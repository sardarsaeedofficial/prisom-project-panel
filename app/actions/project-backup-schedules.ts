"use server";

/**
 * app/actions/project-backup-schedules.ts
 *
 * Sprint 30: Server actions for backup schedule management.
 *
 * Security:
 *  - View schedule: project.view
 *  - Change schedule / run now: project.admin or project.owner
 *    (enforced via backup.create permission which requires admin+)
 *  - No secret values returned
 *  - All inputs validated in backup-schedule-types
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import {
  getOrCreateBackupSchedule,
  saveBackupSchedule,
  enableBackupSchedule,
  disableBackupSchedule,
  type SaveScheduleInput,
} from "@/lib/backups/backup-schedule-service";
import { runScheduledBackupForProject } from "@/lib/backups/backup-schedule-runner";
import type { BackupScheduleDTO }       from "@/lib/backups/backup-schedule-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: { field: string; message: string }[] };

// ── Get schedule ──────────────────────────────────────────────────────────────

export async function getBackupScheduleAction(
  projectId: string,
): Promise<ActionResult<{ schedule: BackupScheduleDTO }>> {
  try {
    await requireProjectPermission(projectId, "project.view");
    const schedule = await getOrCreateBackupSchedule(projectId);
    return { ok: true, data: { schedule } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: msg };
  }
}

// ── Save schedule ─────────────────────────────────────────────────────────────

export async function saveBackupScheduleAction(
  projectId: string,
  input: SaveScheduleInput,
): Promise<ActionResult<{ schedule: BackupScheduleDTO }>> {
  try {
    await requireProjectPermission(projectId, "backup.create");

    const result = await saveBackupSchedule(projectId, input);
    if (!result.ok) {
      return { ok: false, error: "Validation failed.", fieldErrors: result.errors };
    }

    const auth = await requireProjectPermission(projectId, "backup.create").catch(() => null);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: (auth as { userId?: string } | null)?.userId ?? null,
      action:      "project.backup.schedule_saved",
      category:    "backups",
      result:      "success",
      summary:     `Backup schedule saved (${input.enabled ? "enabled" : "disabled"}, ${input.frequency ?? "daily"}).`,
      metadata: {
        enabled:        input.enabled,
        frequency:      input.frequency,
        timeOfDay:      input.timeOfDay,
        dayOfWeek:      input.dayOfWeek,
        retentionCount: input.retentionCount,
      },
    });

    return { ok: true, data: { schedule: result.schedule } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: msg };
  }
}

// ── Enable schedule ───────────────────────────────────────────────────────────

export async function enableBackupScheduleAction(
  projectId: string,
): Promise<ActionResult<{ schedule: BackupScheduleDTO }>> {
  try {
    await requireProjectPermission(projectId, "backup.create");
    const schedule = await enableBackupSchedule(projectId);

    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.schedule_enabled",
      category: "backups",
      result:   "success",
      summary:  `Backup schedule enabled. Next run: ${schedule.nextRunAt ?? "unknown"}.`,
      metadata: { nextRunAt: schedule.nextRunAt, frequency: schedule.frequency },
    });

    return { ok: true, data: { schedule } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: msg };
  }
}

// ── Disable schedule ──────────────────────────────────────────────────────────

export async function disableBackupScheduleAction(
  projectId: string,
): Promise<ActionResult<{ schedule: BackupScheduleDTO }>> {
  try {
    await requireProjectPermission(projectId, "backup.create");
    const schedule = await disableBackupSchedule(projectId);

    await writeProjectAuditEvent({
      projectId,
      action:   "project.backup.schedule_disabled",
      category: "backups",
      result:   "success",
      summary:  "Backup schedule disabled.",
    });

    return { ok: true, data: { schedule } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: msg };
  }
}

// ── Run scheduled backup now ──────────────────────────────────────────────────

export async function runScheduledBackupNowAction(
  projectId: string,
): Promise<ActionResult<{ backupId: string }>> {
  try {
    await requireProjectPermission(projectId, "backup.create");

    const result = await runScheduledBackupForProject({ projectId, isUserTriggered: true });

    if (result.skipped) {
      return { ok: false, error: result.reason ?? "Backup is already running or blocked." };
    }
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Backup failed." };
    }

    return { ok: true, data: { backupId: result.backupId! } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) return { ok: false, error: "Access denied." };
    return { ok: false, error: msg };
  }
}
