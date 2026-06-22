/**
 * lib/storage/storage-paths.ts
 *
 * Sprint 34: Canonical storage path constants and safety validators.
 *
 * Safety rules:
 *  - All paths resolved through path.resolve() before use
 *  - isSafeStoragePath() validates any user-influenced path stays under STORAGE_ROOT
 *  - No arbitrary path input accepted from client
 *  - Symlinks are not followed (callers must skip symlinks)
 */

import path from "path";

export const APP_ROOT      = path.resolve(process.cwd());
export const STORAGE_ROOT  = path.join(APP_ROOT, "storage");
export const PROJECTS_ROOT = path.join(STORAGE_ROOT, "projects");
export const RELEASES_ROOT = path.join(STORAGE_ROOT, "releases");
export const BACKUPS_ROOT  = path.join(STORAGE_ROOT, "backups");

/** Source files directory for a project slug */
export function projectSourceDir(slug: string): string {
  const p = path.join(PROJECTS_ROOT, slug);
  if (!isSafeStoragePath(p)) throw new Error("Unsafe source path");
  return p;
}

/** Releases directory for a project slug */
export function projectReleasesDir(slug: string): string {
  const p = path.join(RELEASES_ROOT, slug);
  if (!isSafeStoragePath(p)) throw new Error("Unsafe releases path");
  return p;
}

/** Backups directory for a project slug */
export function projectBackupsDir(slug: string): string {
  const p = path.join(BACKUPS_ROOT, slug);
  if (!isSafeStoragePath(p)) throw new Error("Unsafe backups path");
  return p;
}

/**
 * Returns true if the resolved path is inside STORAGE_ROOT.
 * Must be called with a path constructed from known-safe components only.
 */
export function isSafeStoragePath(p: string): boolean {
  const resolved = path.resolve(p);
  return (
    resolved === STORAGE_ROOT ||
    resolved.startsWith(STORAGE_ROOT + path.sep)
  );
}
