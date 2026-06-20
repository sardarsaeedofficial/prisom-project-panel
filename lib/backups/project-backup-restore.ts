/**
 * lib/backups/project-backup-restore.ts
 *
 * Sprint 21: Backup restore logic.
 *
 * Restore flow:
 *  1. Load and validate backup record (must be status "ready")
 *  2. Verify SHA-256 checksum of the archive
 *  3. Create an automatic pre-restore backup of the current project state
 *  4. Extract archive to a temp directory (validating every entry)
 *  5. Atomic rename: temp dir → live source dir
 *  6. Update DB record (restoreCount, lastRestoredAt, status)
 *  7. On failure: rollback the source dir from the pre-restore backup if possible
 *
 * CRITICAL SAFETY:
 *  - Never auto-deploy after restore.
 *  - Never touch .env files or secrets.
 *  - Every archive entry is validated via isSafeArchiveEntry before extraction.
 *  - Final extraction target is validated via resolveUnder to prevent escape.
 */

import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { db } from "@/lib/db";
import { BACKUP_ARCHIVE_NAME, BACKUP_MANIFEST_NAME } from "./project-backup-types";
import {
  resolveProjectSource,
  resolveBackupDir,
  resolveUnder,
  isSafeSlug,
  isSafeRef,
  isSafeArchiveEntry,
} from "./project-backup-safety";
import { createProjectBackup } from "./project-backup-runner";

// ── SHA-256 file hash ─────────────────────────────────────────────────────────

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── Result types ──────────────────────────────────────────────────────────────

export type RestoreBackupResult =
  | { ok: true; preRestoreBackupRef: string | null }
  | { ok: false; error: string };

// ── Restore input ─────────────────────────────────────────────────────────────

export type RestoreBackupInput = {
  backupId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  /** Must equal exactly "RESTORE" — enforced in server action, validated here too. */
  confirmationText: string;
  restoredByUserId?: string | null;
};

// ── Main restore function ─────────────────────────────────────────────────────

