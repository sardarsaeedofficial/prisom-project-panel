"use server";

/**
 * app/actions/project-ai-patches.ts
 *
 * Sprint 11: Server actions for the structured AI patch review and apply workflow.
 *
 * Safety rules:
 *  1. Ownership verified on every call.
 *  2. Every AI-proposed path validated via Sprint 6 file-manager + ai-patch-validator.
 *  3. File contents redacted before being sent to AI.
 *  4. AI cannot apply changes — user must explicitly call applyProjectPatchPlanAction.
 *  5. Apply step re-validates every patch (never trusts client-sent safeToApply).
 *  6. No auto-commit, auto-push, auto-restart, auto-deploy.
 *  7. Full file contents are never logged.
 */

import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { randomUUID }     from "crypto";

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { db }                    from "@/lib/db";

import {
  getProjectFileRoot,
  assertSafeProjectPath,
  isEditableTextFile,
  writeProjectTextFile,
  MAX_FILE_AI_BYTES,
} from "@/lib/projects/file-manager";
import { redact }               from "@/lib/ai/redaction";

import {
  generateAiPatchPlan,
  type AiPatchPlan,
  type AiFilePatch,
} from "@/lib/ai/project-patches";

import {
  validateAiFilePatch,
  checkPatchPlanLimits,
} from "@/lib/projects/ai-patch-validator";

// ── Shared result type ────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return { ok: false, error: "Not authenticated." };
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found." };
  }
  return { ok: true, projectId: project.id };
}

// ── generateProjectPatchPlanAction ────────────────────────────────────────────

export interface PatchPlanInput {
  projectId: string;
  instruction: string;
  /** Relative paths the user explicitly selected for editing. */
  paths: string[];
  /**
   * Current editor tab content (unsaved changes included).
   * When provided, this is used instead of reading from disk,
   * so the AI sees what the user is actually editing.
   */
  openEditorContents?: Array<{
    path:       string;
    content:    string;
    modifiedAt?: string;
  }>;
}

/**
 * Generate a structured AI patch plan for the given files and instruction.
 *
 * - Validates each selected path (no .env, no traversal, editable type).
 * - Loads content from openEditorContents first, falls back to disk.
 * - Redacts content before sending to AI.
 * - Server-side validates every AI-proposed patch after generation.
 * - Sets safeToApply / blockedReason on each patch.
 * - Sets oldContent from editor/disk for diff display.
 */
