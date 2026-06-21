/**
 * lib/migration/portability-patch-safety.ts
 *
 * Sprint 25: Safety guards for portability patch file operations.
 *
 * - Path validation (must be relative, under project source root, no traversal)
 * - Git working-tree check
 * - Recent backup check
 * - Never-patch-file rules (.env, node_modules, lock files)
 */

import path   from "path";
import { promises as fs } from "fs";
import { execFile }       from "child_process";
import { promisify }      from "util";
import { db }             from "@/lib/db";
import {
  resolveProjectSource,
  resolveUnder,
  isSafeSlug,
} from "@/lib/backups/project-backup-safety";

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum bytes allowed for a single patched file. */
const MAX_PATCH_FILE_BYTES = 200 * 1024;  // 200 KB

/** A backup created within this many hours counts as "recent". */
const RECENT_BACKUP_HOURS = 24;

// ── Files / paths that may never be patched ───────────────────────────────────

const NEVER_PATCH_BASENAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.staging", ".env.development",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  ".npmrc", ".yarnrc", ".yarnrc.yml",
]);

const NEVER_PATCH_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  "releases", "coverage", ".cache", ".turbo",
]);

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Validate that a patch file path is safe to write.
 * Returns the absolute path if safe, or null with an error message.
 */
export function validatePatchPath(
  relPath:   string,
  sourceDir: string,
): { ok: true; absPath: string } | { ok: false; error: string } {
  if (!relPath || typeof relPath !== "string") {
    return { ok: false, error: "Patch path is empty." };
  }
  if (path.isAbsolute(relPath)) {
    return { ok: false, error: `Patch path must be relative: ${relPath}` };
  }
  const normalised = relPath.replace(/\\/g, "/");
  if (normalised.includes("../") || normalised.startsWith("../") || normalised.includes("\0")) {
    return { ok: false, error: `Patch path contains traversal: ${relPath}` };
  }

  // Check basename is never-patch
  const basename = path.basename(normalised);
  if (NEVER_PATCH_BASENAMES.has(basename)) {
    return { ok: false, error: `Patch may not modify ${basename}.` };
  }

  // Check no component is a never-patch dir
  const parts = normalised.split("/");
  for (const part of parts.slice(0, -1)) {
    if (NEVER_PATCH_DIRS.has(part)) {
      return { ok: false, error: `Patch path is inside protected directory: ${part}` };
    }
  }

  // Resolve and verify still under source root
  const absPath = resolveUnder(sourceDir, relPath);
  if (!absPath) {
    return { ok: false, error: `Patch path escapes project root: ${relPath}` };
  }

  return { ok: true, absPath };
}

// ── File size guard ───────────────────────────────────────────────────────────

export async function isPatchFileTooLarge(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.size > MAX_PATCH_FILE_BYTES;
  } catch {
    return false;  // File doesn't exist yet (create op)
  }
}

// ── Git working-tree check ────────────────────────────────────────────────────

export type GitStatus = "clean" | "dirty" | "no_git";

export async function checkProjectGitStatus(sourceDir: string): Promise<GitStatus> {
  // Check if .git directory exists
  try {
    const stat = await fs.lstat(path.join(sourceDir, ".git"));
    if (!stat.isDirectory()) return "no_git";
  } catch {
    return "no_git";
  }

  // Run git status --porcelain with a timeout
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd: sourceDir, timeout: 5_000 },
    );
    return stdout.trim().length === 0 ? "clean" : "dirty";
  } catch {
    return "dirty";  // If git errors, treat as dirty (safe default)
  }
}

// ── Backup guard ──────────────────────────────────────────────────────────────

export async function checkRecentBackup(projectId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RECENT_BACKUP_HOURS * 60 * 60 * 1000);
  const backup = await db.projectBackup.findFirst({
    where: {
      projectId,
      status:      "ready",
      completedAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return backup !== null;
}

// ── Apply guard — safety checks before writing ────────────────────────────────

export type GuardResult =
  | { ok: true }
  | { ok: false; error: string; canOverride: boolean };

export async function guardBeforeApply(
  projectId:  string,
  sourceDir:  string,
): Promise<GuardResult> {
  const [gitStatus, hasBackup] = await Promise.all([
    checkProjectGitStatus(sourceDir),
    checkRecentBackup(projectId),
  ]);

  if (gitStatus === "no_git" && !hasBackup) {
    return {
      ok:          false,
      error:       "No Git repository and no recent backup found. Create a backup first before applying patches.",
      canOverride: false,
    };
  }
  // Git dirty or no-git-but-has-backup: warn but allow with explicit confirmation
  return { ok: true };
}

// ── Source directory resolver ─────────────────────────────────────────────────

export function resolveCheckedSourceDir(projectSlug: string): string | null {
  if (!isSafeSlug(projectSlug)) return null;
  return resolveProjectSource(projectSlug);
}
