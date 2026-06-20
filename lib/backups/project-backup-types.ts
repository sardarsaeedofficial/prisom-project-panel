/**
 * lib/backups/project-backup-types.ts
 *
 * Sprint 21: Types, constants, and limits for the project backup system.
 *
 * Server-safe — no client-side imports needed. DTO types are plain objects
 * so they can cross the server-action boundary without issues.
 */

// ── Status strings ────────────────────────────────────────────────────────────

export type BackupStatus =
  | "creating"
  | "ready"
  | "failed"
  | "restoring"
  | "restored"
  | "deleted";

export type BackupType = "manual" | "pre_restore" | "system";

// ── Safety limits ─────────────────────────────────────────────────────────────

/** Maximum single-file size to include in a backup (10 MB). */
export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum total uncompressed source size across all included files (250 MB). */
export const MAX_BACKUP_SOURCE_BYTES = 250 * 1024 * 1024;

/** Maximum number of files in a single backup archive. */
export const MAX_BACKUP_FILE_COUNT = 5_000;

/** Maximum age in days for a backup to count as "recent" in the health checklist. */
export const RECENT_BACKUP_DAYS = 7;

// ── Directories/files always excluded ────────────────────────────────────────

export const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".netlify",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".git",
  ".turbo",
  ".cache",
  "storage",  // avoid recursive inclusion of the storage dir itself
  ".yarn",
  ".pnp",
  "releases",  // release snapshots inside project storage
]);

/**
 * Patterns for files that are excluded by default.
 * These are matched against the basename (not the full path).
 */
export const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^\.env\.\w+$/i,        // .env.local, .env.production, etc.
  /^\.env\..*$/i,          // any .env.* variant
  /private\.pem$/i,
  /private\.key$/i,
  /server\.key$/i,
  /ssl\.key$/i,
  /id_rsa$/i,
  /id_dsa$/i,
  /id_ecdsa$/i,
  /id_ed25519$/i,
];

export const EXCLUDED_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".der",
]);

// ── Backup archive paths ──────────────────────────────────────────────────────

export const BACKUP_STORAGE_ROOT = "storage/backups";
export const BACKUP_ARCHIVE_NAME = "backup.zip";
export const BACKUP_MANIFEST_NAME = "manifest.json";

// ── Manifest type (stored in backup.zip and manifest.json) ───────────────────

export type BackupManifest = {
  backupRef: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  createdAt: string;
  backupType: BackupType;
  fileCount: number;
  sizeBytes: number;
  checksumSha256: string;
  includesSecrets: false;         // always false in Sprint 21
  includesEnvKeys: boolean;
  includesSource: boolean;
  includesConfig: boolean;
  excluded: string[];
  sourceRoot: string;             // archive entry prefix for source files
  config: {
    deployment: boolean;
    alertRules: boolean;
    alertSettings: boolean;
    envKeys: boolean;
  };
  /** Extra project metadata stored for reference only. */
  projectMeta?: Record<string, unknown>;
};

// ── DTO (sent to client components) ──────────────────────────────────────────

export type ProjectBackupDTO = {
  id: string;
  backupRef: string;
  label: string | null;
  status: BackupStatus;
  backupType: BackupType;
  sizeBytes: number | null;
  fileCount: number | null;
  checksumShort: string | null;   // first 8 hex chars of SHA-256
  includesSource: boolean;
  includesConfig: boolean;
  includesEnvKeys: boolean;
  includesSecrets: boolean;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
  restoreCount: number;
  lastRestoredAt: string | null;
  manifest: BackupManifest | null;
};
