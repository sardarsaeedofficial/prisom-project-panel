/**
 * lib/admin/admin-disk-usage.ts
 *
 * Sprint 31: Disk usage checks for the Admin Console.
 *
 * Safety:
 *  - Only reads known fixed storage paths under the app root
 *  - No arbitrary path input accepted
 *  - All paths validated to stay under their expected root via path.resolve check
 *  - System disk checked via `df -B1 /` (read-only, no destructive flags)
 *  - Missing directories are handled gracefully (skipped, not an error)
 */

import path           from "path";
import { promises as fs } from "fs";
import { runCommand }  from "@/lib/server/command-runner";

// ── Known safe storage roots ──────────────────────────────────────────────────

const APP_ROOT    = path.resolve(process.cwd());
const STORAGE_ROOT = path.join(APP_ROOT, "storage");

const STORAGE_DIRS = {
  projects: path.join(STORAGE_ROOT, "projects"),
  releases: path.join(STORAGE_ROOT, "releases"),
  backups:  path.join(STORAGE_ROOT, "backups"),
} as const;

// Validate a path is under STORAGE_ROOT before reading
function isSafeStoragePath(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved.startsWith(STORAGE_ROOT + path.sep) || resolved === STORAGE_ROOT;
}

// ── Recursive directory size ──────────────────────────────────────────────────

async function getDirSizeBytes(dirPath: string, depthLimit = 8): Promise<number> {
  if (!isSafeStoragePath(dirPath)) return 0;
  try {
    await fs.access(dirPath);
  } catch {
    return 0;
  }

  let total = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > depthLimit) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch { /* skip */ }
      }
    }
  }

  await walk(dirPath, 0);
  return total;
}

// ── System disk via df ────────────────────────────────────────────────────────

type SystemDisk = {
  totalBytes: number;
  usedBytes:  number;
  freeBytes:  number;
  usagePct:   number;
};

async function getSystemDisk(): Promise<SystemDisk | null> {
  try {
    const r = await runCommand("df", ["-B1", "/"], {
      cwd:       process.cwd(),
      timeoutMs: 8_000,
    });
    if (r.exitCode !== 0) return null;

    // df -B1 output:
    // Filesystem     1B-blocks      Used Available Use% Mounted on
    // /dev/sda1      nnnnnnnnn  nnnnnnn   nnnnnnn  XX%  /
    const lines = r.stdout.trim().split("\n");
    if (lines.length < 2) return null;

    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 5) return null;

    const total = parseInt(parts[1], 10);
    const used  = parseInt(parts[2], 10);
    const free  = parseInt(parts[3], 10);
    if (isNaN(total) || isNaN(used) || isNaN(free) || total === 0) return null;

    const usagePct = Math.round((used / total) * 100);
    return { totalBytes: total, usedBytes: used, freeBytes: free, usagePct };
  } catch {
    return null;
  }
}

// ── Disk status threshold ─────────────────────────────────────────────────────

function diskStatus(usagePct: number | undefined): "healthy" | "warning" | "critical" | "unknown" {
  if (usagePct === undefined) return "unknown";
  if (usagePct >= 90) return "critical";
  if (usagePct >= 70) return "warning";
  return "healthy";
}

// ── Public ────────────────────────────────────────────────────────────────────

export type DiskUsageResult = {
  status:               "healthy" | "warning" | "critical" | "unknown";
  totalBytes?:          number;
  usedBytes?:           number;
  freeBytes?:           number;
  usagePct?:            number;
  projectStorageBytes?: number;
  releaseStorageBytes?: number;
  backupStorageBytes?:  number;
};

export async function getDiskUsage(): Promise<DiskUsageResult> {
  const [sysDisk, projectBytes, releaseBytes, backupBytes] = await Promise.all([
    getSystemDisk().catch(() => null),
    getDirSizeBytes(STORAGE_DIRS.projects).catch(() => 0),
    getDirSizeBytes(STORAGE_DIRS.releases).catch(() => 0),
    getDirSizeBytes(STORAGE_DIRS.backups).catch(() => 0),
  ]);

  return {
    status:               diskStatus(sysDisk?.usagePct),
    totalBytes:           sysDisk?.totalBytes,
    usedBytes:            sysDisk?.usedBytes,
    freeBytes:            sysDisk?.freeBytes,
    usagePct:             sysDisk?.usagePct,
    projectStorageBytes:  projectBytes,
    releaseStorageBytes:  releaseBytes,
    backupStorageBytes:   backupBytes,
  };
}
