/**
 * lib/jobs/background-job-runner.ts
 *
 * Sprint 35: Execute a single background job.
 *
 * Fetches the job from DB, finds its registered handler, runs it,
 * marks success or failure. Safe to call from the worker loop.
 */

import { db }           from "@/lib/db";
import {
  completeJob,
  failJob,
  heartbeatJob,
} from "./background-job-service";
import { getJobHandler } from "./background-job-handlers";
import type { JobType }  from "./background-job-types";

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeBackgroundJob(jobId: string): Promise<void> {
  const job = await db.backgroundJob.findUnique({
    where:  { id: jobId },
    select: {
      id:          true,
      jobType:     true,
      metadataJson: true,
      status:      true,
    },
  });

  if (!job || job.status !== "running") {
    console.warn(`[job-runner] job ${jobId} not found or not running — skipping`);
    return;
  }

  const jobType  = job.jobType as JobType;
  const handler  = getJobHandler(jobType);
  const metadata = (job.metadataJson as Record<string, unknown>) ?? {};

  if (!handler) {
    await failJob(jobId, `No handler registered for job type: ${jobType}`);
    return;
  }

  // Heartbeat timer — update DB every 30s for long-running jobs
  const heartbeatTimer = setInterval(() => {
    heartbeatJob(jobId).catch(() => null);
  }, 30_000);

  try {
    const logLine = await handler(jobId, metadata);
    await completeJob(jobId, logLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(jobId, msg);
  } finally {
    clearInterval(heartbeatTimer);
  }
}
