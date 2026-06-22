/**
 * lib/jobs/background-job-service.ts
 *
 * Sprint 35: CRUD + lifecycle operations for BackgroundJob rows.
 *
 * Safety rules:
 *  - Metadata is sanitized before storage (no secrets, no env values)
 *  - lastError is capped at 500 chars and stripped of stack traces
 *  - Claim is atomic: two workers can't both claim the same job
 *  - Running/queued jobs are never auto-deleted
 *  - Only admin callers may retry/cancel (enforced at action layer)
 */

import { db }                from "@/lib/db";
import { sanitizeAuditMetadata } from "@/lib/audit/audit-sanitize";
import type {
  CreateBackgroundJobInput,
  ListBackgroundJobsInput,
  ListBackgroundJobsOutput,
  BackgroundJobDTO,
  JobStatus,
  JobType,
  ScopeType,
} from "./background-job-types";
import { JOB_LOCK_DURATION_MS } from "./background-job-types";

// ── Ref generator ─────────────────────────────────────────────────────────────

function generateJobRef(jobType: string, projectId?: string): string {
  const ts    = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const pid   = projectId ? `_${projectId.slice(-6)}` : "";
  const rand  = Math.random().toString(36).slice(2, 6);
  return `bgjob_${jobType.replace("_", "")}${pid}_${ts}_${rand}`;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createBackgroundJob(
  input: CreateBackgroundJobInput,
): Promise<string> {
  const {
    jobRef,
    jobType,
    scopeType    = "global",
    projectId,
    title,
    description,
    scheduledFor = new Date(),
    maxAttempts  = 3,
    priority     = 5,
    metadata,
  } = input;

  const ref = jobRef ?? generateJobRef(jobType, projectId);

  const safeMetadata = metadata
    ? sanitizeAuditMetadata(metadata as Record<string, unknown>)
    : undefined;

  const row = await db.backgroundJob.create({
    data: {
      jobRef:      ref,
      jobType,
      scopeType,
      projectId:   projectId ?? null,
      status:      "queued",
      priority,
      title:       title.slice(0, 200),
      description: description?.slice(0, 500) ?? null,
      scheduledFor,
      maxAttempts,
      metadataJson: safeMetadata as object ?? null,
    },
    select: { id: true },
  });

  return row.id;
}

// ── Claim (atomic) ────────────────────────────────────────────────────────────

/**
 * Claim the next due job for this worker.
 *
 * Atomically: find a queued/retrying job with scheduledFor <= now, then
 * flip its status to "running" using an updateMany with the original status
 * in the WHERE clause.  If another worker raced and claimed it first,
 * updateMany returns count=0 and we skip.
 *
 * Returns the claimed job ID, or null if none available.
 */
export async function claimDueJob(workerId: string): Promise<string | null> {
  await markStaleJobs();

  const due = await db.backgroundJob.findFirst({
    where: {
      status:      { in: ["queued", "retrying"] },
      scheduledFor: { lte: new Date() },
    },
    orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }],
    select: { id: true, status: true },
  });

  if (!due) return null;

  const now          = new Date();
  const lockExpires  = new Date(now.getTime() + JOB_LOCK_DURATION_MS);

  const updated = await db.backgroundJob.updateMany({
    where: {
      id:     due.id,
      status: { in: ["queued", "retrying"] },  // optimistic lock
    },
    data: {
      status:       "running",
      startedAt:    now,
      heartbeatAt:  now,
      lockedBy:     workerId,
      lockExpiresAt: lockExpires,
      attempts:     { increment: 1 },
    },
  });

  return updated.count > 0 ? due.id : null;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export async function heartbeatJob(jobId: string): Promise<void> {
  const now         = new Date();
  const lockExpires = new Date(now.getTime() + JOB_LOCK_DURATION_MS);

  await db.backgroundJob.updateMany({
    where:  { id: jobId, status: "running" },
    data:   { heartbeatAt: now, lockExpiresAt: lockExpires },
  });
}

// ── Complete ──────────────────────────────────────────────────────────────────

export async function completeJob(
  jobId:   string,
  logLine?: string,
): Promise<void> {
  await db.backgroundJob.updateMany({
    where: { id: jobId, status: "running" },
    data: {
      status:      "success",
      completedAt:  new Date(),
      lastLogLine: logLine?.slice(0, 500) ?? null,
      lockedBy:     null,
      lockExpiresAt: null,
    },
  });
}

// ── Fail ──────────────────────────────────────────────────────────────────────

