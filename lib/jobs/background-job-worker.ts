/**
 * lib/jobs/background-job-worker.ts
 *
 * Sprint 35: Lightweight background job worker loop.
 *
 * Ticks every 30 seconds. Each tick:
 *  1. Marks stale jobs
 *  2. Claims up to 3 due jobs
 *  3. Executes each job's handler
 *  4. Prunes old rows once per hour
 *
 * Safety rules:
 *  - Singleton via globalThis (never starts twice)
 *  - Disabled if ENABLE_BACKGROUND_JOBS=false
 *  - Skipped during Next.js build phase
 *  - One job error does NOT stop the loop
 *  - DB errors are caught and logged
 *  - Never restarts PM2, deploys code, or runs storage cleanup without prior user confirmation
 */

import { claimDueJob }              from "./background-job-service";
import { executeBackgroundJob }     from "./background-job-runner";
import { pruneOldBackgroundJobs }   from "./background-job-retention";
import { WORKER_TICK_MS, WORKER_CLAIM_LIMIT } from "./background-job-types";

// ── Singleton guard ───────────────────────────────────────────────────────────

const globalForWorker = globalThis as unknown as {
  __prisomJobWorkerStarted?: boolean;
};

let pruneCounter = 0;
const PRUNE_EVERY_N_TICKS = Math.ceil((60 * 60 * 1000) / WORKER_TICK_MS); // ~120 ticks = 1 hour

// ── Worker ID ─────────────────────────────────────────────────────────────────

const WORKER_ID = `worker_${Date.now().toString(36)}`;

// ── Tick ──────────────────────────────────────────────────────────────────────

async function workerTick(): Promise<void> {
  // Register heartbeat so Admin Console shows worker as "running"
  import("@/lib/scheduler/scheduler-status")
    .then(({ registerSchedulerHeartbeat }) => registerSchedulerHeartbeat("jobs"))
    .catch(() => null);

  // Claim and execute up to WORKER_CLAIM_LIMIT jobs per tick
  let claimed = 0;
  for (let i = 0; i < WORKER_CLAIM_LIMIT; i++) {
    try {
      const jobId = await claimDueJob(WORKER_ID);
      if (!jobId) break; // no more due jobs

      claimed++;
      // Execute but do not await — jobs run concurrently
      executeBackgroundJob(jobId).catch((err) => {
        console.error(`[job-worker] uncaught error in job ${jobId}:`, err);
      });
    } catch (err) {
      console.error("[job-worker] claim error:", err);
      break;
    }
  }

  if (claimed > 0) {
    console.log(`[job-worker] tick — claimed ${claimed} job(s)`);
  }

  // Prune old rows once per hour
  pruneCounter++;
  if (pruneCounter >= PRUNE_EVERY_N_TICKS) {
    pruneCounter = 0;
    pruneOldBackgroundJobs()
      .then(({ pruned }) => {
        if (pruned > 0) console.log(`[job-worker] pruned ${pruned} old job row(s)`);
      })
      .catch((err) => console.warn("[job-worker] prune error:", err));
  }
}

// ── Public: start worker ──────────────────────────────────────────────────────

export function startBackgroundJobWorker(): void {
  if (globalForWorker.__prisomJobWorkerStarted) return;

  if (process.env.ENABLE_BACKGROUND_JOBS === "false") {
    console.log("[job-worker] disabled via ENABLE_BACKGROUND_JOBS=false");
    return;
  }

  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  ) {
    return;
  }

  globalForWorker.__prisomJobWorkerStarted = true;

  setInterval(() => {
    workerTick().catch((err) => {
      console.error("[job-worker] tick error:", err);
    });
  }, WORKER_TICK_MS);

  console.log(`[job-worker] started — worker ID ${WORKER_ID}, tick every ${WORKER_TICK_MS / 1000}s`);
}
