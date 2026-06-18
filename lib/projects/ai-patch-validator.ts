/**
 * lib/projects/ai-patch-validator.ts
 *
 * Sprint 11: Server-side validation of AI-proposed file patches.
 *
 * Never trust the AI.  Every patch must pass every check here before
 * it is marked safeToApply:true.  Blocked patches are returned in the
 * plan (visible to the user) but cannot be applied.
 *
 * Safety rules enforced:
 *  - Relative paths only (no absolute paths, no ..)
 *  - Must stay inside project root (delegates to assertSafeProjectPath)
 *  - Blocked file types (env, pem, key, binary, etc.)
 *  - Action must be "modify" | "create" | "delete"
 *  - "modify" target must exist on disk
 *  - "create" target must NOT already exist (prevents silent overwrites)
 *  - "delete" requires confirmedDelete:true in caller
 *  - newContent size <= 300 KB
 *  - Package.json changes are allowed but flagged as medium risk
 *  - .git/config and node_modules are always blocked
 *  - No more than 10 patches total (enforced in action, not here)
 *  - Total newContent <= 800 KB (enforced in action)
 */

import { promises as fs } from "fs";
import {
  assertSafeProjectPath,
  isEditableTextFile,
} from "@/lib/projects/file-manager";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PATCH_CONTENT_BYTES = 300 * 1024; // 300 KB per patch

// ── Extra blocked path patterns ───────────────────────────────────────────────

const EXTRA_BLOCKED_PATTERNS: RegExp[] = [
  /^\.git\//,
  /^\.git$/,
  /node_modules\//,
  /^node_modules$/,
  /^\.next\//,
  /^dist\//,
  /^build\//,
  /^out\//,
  /^coverage\//,
  /^logs\//,
  /^storage\//,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /\.p12$/i,
  /\.db$/i,
  /\.sqlite$/i,
];

function isExtraBlocked(relativePath: string): boolean {
  return EXTRA_BLOCKED_PATTERNS.some((rx) => rx.test(relativePath));
}

// ── Per-patch validation result ───────────────────────────────────────────────

export interface PatchValidationResult {
  safeToApply:    boolean;
  blockedReason?: string;
  /** Advisory warning added to the patch (does not block application). */
  advisoryNote?:  string;
}

// ── Validate a single patch ───────────────────────────────────────────────────

export async function validateAiFilePatch(
  root:  string,
  patch: {
    path:       string;
    action:     string;
    newContent?: string;
  },
  opts: {
    /** Paths the user explicitly selected — modify must be in this set (unless empty). */
    allowedPaths?:    Set<string>;
    confirmedDelete?: boolean;
  } = {},
): Promise<PatchValidationResult> {
  const { path: relPath, action, newContent } = patch;

  // ── Action check ────────────────────────────────────────────────────────────
  if (action !== "modify" && action !== "create" && action !== "delete") {
    return { safeToApply: false, blockedReason: `Unknown action "${action}".` };
  }

  // ── Delete requires explicit confirmation ────────────────────────────────────
  if (action === "delete" && !opts.confirmedDelete) {
    return {
      safeToApply:   false,
      blockedReason: "Delete operations require explicit confirmation.",
    };
  }

  // ── Extra blocked patterns (before assertSafeProjectPath) ───────────────────
  if (isExtraBlocked(relPath)) {
    return {
      safeToApply:   false,
      blockedReason: `Path "${relPath}" is in a protected location and cannot be edited.`,
    };
  }

  // ── Sprint 6 path safety (traversal, symlinks, .env, blocked types) ─────────
  const pathCheck = await assertSafeProjectPath(root, relPath);
  if (!pathCheck.ok) {
    return { safeToApply: false, blockedReason: pathCheck.error };
  }

  // ── Editable file type check ─────────────────────────────────────────────────
  if (!isEditableTextFile(relPath)) {
    return {
      safeToApply:   false,
      blockedReason: `"${relPath}" is not an editable text file type.`,
    };
  }

  // ── For modify: path must be in allowed set (if provided and non-empty) ───────
  if (action === "modify" && opts.allowedPaths && opts.allowedPaths.size > 0) {
    if (!opts.allowedPaths.has(relPath)) {
      return {
        safeToApply:   false,
        blockedReason: `"${relPath}" was not in the list of files you selected for editing.`,
      };
    }
  }

  // ── newContent size limit ────────────────────────────────────────────────────
  if (action !== "delete" && newContent !== undefined) {
    const bytes = Buffer.byteLength(newContent, "utf8");
    if (bytes > MAX_PATCH_CONTENT_BYTES) {
      return {
        safeToApply:   false,
        blockedReason: `Proposed content for "${relPath}" is too large (${Math.round(bytes / 1024)} KB > 300 KB limit).`,
      };
    }
  }

  if (action !== "delete" && (newContent === undefined || newContent === "")) {
    return {
      safeToApply:   false,
      blockedReason: `No new content provided for "${relPath}".`,
    };
  }

  // ── For modify: target file must already exist ────────────────────────────────
  if (action === "modify") {
    try {
      const stat = await fs.stat(pathCheck.absolutePath);
      if (!stat.isFile()) {
        return { safeToApply: false, blockedReason: `"${relPath}" is not a regular file.` };
      }
    } catch {
      return {
        safeToApply:   false,
        blockedReason: `"${relPath}" does not exist. Use "create" action for new files.`,
      };
    }
  }

  // ── For create: target must NOT already exist ────────────────────────────────
  if (action === "create") {
    try {
      await fs.access(pathCheck.absolutePath);
      // File exists
      return {
        safeToApply:   false,
        blockedReason: `"${relPath}" already exists. Use "modify" action to edit existing files.`,
      };
    } catch {
      // Does not exist — good
    }
  }

  // ── For delete: target must exist ────────────────────────────────────────────
  if (action === "delete") {
    try {
      await fs.access(pathCheck.absolutePath);
    } catch {
      return {
        safeToApply:   false,
        blockedReason: `"${relPath}" does not exist and cannot be deleted.`,
      };
    }
  }

  // ── Advisory: package.json changes ──────────────────────────────────────────
  const basename = relPath.split("/").pop() ?? relPath;
  let advisoryNote: string | undefined;
  if (basename === "package.json") {
    advisoryNote =
      "package.json changes are allowed. Use the Packages tab for dependency installs/removes.";
  }

  return { safeToApply: true, advisoryNote };
}

// ── Validate total plan limits ────────────────────────────────────────────────

export interface PlanLimitCheck {
  ok:     boolean;
  error?: string;
}

export function checkPatchPlanLimits(patches: Array<{ newContent?: string }>): PlanLimitCheck {
  if (patches.length > 10) {
    return { ok: false, error: `Too many patches in one plan (${patches.length} > 10 max).` };
  }

  let totalBytes = 0;
  for (const p of patches) {
    if (p.newContent) {
      totalBytes += Buffer.byteLength(p.newContent, "utf8");
    }
  }
  if (totalBytes > 800 * 1024) {
    return {
      ok:    false,
      error: `Total patch content is too large (${Math.round(totalBytes / 1024)} KB > 800 KB limit).`,
    };
  }

  return { ok: true };
}
