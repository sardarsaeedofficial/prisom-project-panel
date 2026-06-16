/**
 * lib/projects/static-publisher.ts
 *
 * Copies a project's built static frontend output and/or media files to
 * the public web root for nginx to serve.
 *
 * Public root layout:
 *   /var/www/prisom-projects/{slug}/{deploymentRef}/   ← built frontend
 *   /var/www/prisom-projects/{slug}/media/             ← uploaded media
 *
 * Uses fs APIs only — no shell. Permission helpers use execFile.
 */

import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const PUBLIC_ROOT = "/var/www/prisom-projects";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StaticPublishResult {
  ok:          boolean;
  error?:      string;
  publishPath: string;
}

export interface MediaMigrateResult {
  ok:          boolean;
  error?:      string;
  copiedFiles: number;
  mediaPath:   string;
}

// Common media source directories to check in the project source
const MEDIA_DIRS = [
  "uploads",
  "public/uploads",
  "public/assets",
  "client/public",
  "attached_assets",
  "static",
  "assets",
];

// File extensions treated as media
const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".webm", ".mov",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg",
  ".pdf", ".zip",
  ".mp3", ".wav", ".ogg",
]);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Recursively copies src → dst using fs.cp (Node 16.7+). */
async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  await fs.cp(src, dst, {
    recursive: true,
    force:     true,
    preserveTimestamps: true,
  });
}

/** Tries to fix ownership + permissions via execFile; non-fatal if it fails. */
async function fixPermissions(dir: string): Promise<void> {
  try {
    await execFileAsync("chown", ["-R", "www-data:www-data", dir], { timeout: 15_000 });
  } catch {
    // www-data may not exist; non-fatal
  }
  try {
    await execFileAsync("chmod", ["-R", "755", dir], { timeout: 15_000 });
  } catch {
    // Non-fatal
  }
}

// ── Frontend static publish ────────────────────────────────────────────────

/**
 * Copies the built frontend static output from the release dir to the
 * public web root.
 *
 * @param releasePath   Absolute path to the release snapshot
 * @param slug          Project slug (used in destination path)
 * @param deploymentRef Deployment reference (used in destination path)
 * @param staticOutputDir Relative path within releasePath to the built output
 *                        (e.g. "dist", "out", "build", ".next/static")
 */
export async function publishStaticSite(
  releasePath: string,
  slug: string,
  deploymentRef: string,
  staticOutputDir: string
): Promise<StaticPublishResult> {
  const srcDir = path.join(releasePath, staticOutputDir);
  const dstDir = path.join(PUBLIC_ROOT, slug, deploymentRef);

  // Verify source exists
  try {
    await fs.access(srcDir);
  } catch {
    return {
      ok:          false,
      error:       `Static output directory not found: ${staticOutputDir} (looked in ${srcDir}). Did the build step run?`,
      publishPath: dstDir,
    };
  }

  // Copy to /var/www
  try {
    await copyDir(srcDir, dstDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        error:
          `Permission denied: cannot write to ${dstDir}. ` +
          `Run on VPS: sudo mkdir -p ${path.join(PUBLIC_ROOT, slug)} && ` +
          `sudo chown ${process.env.USER ?? "prisom"}:${process.env.USER ?? "prisom"} ${path.join(PUBLIC_ROOT, slug)}`,
        publishPath: dstDir,
      };
    }
    return { ok: false, error: `Copy failed: ${(e as Error).message}`, publishPath: dstDir };
  }

  // Best-effort permission fix
  await fixPermissions(dstDir);

  return { ok: true, publishPath: dstDir };
}

// ── Media file migration ───────────────────────────────────────────────────

/**
 * Scans a project source directory for known media folders and copies
 * any media files to /var/www/prisom-projects/{slug}/media/.
 *
 * The media directory preserves the sub-path so database URLs keep working,
 * e.g.  uploads/photo.jpg → /var/www/prisom-projects/myapp/media/uploads/photo.jpg
 */
export async function migrateMediaFiles(
  projectSourcePath: string,
  slug: string
): Promise<MediaMigrateResult> {
  const mediaRoot = path.join(PUBLIC_ROOT, slug, "media");
  let copiedFiles = 0;

  try {
    await fs.mkdir(mediaRoot, { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        ok:          false,
        error:       `Permission denied: cannot create ${mediaRoot}`,
        copiedFiles: 0,
        mediaPath:   mediaRoot,
      };
    }
    return { ok: false, error: (e as Error).message, copiedFiles: 0, mediaPath: mediaRoot };
  }

  for (const mediaDirRel of MEDIA_DIRS) {
    const srcDir = path.join(projectSourcePath, mediaDirRel);
    try {
      await fs.access(srcDir);
    } catch {
      continue; // Directory doesn't exist — skip
    }

    // Walk and copy only media files
    const copied = await copyMediaFiles(srcDir, path.join(mediaRoot, mediaDirRel));
    copiedFiles += copied;
  }

  if (copiedFiles > 0) {
    await fixPermissions(mediaRoot);
  }

  return { ok: true, copiedFiles, mediaPath: mediaRoot };
}

async function copyMediaFiles(srcDir: string, dstDir: string): Promise<number> {
  let count = 0;
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      count += await copyMediaFiles(srcPath, dstPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(ext)) {
        try {
          await fs.mkdir(dstDir, { recursive: true });
          await fs.copyFile(srcPath, dstPath);
          count++;
        } catch {
          // Skip unreadable/locked files
        }
      }
    }
  }
  return count;
}
