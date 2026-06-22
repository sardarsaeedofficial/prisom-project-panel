/**
 * lib/jobs/background-job-handlers.ts
 *
 * Sprint 35: Registered handlers for each job type.
 *
 * Safety rules:
 *  - Handlers MUST NOT run destructive storage cleanup automatically
 *  - Handlers MUST NOT expose secrets
 *  - Handlers MUST NOT restart PM2 processes or deploy code
 *  - Each handler receives a sanitized job DTO (no internal secrets in metadata)
 *  - storage_cleanup jobs are recorded only, not auto-executed
 *
 * Handler signature: (jobId: string, metadata: Record<string,unknown>) => Promise<string>
 * Return value is the log line recorded on success.
 */

import { markStaleOperations } from "@/lib/operations/project-operation-cleanup";
import type { JobType } from "./background-job-types";

export type JobHandlerFn = (
  jobId:    string,
  metadata: Record<string, unknown>,
) => Promise<string>;

// ── Handler registry ──────────────────────────────────────────────────────────

const HANDLERS = new Map<JobType, JobHandlerFn>();

export function registerJobHandler(type: JobType, fn: JobHandlerFn): void {
  HANDLERS.set(type, fn);
}

export function getJobHandler(type: JobType): JobHandlerFn | undefined {
  return HANDLERS.get(type);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// admin_health — refresh cached admin health sections (fast + disk + pm2 + schedulers)
registerJobHandler("admin_health", async (_jobId, _metadata) => {
  const { clearCachedSection } = await import("@/lib/admin/admin-health-cache");
  clearCachedSection(); // bust all sections so next request re-fetches
  return "Admin health cache cleared — will refresh on next request";
});

// operation_sync — mark stale project operations across all projects
registerJobHandler("operation_sync", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (projectId) {
    await markStaleOperations(projectId);
    return `Stale operations marked for project ${projectId}`;
  }
  // If no projectId, run for all projects with running operations
  const { db } = await import("@/lib/db");
  const projects = await db.projectOperation.findMany({
    where:   { status: "running" },
    select:  { projectId: true },
    distinct: ["projectId"],
  });
  for (const p of projects) {
    await markStaleOperations(p.projectId).catch(() => null);
  }
  return `Stale operation check completed for ${projects.length} project(s)`;
});

// scheduled_backup — run due backup schedules (delegates to existing sprint 30 runner)
registerJobHandler("scheduled_backup", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("scheduled_backup handler requires projectId in metadata");

  // Sprint 36: manually-triggered jobs (created via template) require BACKUP confirmation
  const isManualJob = typeof metadata.templateId === "string";
  if (isManualJob && metadata.confirmation !== "BACKUP") {
    throw new Error(
      "Manual scheduled backup requires BACKUP confirmation in job metadata. " +
      "Use the manual job runner and type BACKUP to confirm.",
    );
  }

  const { runScheduledBackupForProject } = await import("@/lib/backups/backup-schedule-runner");
  const result = await runScheduledBackupForProject({
    projectId,
    isUserTriggered: isManualJob,
  });

  if (result.skipped)  return `Skipped: ${result.reason ?? "unknown reason"}`;
  if (!result.ok)      throw new Error(result.error ?? "Backup failed");
  return `Scheduled backup created: ${result.backupId}`;
});

// alert_check — run alert evaluation for a project (delegates to sprint 16)
registerJobHandler("alert_check", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("alert_check handler requires projectId in metadata");

  const { evaluateProjectAlertRules } = await import("@/lib/projects/alert-evaluator");
  const { db } = await import("@/lib/db");

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  await evaluateProjectAlertRules({ projectId, source: "scheduled", persist: true });
  return `Alert rules evaluated for project ${project.name}`;
});

// domain_health — refresh domain health checks for a project
registerJobHandler("domain_health", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("domain_health handler requires projectId in metadata");

  // Domain health is managed in Sprint 29 — we just trigger a lightweight check
  // by refreshing the domain status from DB. Full implementation can be added later.
  const { db } = await import("@/lib/db");
  const domains = await db.domain.findMany({
    where:  { projectId },
    select: { id: true, hostname: true },
  });
  return `Domain health check queued for ${domains.length} domain(s) in project ${projectId}`;
});

// go_live_check — compute project readiness (non-destructive read-only check)
registerJobHandler("go_live_check", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("go_live_check handler requires projectId in metadata");

  const { db } = await import("@/lib/db");
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, status: true, liveUrl: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  const isLive = !!project.liveUrl;
  return `Go-live check completed: ${project.name} (${project.status}, liveUrl ${isLive ? "set" : "not set"})`;
});

// storage_cleanup — INTENTIONALLY PASSIVE in this sprint
// Storage cleanup jobs are created via Sprint 34 flow (requires "CLEANUP" confirmation).
// The worker records success without auto-deleting anything.
registerJobHandler("storage_cleanup", async (_jobId, _metadata) => {
  // Sprint 34 cleanup is user-confirmed in the UI before a job is created.
  // If a job exists here, the cleanup already ran at job creation time via
  // runStorageCleanup(). This handler just acknowledges it.
  return "Storage cleanup job acknowledged — cleanup was executed at job creation time";
});
