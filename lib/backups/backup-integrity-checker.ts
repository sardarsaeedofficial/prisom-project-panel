/**
 * lib/backups/backup-integrity-checker.ts
 *
 * Sprint 60: Backup integrity validation.
 *
 * Checks (metadata + file-existence only — no extraction into live directories):
 *  - DB record exists and status is "ready"
 *  - Archive file exists on disk
 *  - File size > 0
 *  - Checksum is recorded
 *  - storagePath is safely resolved under BACKUP_STORAGE_ROOT
 *  - manifest.json exists alongside the archive if present
 *
 * SAFETY: Does NOT extract any files. Does NOT write to the live project source.
 *
 * Server-only.
 */

import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { BACKUP_ARCHIVE_NAME, BACKUP_MANIFEST_NAME } from "./project-backup-types";
import { BACKUP_STORAGE_ROOT_ABS } from "./project-backup-safety";
import type { DisasterRecoveryCheck, BackupIntegrityResult } from "./disaster-recovery-types";

const APP_ROOT = process.cwd();

async function safeFileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function resolveArchive(storagePath: string, archiveName: string): string | null {
  const absPath = path.resolve(APP_ROOT, storagePath, archiveName);
  // Ensure path stays within the backup root
  if (
    absPath === BACKUP_STORAGE_ROOT_ABS ||
    absPath.startsWith(BACKUP_STORAGE_ROOT_ABS + path.sep)
  ) {
    return absPath;
  }
  return null;
}

