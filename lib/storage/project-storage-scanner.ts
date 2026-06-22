/**
 * lib/storage/project-storage-scanner.ts
 *
 * Sprint 34: Safe filesystem scanner for project storage directories.
 *
 * Safety rules:
 *  - Never follows symlinks
 *  - Skips .git and node_modules
 *  - Max traversal depth: 10
 *  - All paths validated to stay under STORAGE_ROOT before reading
 *  - No arbitrary path input — only slug-derived paths
 *  - Handles missing/inaccessible directories gracefully
 */

import path            from "path";
import { promises as fs } from "fs";
import {
  isSafeStoragePath,
  projectSourceDir,
  projectReleasesDir,
  projectBackupsDir,
} from "./storage-paths";

// ── Recursive size ─────────────────────────────────────────────────────────────

const SKIP_NAMES = new Set([".git", "node_modules"]);
const MAX_DEPTH  = 10;

async function getDirSizeBytes(dirPath: string, depth = 0): Promise<number> {
  if (!isSafeStoragePath(dirPath)) return 0;
  if (depth > MAX_DEPTH) return 0;

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (!isSafeStoragePath(full)) continue;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      total += await getDirSizeBytes(full, depth + 1);
    } else if (e.isFile()) {
      try {
        const s = await fs.stat(full);
        total += s.size;
      } catch { /* skip */ }
    }
  }
  return total;
}

// ── Dir exists check ───────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ── Source size ────────────────────────────────────────────────────────────────

export async function getProjectSourceSizeBytes(slug: string): Promise<number> {
  try {
    const dir = projectSourceDir(slug);
    return await getDirSizeBytes(dir);
  } catch {
    return 0;
  }
}

// ── Release directories ────────────────────────────────────────────────────────

export type ScannedReleaseDir = {
  name:      string;    // directory name
  sizeBytes: number;
  mtimeMs:   number;    // last-modified epoch ms (used for recency sort)
};

export async function scanReleaseDirectories(slug: string): Promise<ScannedReleaseDir[]> {
  try {
    const dir = projectReleasesDir(slug);
    if (!(await dirExists(dir))) return [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: ScannedReleaseDir[] = [];

    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (!isSafeStoragePath(full)) continue;
      try {
        const stat = await fs.stat(full);
        const size = await getDirSizeBytes(full);
        results.push({ name: e.name, sizeBytes: size, mtimeMs: stat.mtimeMs });
      } catch { /* skip this dir */ }
    }

    // Sort newest first
    results.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return results;
  } catch {
    return [];
  }
}

// ── Release total ──────────────────────────────────────────────────────────────

export async function getTotalReleasesSize(slug: string): Promise<number> {
  const dirs = await scanReleaseDirectories(slug);
  return dirs.reduce((s, d) => s + d.sizeBytes, 0);
}

// ── Backup total from FS ───────────────────────────────────────────────────────

export async function getTotalBackupsSizeOnDisk(slug: string): Promise<number> {
  try {
    const dir = projectBackupsDir(slug);
    return await getDirSizeBytes(dir);
  } catch {
    return 0;
  }
}

// ── Backup file size for a specific backupRef ─────────────────────────────────

export async function getBackupFileSizeBytes(
  slug:      string,
  backupRef: string,
  archiveName = "backup.zip",
): Promise<number> {
  try {
    const dir = projectBackupsDir(slug);
    const archivePath = path.join(dir, backupRef, archiveName);
    if (!isSafeStoragePath(archivePath)) return 0;
    const stat = await fs.stat(archivePath);
    return stat.size;
  } catch {
    return 0;
  }
}

// ── Delete a release directory ─────────────────────────────────────────────────

export async function deleteReleaseDir(slug: string, dirName: string): Promise<void> {
  const dir = projectReleasesDir(slug);
  const target = path.join(dir, dirName);

  if (!isSafeStoragePath(target)) {
    throw new Error(`Unsafe release path for slug=${slug} dir=${dirName}`);
  }

  // Reject anything that looks like path traversal
  if (dirName.includes("..") || dirName.includes("/") || dirName.includes("\\")) {
    throw new Error("Invalid release directory name");
  }

  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return; // already gone — no error
  if (!stat.isDirectory()) throw new Error("Target is not a directory");

  await fs.rm(target, { recursive: true, force: true });
}

// ── Delete a backup archive directory ────────────────────────────────────────

export async function deleteBackupDir(slug: string, backupRef: string): Promise<void> {
  const dir = projectBackupsDir(slug);
  const target = path.join(dir, backupRef);

  if (!isSafeStoragePath(target)) {
    throw new Error(`Unsafe backup path for slug=${slug} ref=${backupRef}`);
  }

  if (backupRef.includes("..") || backupRef.includes("/") || backupRef.includes("\\")) {
    throw new Error("Invalid backup reference");
  }

  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return; // already gone
  if (!stat.isDirectory()) throw new Error("Backup target is not a directory");

  await fs.rm(target, { recursive: true, force: true });
}