export async function generateProjectPatchPlanAction(
  input: PatchPlanInput,
): Promise<ActionResult<AiPatchPlan>> {
  const { projectId, instruction, paths, openEditorContents = [] } = input;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // ── Instruction sanity check ────────────────────────────────────────────────
  if (!instruction || instruction.trim().length < 3) {
    return { ok: false, error: "Please provide a clear instruction (at least 3 characters)." };
  }

  // ── Paths check ─────────────────────────────────────────────────────────────
  if (!paths || paths.length === 0) {
    return { ok: false, error: "Select at least one file for the AI to work with." };
  }
  if (paths.length > 10) {
    return { ok: false, error: "Maximum 10 files per patch request." };
  }

  // ── Resolve project root ────────────────────────────────────────────────────
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };
  const { root } = rootResult;

  // ── Build editor content lookup ──────────────────────────────────────────────
  const editorMap = new Map(openEditorContents.map((e) => [e.path, e]));

  // ── Load and validate each selected file ────────────────────────────────────
  const selectedFiles: Array<{ path: string; content: string }> = [];
  const oldContentMap = new Map<string, string>(); // path → current content for diff

  for (const relPath of paths) {
    // Path safety (Sprint 6)
    const pathCheck = await assertSafeProjectPath(root, relPath);
    if (!pathCheck.ok) {
      return { ok: false, error: `Blocked path "${relPath}": ${pathCheck.error}` };
    }

    if (!isEditableTextFile(relPath)) {
      return { ok: false, error: `"${relPath}" is not an editable file type.` };
    }

    let content: string;

    // Use open editor content if available (includes unsaved changes)
    const editorEntry = editorMap.get(relPath);
    if (editorEntry) {
      content = editorEntry.content.slice(0, MAX_FILE_AI_BYTES);
      oldContentMap.set(relPath, editorEntry.content);
    } else {
      // Fall back to reading from disk
      try {
        const raw = await fs.readFile(pathCheck.absolutePath, "utf8");
        content = raw.slice(0, MAX_FILE_AI_BYTES);
        oldContentMap.set(relPath, raw);
      } catch {
        return { ok: false, error: `Could not read "${relPath}".` };
      }
    }

    selectedFiles.push({ path: relPath, content: redact(content) });
  }

  // ── Call AI ─────────────────────────────────────────────────────────────────
  const aiResult = await generateAiPatchPlan(
    projectId,
    redact(instruction),
    selectedFiles,
  );

  if (!aiResult.ok) {
    return { ok: false, error: aiResult.error, code: aiResult.code };
  }

  const raw = aiResult.data.raw;

  // Handle raw fallback (JSON parse failed)
  if ("rawFallback" in raw && raw.rawFallback) {
    const fallbackPlan: AiPatchPlan = {
      summary:           raw.summary,
      riskLevel:         "high",
      warnings:          [...raw.warnings, "AI returned an unstructured response — no patches can be applied."],
      verificationSteps: [],
      patches:           [],
      rawFallback:       raw.rawFallback as string,
    };
    return { ok: true, data: fallbackPlan };
  }

  // ── Plan-level limits ────────────────────────────────────────────────────────
  const rawPatches = raw.rawPatches ?? [];
  const limitCheck = checkPatchPlanLimits(
    rawPatches.map((p) => ({ newContent: typeof p.newContent === "string" ? p.newContent : undefined })),
  );
  const planWarnings = [...raw.warnings];
  if (!limitCheck.ok) {
    planWarnings.push(`⛔ ${limitCheck.error}`);
  }

  // ── Validate each patch ──────────────────────────────────────────────────────
  const allowedPaths = new Set(paths);
  const validatedPatches: AiFilePatch[] = [];

  for (const rawPatch of rawPatches.slice(0, 10)) {
    const patchPath    = typeof rawPatch.path        === "string" ? rawPatch.path.trim()        : "";
    const action       = typeof rawPatch.action      === "string" ? rawPatch.action              : "modify";
    const title        = typeof rawPatch.title       === "string" ? rawPatch.title.slice(0, 200) : "Untitled patch";
    const explanation  = typeof rawPatch.explanation === "string" ? rawPatch.explanation.slice(0, 1000) : "";
    const newContent   = typeof rawPatch.newContent  === "string" ? rawPatch.newContent          : undefined;
    const unifiedDiff  = typeof rawPatch.unifiedDiff === "string" ? rawPatch.unifiedDiff.slice(0, 50_000) : undefined;

    if (!patchPath) {
      validatedPatches.push({
        id: randomUUID(), path: "(unknown)", action: "modify", title, explanation,
        safeToApply: false, blockedReason: "Patch has no file path.",
      });
      continue;
    }

    // Server-side safety validation
    const validation = await validateAiFilePatch(root, { path: patchPath, action, newContent }, {
      allowedPaths:    action === "modify" ? allowedPaths : undefined,
      confirmedDelete: false, // delete always blocked at generate time; needs explicit confirm on apply
    });

    // Set oldContent from editor / disk (for diff display) — only for modify
    let oldContent: string | undefined;
    if (action === "modify") {
      oldContent = oldContentMap.get(patchPath);
      // If not in selected files but exists on disk (edge case), try to read
      if (!oldContent) {
        const pc = await assertSafeProjectPath(root, patchPath).catch(() => ({ ok: false as const }));
        if (pc.ok) {
          try { oldContent = await fs.readFile(pc.absolutePath, "utf8"); } catch { /* ignore */ }
        }
      }
    }

    const advisoryWarnings: string[] = validation.advisoryNote ? [validation.advisoryNote] : [];

    validatedPatches.push({
      id:             randomUUID(),
      path:           patchPath,
      action:         (action === "modify" || action === "create" || action === "delete") ? action : "modify",
      title,
      explanation,
      oldContent,
      newContent,
      unifiedDiff,
      safeToApply:    validation.safeToApply && limitCheck.ok,
      blockedReason:  validation.safeToApply ? (limitCheck.ok ? undefined : limitCheck.error) : validation.blockedReason,
      ...(advisoryWarnings.length > 0 && { explanation: explanation + "\n\n⚠ " + advisoryWarnings.join(" ") }),
    });
  }

  const plan: AiPatchPlan = {
    summary:           raw.summary,
    riskLevel:         raw.riskLevel,
    warnings:          planWarnings,
    verificationSteps: raw.verificationSteps,
    patches:           validatedPatches,
  };

  return { ok: true, data: plan };
}

