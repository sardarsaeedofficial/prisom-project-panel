/**
 * lib/jobs/background-job-types.ts
 *
 * Sprint 35: Shared types for the Background Jobs system.
 * Pure types — no server dependencies, safe to import anywhere.
 */

// ── Job type ──────────────────────────────────────────────────────────────────

export type JobType =
  | "alert_check"
  | "scheduled_backup"
  | "storage_cleanup"
  | "domain_health"
  | "admin_health"
  | "go_live_check"
  | "operation_sync"
  | "release_preflight"
  | "github_sync"
  | "github_auto_deploy";

export const JOB_TYPES: JobType[] = [
  "alert_check",
  "scheduled_backup",
  "storage_cleanup",
  "domain_health",
  "admin_health",
  "go_live_check",
  "operation_sync",
  "release_preflight",
  "github_sync",
  "github_auto_deploy",
];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  alert_check:        "Alert Check",
  scheduled_backup:   "Scheduled Backup",
  storage_cleanup:    "Storage Cleanup",
  domain_health:      "Domain Health",
  admin_health:       "Admin Health Cache",
  go_live_check:      "Go-Live Check",
  operation_sync:     "Operation Sync",
  release_preflight:  "Release Preflight",
  github_sync:        "GitHub Sync",
  github_auto_deploy: "GitHub Auto-Deploy",
};

// ── Job status ────────────────────────────────────────────────────────────────

export type JobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "retrying"
  | "stale";

export const JOB_STATUSES: JobStatus[] = [
  "queued", "running", "success", "failed", "cancelled", "retrying", "stale",
];

// ── Scope type ────────────────────────────────────────────────────────────────

export type ScopeType = "global" | "project" | "service";

// ── DTO ───────────────────────────────────────────────────────────────────────

export type BackgroundJobDTO = {
  id:          string;
  jobRef:      string;
  jobType:     JobType;
  scopeType:   ScopeType;
  projectId:   string | null;
  projectName: string | null;  // joined from Project

  status:      JobStatus;
  priority:    number;

  title:       string;
  description: string | null;

  scheduledFor: string | null;  // ISO
  startedAt:    string | null;
  completedAt:  string | null;
  heartbeatAt:  string | null;

  attempts:    number;
  maxAttempts: number;
  lastError:   string | null;
  lastLogLine: string | null;

  lockedBy:      string | null;
  lockExpiresAt: string | null;

  durationMs: number | null;  // computed from startedAt + completedAt

  createdAt: string;
  updatedAt: string;
};

// ── Input for creating a job ──────────────────────────────────────────────────

export type CreateBackgroundJobInput = {
  jobRef?:      string;   // auto-generated if omitted
  jobType:      JobType;
  scopeType?:   ScopeType;
  projectId?:   string;
  title:        string;
  description?: string;
  scheduledFor?: Date;
  maxAttempts?: number;
  priority?:    number;
  metadata?:    Record<string, unknown>;
};

// ── Filters for listing ───────────────────────────────────────────────────────

export type ListBackgroundJobsInput = {
  status?:    JobStatus | JobStatus[];
  jobType?:   JobType   | JobType[];
  projectId?: string;
  from?:      Date;
  to?:        Date;
  page?:      number;
  pageSize?:  number;
};

export type ListBackgroundJobsOutput = {
  jobs:       BackgroundJobDTO[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
};

// ── Action result ─────────────────────────────────────────────────────────────

export type BackgroundJobActionResult =
  | { ok: true }
  | { ok: false; error: string };

// ── Summary for Admin Console card ───────────────────────────────────────────

export type BackgroundJobsSummary = {
  active:     number;
  failed24h:  number;
  stale:      number;
  queued:     number;
  success24h: number;
};

// ── Stale threshold ───────────────────────────────────────────────────────────

/** A running job is stale if its lockExpiresAt has passed */
export const JOB_LOCK_DURATION_MS = 5 * 60 * 1000;  // 5 minutes

/** Worker claims up to this many jobs per tick */
export const WORKER_CLAIM_LIMIT = 3;

/** Worker tick interval */
export const WORKER_TICK_MS = 30_000;  // 30 seconds
