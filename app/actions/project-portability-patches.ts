"use server";

/**
 * app/actions/project-portability-patches.ts
 *
 * Sprint 25: Server actions for Replit portability patches.
 *
 * Safety rules:
 *   - All patch paths are re-validated server-side at apply time
 *   - apply requires confirmationText === "APPLY"
 *   - Git/backup guard blocks unsafe apply (no git + no backup)
 *   - Patch plan is re-generated server-side at apply time (never trust client)
 *   - Conflict detection: "before" content must match current file
 *   - Audit events on plan, apply, fail, skip
 *   - Never writes .env, node_modules, or lock files
 */

import path from "path";
import { promises as fs } from "fs";
import { db }                        from "@/lib/db";
import { requireProjectPermission }  from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }    from "@/lib/audit/project-audit";
import { getAuditRequestContext }    from "@/lib/audit/request-context";
import {
  resolveCheckedSourceDir,
  guardBeforeApply,
} from "@/lib/migration/portability-patch-safety";
import {
  planPatch,
  listPatchSummaries,
  type PlannerInput,
} from "@/lib/migration/portability-patch-planner";
import { applyPortabilityPatch } from "@/lib/migration/portability-patch-apply";
import type {
  PortabilityPatchPlan,
  PatchSummary,
  ApplyPatchResult,
  PatchId,
} from "@/lib/migration/portability-patch-types";

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Source-file scanner (reused across actions) ───────────────────────────────

const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", ".cache", "releases"]);
const NEVER_READ = [/^\.env$/i, /^\.env\./i, /\.pem$/i, /\.key$/i];
const MAX_FILES  = 300;
const MAX_BYTES  = 100 * 1024;

async function collectSourceFiles(
  sourceDir: string,
): Promise<{ fileList: string[]; allContent: string; allDeps: Record<string, string> }> {
  const fileList: string[] = [];
  const contentParts: string[] = [];
  let allDeps: Record<string, string> = {};

  async function walk(dir: string, prefix: string): Promise<void> {
    if (fileList.length >= MAX_FILES) return;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (fileList.length >= MAX_FILES) break;
      const name    = entry.name;
      const absPath = path.join(dir, name);
      const relPath = prefix ? `${prefix}/${name}` : name;

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) await walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      fileList.push(relPath);
      if (NEVER_READ.some((r) => r.test(name))) continue;
      if (!SCAN_EXTS.has(path.extname(name)) && name !== "package.json") continue;

      try {
        const stat = await fs.lstat(absPath);
        if (stat.isSymbolicLink() || stat.size > MAX_BYTES) continue;
        const content = await fs.readFile(absPath, "utf8");
        contentParts.push(content);

        // Parse package.json deps
        if (name === "package.json") {
          try {
            const pkg = JSON.parse(content);
            allDeps = { ...allDeps, ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
          } catch { /* ignore */ }
        }
      } catch { /* skip unreadable */ }
    }
  }

  await walk(sourceDir, "");
  return { fileList, allContent: contentParts.join("\n"), allDeps };
}

// ── 1. List available patches ─────────────────────────────────────────────────

export async function listPatchesAction(
  projectId: string,
): Promise<ActionResult<PatchSummary[]>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  if (!project) return { ok: false, error: "Project not found." };

  const sourceDir = resolveCheckedSourceDir(project.slug);
  if (!sourceDir) return { ok: false, error: "Invalid project slug." };

  try {
    await fs.access(sourceDir);
  } catch {
    return { ok: false, error: "Project source directory not found. Import source files first." };
  }

  const { fileList, allContent, allDeps } = await collectSourceFiles(sourceDir);
  const input: PlannerInput = { projectId, sourceDir, allContent, fileList, allDeps };

  const summaries = await listPatchSummaries(input);
  return { ok: true, data: summaries };
}

// ── 2. Plan a specific patch (returns full plan with diffs) ───────────────────

