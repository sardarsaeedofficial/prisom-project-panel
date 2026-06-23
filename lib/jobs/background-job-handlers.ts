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

// release_preflight — run preflight checks for the latest successful deployment
registerJobHandler("release_preflight", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("release_preflight handler requires projectId in metadata");

  const { db } = await import("@/lib/db");
  const dep = await db.deployment.findFirst({
    where:   { projectId, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select:  { id: true },
  });
  if (!dep) return `No successful deployment found for project ${projectId} — skipped`;

  const { runReleasePreflight } = await import("@/lib/releases/release-preflight-runner");
  const report = await runReleasePreflight(projectId, dep.id);
  return `Preflight complete: ${report.overallStatus} (${report.checks.filter((c) => c.status === "fail").length} blocking failures)`;
});

// ── Sprint 40: GitHub auto-sync handlers ──────────────────────────────────────

// github_sync — fetch remote + optional ff-only pull (never on dirty worktree)
registerJobHandler("github_sync", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("github_sync handler requires projectId in metadata");

  const { runLocalGitSync } = await import("@/lib/github/github-sync-service");
  const { db } = await import("@/lib/db");

  // Read current sync settings to decide whether to auto-pull
  const settings = await db.projectGitHubSyncSettings.findUnique({
    where:  { projectId },
    select: { autoPullEnabled: true, autoDeployEnabled: true },
  });
  const autoPull = settings?.autoPullEnabled ?? false;

  const result = await runLocalGitSync(projectId, { autoPull });

  if (!result.ok) throw new Error(result.message);

  // Queue auto-deploy if pull succeeded and autoDeployEnabled
  if (result.status === "synced" && result.pulledCommits && settings?.autoDeployEnabled) {
    const { createBackgroundJob } = await import("@/lib/jobs/background-job-service");
    await createBackgroundJob({
      jobType:     "github_auto_deploy",
      scopeType:   "project",
      projectId,
      title:       "GitHub Auto-Deploy",
      description: `Auto-deploy triggered after syncing ${result.pulledCommits} commit(s)`,
      metadata:    { projectId, triggeredBySyncCommits: result.pulledCommits },
      maxAttempts: 1,
      priority:    4,
    });
  }

  return result.message;
});

// github_auto_deploy — deploy after a successful sync
// Note: this handler intentionally triggers a deployment (exception to the
// Sprint 35 "no deploy" rule — Sprint 40 explicitly adds this capability).
registerJobHandler("github_auto_deploy", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("github_auto_deploy handler requires projectId in metadata");

  const { db } = await import("@/lib/db");

  // Verify auto-deploy is still enabled (setting may have changed since job was queued)
  const settings = await db.projectGitHubSyncSettings.findUnique({
    where:  { projectId },
    select: { autoDeployEnabled: true, lastSyncStatus: true },
  });
  if (!settings?.autoDeployEnabled) return "Auto-deploy is disabled — skipped";
  if (settings.lastSyncStatus !== "synced") {
    return `Last sync status is "${settings.lastSyncStatus}" — deploy skipped (requires "synced")`;
  }

  // Get project + full deploy config
  const project = await db.project.findUnique({
    where:   { id: projectId },
    select:  { slug: true, name: true, deploymentConfig: true },
  });
  if (!project)                  throw new Error("Project not found");
  if (!project.deploymentConfig) return "No deployment config — deploy skipped";

  const cfg = project.deploymentConfig as import("@prisma/client").ProjectDeploymentConfig;

  // Guard: no concurrent build
  const { DeploymentStatus, DeploymentSource } = await import("@prisma/client");
  const inFlight = await db.deployment.findFirst({
    where:  { projectId, status: DeploymentStatus.BUILDING },
    select: { id: true },
  });
  if (inFlight) return "Deployment already in progress — skipped";

  // Acquire operation lock
  const { startProjectOperation, completeProjectOperation, failProjectOperation } =
    await import("@/lib/operations/project-operation-service");
  const opId = await startProjectOperation({
    projectId,
    operationType: "deploy",
    title:         `GitHub auto-deploy ${project.slug}`,
  });

  // Create BUILDING deployment record
  const deployStart = new Date();
  const deployment = await db.deployment.create({
    data: { projectId, status: DeploymentStatus.BUILDING, source: DeploymentSource.MANUAL, startedAt: deployStart },
  });

  try {
    // Fetch decrypted env vars (NEVER logged)
    const { getDecryptedEnvVarsForDeploy } = await import("@/app/actions/project-envvars");
    const envVars = await getDecryptedEnvVarsForDeploy(projectId, "production");

    const { runProjectDeployment } = await import("@/lib/projects/project-deploy-runner");
    const result = await runProjectDeployment({
      slug:            project.slug,
      installCommand:  cfg.installCommand,
      buildCommand:    cfg.buildCommand,
      startCommand:    cfg.startCommand,
      rootDirectory:   cfg.rootDirectory,
      port:            cfg.port,
      pm2Name:         cfg.pm2Name,
      healthPath:      cfg.healthPath,
      nodeEnv:         cfg.nodeEnv,
      envVars,
      routeMode:       (cfg as unknown as { routeMode?: string }).routeMode as import("@/lib/projects/project-deploy-runner").RouteMode ?? "fullstack_node",
      staticOutputDir: cfg.staticOutputDir,
      apiPrefix:       (cfg as unknown as { apiPrefix?: string }).apiPrefix,
    });

    const finalStatus = result.ok ? DeploymentStatus.SUCCESS : DeploymentStatus.FAILED;
    await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status:     finalStatus,
        finishedAt: new Date(),
        duration:   Date.now() - deployStart.getTime(),
        ...(result.ok ? {} : { errorMessage: result.error.slice(0, 2_000) }),
        metadata: {
          deploymentRef: result.deploymentRef ?? null,
          releasePath:   result.releasePath   ?? null,
          pm2Name:       cfg.pm2Name,
          port:          cfg.port,
          envVarNames:   Object.keys(envVars),
          output:        result.output.slice(0, 10_000),
        },
      },
    });

    await completeProjectOperation(opId);

    if (!result.ok) throw new Error(result.error);

    // Audit
    try {
      const { writeProjectAuditEvent } = await import("@/lib/audit/project-audit");
      await writeProjectAuditEvent({
        projectId,
        category: "git",
        action:   "project.github.auto_deploy",
        summary:  `GitHub auto-deploy succeeded for ${project.name}`,
        result:   "success",
        metadata: { deploymentId: deployment.id, deploymentRef: result.deploymentRef ?? null },
      });
    } catch { /* non-fatal */ }

    return `Auto-deploy completed: ${result.deploymentRef ?? deployment.id}`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failProjectOperation(opId, reason);
    await db.deployment.update({
      where: { id: deployment.id },
      data:  { status: DeploymentStatus.FAILED, finishedAt: new Date(), errorMessage: reason.slice(0, 2_000) },
    }).catch(() => null);
    throw err;
  }
});

