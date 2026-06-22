/**
 * lib/backups/backup-schedule-types.ts
 *
 * Sprint 30: Types, validation, and constants for the scheduled backup system.
 * Pure data — no server deps.  Safe to import from client or server.
 */

// ── Schedule config ────────────────────────────────────────────────────────────

export type BackupFrequency = "daily" | "weekly";

export type BackupScheduleSettings = {
  enabled:           boolean;
  frequency:         BackupFrequency;
  timeOfDay:         string;        // HH:mm
  dayOfWeek:         number | null; // 0=Sun … 6=Sat; for weekly
  retentionCount:    number;
  includeSource:     boolean;
  includeEnvMetadata: boolean;
};

// ── DTO (safe to send to client) ──────────────────────────────────────────────

export type BackupScheduleDTO = BackupScheduleSettings & {
  id:              string;
  projectId:       string;
  lastRunAt:       string | null;
  lastSuccessAt:   string | null;
  lastFailureAt:   string | null;
  lastFailureText: string | null;
  nextRunAt:       string | null;
  healthStatus:    BackupScheduleHealthStatus;
  createdAt:       string;
  updatedAt:       string;
};

// ── Health status ──────────────────────────────────────────────────────────────

export type BackupScheduleHealthStatus =
  | "healthy"    // recent successful backup
  | "warning"    // enabled but stale (backup missed window)
  | "failed"     // last scheduled run failed
  | "disabled"   // schedule is off
  | "never_run"; // enabled but never run

// ── Validation ────────────────────────────────────────────────────────────────

const TIME_PATTERN = /^\d{2}:\d{2}$/;

export type ScheduleValidationError = { field: string; message: string };

export function validateScheduleInput(input: Partial<BackupScheduleSettings>): ScheduleValidationError[] {
  const errors: ScheduleValidationError[] = [];

  if (input.frequency !== undefined && input.frequency !== "daily" && input.frequency !== "weekly") {
    errors.push({ field: "frequency", message: "Frequency must be daily or weekly." });
  }

  if (input.timeOfDay !== undefined) {
    if (!TIME_PATTERN.test(input.timeOfDay)) {
      errors.push({ field: "timeOfDay", message: "Time must be in HH:mm format." });
    } else {
      const [h, m] = input.timeOfDay.split(":").map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        errors.push({ field: "timeOfDay", message: "Invalid time value." });
      }
    }
  }

  if (input.frequency === "weekly" && input.dayOfWeek !== undefined && input.dayOfWeek !== null) {
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      errors.push({ field: "dayOfWeek", message: "Day of week must be 0 (Sun) to 6 (Sat)." });
    }
  }

  if (input.retentionCount !== undefined) {
    if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 100) {
      errors.push({ field: "retentionCount", message: "Retention count must be between 1 and 100." });
    }
  }

  return errors;
}

// ── Next-run calculation ──────────────────────────────────────────────────────

/**
 * Compute the next backup run time from `from` (defaults to now).
 *
 * Rules:
 *  - daily:  next occurrence of timeOfDay at or after `from`
 *  - weekly: next occurrence of dayOfWeek at timeOfDay at or after `from`
 */
export function computeNextBackupRun(
  schedule: Pick<BackupScheduleSettings, "frequency" | "timeOfDay" | "dayOfWeek">,
  from: Date = new Date(),
): Date {
  const [hours, minutes] = schedule.timeOfDay.split(":").map(Number);

  // Build today's candidate run time
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);

  if (schedule.frequency === "daily") {
    // If we've already passed today's time, advance by 1 day
    if (candidate <= from) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  if (schedule.frequency === "weekly") {
    const targetDay = schedule.dayOfWeek ?? 0;
    const currentDay = candidate.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;

    // Same day but time has passed (or exactly now) — jump forward 7 days
    if (daysUntil === 0 && candidate <= from) {
      daysUntil = 7;
    }

    candidate.setDate(candidate.getDate() + daysUntil);
    return candidate;
  }

  // Fallback: 24 hours
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

// ── Health calculator ─────────────────────────────────────────────────────────

export function computeScheduleHealthStatus(
  schedule: Pick<
    BackupScheduleDTO,
    "enabled" | "frequency" | "lastSuccessAt" | "lastFailureAt" | "lastRunAt"
  >,
): BackupScheduleHealthStatus {
  if (!schedule.enabled) return "disabled";

  if (!schedule.lastRunAt) return "never_run";

  // If the last run failed
  if (
    schedule.lastFailureAt &&
    (!schedule.lastSuccessAt || new Date(schedule.lastFailureAt) > new Date(schedule.lastSuccessAt))
  ) {
    return "failed";
  }

  if (!schedule.lastSuccessAt) return "never_run";

  const now        = Date.now();
  const lastSuccess = new Date(schedule.lastSuccessAt).getTime();
  const ageMs      = now - lastSuccess;

  const staleThresholdMs = schedule.frequency === "weekly"
    ? 8 * 24 * 60 * 60 * 1000  // 8 days for weekly
    : 26 * 60 * 60 * 1000;     // 26 hours for daily (allow slight delay)

  return ageMs <= staleThresholdMs ? "healthy" : "warning";
}

// ── Day names ─────────────────────────────────────────────────────────────────

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
