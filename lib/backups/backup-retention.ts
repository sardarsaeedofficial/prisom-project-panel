/**
 * lib/backups/backup-retention.ts
 *
 * Sprint 30: Retention policy enforcement for scheduled backups.
 *
 * Safety rules:
 *  - Only deletes backups with backupType="scheduled" AND status="ready"
 *  - Never deletes manual, pre_restore, or system backups
 *  - Never deletes failed backups
 *  - Validates backup path is under BACKUP_STORAGE_ROOT_ABS before file deletion
 *  - DB record must belong to the same project (IDOR prevention)
 *  - Uses writeProjectAuditEvent for deletion audit trail
 */

import path               from "path";
import { promises as fs } from "fs";
import { db }             from "@/lib/db";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { BACKUP_STORAGE_ROOT_ABS, resolveUnder } from "./project-backup-safety";

export type RetentionResult = {
  kept:    number;
  deleted: number;
  errors:  number;
};

/**
 * Apply retention policy for scheduled backups.
 *
 * Keeps the newest `retentionCount` successful scheduled backups.
 * Deletes older ones (archive file + DB record marked deleted).
 * Never touches manual, pre_restore, or system backups.
 */
export async function applyRetentionPolicy(
  projectId: string,
  retentionCount: number,
): Promise<RetentionResult> {
  const safeCount = Math.max(1, Math.min(retentionCount, 100));

  // Only target successful scheduled backups for this project
  const candidates = await db.projectBackup.findMany({
    where: {
      projectId,
      backupType: "scheduled",
      status:     "ready",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id:          true,
      backupRef:   true,
      storagePath: true,
      archiveName: true,
    },
  });

  if (candidates.length <= safeCount) {
    return { kept: candidates.length, deleted: 0, errors: 0 };
  }

  const toKeep   = candidates.slice(0, safeCount);
  const toDelete = candidates.slice(safeCount);

  let deleted = 0;
  let errors  = 0;

  for (const backup of toDelete) {
    try {
      await deleteOneBackup(projectId, backup);
      deleted++;
    } catch (err) {
      console.error(`[backup-retention] failed to delete backup ${backup.id}:`, err);
      errors++;
    }
  }

  // Audit the deletion batch
  if (deleted > 0) {
    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.retention_deleted",
      category: "backups",
      result:   "success",
      summary:  `Retention policy: deleted ${deleted} old scheduled backup(s), kept ${toKeep.length}.`,
      metadata: {
        retentionCount: safeCount,
        deletedCount:   deleted,
        keptCount:      toKeep.length,
        errorCount:     errors,
      },
    });
  }

  return { kept: toKeep.length, deleted, errors };
}

// ── Internal: delete one backup record + archive file ────────────────────────

async function deleteOneBackup(
  projectId: string,
  backup: { id: string; backupRef: string; storagePath: string; archiveName: string },
): Promise<void> {
  // Validate the storage path is under the backup root
  const archivePath = resolveUnder(BACKUP_STORAGE_ROOT_ABS, backup.storagePath, backup.archiveName);
  const dirPath     = resolveUnder(BACKUP_STORAGE_ROOT_ABS, backup.storagePath);

  // Mark deleted in DB first (so even if file removal fails, record is gone)
  await db.projectBackup.update({
    where: { id: backup.id, projectId },  // projectId guard prevents IDOR
    data: {
      status:    "deleted",
      deletedAt: new Date(),
    },
  });

  // Remove archive file (best-effort)
  if (archivePath) {
    await fs.unlink(archivePath).catch(() => null);
  }

  // Remove manifest file (best-effort)
  if (dirPath) {
    const manifestPath = path.join(dirPath, "manifest.json");
    await fs.unlink(manifestPath).catch(() => null);
    // Try to remove the directory (succeeds only if empty)
    await fs.rmdir(dirPath).catch(() => null);
  }
}
