/**
 * instrumentation.ts
 *
 * Next.js server instrumentation hook — runs once when the server starts.
 * This is the safe, idiomatic place to start the background alert scheduler.
 *
 * The scheduler:
 *  - Only runs inside the panel's Node.js process (prisom-projects)
 *  - Never starts during the build phase
 *  - Is guarded by a global singleton so it never runs more than once
 *  - Can be disabled via ALERT_SCHEDULER_ENABLED=false
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
  }
}