export async function planPatchAction(
  projectId: string,
  patchId:   PatchId,
): Promise<ActionResult<PortabilityPatchPlan>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  if (!project) return { ok: false, error: "Project not found." };

  const sourceDir = resolveCheckedSourceDir(project.slug);
  if (!sourceDir) return { ok: false, error: "Invalid project slug." };

  try { await fs.access(sourceDir); }
  catch { return { ok: false, error: "Project source directory not found." }; }

  const { fileList, allContent, allDeps } = await collectSourceFiles(sourceDir);
  const input: PlannerInput = { projectId, sourceDir, allContent, fileList, allDeps };

  let plan: PortabilityPatchPlan;
  try {
    plan = await planPatch(patchId, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Patch planning failed: ${msg}` };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.patch_planned",
    category:    "publishing",
    result:      "success",
    summary:     `Patch planned: ${plan.title} (status: ${plan.status})`,
    metadata: {
      patchId:           plan.id,
      patchTitle:        plan.title,
      status:            plan.status,
      filesCount:        plan.files.length,
      requiredSecrets:   plan.requiredSecrets,
      requiredPackages:  plan.requiredPackages,
    },
    ...ctx,
  }).catch(() => null);

  // Strip file content from plan — client only needs the diff string.
  // Keep `after` as empty string since the type requires string; client renders only `diff`.
  const safeplan: PortabilityPatchPlan = {
    ...plan,
    files: plan.files.map((f) => ({
      ...f,
      before: undefined,  // strip old content — not needed client-side
      after:  "",         // strip new content — client renders only the `diff` field
    })),
  };

  return { ok: true, data: safeplan };
}

// ── 3. Apply a patch ──────────────────────────────────────────────────────────

export async function applyPatchAction(
  projectId:        string,
  patchId:          PatchId,
  confirmationText: string,
): Promise<ActionResult<ApplyPatchResult>> {
  // ── Confirmation gate ─────────────────────────────────────────────────────
  if (confirmationText.trim().toUpperCase() !== "APPLY") {
    return { ok: false, error: 'Type "APPLY" to confirm.' };
  }

  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({ where: { id: projectId }, select: { slug: true, name: true } });
  if (!project) return { ok: false, error: "Project not found." };

  const sourceDir = resolveCheckedSourceDir(project.slug);
  if (!sourceDir) return { ok: false, error: "Invalid project slug." };

  try { await fs.access(sourceDir); }
  catch { return { ok: false, error: "Project source directory not found." }; }

  // ── Backup / git guard ────────────────────────────────────────────────────
  const guard = await guardBeforeApply(projectId, sourceDir);
  if (!guard.ok) {
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId, actorUserId: auth.userId, actorRole: auth.role,
      action: "project.migration.patch_skipped",
      category: "publishing", result: "skipped",
      summary: `Patch skipped (guard): ${patchId} — ${guard.error}`,
      metadata: { patchId, reason: guard.error },
      ...ctx,
    }).catch(() => null);
    return { ok: false, error: guard.error };
  }

  // ── Re-generate patch plan server-side (never trust client plan) ──────────
  const { fileList, allContent, allDeps } = await collectSourceFiles(sourceDir);
  const plannerInput: PlannerInput = { projectId, sourceDir, allContent, fileList, allDeps };

  let plan: PortabilityPatchPlan;
  try {
    plan = await planPatch(patchId, plannerInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Could not generate patch plan: ${msg}` };
  }

  if (plan.status !== "available") {
    return { ok: false, error: `Patch is not applicable (${plan.status}): ${plan.statusReason ?? ""}`.trim() };
  }

  if (plan.files.length === 0) {
    return { ok: false, error: "Patch plan produced no file changes." };
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  let result: ApplyPatchResult;
  try {
    result = await applyPortabilityPatch(plan, sourceDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId, actorUserId: auth.userId, actorRole: auth.role,
      action:   "project.migration.patch_failed",
      category: "publishing", result: "failed",
      summary:  `Patch failed: ${plan.title} — ${msg}`,
      metadata: { patchId, patchTitle: plan.title, error: msg },
      ...ctx,
    }).catch(() => null);
    return { ok: false, error: `Patch apply failed: ${msg}` };
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      result.ok ? "project.migration.patch_applied" : "project.migration.patch_failed",
    category:    "publishing",
    result:      result.ok ? "success" : "failed",
    summary:     result.ok
      ? `Patch applied: ${plan.title} (${result.filesCreated + result.filesUpdated} files changed)`
      : `Patch failed: ${plan.title} — ${result.errors.join("; ")}`,
    metadata: {
      patchId:              plan.id,
      patchTitle:           plan.title,
      filesCreated:         result.filesCreated,
      filesUpdated:         result.filesUpdated,
      errorCount:           result.errors.length,
      requiredSecrets:      result.requiredSecrets,
      dependencyChanges:    result.requiredPackages.length,
    },
    ...ctx,
  }).catch(() => null);

  if (!result.ok && result.errors.length > 0) {
    return {
      ok:    false,
      error: `Patch partially failed: ${result.errors.join(" | ")}`,
    };
  }

  return { ok: true, data: result };
}
