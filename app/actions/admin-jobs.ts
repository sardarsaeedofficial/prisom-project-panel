"use server";

/**
 * app/actions/admin-jobs.ts
 *
 * Sprint 35: Admin server actions for the Background Jobs dashboard.
 * Sprint 36: Add job template creation, job details, project list, scheduler status.
 *
 * Safety rules:
 *  - All actions require OWNER or ADMIN role
 *  - Retry of storage_cleanup is blocked (requires Sprint 34 confirmation flow)
 *  - createBackgroundJobFromTemplateAction validates templateId against server-side allowlist
 *  - No arbitrary job types or client-supplied metadata accepted
 *  - No secrets returned — job metadata is sanitized at write time
 */

import { requireAdmin }              from "@/lib/auth/require-admin";
import {
  listBackgroundJobs,
  retryJob,
  cancelJob,
  markStaleJobs,
} from "@/lib/jobs/background-job-service";
import { pruneOldBackgroundJobs }    from "@/lib/jobs/background-job-retention";
import { createJobFromTemplate }     from "@/lib/jobs/background-job-template-service";
import {
  getPublicTemplates,
  type JobTemplatePublic,
} from "@/lib/jobs/background-job-templates";
import { getSchedulerStatus }        from "@/lib/scheduler/scheduler-status";
import { db }                        from "@/lib/db";
import type {
  ListBackgroundJobsInput,
  ListBackgroundJobsOutput,
  BackgroundJobDTO,
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

// ── Job details ───────────────────────────────────────────────────────────────

export async function getJobDetailsAction(
  jobId: string,
): Promise<{ ok: true; job: BackgroundJobDTO & { safeMetadata: Record<string, unknown> | null } } | { ok: false; error: string }> {
  try {
    await requireAdmin();

    if (!jobId || typeof jobId !== "string") {
      return { ok: false, error: "Invalid job ID" };
    }

    const row = await db.backgroundJob.findUnique({
      where:   { id: jobId },
      include: { project: { select: { name: true } } },
    });

    if (!row) return { ok: false, error: "Job not found" };

    // Build DTO
    const durationMs =
      row.startedAt && row.completedAt
        ? row.completedAt.getTime() - row.startedAt.getTime()
        : row.startedAt ? Date.now() - row.startedAt.getTime() : null;

    const job: BackgroundJobDTO & { safeMetadata: Record<string, unknown> | null } = {
      id:            row.id,
      jobRef:        row.jobRef,
      jobType:       row.jobType as BackgroundJobDTO["jobType"],
      scopeType:     row.scopeType as BackgroundJobDTO["scopeType"],
      projectId:     row.projectId,
      projectName:   row.project?.name ?? null,
      status:        row.status as BackgroundJobDTO["status"],
      priority:      row.priority,
      title:         row.title,
      description:   row.description,
      scheduledFor:  row.scheduledFor?.toISOString() ?? null,
      startedAt:     row.startedAt?.toISOString()    ?? null,
      completedAt:   row.completedAt?.toISOString()  ?? null,
      heartbeatAt:   row.heartbeatAt?.toISOString()  ?? null,
      attempts:      row.attempts,
      maxAttempts:   row.maxAttempts,
      lastError:     row.lastError,
      lastLogLine:   row.lastLogLine,
      lockedBy:      row.lockedBy,
      lockExpiresAt: row.lockExpiresAt?.toISOString() ?? null,
      durationMs,
      createdAt:     row.createdAt.toISOString(),
      updatedAt:     row.updatedAt.toISOString(),
      // Include safe metadata fields (excluding any secrets — metadata is sanitized at write time)
      safeMetadata:  row.metadataJson
        ? sanitizeMetadataForDisplay(row.metadataJson as Record<string, unknown>)
        : null,
    };

    return { ok: true, job };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load job details" };
  }
}

/** Strip any metadata keys that could contain secrets */
function sanitizeMetadataForDisplay(meta: Record<string, unknown>): Record<string, unknown> {
  const BLOCKED_KEYS = new Set([
    "password", "secret", "token", "key", "credential",
    "apiKey", "api_key", "privateKey", "private_key", "env",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (BLOCKED_KEYS.has(k.toLowerCase())) continue;
    // Only allow string, number, boolean, null
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    }
  }
  return out;
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

    // Safety: block re-queueing of storage_cleanup jobs
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

// ── Mark stale ────────────────────────────────────────────────────────────────

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

// ── Sprint 36: Job templates ──────────────────────────────────────────────────

export async function getJobTemplatesAction(): Promise<
  { ok: true; templates: JobTemplatePublic[] } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    return { ok: true, templates: getPublicTemplates() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load templates" };
  }
}

// ── Sprint 36: Create job from template ──────────────────────────────────────

export type CreateJobFromTemplateInput = {
  templateId:    string;
  projectId?:    string;
  scheduledFor?: string; // ISO string from client
  confirmation?: string;
};

export async function createBackgroundJobFromTemplateAction(
  input: CreateJobFromTemplateInput,
): Promise<{ ok: true; jobId: string; jobRef: string } | { ok: false; error: string }> {
  try {
    const actor = await requireAdmin();

    // Never trust client-supplied scheduledFor if it's in the past by more than 1 min
    let scheduledFor: Date | undefined;
    if (input.scheduledFor) {
      const d = new Date(input.scheduledFor);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000) {
        scheduledFor = d;
      }
    }

    const result = await createJobFromTemplate({
      templateId:   input.templateId,
      projectId:    input.projectId,
      scheduledFor: scheduledFor ?? new Date(),
      actorUserId:  actor.userId,
      confirmation: input.confirmation,
    });

    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create job" };
  }
}

// ── Sprint 36: Projects for job template selector ─────────────────────────────

export type ProjectForTemplate = {
  id:     string;
  name:   string;
  slug:   string;
  status: string;
};

export async function getProjectsForJobTemplateAction(): Promise<
  { ok: true; projects: ProjectForTemplate[] } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    const rows = await db.project.findMany({
      select:  { id: true, name: true, slug: true, status: true },
      orderBy: { name: "asc" },
    });
    return {
      ok:       true,
      projects: rows.map((r) => ({
        id:     r.id,
        name:   r.name,
        slug:   r.slug,
        status: r.status as string,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load projects" };
  }
}

// ── Sprint 36: Scheduler status ───────────────────────────────────────────────

export type SchedulerStatusInfo = {
  name:             string;
  label:            string;
  status:           "running" | "stale" | "unknown";
  lastHeartbeatAt?: string;
  tickCount?:       number;
  lastError?:       string;
};

export async function getSchedulerStatusAction(): Promise<
  { ok: true; schedulers: SchedulerStatusInfo[] } | { ok: false; error: string }
> {
  try {
    await requireAdmin();

    const names: Array<{ key: string; label: string }> = [
      { key: "jobs",    label: "Job Worker" },
      { key: "alerts",  label: "Alert Scheduler" },
      { key: "backups", label: "Backup Scheduler" },
    ];

    const schedulers: SchedulerStatusInfo[] = names.map(({ key, label }) => {
      const s = getSchedulerStatus(key);
      return {
        name:             key,
        label,
        status:           s.status,
        lastHeartbeatAt:  s.lastHeartbeatAt,
        tickCount:        s.tickCount,
        lastError:        s.lastError,
      };
    });

    return { ok: true, schedulers };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load scheduler status" };
  }
}
