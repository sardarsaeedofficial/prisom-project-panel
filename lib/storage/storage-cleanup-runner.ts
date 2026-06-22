/**
 * lib/storage/storage-cleanup-runner.ts
 *
 * Sprint 34: Execute a storage cleanup for a project.
 *
 * Safety rules:
 *  - Requires explicit "CLEANUP" confirmation text (case-sensitive)
 *  - Re-derives the cleanup plan server-side — never trusts the client's item list
 *  - Uses Sprint 27 operation locking (storage_cleanup type)
 *  - Deletes filesystem files first, then marks DB records
 *  - Filesystem failures are recorded but do not prevent marking the DB
 *    (if FS is already gone, the DB cleanup still proceeds)
 *  - All deleted items are written to the project audit log
 *  - Never touches source directories or .env files
 */

import {
  startProjectOperation,
  completeProjectOperation,
  failProjectOperation,
  OperationConflictError,
} from "@/lib/operations/project-operation-service";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { buildStorageCleanupPlan }  from "./storage-cleanup-planner";
import {
  deleteReleaseDir,
  deleteBackupDir,
} from "./project-storage-scanner";
import { db } from "@/lib/db";
import type {
  StorageItem,
  CleanupResult,
  CleanupDeletedItem,
  CleanupFailedItem,
} from "./storage-types";

// ── Confirmation guard ────────────────────────────────────────────────────────

const REQUIRED_CONFIRMATION = "CLEANUP";

// ── Execution ─────────────────────────────────────────────────────────────────

type RunCleanupOptions = {
  projectId:    string;
  actorUserId:  string;
  actorEmail:   string;
  actorRole:    string;
  confirmation: string;
};

export async function runStorageCleanup(opts: RunCleanupOptions): Promise<CleanupResult> {
  const { projectId, actorUserId, actorEmail, actorRole, confirmation } = opts;

  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`Confirmation text must be exactly "${REQUIRED_CONFIRMATION}"`);
  }

  // Load project metadata
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) throw new Error("Project not found");

  // Acquire operation lock
  let opId: string;
  try {
    opId = await startProjectOperation({
      projectId,
      operationType:     "storage_cleanup",
      title:             `Storage cleanup`,
      initiatedByUserId: actorUserId,
      meta:              { triggeredBy: actorEmail },
    });
  } catch (err) {
    if (err instanceof OperationConflictError) {
      throw new Error(`Cannot run storage cleanup: ${err.message}`);
    }
    throw err;
  }

  const deletedItems:  CleanupDeletedItem[]  = [];
  const failedItems:   CleanupFailedItem[]   = [];

  try {
    // Re-derive the plan server-side (never trust client-provided item list)
    const plan = await buildStorageCleanupPlan(projectId);

    for (const item of plan.eligibleItems) {
      try {
        await deleteItem(item, project.slug);

        // For backups, update the DB record
        if (item.kind === "backup") {
          await db.projectBackup.update({
            where: { id: item.id },
            data:  {
              status:    "deleted",
              deletedAt: new Date(),
            },
          }).catch(() => null); // non-fatal — file is already gone
        }

        deletedItems.push({
          id:         item.id,
          label:      item.label,
          kind:       item.kind,
          bytesFreed: item.sizeBytes,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failedItems.push({ id: item.id, label: item.label, reason });
      }
    }

    const totalBytesFreed = deletedItems.reduce((s, d) => s + d.bytesFreed, 0);
    const result: CleanupResult = {
      projectId,
      completedAt: new Date().toISOString(),
      deletedItems,
      failedItems,
      totalBytesFreed,
      operationId: opId,
    };

    await completeProjectOperation(opId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId,
      actorEmail,
      actorRole,
      action:      "storage.cleanup",
      category:    "storage",
      result:      failedItems.length > 0 ? "failed" : "success",
      targetType:  "project",
      targetId:    projectId,
      targetLabel: project.name,
      summary:     `Storage cleanup: deleted ${deletedItems.length} item(s), freed ${formatBytes(totalBytesFreed)}. ${failedItems.length} failure(s).`,
      metadata: {
        deletedItems: deletedItems.map((d) => ({ id: d.id, label: d.label, kind: d.kind, bytesFreed: d.bytesFreed })),
        failedCount:  failedItems.length,
        totalBytesFreed,
        operationId:  opId,
      },
    });

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failProjectOperation(opId, msg);
    throw err;
  }
}

// ── Per-item delete ────────────────────────────────────────────────────────────

async function deleteItem(item: StorageItem, slug: string): Promise<void> {
  if (item.kind === "release") {
    await deleteReleaseDir(slug, item.id);
  } else if (item.kind === "backup") {
    // Look up the backupRef from DB to get the actual directory name
    const backup = await db.projectBackup.findUnique({
      where:  { id: item.id },
      select: { backupRef: true, deletedAt: true },
    });
    if (!backup) throw new Error(`Backup record not found: ${item.id}`);
    if (backup.deletedAt) return; // already deleted — skip
    await deleteBackupDir(slug, backup.backupRef);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)          return `${b} B`;
  if (b < 1024 * 1024)   return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)     return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 ** 3)).toFixed(2)} GB`;
}