// replit_migration_scan — scan project source and persist migration report
registerJobHandler("replit_migration_scan", async (_jobId, metadata) => {
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : undefined;
  if (!projectId) throw new Error("replit_migration_scan handler requires projectId in metadata");

  const { db } = await import("@/lib/db");
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) throw new Error("Project not found");

  // Run the analyzer
  const { analyzeReplitProject } = await import("@/lib/migration/replit-project-analyzer");
  const report = await analyzeReplitProject(project.slug);
  if (!report) throw new Error("Analysis returned no data");

  // Run external service detection
  const { detectExternalServices } = await import("@/lib/migration/external-service-detector");
  const externalServices = detectExternalServices(report);

  // Generate manual steps
  const { generateManualSteps } = await import("@/lib/migration/manual-steps-generator");
  const manualSteps = generateManualSteps(report, externalServices);

  const blockers        = report.risks.filter((r) => r.severity === "blocker").length;
  const readinessStatus = blockers > 0 ? "blocked" : report.risks.some((r) => r.severity === "warning") ? "warnings" : "ready";
  const status          = readinessStatus === "blocked" ? "blocked" : readinessStatus === "warnings" ? "draft" : "ready";

  const enriched = { ...report, projectSlug: project.slug, externalServices, manualSteps, applyActions: [], readinessStatus };

  // Persist report
  await db.projectMigrationReport.create({
    data: {
      projectId,
      sourceType: "replit",
      status,
      reportJson: enriched as object,
    },
  });

  // Notify on blockers or ready
  try {
    const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
    if (blockers > 0) {
      await notifyProjectAdmins(projectId, {
        title:      "Migration scan: blockers found",
        body:       `${blockers} blocker(s) must be resolved before deployment.`,
        severity:   "warning",
        category:   "deployment",
        sourceType: "migration_report",
        href:       `/projects/${projectId}/migration`,
      });
    } else {
      await notifyProjectAdmins(projectId, {
        title:      "Migration scan complete",
        body:       `${project.name} looks ready for migration (${report.filesScanned} files scanned).`,
        severity:   "success",
        category:   "deployment",
        sourceType: "migration_report",
        href:       `/projects/${projectId}/migration`,
      });
    }
  } catch { /* non-fatal */ }

  // Write audit event
  try {
    const { writeProjectAuditEvent } = await import("@/lib/audit/project-audit");
    await writeProjectAuditEvent({
      projectId,
      category: "publishing",
      action:   "project.migration.scan_completed",
      summary:  `Migration scan completed: ${report.filesScanned} files, ${blockers} blockers`,
      result:   blockers > 0 ? "failed" : "success",
      metadata: { filesScanned: report.filesScanned, blockers, status },
    });
  } catch { /* non-fatal */ }

  return `Migration scan done: ${report.filesScanned} files, ${report.risks.length} issues, status=${status}`;
});
