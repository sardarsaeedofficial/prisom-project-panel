/**
 * lib/backups/backup-schedule-service.ts
 *
 * Sprint 30: CRUD helpers for ProjectBackupSchedule records.
 * Server-only — uses Prisma.
 */

import { db } from "@/lib/db";
import {
  computeNextBackupRun,
  computeScheduleHealthStatus,
  validateScheduleInput,
  type BackupScheduleDTO,
  type BackupScheduleSettings,
  type ScheduleValidationError,
} from "./backup-schedule-types";

// ── DB row → DTO ──────────────────────────────────────────────────────────────

function toDTO(row: {
  id:              string;
  projectId:       string;
  enabled:         boolean;
  frequency:       string;
  timeOfDay:       string;
  dayOfWeek:       number | null;
  retentionCount:  number;
  includeSource:   boolean;
  includeEnvMetadata: boolean;
  lastRunAt:       Date | null;
  lastSuccessAt:   Date | null;
  lastFailureAt:   Date | null;
  lastFailureText: string | null;
  nextRunAt:       Date | null;
  createdAt:       Date;
  updatedAt:       Date;
}): BackupScheduleDTO {
  const dto: BackupScheduleDTO = {
    id:              row.id,
    projectId:       row.projectId,
    enabled:         row.enabled,
    frequency:       row.frequency as "daily" | "weekly",
    timeOfDay:       row.timeOfDay,
    dayOfWeek:       row.dayOfWeek,
    retentionCount:  row.retentionCount,
    includeSource:   row.includeSource,
    includeEnvMetadata: row.includeEnvMetadata,
    lastRunAt:       row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt:   row.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt:   row.lastFailureAt?.toISOString() ?? null,
    lastFailureText: row.lastFailureText,
    nextRunAt:       row.nextRunAt?.toISOString() ?? null,
    healthStatus:    "disabled",
    createdAt:       row.createdAt.toISOString(),
    updatedAt:       row.updatedAt.toISOString(),
  };
  dto.healthStatus = computeScheduleHealthStatus(dto);
  return dto;
}

// ── Get or create ─────────────────────────────────────────────────────────────

export async function getOrCreateBackupSchedule(projectId: string): Promise<BackupScheduleDTO> {
  let row = await db.projectBackupSchedule.findUnique({ where: { projectId } });
  if (!row) {
    row = await db.projectBackupSchedule.create({ data: { projectId } });
  }
  return toDTO(row);
}

// ── Save schedule ─────────────────────────────────────────────────────────────

export type SaveScheduleInput = Partial<BackupScheduleSettings>;
export type SaveScheduleResult =
  | { ok: true; schedule: BackupScheduleDTO }
  | { ok: false; errors: ScheduleValidationError[] };

export async function saveBackupSchedule(
  projectId: string,
  input: SaveScheduleInput,
): Promise<SaveScheduleResult> {
  const errors = validateScheduleInput(input);
  if (errors.length > 0) return { ok: false, errors };

  const existing = await db.projectBackupSchedule.findUnique({ where: { projectId } });

  // Compute new nextRunAt if relevant fields changed and schedule is enabled
  const willEnable  = input.enabled ?? existing?.enabled ?? false;
  const newFreq     = input.frequency  ?? existing?.frequency  ?? "daily";
  const newTime     = input.timeOfDay  ?? existing?.timeOfDay  ?? "02:00";
  const newDay      = input.dayOfWeek  !== undefined ? input.dayOfWeek : (existing?.dayOfWeek ?? null);

  let nextRunAt: Date | null | undefined = undefined; // undefined = don't touch
  if (willEnable) {
    nextRunAt = computeNextBackupRun({ frequency: newFreq as "daily"|"weekly", timeOfDay: newTime, dayOfWeek: newDay });
  } else if (!willEnable && existing?.enabled) {
    // Being disabled — clear nextRunAt so it doesn't fire
    nextRunAt = null;
  }

  const updateData: Record<string, unknown> = {};
  if (input.enabled         !== undefined) updateData.enabled          = input.enabled;
  if (input.frequency       !== undefined) updateData.frequency        = input.frequency;
  if (input.timeOfDay       !== undefined) updateData.timeOfDay        = input.timeOfDay;
  if (input.dayOfWeek       !== undefined) updateData.dayOfWeek        = input.dayOfWeek;
  if (input.retentionCount  !== undefined) updateData.retentionCount   = input.retentionCount;
  if (input.includeSource   !== undefined) updateData.includeSource    = input.includeSource;
  if (input.includeEnvMetadata !== undefined) updateData.includeEnvMetadata = input.includeEnvMetadata;
  if (nextRunAt             !== undefined) updateData.nextRunAt        = nextRunAt;

  const row = await db.projectBackupSchedule.upsert({
    where:  { projectId },
    create: { projectId, ...updateData },
    update: updateData,
  });

  return { ok: true, schedule: toDTO(row) };
}

// ── Enable / disable shortcuts ────────────────────────────────────────────────

export async function enableBackupSchedule(projectId: string): Promise<BackupScheduleDTO> {
  const existing = await db.projectBackupSchedule.findUnique({ where: { projectId } });
  const nextRunAt = computeNextBackupRun({
    frequency:  (existing?.frequency ?? "daily") as "daily" | "weekly",
    timeOfDay:  existing?.timeOfDay  ?? "02:00",
    dayOfWeek:  existing?.dayOfWeek  ?? null,
  });
  const row = await db.projectBackupSchedule.upsert({
    where:  { projectId },
    create: { projectId, enabled: true, nextRunAt },
    update: { enabled: true, nextRunAt },
  });
  return toDTO(row);
}

export async function disableBackupSchedule(projectId: string): Promise<BackupScheduleDTO> {
  const row = await db.projectBackupSchedule.upsert({
    where:  { projectId },
    create: { projectId, enabled: false, nextRunAt: null },
    update: { enabled: false, nextRunAt: null },
  });
  return toDTO(row);
}

// ── Update after run (called by runner) ──────────────────────────────────────

export async function recordScheduleRunResult(
  projectId: string,
  result: "success" | "failure",
  errorText: string | null,
): Promise<void> {
  const now      = new Date();
  const existing = await db.projectBackupSchedule.findUnique({ where: { projectId } });
  if (!existing) return;

  const nextRunAt = existing.enabled
    ? computeNextBackupRun({
        frequency: existing.frequency as "daily" | "weekly",
        timeOfDay: existing.timeOfDay,
        dayOfWeek: existing.dayOfWeek,
      }, now)
    : null;

  await db.projectBackupSchedule.update({
    where: { projectId },
    data: {
      lastRunAt:       now,
      ...(result === "success" ? { lastSuccessAt: now } : {}),
      ...(result === "failure" ? { lastFailureAt: now, lastFailureText: errorText ?? "Unknown error" } : {}),
      nextRunAt,
    },
  });
}
