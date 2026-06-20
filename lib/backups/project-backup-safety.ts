/**
 * lib/backups/project-backup-safety.ts
 *
 * Sprint 21: Path safety guards for the backup/restore system.
 *
 * All path operations must go through these helpers before touching the filesystem.
 * They enforce:
 *  - All source paths resolve strictly under storage/projects/<slug>
 *  - All backup paths resolve strictly under storage/backups/<slug>
 *  - Restore targets resolve under storage/projects/<slug>
 *  - No path traversal (../)
 *  - No symlink following outside the allowed root
 *  - Archive entry paths are relative-only
 */

import path from "path";
import { promises as fs } from "fs";
import {
  EXCLUDED_DIRS,
  EXCLUDED_FILE_PATTERNS,
  EXCLUDED_EXTENSIONS,
  MAX_BACKUP_FILE_BYTES,
} from "./project-backup-types";

// ── Root directories ──────────────────────────────────────────────────────────

const CWD = process.cwd();

export const PROJECT_SOURCE_ROOT = path.resolve(CWD, "storage", "projects");
export const BACKUP_STORAGE_ROOT_ABS = path.resolve(CWD, "storage", "backups");

// ── Strict directory resolution ───────────────────────────────────────────────

/**
 * Resolve and validate that a path is strictly under an allowed root.
 * Returns the resolved absolute path if safe, null if it would escape.
 */
export function resolveUnder(root: string, ...parts: string[]): string | null {
  const joined = path.resolve(root, ...parts);
  // Ensure resolved path starts with root + path.sep (or equals root exactly)
  if (joined === root || joined.startsWith(root + path.sep)) {
    return joined;
  }
  return null;
}

/**
 * Resolve the source directory for a project slug.
 * Returns null if the slug contains path traversal.
 */
export function resolveProjectSource(slug: string): string | null {
  // Slug must be safe
  if (!isSafeSlug(slug)) return null;
  return resolveUnder(PROJECT_SOURCE_ROOT, slug);
}

/**
 * Resolve the backup storage directory for a project slug.
 */
export function resolveBackupRoot(slug: string): string | null {
  if (!isSafeSlug(slug)) return null;
  return resolveUnder(BACKUP_STORAGE_ROOT_ABS, slug);
}

/**
 * Resolve a specific backup directory.
 */
export function resolveBackupDir(slug: string, backupRef: string): string | null {
  if (!isSafeSlug(slug) || !isSafeRef(backupRef)) return null;
  const root = resolveBackupRoot(slug);
  if (!root) return null;
  return resolveUnder(root, backupRef);
}

// ── Slug / ref validators ─────────────────────────────────────────────────────

/** Project slugs: lowercase alphanumeric and hyphens only. */
export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/** Backup refs: alphanumeric, underscores, hyphens only. */
export function isSafeRef(ref: string): boolean {
  return /^[a-zA-Z0-9_-]{3,80}$/.test(ref);
}

// ── Archive entry path validation ─────────────────────────────────────────────

/**
 * Returns true if an archive entry path is safe to extract.
 * Blocks: absolute paths, path traversal, null bytes, Windows device names.
 */
export function isSafeArchiveEntry(entryPath: string): boolean {
  if (!entryPath || typeof entryPath !== "string") return false;
  if (entryPath.includes("\0")) return false;
  if (path.isAbsolute(entryPath)) return false;
  // Normalise forward slashes for comparison
  const normalised = entryPath.replace(/\\/g, "/");
  if (normalised.includes("../")) return false;
  if (normalised.startsWith("../")) return false;
  // Windows device names
  if (/^(?:CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\/|$)/i.test(normalised)) return false;
  return true;
}

// ── File exclusion checks ─────────────────────────────────────────────────────

/**
 * Returns true if a directory name should be excluded from backups.
 */
export function isExcludedDir(name: string): boolean {
  return EXCLUDED_DIRS.has(name.toLowerCase());
}

/**
 * Returns true if a file basename should be excluded from backups.
 */
export function isExcludedFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  // Check extension
  const ext = path.extname(lower);
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  // Check patterns
  return EXCLUDED_FILE_PATTERNS.some((p) => p.test(basename));
}

/**
 * Returns true if a file should be skipped due to size.
 */
export function isFileTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_BACKUP_FILE_BYTES;
}

// ── Directory walk ────────────────────────────────────────────────────────────

export type WalkEntry = {
  absPath: string;
  relPath: string;   // relative to the walk root, forward slashes
  sizeBytes: number;
};

/**
 * Recursively walk a directory collecting files.
 * Respects EXCLUDED_DIRS, EXCLUDED_FILE_PATTERNS, and size limits.
 * Returns up to MAX_BACKUP_FILE_COUNT entries (truncation is tracked separately).
 */
export async function walkDirectory(
  rootAbs: string,
  maxFiles: number,
  maxTotalBytes: number,
): Promise<{ entries: WalkEntry[]; skipped: number; totalBytes: number }> {
  const entries: WalkEntry[] = [];
  let skipped = 0;
  let totalBytes = 0;

  async function walk(dirAbs: string, prefix: string): Promise<void> {
    if (entries.length >= maxFiles) { skipped++; return; }
    if (totalBytes >= maxTotalBytes) { skipped++; return; }

    let dirEntries: import("fs").Dirent[];
    try {
      dirEntries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;  // Skip unreadable directories silently
    }

    for (const dirent of dirEntries) {
      if (entries.length >= maxFiles) { skipped++; continue; }

      const name = dirent.name;
      const absPath = path.join(dirAbs, name);
      const relPath = prefix ? `${prefix}/${name}` : name;

      if (dirent.isDirectory()) {
        if (isExcludedDir(name)) continue;
        await walk(absPath, relPath);
      } else if (dirent.isFile()) {
        if (isExcludedFile(name)) { skipped++; continue; }

        let stat: import("fs").Stats;
        try {
          stat = await fs.stat(absPath);
        } catch {
          skipped++;
          continue;
        }

        if (isFileTooLarge(stat.size)) { skipped++; continue; }
        if (totalBytes + stat.size > maxTotalBytes) { skipped++; continue; }

        totalBytes += stat.size;
        entries.push({ absPath, relPath, sizeBytes: stat.size });
      }
      // Symlinks are skipped entirely (not followed)
    }
  }

  await walk(rootAbs, "");
  return { entries, skipped, totalBytes };
}
