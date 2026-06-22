"use server";

/**
 * app/actions/admin-jobs.ts
 *
 * Sprint 35: Admin server actions for the Background Jobs dashboard.
 *
 * Safety rules:
 *  - All actions require OWNER or ADMIN role
 *  - Retry of destructive jobs is blocked (storage_cleanup requires confirmation flow)
 *  - No secret values returned — job metadata is sanitized at write time
 *  - cancel/markStale only affect non-terminal, non-running states
 */

import { requireAdmin }          from "@/lib/auth/require-admin";
import {
  listBackgroundJobs,
  retryJob,
  cancelJob,
  markStaleJobs,
} from "@/lib/jobs/background-job-service";
import { pruneOldBackgroundJobs } from "@/lib/jobs/background-job-retention";
import type {
  ListBackgroundJobsInput,
  ListBackgroundJobsOutput,
} from "@/lib/jobs/background-job-types";

// ── List ──────────────────────────────────────────────────────────────────────

export async function listAdminJobsAction(
  input: ListBackgroundJobsInput,
): Promise<{ ok: true; result: ListBackgroundJobsOutput } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const result = await listBackgroundJobs(input);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list jobs" };
  }
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export async function retryAdminJobAction(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();

    if (!jobId || typeof jobId !== "string") {
      return { ok: false, error: "Invalid job ID" };
    }

    // Safety: block re-queueing of storage_cleanup jobs (requires user confirmation in UI)
    const { db } = await import("@/lib/db");
    const job = await db.backgroundJob.findUnique({
      where:  { id: jobId },
      select: { jobType: true, status: true },
    });

    if (!job) return { ok: false, error: "Job not found" };

    if (job.jobType === "storage_cleanup") {
      return {
        ok:    false,
        error: "Storage cleanup jobs cannot be retried automatically. Use the project Storage Center to re-initiate.",
      };
    }

    if (job.status === "running") {
      return { ok: false, error: "Job is already running" };
    }
    if (job.status === "queued" || job.status === "retrying") {
      return { ok: false, error: "Job is already queued" };
    }

    const ok = await retryJob(jobId);
    if (!ok) return { ok: false, error: "Job could not be re-queued (status may have changed)" };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to retry job" };
  }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelAdminJobAction(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();

    if (!jobId || typeof jobId !== "string") {
      return { ok: false, error: "Invalid job ID" };
    }

    const ok = await cancelJob(jobId);
    if (!ok) return { ok: false, error: "Job could not be cancelled (it may not be queued/retrying)" };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to cancel job" };
  }
}

// ── Mark stale (admin-triggered) ─────────────────────────────────────────────

export async function markStaleJobsAction(): Promise<
  { ok: true; markedStale: number } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    const markedStale = await markStaleJobs();
    return { ok: true, markedStale };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to mark stale jobs" };
  }
}

// ── Prune ─────────────────────────────────────────────────────────────────────

export async function pruneOldJobsAction(): Promise<
  { ok: true; pruned: number } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    const { pruned } = await pruneOldBackgroundJobs();
    return { ok: true, pruned };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to prune old jobs" };
  }
}
