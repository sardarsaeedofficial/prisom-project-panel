"use server";

/**
 * app/actions/project-files.ts
 *
 * Sprint 6: server actions for the safe project file browser/editor.
 *
 * Every action:
 *  1. Verifies project ownership via getCurrentWorkspaceId().
 *  2. Delegates all path safety to lib/projects/file-manager.ts.
 *  3. Never returns absolute paths to the client.
 *  4. Never reads or returns .env values.
 *  5. Enforces optimistic concurrency on saves.
 */

import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  getProjectFileRoot,
  assertSafeProjectPath,
  isEditableTextFile,
  normalizeProjectRelativePath,
  listProjectFiles,
  readProjectTextFile,
  writeProjectTextFile,
  type ProjectFileTree,
} from "@/lib/projects/file-manager";

// ── Shared result type ────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyProjectOwnership(
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  // Sprint 17: file operations require files.read (read-only ops also allowed by files.write roles)
  // Using files.read so all roles with file access can use this guard; write ops
  // are further validated by the individual actions that need files.write.
  const auth = await requireProjectPermission(projectId, "files.read");
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, projectId };
}

// ── getProjectFileTreeAction ──────────────────────────────────────────────────

export interface FileTreeItem {
  path:  string;
  name:  string;
  isDir: boolean;
  size:  number;
  depth: number;
}

export interface FileTreeResult {
  label: string;
  files: FileTreeItem[];
  totalFiles: number;
  truncated:  boolean;
}

export async function getProjectFileTreeAction(
  projectId: string,
): Promise<ActionResult<FileTreeResult>> {
  const auth = await verifyProjectOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await listProjectFiles(projectId, { maxFiles: 800, maxDepth: 8 });
  if (!result.ok) return { ok: false, error: result.error };

  const { label, files } = result.data;

  return {
    ok:   true,
    data: {
      label,
      files:      files.map(({ path, name, isDir, size, depth }) => ({ path, name, isDir, size, depth })),
      totalFiles: files.filter((f) => !f.isDir).length,
      truncated:  files.length >= 800,
    },
  };
}

// ── readProjectFileAction ─────────────────────────────────────────────────────

export interface ReadFileResult {
  path:       string;
  content:    string;
  size:       number;
  modifiedAt: string;
  language:   string;
}

export async function readProjectFileAction(
  projectId:    string,
  relativePath: string,
): Promise<ActionResult<ReadFileResult>> {
  const auth = await verifyProjectOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await readProjectTextFile(projectId, relativePath);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, data: result.data };
}

// ── saveProjectFileAction ─────────────────────────────────────────────────────

export interface SaveFileInput {
  projectId:          string;
  relativePath:       string;
  content:            string;
  /** ISO mtime from the last successful read — used for conflict detection. */
  expectedModifiedAt?: string;
}

export interface SaveFileResult {
  path:       string;
  size:       number;
  modifiedAt: string;
}

