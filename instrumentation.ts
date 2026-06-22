/**
 * instrumentation.ts
 *
 * Next.js server instrumentation hook — runs once when the server starts.
 * Starts background schedulers for alert checks and scheduled backups.
 *
 * Schedulers:
 *  - Alert scheduler   — checks per-project alert rules on a configurable interval
 *  - Backup scheduler  — runs due scheduled project backups every 5 minutes
 *
 * Both schedulers:
 *  - Only run inside the Node.js runtime (not Edge runtime, not build phase)
 *  - Are guarded by per-scheduler global singletons (never start twice)
 *  - Can be disabled via ALERT_SCHEDULER_ENABLED=false / ENABLE_INTERNAL_SCHEDULERS=false
 *
 * Reference: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only start in the Node.js runtime (not Edge runtime, not build phase)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAlertScheduler } = await import(
      "./lib/projects/alert-scheduler"
    );
    startAlertScheduler();

    const { startBackupScheduler } = await import(
      "./lib/backups/backup-scheduler"
    );
    startBackupScheduler();
  }
}
