/**
 * lib/backups/backup-schedule-runner.ts
 *
 * Sprint 30: Per-project scheduled backup runner + scheduler tick.
 *
 * runScheduledBackupForProject — runs a single backup, acquires operation lock,
 *   updates schedule timestamps, applies retention.
 *
 * runDueBackupSchedules — finds all due schedules and runs them.
 *   Called from the scheduler tick (startBackupScheduler).
 *
 * Safety:
 *  - Uses Sprint 27 operation lock (backup_create) — blocked by restore/deploy
 *  - One backup per project at a time (in-memory guard + DB lock)
 *  - Failures are captured; one project failure does not stop the batch
 *  - Never auto-restores anything
 *  - Sanitized error messages stored (no stack traces, no secrets)
 */

import { db }                       from "@/lib/db";
import { createProjectBackup }      from "./project-backup-runner";
import { applyRetentionPolicy }     from "./backup-retention";
import { recordScheduleRunResult }  from "./backup-schedule-service";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import {
  startProjectOperation,
  completeProjectOperation,
  failProjectOperation,
  OperationConflictError,
} from "@/lib/operations/project-operation-service";

// ── In-memory guard (per-process, prevents overlap within same tick) ──────────

const runningProjectIds = new Set<string>();

// ── Per-project runner ────────────────────────────────────────────────────────

export type ScheduledRunResult = {
  ok:        boolean;
  projectId: string;
  backupId?: string;
  error?:    string;
  skipped?:  boolean;
  reason?:   string;
};

/**
 * Run a scheduled backup for a single project.
 *
 * Can be called by the scheduler tick or by an explicit "Run now" user action.
 * `isUserTriggered` controls whether the operation title says "Scheduled" or "Run now".
 */
export async function runScheduledBackupForProject(input: {
  projectId:     string;
  isUserTriggered?: boolean;
}): Promise<ScheduledRunResult> {
  const { projectId, isUserTriggered = false } = input;

  // In-memory dedup
  if (runningProjectIds.has(projectId)) {
    return { ok: false, projectId, skipped: true, reason: "Already running for this project." };
  }
  runningProjectIds.add(projectId);

  const startedAt = Date.now();
  let opId: string | null = null;

  try {
    // Load project meta
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true },
    });
    if (!project) {
      return { ok: false, projectId, error: "Project not found." };
    }

    const schedule = await db.projectBackupSchedule.findUnique({ where: { projectId } });
    if (!schedule) {
      return { ok: false, projectId, error: "Backup schedule not found." };
    }

    // Acquire operation lock
    const title = isUserTriggered
      ? "Scheduled backup (run now)"
      : "Scheduled backup";

    try {
      opId = await startProjectOperation({
        projectId,
        operationType: "backup_create",
        title,
        // system-initiated — no user ID
        meta: { trigger: isUserTriggered ? "manual_run_now" : "scheduler" },
      });
    } catch (err) {
      if (err instanceof OperationConflictError) {
        return { ok: false, projectId, skipped: true, reason: err.message };
      }
      throw err;
    }

    // Audit: started
    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.scheduled_run_started",
      category: "backups",
      result:   "success",
      summary:  `Scheduled backup started (${isUserTriggered ? "run now" : "scheduler"}).`,
      metadata: {
        trigger:        isUserTriggered ? "manual_run_now" : "scheduler",
        frequency:      schedule.frequency,
        retentionCount: schedule.retentionCount,
      },
    });

    // Create the backup
    const backupResult = await createProjectBackup({
      projectId,
      projectSlug:    project.slug,
      projectName:    project.name,
      label:          isUserTriggered ? "Scheduled (run now)" : undefined,
      backupType:     "scheduled" as import("./project-backup-types").BackupType,
      includeEnvKeys: schedule.includeEnvMetadata,
      createdByUserId: null,
    });

    const durationMs = Date.now() - startedAt;

    if (!backupResult.ok) {
      await failProjectOperation(opId!, backupResult.error);
      await recordScheduleRunResult(projectId, "failure", backupResult.error);

      await writeProjectAuditEvent({
        projectId,
        action:   "project.backup.scheduled_run_failed",
        category: "backups",
        result:   "failed",
        summary:  `Scheduled backup failed: ${backupResult.error}`,
        metadata: { trigger: isUserTriggered ? "manual_run_now" : "scheduler", durationMs },
      });

      return { ok: false, projectId, error: backupResult.error };
    }

    // Success — complete the operation
    await completeProjectOperation(opId!);
    await recordScheduleRunResult(projectId, "success", null);

    // Apply retention policy
    const retention = await applyRetentionPolicy(projectId, schedule.retentionCount).catch((err) => {
      console.error(`[backup-scheduler] retention error for ${projectId}:`, err);
      return { kept: 0, deleted: 0, errors: 1 };
    });

    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.scheduled_run_completed",
      category: "backups",
      result:   "success",
      summary:  `Scheduled backup completed. Retention: kept ${retention.kept}, deleted ${retention.deleted}.`,
      metadata: {
        trigger:        isUserTriggered ? "manual_run_now" : "scheduler",
        backupId:       backupResult.backupId,
        backupRef:      backupResult.backupRef,
        durationMs,
        retentionKept:  retention.kept,
        retentionDeleted: retention.deleted,
      },
    });

    return { ok: true, projectId, backupId: backupResult.backupId };
  } catch (err) {
    const errMsg = err instanceof Error
      ? err.message.slice(0, 500)
      : "Unexpected error during scheduled backup.";

    if (opId) {
      await failProjectOperation(opId, errMsg).catch(() => null);
    }
    await recordScheduleRunResult(projectId, "failure", errMsg).catch(() => null);

    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.scheduled_run_failed",
      category: "backups",
      result:   "failed",
      summary:  `Scheduled backup crashed: ${errMsg}`,
      metadata: { trigger: isUserTriggered ? "manual_run_now" : "scheduler" },
    });

    return { ok: false, projectId, error: errMsg };
  } finally {
    runningProjectIds.delete(projectId);
  }
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

export type BackupScheduleRunSummary = {
  evaluated: number;
  succeeded: number;
  failed:    number;
  skipped:   number;
};

const MAX_BATCH = 5; // max projects to process per tick

/**
 * Find and run all due backup schedules.
 * Individual project failures do not abort the batch.
 */
export async function runDueBackupSchedules(): Promise<BackupScheduleRunSummary> {
  const now = new Date();

  const dueSchedules = await db.projectBackupSchedule.findMany({
    where: {
      enabled:   true,
      nextRunAt: { lte: now },
    },
    take:    MAX_BATCH,
    orderBy: { nextRunAt: "asc" },
    select:  { projectId: true },
  }).catch((err: unknown) => {
    console.error("[backup-scheduler] failed to query due schedules:", err);
    return [];
  });

  if (dueSchedules.length === 0) {
    return { evaluated: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const toRun = dueSchedules.filter((s) => !runningProjectIds.has(s.projectId));

  let succeeded = 0;
  let failed    = 0;
  let skipped   = 0;

  const results = await Promise.allSettled(
    toRun.map((s) => runScheduledBackupForProject({ projectId: s.projectId })),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const r = result.value;
      if (r.skipped)    skipped++;
      else if (r.ok)    succeeded++;
      else              failed++;
    } else {
      failed++;
      console.error("[backup-scheduler] unexpected error in batch:", result.reason);
    }
  }

  return { evaluated: toRun.length, succeeded, failed, skipped };
}