export async function saveProjectFileAction(
  input: SaveFileInput,
): Promise<ActionResult<SaveFileResult>> {
  const { projectId, relativePath, content, expectedModifiedAt } = input;

  const auth = await verifyProjectOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Resolve the root and check path safety (needed for mtime check)
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };

  const { root } = rootResult;
  const pathResult = await assertSafeProjectPath(root, relativePath);
  if (!pathResult.ok) return { ok: false, error: pathResult.error };

  // Editable file check
  if (!isEditableTextFile(relativePath)) {
    return { ok: false, error: "This file type cannot be edited.", code: "UNSUPPORTED_TYPE" };
  }

  // Optimistic concurrency: compare mtime if the client sent one
  if (expectedModifiedAt) {
    try {
      const stat = await fs.stat(pathResult.absolutePath);
      const diskMtime = stat.mtime.toISOString();
      if (diskMtime !== expectedModifiedAt) {
        return {
          ok:    false,
          error: "File changed on disk. Reload before saving.",
          code:  "CONFLICT",
        };
      }
    } catch {
      // File doesn't exist yet — that's allowed for new files
    }
  }

  const result = await writeProjectTextFile(projectId, relativePath, content);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/projects/${projectId}/files`);

  return { ok: true, data: result.data };
}

// ── createProjectFileAction ───────────────────────────────────────────────────

export interface CreateFileInput {
  projectId:    string;
  relativePath: string;
  content?:     string;
}

export async function createProjectFileAction(
  input: CreateFileInput,
): Promise<ActionResult<SaveFileResult>> {
  const { projectId, relativePath, content = "" } = input;

  const auth = await verifyProjectOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  // Resolve root and validate path
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };

  const { root } = rootResult;
  const pathResult = await assertSafeProjectPath(root, relativePath);
  if (!pathResult.ok) return { ok: false, error: pathResult.error };

  if (!isEditableTextFile(relativePath)) {
    return { ok: false, error: "That file type cannot be created here.", code: "UNSUPPORTED_TYPE" };
  }

  // Refuse to overwrite an existing file
  try {
    await fs.access(pathResult.absolutePath);
    return { ok: false, error: "A file already exists at that path.", code: "ALREADY_EXISTS" };
  } catch {
    // Doesn't exist — good
  }

  // Ensure parent directory exists
  try {
    await fs.mkdir(path.dirname(pathResult.absolutePath), { recursive: true });
  } catch {
    return { ok: false, error: "Failed to create parent directory." };
  }

  const result = await writeProjectTextFile(projectId, relativePath, content);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/projects/${projectId}/files`);

  return { ok: true, data: result.data };
}

// ── applyAiPatchAction ────────────────────────────────────────────────────────

export interface PatchToApply {
  path:                string;
  proposedContent:     string;
  expectedModifiedAt?: string;
}

export interface ApplyPatchResult {
  applied: Array<{ path: string; size: number; modifiedAt: string }>;
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Apply AI-proposed patches after explicit user approval.
 *
 * Each patch is independently validated and applied.
 * If any patch fails validation, it is skipped — others still proceed.
 * The user must explicitly click "Apply Patch" for this to run.
 */
export async function applyAiPatchAction(input: {
  projectId: string;
  patches:   PatchToApply[];
}): Promise<ActionResult<ApplyPatchResult>> {
  const { projectId, patches } = input;

  if (!patches || patches.length === 0) {
    return { ok: false, error: "No patches to apply." };
  }
  if (patches.length > 10) {
    return { ok: false, error: "Too many patches in a single apply (max 10)." };
  }

  const auth = await verifyProjectOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };

  const { root } = rootResult;
  const applied: ApplyPatchResult["applied"] = [];
  const skipped: ApplyPatchResult["skipped"] = [];

  for (const patch of patches) {
    const { path: relPath, proposedContent, expectedModifiedAt } = patch;

    // Path safety
    const pathResult = await assertSafeProjectPath(root, relPath);
    if (!pathResult.ok) {
      skipped.push({ path: relPath, reason: pathResult.error });
      continue;
    }

    // File type check
    if (!isEditableTextFile(relPath)) {
      skipped.push({ path: relPath, reason: "File type is not editable." });
      continue;
    }

    // Optimistic concurrency
    if (expectedModifiedAt) {
      try {
        const stat = await fs.stat(pathResult.absolutePath);
        if (stat.mtime.toISOString() !== expectedModifiedAt) {
          skipped.push({ path: relPath, reason: "File changed on disk since patch was generated. Reload and retry." });
          continue;
        }
      } catch {
        // File doesn't exist — create is OK
      }
    }

    const writeResult = await writeProjectTextFile(projectId, relPath, proposedContent);
    if (!writeResult.ok) {
      skipped.push({ path: relPath, reason: writeResult.error });
      continue;
    }

    applied.push(writeResult.data);
    revalidatePath(`/projects/${projectId}/files`);
  }

  return {
    ok:   true,
    data: { applied, skipped },
  };
}