export async function failJob(
  jobId:  string,
  error:  string,
): Promise<void> {
  const safeError = sanitizeError(error);

  const job = await db.backgroundJob.findUnique({
    where:  { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });
  if (!job) return;

  const canRetry = job.attempts < job.maxAttempts;

  await db.backgroundJob.updateMany({
    where: { id: jobId },
    data: {
      status:        canRetry ? "retrying" : "failed",
      completedAt:   new Date(),
      lastError:     safeError,
      lockedBy:      null,
      lockExpiresAt: null,
      // Schedule retry with exponential backoff
      scheduledFor:  canRetry
        ? new Date(Date.now() + backoffMs(job.attempts))
        : undefined,
    },
  });
}

// ── Retry (admin-triggered) ───────────────────────────────────────────────────

export async function retryJob(jobId: string): Promise<boolean> {
  const job = await db.backgroundJob.findUnique({
    where:  { id: jobId },
    select: { status: true, attempts: true, maxAttempts: true },
  });
  if (!job) return false;

  // Allow retry even if maxAttempts reached (admin override)
  const updated = await db.backgroundJob.updateMany({
    where: { id: jobId, status: { in: ["failed", "stale", "cancelled"] } },
    data: {
      status:        "queued",
      scheduledFor:  new Date(),
      lastError:     null,
      lockedBy:      null,
      lockExpiresAt: null,
      completedAt:   null,
    },
  });

  return updated.count > 0;
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelJob(jobId: string): Promise<boolean> {
  const updated = await db.backgroundJob.updateMany({
    where: { id: jobId, status: { in: ["queued", "retrying"] } },
    data: {
      status:      "cancelled",
      completedAt: new Date(),
    },
  });
  return updated.count > 0;
}

// ── Mark stale ────────────────────────────────────────────────────────────────

export async function markStaleJobs(): Promise<number> {
  const result = await db.backgroundJob.updateMany({
    where: {
      status:       "running",
      lockExpiresAt: { lt: new Date() },
    },
    data: {
      status:        "stale",
      completedAt:   new Date(),
      lockedBy:      null,
      lockExpiresAt: null,
      lastError:     "Job became stale: worker heartbeat timed out",
    },
  });
  return result.count;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listBackgroundJobs(
  input: ListBackgroundJobsInput,
): Promise<ListBackgroundJobsOutput> {
  const {
    status,
    jobType,
    projectId,
    from,
    to,
    page     = 1,
    pageSize = 25,
  } = input;

  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const safePage     = Math.max(page, 1);
  const skip         = (safePage - 1) * safePageSize;

  // Build Prisma where clause dynamically
  const where: Record<string, unknown> = {};

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    where.status = { in: statuses };
  }
  if (jobType) {
    const types = Array.isArray(jobType) ? jobType : [jobType];
    where.jobType = { in: types };
  }
  if (projectId)     where.projectId  = projectId;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as { gte?: Date }).gte = from;
    if (to)   (where.createdAt as { lte?: Date }).lte = to;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaWhere = where as any;

  const [rows, total] = await Promise.all([
    db.backgroundJob.findMany({
      where:   prismaWhere,
      orderBy: { createdAt: "desc" },
      skip,
      take:    safePageSize,
      include: { project: { select: { name: true } } },
    }),
    db.backgroundJob.count({ where: prismaWhere }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / safePageSize));

  return {
    jobs:       rows.map(rowToDTO),
    total,
    page:       safePage,
    pageSize:   safePageSize,
    totalPages,
  };
}

// ── Summary (for admin console card) ─────────────────────────────────────────

export async function getBackgroundJobsSummary(): Promise<import("./background-job-types").BackgroundJobsSummary> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [active, failed24h, stale, queued, success24h] = await Promise.all([
    db.backgroundJob.count({ where: { status: "running" } }),
    db.backgroundJob.count({ where: { status: "failed",  completedAt: { gte: since24h } } }),
    db.backgroundJob.count({ where: { status: "stale" } }),
    db.backgroundJob.count({ where: { status: { in: ["queued", "retrying"] } } }),
    db.backgroundJob.count({ where: { status: "success", completedAt: { gte: since24h } } }),
  ]);

  return { active, failed24h, stale, queued, success24h };
}

// ── DTO mapper ────────────────────────────────────────────────────────────────

function rowToDTO(
  row: {
    id: string; jobRef: string; jobType: string; scopeType: string;
    projectId: string | null; status: string; priority: number;
    title: string; description: string | null;
    scheduledFor: Date | null; startedAt: Date | null;
    completedAt: Date | null; heartbeatAt: Date | null;
    attempts: number; maxAttempts: number;
    lastError: string | null; lastLogLine: string | null;
    lockedBy: string | null; lockExpiresAt: Date | null;
    createdAt: Date; updatedAt: Date;
    project?: { name: string } | null;
  },
): BackgroundJobDTO {
  const durationMs =
    row.startedAt && row.completedAt
      ? row.completedAt.getTime() - row.startedAt.getTime()
      : row.startedAt
      ? Date.now() - row.startedAt.getTime()
      : null;

  return {
    id:            row.id,
    jobRef:        row.jobRef,
    jobType:       row.jobType as JobType,
    scopeType:     row.scopeType as ScopeType,
    projectId:     row.projectId,
    projectName:   row.project?.name ?? null,
    status:        row.status as JobStatus,
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
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function backoffMs(attempts: number): number {
  // Exponential backoff: 30s, 2m, 8m
  return Math.min(30_000 * Math.pow(4, attempts), 8 * 60_000);
}

function sanitizeError(raw: string): string {
  // Cap length, remove stack traces, mask anything that looks like a path or key
  return raw
    .replace(/at\s+\S+\s+\([^)]+\)/g, "")           // strip stack frames
    .replace(/\/home\/[^\s]+/g, "<path>")            // strip home paths
    .replace(/[A-Z0-9]{20,}/g, "<token>")             // strip long tokens
    .trim()
    .slice(0, 500);
}