export async function checkBackupIntegrity(input: {
  projectId: string;
  backupId: string;
}): Promise<BackupIntegrityResult> {
  const { projectId, backupId } = input;
  const checks: DisasterRecoveryCheck[] = [];

  // ── 1. Load DB record ───────────────────────────────────────────────────────

  const backup = await db.projectBackup.findFirst({
    where:  { id: backupId, projectId },
    select: {
      id:            true,
      backupRef:     true,
      status:        true,
      sizeBytes:     true,
      fileCount:     true,
      checksumSha256: true,
      storagePath:   true,
      archiveName:   true,
      backupType:    true,
      createdAt:     true,
      completedAt:   true,
      lastError:     true,
      includesSource: true,
    },
  });

  if (!backup) {
    return {
      backupId,
      backupRef: "",
      checks: [{
        id:       "db-record",
        category: "integrity",
        label:    "Backup record found in database",
        status:   "fail",
        required: true,
        message:  `Backup ${backupId} not found for this project.`,
      }],
      status: "failed",
      summary: "Backup not found.",
    };
  }

  // ── Check 1: DB status is "ready" ───────────────────────────────────────────

  if (backup.status === "ready") {
    checks.push({
      id:       "db-record",
      category: "integrity",
      label:    "Backup status is ready",
      status:   "pass",
      required: true,
      message:  `Status: ready. Completed: ${backup.completedAt?.toISOString().slice(0, 10) ?? "unknown"}.`,
    });
  } else {
    checks.push({
      id:       "db-record",
      category: "integrity",
      label:    "Backup status is ready",
      status:   "fail",
      required: true,
      message:  `Backup status is "${backup.status}"${backup.lastError ? ` — ${backup.lastError.slice(0, 200)}` : ""}.`,
    });
  }

  // ── Check 2: storagePath is safe ────────────────────────────────────────────

  const archiveName = backup.archiveName || BACKUP_ARCHIVE_NAME;
  const archivePath = resolveArchive(backup.storagePath, archiveName);

  if (!archivePath) {
    checks.push({
      id:       "storage-path-safe",
      category: "integrity",
      label:    "Storage path safely resolved",
      status:   "fail",
      required: true,
      message:  `Archive path "${backup.storagePath}" resolves outside the backup storage root. This backup may be corrupt or tampered.`,
    });
    return { backupId, backupRef: backup.backupRef, checks, status: "failed", summary: "Unsafe storage path." };
  }

  checks.push({
    id:       "storage-path-safe",
    category: "integrity",
    label:    "Storage path safely resolved",
    status:   "pass",
    required: true,
    message:  "Path resolves within the backup storage root.",
  });

  // ── Check 3: archive file exists ────────────────────────────────────────────

  const archiveSize = await safeFileSize(archivePath);

  if (archiveSize === null) {
    checks.push({
      id:       "archive-exists",
      category: "integrity",
      label:    "Archive file exists on disk",
      status:   "fail",
      required: true,
      message:  `Archive not found at: ${backup.storagePath}/${archiveName}`,
    });
  } else if (archiveSize === 0) {
    checks.push({
      id:       "archive-exists",
      category: "integrity",
      label:    "Archive file exists on disk",
      status:   "fail",
      required: true,
      message:  "Archive file exists but is empty (0 bytes). This backup is invalid.",
    });
  } else {
    checks.push({
      id:       "archive-exists",
      category: "integrity",
      label:    "Archive file exists on disk",
      status:   "pass",
      required: true,
      message:  `Archive found: ${(archiveSize / 1024 / 1024).toFixed(2)} MB on disk.`,
    });
  }

  // ── Check 4: DB size matches disk (approx) ───────────────────────────────────

  if (archiveSize !== null && archiveSize > 0 && backup.sizeBytes !== null) {
    const ratio = archiveSize / backup.sizeBytes;
    if (ratio >= 0.9 && ratio <= 1.1) {
      checks.push({
        id:       "size-match",
        category: "integrity",
        label:    "Archive size matches database record",
        status:   "pass",
        required: false,
        message:  `Disk: ${(archiveSize / 1024).toFixed(0)} KB, DB: ${(backup.sizeBytes / 1024).toFixed(0)} KB — within tolerance.`,
      });
    } else {
      checks.push({
        id:       "size-match",
        category: "integrity",
        label:    "Archive size matches database record",
        status:   "warning",
        required: false,
        message:  `Disk size (${(archiveSize / 1024).toFixed(0)} KB) differs from DB record (${(backup.sizeBytes / 1024).toFixed(0)} KB) by more than 10%. File may have been modified.`,
      });
    }
  }

  // ── Check 5: checksum recorded ──────────────────────────────────────────────

  if (backup.checksumSha256 && backup.checksumSha256.length === 64) {
    checks.push({
      id:       "checksum-recorded",
      category: "integrity",
      label:    "SHA-256 checksum recorded",
      status:   "pass",
      required: false,
      message:  `Checksum: ${backup.checksumSha256.slice(0, 16)}…`,
      evidence: [backup.checksumSha256],
    });
  } else {
    checks.push({
      id:       "checksum-recorded",
      category: "integrity",
      label:    "SHA-256 checksum recorded",
      status:   "warning",
      required: false,
      message:  "No SHA-256 checksum on this backup. Integrity cannot be fully verified without it.",
    });
  }

  // ── Check 6: manifest.json exists ───────────────────────────────────────────

  const manifestPath = path.resolve(APP_ROOT, backup.storagePath, BACKUP_MANIFEST_NAME);
  const manifestSize = await safeFileSize(manifestPath);

  if (manifestSize !== null && manifestSize > 0) {
    checks.push({
      id:       "manifest-exists",
      category: "integrity",
      label:    "Backup manifest (manifest.json) present",
      status:   "pass",
      required: false,
      message:  `manifest.json found (${manifestSize} bytes).`,
    });
  } else {
    checks.push({
      id:       "manifest-exists",
      category: "integrity",
      label:    "Backup manifest (manifest.json) present",
      status:   "warning",
      required: false,
      message:  "manifest.json not found alongside archive. Metadata restoration may be limited.",
    });
  }

  // ── Check 7: file count plausible ───────────────────────────────────────────

  if (backup.fileCount !== null && backup.fileCount > 0) {
    checks.push({
      id:       "file-count",
      category: "integrity",
      label:    "File count recorded and non-zero",
      status:   "pass",
      required: false,
      message:  `${backup.fileCount} file(s) recorded in this backup.`,
    });
  } else if (backup.fileCount === 0) {
    checks.push({
      id:       "file-count",
      category: "integrity",
      label:    "File count recorded and non-zero",
      status:   "warning",
      required: false,
      message:  "File count is zero — this backup may be empty or source was empty at backup time.",
    });
  }

  // ── Derive overall integrity status ─────────────────────────────────────────

  const hasFail    = checks.some((c) => c.status === "fail");
  const hasWarning = checks.some((c) => c.status === "warning");
  const integrityStatus: BackupIntegrityResult["status"] = hasFail
    ? "failed"
    : hasWarning
    ? "warning"
    : "passed";

  const passCount = checks.filter((c) => c.status === "pass").length;
  const summary   = hasFail
    ? `Integrity check failed — ${checks.filter((c) => c.status === "fail").length} critical issue(s) found.`
    : hasWarning
    ? `Integrity check passed with ${checks.filter((c) => c.status === "warning").length} warning(s). Review before restoring.`
    : `All ${passCount} checks passed. Backup appears intact.`;

  return {
    backupId:  backup.id,
    backupRef: backup.backupRef,
    checks,
    status:    integrityStatus,
    summary,
  };
}
