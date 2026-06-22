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

// Sprint 37: fire admin notifications when a job permanently fails
async function notifyJobFailed(jobId: string, error: string): Promise<void> {
  try {
    const job = await db.backgroundJob.findUnique({
      where:  { id: jobId },
      select: { id: true, title: true, jobType: true, status: true, projectId: true, attempts: true, maxAttempts: true },
    });
    if (!job || job.status !== "failed") return; // still retrying — don't notify yet

    const { notifyAdmins, notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
    const notifyInput = {
      title:      `Background job failed: ${job.title}`,
      body:       error.slice(0, 500),
      severity:   "error" as const,
      category:   "job" as const,
      sourceType: "background_job",
      sourceId:   job.id,
      href:       job.projectId ? `/projects/${job.projectId}/operations` : "/admin/jobs",
    };

    if (job.projectId) {
      await notifyProjectAdmins(job.projectId, notifyInput);
    }
    await notifyAdmins(notifyInput);
  } catch {
    // Non-fatal
  }
}

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
    notifyJobFailed(jobId, msg).catch(() => null);
  } finally {
    clearInterval(heartbeatTimer);
  }
}