// ── applyProjectPatchPlanAction ───────────────────────────────────────────────

export interface ApplyPatchInput {
  projectId: string;
  patches: Array<{
    id:                 string;
    path:               string;
    action:             "modify" | "create" | "delete";
    newContent?:        string;
    expectedModifiedAt?: string;
  }>;
  /** Required true for any delete operation to proceed. */
  confirmedDelete?: boolean;
}

export interface ApplyPatchOutput {
  applied: Array<{ id: string; path: string; action: string; size: number; modifiedAt: string }>;
  skipped: Array<{ id: string; path: string; reason: string }>;
}

/**
 * Apply explicitly user-approved patches to disk.
 *
 * Safety: re-validates every patch server-side — never trusts client-sent
 * safeToApply.  Applies only through Sprint 6 writeProjectTextFile.
 */
export async function applyProjectPatchPlanAction(
  input: ApplyPatchInput,
): Promise<ActionResult<ApplyPatchOutput>> {
  const { projectId, patches, confirmedDelete = false } = input;

  if (!patches || patches.length === 0) {
    return { ok: false, error: "No patches to apply." };
  }
  if (patches.length > 10) {
    return { ok: false, error: "Too many patches in a single apply (max 10)." };
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // ── Resolve project root ────────────────────────────────────────────────────
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };
  const { root } = rootResult;

  const applied: ApplyPatchOutput["applied"] = [];
  const skipped: ApplyPatchOutput["skipped"] = [];

  for (const patch of patches) {
    const { id, path: relPath, action, newContent, expectedModifiedAt } = patch;

    // Re-validate every patch server-side (never trust client)
    const validation = await validateAiFilePatch(
      root,
      { path: relPath, action, newContent },
      { confirmedDelete },
    );

    if (!validation.safeToApply) {
      skipped.push({ id, path: relPath, reason: validation.blockedReason ?? "Validation failed." });
      continue;
    }

    // ── Optimistic concurrency check for modify ────────────────────────────────
    if (action === "modify" && expectedModifiedAt) {
      const pathCheck = await assertSafeProjectPath(root, relPath);
      if (!pathCheck.ok) {
        skipped.push({ id, path: relPath, reason: pathCheck.error });
        continue;
      }
      try {
        const stat = await fs.stat(pathCheck.absolutePath);
        if (stat.mtime.toISOString() !== expectedModifiedAt) {
          skipped.push({
            id, path: relPath,
            reason: "File changed on disk since patch was generated. Reload and regenerate.",
          });
          continue;
        }
      } catch {
        // File doesn't exist — treat as create-on-modify edge case; will fail writeProjectTextFile
      }
    }

    // ── Apply ──────────────────────────────────────────────────────────────────
    if (action === "modify" || action === "create") {
      if (!newContent) {
        skipped.push({ id, path: relPath, reason: "No content provided for apply." });
        continue;
      }

      // For create: ensure parent directory exists
      if (action === "create") {
        const pathCheck = await assertSafeProjectPath(root, relPath);
        if (!pathCheck.ok) {
          skipped.push({ id, path: relPath, reason: pathCheck.error });
          continue;
        }
        try {
          await fs.mkdir(path.dirname(pathCheck.absolutePath), { recursive: true });
        } catch {
          skipped.push({ id, path: relPath, reason: "Failed to create parent directory." });
          continue;
        }
      }

      const writeResult = await writeProjectTextFile(projectId, relPath, newContent);
      if (!writeResult.ok) {
        skipped.push({ id, path: relPath, reason: writeResult.error });
        continue;
      }
      const { size, modifiedAt } = writeResult.data;
      applied.push({ id, path: relPath, action, size, modifiedAt });
      revalidatePath(`/projects/${projectId}/files`);

    } else if (action === "delete") {
      // Delete requires confirmedDelete:true — already checked in validation
      const pathCheck = await assertSafeProjectPath(root, relPath);
      if (!pathCheck.ok) {
        skipped.push({ id, path: relPath, reason: pathCheck.error });
        continue;
      }
      try {
        await fs.unlink(pathCheck.absolutePath);
        applied.push({
          id, path: relPath, action,
          size: 0, modifiedAt: new Date().toISOString(),
        });
        revalidatePath(`/projects/${projectId}/files`);
      } catch (e) {
        skipped.push({ id, path: relPath, reason: `Could not delete file: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }

  return { ok: true, data: { applied, skipped } };
}
