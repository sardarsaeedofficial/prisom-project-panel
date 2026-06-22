/**
 * lib/backups/backup-scheduler.ts
 *
 * Sprint 30: Background scheduler for periodic scheduled project backups.
 *
 * Mirrors the pattern of lib/projects/alert-scheduler.ts exactly:
 *  - Singleton guard via globalThis
 *  - setInterval tick every 5 minutes
 *  - Queries ProjectBackupSchedule where enabled=true AND nextRunAt <= now
 *  - Delegates to runDueBackupSchedules
 *  - Individual project failures do not crash the scheduler loop
 *  - Never starts during Next.js build phase
 *  - Can be disabled via ENABLE_INTERNAL_SCHEDULERS=false
 *
 * Started from instrumentation.ts alongside the alert scheduler.
 */

import { runDueBackupSchedules } from "./backup-schedule-runner";

// ── Singleton guard ───────────────────────────────────────────────────────────

const globalForScheduler = globalThis as unknown as {
  __prisomBackupSchedulerStarted?: boolean;
};

const SCHEDULER_TICK_MS = 5 * 60 * 1000; // 5 minutes

// ── Public: start scheduler ───────────────────────────────────────────────────

/**
 * Start the background backup scheduler.
 *
 * Idempotent — safe to call multiple times (only starts once per process).
 * Should only be called from server-side code (instrumentation.ts).
 */
export function startBackupScheduler(): void {
  if (globalForScheduler.__prisomBackupSchedulerStarted) {
    return;
  }

  // Allow disabling via env var
  if (process.env.ENABLE_INTERNAL_SCHEDULERS === "false") {
    console.log("[backup-scheduler] disabled via ENABLE_INTERNAL_SCHEDULERS=false");
    return;
  }

  // Skip during Next.js build phase (no DB connection expected)
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  ) {
    return;
  }

  globalForScheduler.__prisomBackupSchedulerStarted = true;

  setInterval(() => {
    runDueBackupSchedules()
      .then(() => {
        // Sprint 31: register heartbeat for Admin Console scheduler status
        import("@/lib/scheduler/scheduler-status").then(({ registerSchedulerHeartbeat }) => {
          registerSchedulerHeartbeat("backups");
        }).catch(() => null);
      })
      .catch((err: unknown) => {
        console.error("[backup-scheduler] tick error:", err);
        import("@/lib/scheduler/scheduler-status").then(({ registerSchedulerHeartbeat }) => {
          registerSchedulerHeartbeat("backups", err instanceof Error ? err.message : String(err));
        }).catch(() => null);
      });
  }, SCHEDULER_TICK_MS);

  console.log("[backup-scheduler] started — tick every 5 min");
}