export async function restoreProjectBackup(
  input: RestoreBackupInput,
): Promise<RestoreBackupResult> {
  const {
    backupId,
    projectId,
    projectSlug,
    projectName,
    confirmationText,
    restoredByUserId,
  } = input;

  // ── 0. Confirmation gate ──────────────────────────────────────────────────
  if (confirmationText !== "RESTORE") {
    return { ok: false, error: 'Type "RESTORE" to confirm the restore operation.' };
  }

  // ── 1. Load backup record ─────────────────────────────────────────────────
  const backup = await db.projectBackup.findFirst({
    where: {
      id: backupId,
      projectId,
      deletedAt: null,
    },
  });

  if (!backup) {
    return { ok: false, error: "Backup not found." };
  }

  if (backup.status !== "ready") {
    return {
      ok: false,
      error: `Cannot restore a backup in "${backup.status}" status. Only "ready" backups can be restored.`,
    };
  }

  // ── 2. Validate slug + resolve paths ─────────────────────────────────────
  if (!isSafeSlug(projectSlug)) {
    return { ok: false, error: "Invalid project slug." };
  }
  if (!isSafeRef(backup.backupRef)) {
    return { ok: false, error: "Invalid backup reference." };
  }

  const sourceDir = resolveProjectSource(projectSlug);
  if (!sourceDir) {
    return { ok: false, error: "Invalid project source path." };
  }

  const backupDir = resolveBackupDir(projectSlug, backup.backupRef);
  if (!backupDir) {
    return { ok: false, error: "Invalid backup storage path." };
  }

  const archivePath = path.join(backupDir, BACKUP_ARCHIVE_NAME);

  // Verify archive file exists
  try {
    await fs.access(archivePath);
  } catch {
    return { ok: false, error: "Backup archive file is missing from storage." };
  }

  // ── 3. Verify checksum ────────────────────────────────────────────────────
  if (backup.checksumSha256) {
    let actualChecksum: string;
    try {
      actualChecksum = await sha256File(archivePath);
    } catch {
      return { ok: false, error: "Could not read backup archive to verify checksum." };
    }

    if (actualChecksum !== backup.checksumSha256) {
      return {
        ok: false,
        error: "Backup archive checksum mismatch — the archive may be corrupted.",
      };
    }
  }

  // ── 4. Create pre-restore backup ──────────────────────────────────────────
  let preRestoreBackupRef: string | null = null;

  // Mark backup as restoring
  await db.projectBackup.update({
    where: { id: backupId },
    data: { status: "restoring" },
  });

  const preRestoreResult = await createProjectBackup({
    projectId,
    projectSlug,
    projectName,
    label: `Pre-restore snapshot (before restoring ${backup.backupRef})`,
    backupType: "pre_restore",
    includeEnvKeys: true,
    createdByUserId: restoredByUserId ?? null,
  });

  if (preRestoreResult.ok) {
    preRestoreBackupRef = preRestoreResult.backupRef;
  } else {
    // Pre-restore backup failed — abort the restore to avoid data loss without a safety net
    await db.projectBackup.update({
      where: { id: backupId },
      data: {
        status: "ready",
        lastError: `Restore aborted: could not create pre-restore backup: ${preRestoreResult.error}`,
      },
    });
    return {
      ok: false,
      error: `Restore aborted: could not create a pre-restore snapshot. Please try again. (${preRestoreResult.error})`,
    };
  }

  // ── 5. Extract archive to temp directory ──────────────────────────────────
  const tempDir = path.join(
    path.dirname(sourceDir),
    `.restore_tmp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
  );

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName.replace(/\\/g, "/");

      // Only extract entries under "source/" prefix
      if (!entryName.startsWith("source/")) continue;

      // Validate the entry path
      if (!isSafeArchiveEntry(entryName)) {
        throw new Error(`Unsafe archive entry detected: ${entryName}`);
      }

      // Strip the "source/" prefix to get the relative file path
      const relativePath = entryName.slice("source/".length);
      if (!relativePath) continue; // Skip the "source/" directory entry itself

      // Resolve the final output path under tempDir
      const outputPath = resolveUnder(tempDir, ...relativePath.split("/"));
      if (!outputPath) {
        throw new Error(`Archive entry would escape temp directory: ${entryName}`);
      }

      // Create parent directories
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Extract the file
      const content = entry.getData();
      await fs.writeFile(outputPath, content);
    }
  } catch (err) {
    // Clean up temp dir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);

    // Reset backup status
    const msg = err instanceof Error ? err.message : "Unknown error";
    await db.projectBackup.update({
      where: { id: backupId },
      data: {
        status: "ready",
        lastError: `Restore extraction failed: ${msg}`,
      },
    });

    return { ok: false, error: `Restore failed during extraction: ${msg}` };
  }

  // ── 6. Atomic swap: temp dir → source dir ────────────────────────────────
  const oldDir = path.join(
    path.dirname(sourceDir),
    `.old_${path.basename(sourceDir)}_${Date.now()}`,
  );

  try {
    // Move current source dir to a temp "old" location
    await fs.rename(sourceDir, oldDir);

    // Move extracted temp dir to source location
    await fs.rename(tempDir, sourceDir);

    // Remove the old dir (best-effort)
    await fs.rm(oldDir, { recursive: true, force: true }).catch(() => null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    // Attempt rollback: restore the old dir if the source was moved
    try {
      const oldDirExists = await fs.stat(oldDir).then(() => true).catch(() => false);
      const sourceDirExists = await fs.stat(sourceDir).then(() => true).catch(() => false);

      if (oldDirExists && !sourceDirExists) {
        // The old dir was moved but tempDir → sourceDir rename failed
        // Restore the old dir
        await fs.rename(oldDir, sourceDir);
      }
    } catch {
      // Rollback also failed — log but don't mask the original error
    }

    // Clean up temp dir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);

    await db.projectBackup.update({
      where: { id: backupId },
      data: {
        status: "ready",
        lastError: `Restore failed during filesystem swap: ${msg}`,
      },
    });

    return { ok: false, error: `Restore failed during filesystem swap: ${msg}` };
  }

  // ── 7. Update backup record ───────────────────────────────────────────────
  await db.projectBackup.update({
    where: { id: backupId },
    data: {
      status: "restored",
      restoreCount: { increment: 1 },
      lastRestoredAt: new Date(),
      lastError: null,
    },
  });

  // CRITICAL: Never auto-deploy after restore.
  // The user must manually trigger a new deployment from the Publishing tab.

  return { ok: true, preRestoreBackupRef };
}

// ── Delete backup ─────────────────────────────────────────────────────────────

export type DeleteBackupResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteProjectBackup(
  backupId: string,
  projectId: string,
  projectSlug: string,
): Promise<DeleteBackupResult> {
  const backup = await db.projectBackup.findFirst({
    where: { id: backupId, projectId, deletedAt: null },
  });

  if (!backup) {
    return { ok: false, error: "Backup not found." };
  }

  if (backup.status === "restoring") {
    return { ok: false, error: "Cannot delete a backup while it is being restored." };
  }

  if (!isSafeSlug(projectSlug) || !isSafeRef(backup.backupRef)) {
    return { ok: false, error: "Invalid slug or backup reference." };
  }

  const backupDir = resolveBackupDir(projectSlug, backup.backupRef);

  // Soft-delete the DB record first
  await db.projectBackup.update({
    where: { id: backupId },
    data: { deletedAt: new Date(), status: "deleted" },
  });

  // Best-effort filesystem cleanup (don't fail if files are already gone)
  if (backupDir) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => null);
  }

  return { ok: true };
}

// ── Read manifest from backup dir ────────────────────────────────────────────

export async function readBackupManifest(
  projectSlug: string,
  backupRef: string,
): Promise<import("./project-backup-types").BackupManifest | null> {
  if (!isSafeSlug(projectSlug) || !isSafeRef(backupRef)) return null;

  const backupDir = resolveBackupDir(projectSlug, backupRef);
  if (!backupDir) return null;

  const manifestPath = path.join(backupDir, BACKUP_MANIFEST_NAME);
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw) as import("./project-backup-types").BackupManifest;
  } catch {
    return null;
  }
}
