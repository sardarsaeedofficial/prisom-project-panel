/**
 * lib/jobs/background-job-templates.ts
 *
 * Sprint 36: Allowlisted job templates for the manual job runner.
 *
 * Safety rules:
 *  - storage_cleanup is intentionally excluded — it requires the Sprint 34
 *    explicit cleanup flow with "CLEANUP" typed confirmation.
 *  - Templates are the ONLY way to create jobs from the UI.
 *  - No arbitrary job types, handlers, or metadata accepted from clients.
 *  - requiresConfirmation templates enforce an exact match string server-side.
 */

import type { JobType, ScopeType } from "./background-job-types";

// ── Template shape ────────────────────────────────────────────────────────────

export type JobTemplate = {
  readonly jobType:              JobType;
  readonly scopeType:            ScopeType;
  readonly title:                string;
  readonly description:          string;
  readonly requiresProject:      boolean;
  readonly destructive:          boolean;
  readonly retryable:            boolean;
  readonly requiresConfirmation?: boolean;
  readonly confirmationText?:    string;
  readonly confirmationHint?:    string;
};

export type TemplateId = keyof typeof JOB_TEMPLATES;

// ── Template registry ─────────────────────────────────────────────────────────

export const JOB_TEMPLATES = {
  admin_health_refresh: {
    jobType:         "admin_health",
    scopeType:       "global",
    title:           "Refresh Admin Health Cache",
    description:     "Bust the admin health cache so the next load re-fetches PM2, disk, and scheduler data.",
    requiresProject: false,
    destructive:     false,
    retryable:       true,
  },
  stale_operation_sweep: {
    jobType:         "operation_sync",
    scopeType:       "global",
    title:           "Mark Stale Operations",
    description:     "Find all running project operations whose lock has expired and mark them stale.",
    requiresProject: false,
    destructive:     false,
    retryable:       true,
  },
  domain_health_scan: {
    jobType:         "domain_health",
    scopeType:       "project",
    title:           "Domain Health Scan",
    description:     "Query domain records for a selected project and refresh their health status.",
    requiresProject: true,
    destructive:     false,
    retryable:       true,
  },
  go_live_check: {
    jobType:         "go_live_check",
    scopeType:       "project",
    title:           "Go-Live Readiness Check",
    description:     "Check go-live readiness for a selected project (liveUrl, status, domains).",
    requiresProject: true,
    destructive:     false,
    retryable:       true,
  },
  alert_check: {
    jobType:         "alert_check",
    scopeType:       "project",
    title:           "Evaluate Alert Rules",
    description:     "Run alert rule evaluation for a selected project and record any triggered alerts.",
    requiresProject: true,
    destructive:     false,
    retryable:       true,
  },
  scheduled_backup_check: {
    jobType:               "scheduled_backup",
    scopeType:             "project",
    title:                 "Run Scheduled Backup",
    description:           "Manually trigger a scheduled-backup style run for a selected project.",
    requiresProject:       true,
    destructive:           false,
    retryable:             true,
    requiresConfirmation:  true,
    confirmationText:      "BACKUP",
    confirmationHint:      "Type BACKUP to confirm",
  },
} as const satisfies Record<string, JobTemplate>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if `id` is a valid template key. */
export function isValidTemplateId(id: string): id is TemplateId {
  return Object.prototype.hasOwnProperty.call(JOB_TEMPLATES, id);
}

/** Safe public representation (no internal fields added beyond what's in the type). */
export type JobTemplatePublic = JobTemplate & { id: TemplateId };

export function getPublicTemplates(): JobTemplatePublic[] {
  return (Object.keys(JOB_TEMPLATES) as TemplateId[]).map((id) => ({
    id,
    ...JOB_TEMPLATES[id],
  }));
}
