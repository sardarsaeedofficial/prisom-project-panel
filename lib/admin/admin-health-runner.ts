/**
 * lib/admin/admin-health-runner.ts
 *
 * Sprint 31: Aggregates all admin health signals into one report.
 *
 * Safety:
 *  - All sub-checks are crash-guarded — one failure never crashes the whole report
 *  - No secret values returned (only names/counts)
 *  - No destructive operations
 *  - Audit events are project-scoped; admin view is query-only
 */

import { db }                   from "@/lib/db";
import { getDiskUsage }         from "./admin-disk-usage";
import { getPm2Health }         from "./admin-pm2-health";
import { getSchedulerStatus }   from "@/lib/scheduler/scheduler-status";
import {
  getCachedSection,
  setCachedSection,
} from "./admin-health-cache";
import type {
  AdminHealthReport,
  AdminSystemWarning,
  AdminOverallStatus,
  AdminSchedulerSummary,
  AdminFastSummary,
  AdminPm2Section,
  AdminDiskSection,
  AdminSchedulersSection,
} from "./admin-health-types";
import { STALE_THRESHOLD_MS }   from "@/lib/operations/project-operation-locks";

// ── Stale operation detection ─────────────────────────────────────────────────

async function getOperationCounts(): Promise<{
  active: number;
  failed24h: number;
  stale: number;
}> {
  const now    = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [active, failed24h] = await Promise.all([
    db.projectOperation.count({ where: { status: "running" } }),
    db.projectOperation.count({
      where: { status: "failed", updatedAt: { gte: ago24h } },
    }),
  ]);

  // Stale: running AND started before their type's threshold
  const runningOps = await db.projectOperation.findMany({
    where:  { status: "running" },
    select: { operationType: true, startedAt: true },
  });

  let stale = 0;
  for (const op of runningOps) {
    const threshold = STALE_THRESHOLD_MS[op.operationType as keyof typeof STALE_THRESHOLD_MS]
      ?? 60 * 60 * 1000;
    const age = now.getTime() - op.startedAt.getTime();
    if (age > threshold) stale++;
  }

  return { active, failed24h, stale };
}

// ── Warnings builder ──────────────────────────────────────────────────────────

function buildWarnings(report: Omit<AdminHealthReport, "warnings" | "overallStatus">): AdminSystemWarning[] {
  const warnings: AdminSystemWarning[] = [];

  // Disk
  if (report.disk.status === "critical") {
    warnings.push({
      severity: "critical",
      title: "Disk critically full",
      description: `System disk is ${report.disk.usagePct ?? "?"}% full. Free space is dangerously low.`,
    });
  } else if (report.disk.status === "warning") {
    warnings.push({
      severity: "warning",
      title: "Disk usage high",
      description: `System disk is ${report.disk.usagePct ?? "?"}% full. Consider cleaning up old releases or backups.`,
    });
  }

  // Stale operations
  if (report.operations.stale > 0) {
    warnings.push({
      severity: "warning",
      title: `${report.operations.stale} stale operation${report.operations.stale > 1 ? "s" : ""}`,
      description: "One or more operations have been running longer than expected. Check the Operations page.",
      href: "/projects",
    });
  }

  // Failed deployments in last 24h
  if (report.deployments.failed24h > 0) {
    warnings.push({
      severity: "warning",
      title: `${report.deployments.failed24h} failed deployment${report.deployments.failed24h > 1 ? "s" : ""} in last 24h`,
      description: "Recent deployments have failed. Review the affected projects.",
      href: "/projects",
    });
  }

  // Scheduled backup failures in last 24h
  if (report.backups.scheduledFailed24h > 0) {
    warnings.push({
      severity: "warning",
      title: `${report.backups.scheduledFailed24h} scheduled backup${report.backups.scheduledFailed24h > 1 ? "s" : ""} failed in last 24h`,
      description: "Automatic backup jobs have failed. Check the Backups page for affected projects.",
      href: "/projects",
    });
  }

  // Projects without recent backup
  if (report.backups.projectsWithoutRecentBackup > 0) {
    warnings.push({
      severity: "info",
      title: `${report.backups.projectsWithoutRecentBackup} project${report.backups.projectsWithoutRecentBackup > 1 ? "s" : ""} without a recent backup`,
      description: "Some published projects have no backup in the last 7 days.",
      href: "/projects",
    });
  }

  // PM2 errors
  if (report.pm2.status === "critical") {
    warnings.push({
      severity: "critical",
      title: "PM2 process error",
      description: "One or more managed processes are in an errored state.",
    });
  } else if (report.pm2.status === "warning") {
    warnings.push({
      severity: "warning",
      title: "PM2 process stopped",
      description: "One or more managed processes are stopped.",
    });
  }

  // Scheduler health
  if (report.schedulers.alerts.status === "stale") {
    warnings.push({
      severity: "warning",
      title: "Alert scheduler stale",
      description: "The alert scheduler has not ticked recently. It may have crashed or been disabled.",
    });
  }
  if (report.schedulers.backups.status === "stale") {
    warnings.push({
      severity: "warning",
      title: "Backup scheduler stale",
      description: "The backup scheduler has not ticked recently. Scheduled backups may not be running.",
    });
  }

  return warnings;
}

// ── Overall status ────────────────────────────────────────────────────────────

function computeOverallStatus(warnings: AdminSystemWarning[]): AdminOverallStatus {
  if (warnings.some((w) => w.severity === "critical")) return "critical";
  if (warnings.some((w) => w.severity === "warning"))  return "warning";
  return "healthy";
}

// ── Scheduler summary ─────────────────────────────────────────────────────────

function toSchedulerSummary(name: string): AdminSchedulerSummary {
  const s = getSchedulerStatus(name);
  // Map SchedulerStatusValue to AdminSchedulerSummary status
  const status = s.status === "running" ? "running"
               : s.status === "stale"   ? "stale"
               :                          "unknown";
  return {
    name,
    status,
    lastHeartbeatAt: s.lastHeartbeatAt,
    tickCount:       s.tickCount,
    lastError:       s.lastError,
  };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runAdminHealthReport(): Promise<AdminHealthReport> {
  const now    = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ago7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

  // All checks run in parallel, individually crash-guarded
  const [
    projectCount,
    publishedCount,
    domainCount,
    backupCount,
    userCount,
    opCounts,
    deploy24hCounts,
    latestFailures,
    scheduledEnabled,
    scheduledFailed24h,
    projectsWithoutRecentBackup,
    recentAuditEvents,
    disk,
    pm2,
  ] = await Promise.all([
    // project count
    db.project.count().catch(() => 0),

    // published project count (has at least one ACTIVE domain)
    db.project.count({
      where: { domains: { some: { status: "ACTIVE" } } },
    }).catch(() => 0),

    // domain count
    db.domain.count().catch(() => 0),

    // backup count
    db.projectBackup.count({ where: { status: "ready" } }).catch(() => 0),

    // user count
    db.user.count().catch(() => 0),

    // operation counts
    getOperationCounts().catch(() => ({ active: 0, failed24h: 0, stale: 0 })),

    // deployment success/fail counts
    Promise.all([
      db.deployment.count({ where: { status: "SUCCESS", startedAt: { gte: ago24h } } }).catch(() => 0),
      db.deployment.count({ where: { status: "FAILED",  startedAt: { gte: ago24h } } }).catch(() => 0),
    ]),

    // latest failed deployments (last 24h, max 5)
    db.deployment.findMany({
      where:   { status: "FAILED", startedAt: { gte: ago24h } },
      orderBy: { startedAt: "desc" },
      take:    5,
      select: {
        id:           true,
        errorMessage: true,
        startedAt:    true,
        project: {
          select: { id: true, name: true, slug: true },
        },
      },
    }).catch(() => []),

    // scheduled backup enabled count
    db.projectBackupSchedule.count({ where: { enabled: true } }).catch(() => 0),

    // scheduled backup failures in last 24h
    db.projectBackupSchedule.count({
      where: { lastFailureAt: { gte: ago24h } },
    }).catch(() => 0),

    // published projects without a recent backup
    db.project.count({
      where: {
        domains: { some: { status: "ACTIVE" } },
        backups: {
          none: { status: "ready", completedAt: { gte: ago7d } },
        },
      },
    }).catch(() => 0),

    // recent audit events (last 20 across all projects)
    db.projectAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take:    20,
      select: {
        id:        true,
        action:    true,
        summary:   true,
        result:    true,
        createdAt: true,
      },
    }).catch(() => []),

    // disk usage
    getDiskUsage().catch(() => ({ status: "unknown" as const })),

    // pm2 health
    getPm2Health().catch(() => ({ status: "unknown" as const, processes: [] })),
  ]);

  const [success24h, failed24h] = deploy24hCounts;

  const partial: Omit<AdminHealthReport, "warnings" | "overallStatus"> = {
    generatedAt: now.toISOString(),

    totals: {
      projects:          projectCount,
      publishedProjects: publishedCount,
      domains:           domainCount,
      backups:           backupCount,
      users:             userCount,
    },

    operations: opCounts,

    deployments: {
      success24h,
      failed24h,
      latestFailures: latestFailures.map((d) => ({
        projectId:    d.project.id,
        projectName:  d.project.name,
        projectSlug:  d.project.slug,
        deploymentId: d.id,
        errorMessage: d.errorMessage,
        startedAt:    d.startedAt.toISOString(),
      })),
    },

    pm2,

    disk,

    backups: {
      scheduledEnabled,
      scheduledFailed24h,
      projectsWithoutRecentBackup,
    },

    domains: {
      total:   domainCount,
      active:  await db.domain.count({ where: { status: "ACTIVE" }  }).catch(() => 0),
      errored: await db.domain.count({ where: { status: "FAILED" } }).catch(() => 0),
    },

    schedulers: {
      alerts:  toSchedulerSummary("alerts"),
      backups: toSchedulerSummary("backups"),
    },

    recentAuditEvents: recentAuditEvents.map((e) => ({
      id:        e.id,
      action:    e.action,
      summary:   e.summary,
      result:    e.result,
      createdAt: e.createdAt.toISOString(),
    })),
  };

  const warnings     = buildWarnings(partial);
  const overallStatus = computeOverallStatus(warnings);

  return { ...partial, warnings, overallStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 33: Fast summary + async section runners
// ─────────────────────────────────────────────────────────────────────────────

// ── Fast warnings (DB-only) ───────────────────────────────────────────────────

function buildFastWarnings(
  opCounts:                    { stale: number },
  deployFailed24h:             number,
  scheduledFailed24h:          number,
  projectsWithoutRecentBackup: number,
): AdminSystemWarning[] {
  const warnings: AdminSystemWarning[] = [];

  if (opCounts.stale > 0) {
    warnings.push({
      severity:    "warning",
      title:       `${opCounts.stale} stale operation${opCounts.stale > 1 ? "s" : ""}`,
      description: "One or more operations have been running longer than expected. Check the Operations page.",
      href:        "/projects",
    });
  }

  if (deployFailed24h > 0) {
    warnings.push({
      severity:    "warning",
      title:       `${deployFailed24h} failed deployment${deployFailed24h > 1 ? "s" : ""} in last 24h`,
      description: "Recent deployments have failed. Review the affected projects.",
      href:        "/projects",
    });
  }

  if (scheduledFailed24h > 0) {
    warnings.push({
      severity:    "warning",
      title:       `${scheduledFailed24h} scheduled backup${scheduledFailed24h > 1 ? "s" : ""} failed in last 24h`,
      description: "Automatic backup jobs have failed. Check the Backups page for affected projects.",
      href:        "/projects",
    });
  }

  if (projectsWithoutRecentBackup > 0) {
    warnings.push({
      severity:    "info",
      title:       `${projectsWithoutRecentBackup} project${projectsWithoutRecentBackup > 1 ? "s" : ""} without a recent backup`,
      description: "Some published projects have no backup in the last 7 days.",
      href:        "/projects",
    });
  }

  return warnings;
}

// ── runAdminFastSummary ───────────────────────────────────────────────────────

export async function runAdminFastSummary(forceRefresh = false): Promise<AdminFastSummary> {
  if (!forceRefresh) {
    const cached = getCachedSection<AdminFastSummary>("fast");
    if (cached?.isFresh) {
      return { ...cached.value, cacheStatus: "fresh" };
    }
    if (cached) {
      // Return stale while caller decides whether to re-fetch
      return { ...cached.value, cacheStatus: "stale" };
    }
  }

  const now    = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ago7d  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);

  const [
    projectCount,
    publishedCount,
    domainCount,
    domainActive,
    domainFailed,
    backupCount,
    userCount,
    opCounts,
    deploy24hCounts,
    latestFailures,
    scheduledEnabled,
    scheduledFailed24h,
    projectsWithoutRecentBackup,
    recentAuditEvents,
  ] = await Promise.all([
    db.project.count().catch(() => 0),

    db.project.count({
      where: { domains: { some: { status: "ACTIVE" } } },
    }).catch(() => 0),

    db.domain.count().catch(() => 0),

    db.domain.count({ where: { status: "ACTIVE" } }).catch(() => 0),

    db.domain.count({ where: { status: "FAILED" } }).catch(() => 0),

    db.projectBackup.count({ where: { status: "ready" } }).catch(() => 0),

    db.user.count().catch(() => 0),

    getOperationCounts().catch(() => ({ active: 0, failed24h: 0, stale: 0 })),

    Promise.all([
      db.deployment.count({ where: { status: "SUCCESS", startedAt: { gte: ago24h } } }).catch(() => 0),
      db.deployment.count({ where: { status: "FAILED",  startedAt: { gte: ago24h } } }).catch(() => 0),
    ]),

    db.deployment.findMany({
      where:   { status: "FAILED", startedAt: { gte: ago24h } },
      orderBy: { startedAt: "desc" },
      take:    5,
      select: {
        id:           true,
        errorMessage: true,
        startedAt:    true,
        project: { select: { id: true, name: true, slug: true } },
      },
    }).catch(() => []),

    db.projectBackupSchedule.count({ where: { enabled: true } }).catch(() => 0),

    db.projectBackupSchedule.count({
      where: { lastFailureAt: { gte: ago24h } },
    }).catch(() => 0),

    db.project.count({
      where: {
        domains: { some: { status: "ACTIVE" } },
        backups: { none: { status: "ready", completedAt: { gte: ago7d } } },
      },
    }).catch(() => 0),

    db.projectAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take:    20,
      select: {
        id:        true,
        action:    true,
        summary:   true,
        result:    true,
        createdAt: true,
      },
    }).catch(() => []),
  ]);

  const [success24h, deployFailed24h] = deploy24hCounts;

  const fastWarnings = buildFastWarnings(
    opCounts,
    deployFailed24h,
    scheduledFailed24h,
    projectsWithoutRecentBackup,
  );

  const result: AdminFastSummary = {
    generatedAt:  now.toISOString(),
    cacheStatus:  "miss",

    totals: {
      projects:          projectCount,
      publishedProjects: publishedCount,
      domains:           domainCount,
      backups:           backupCount,
      users:             userCount,
    },

    operations:  opCounts,

    deployments: {
      success24h,
      failed24h:  deployFailed24h,
      latestFailures: latestFailures.map((d) => ({
        projectId:    d.project.id,
        projectName:  d.project.name,
        projectSlug:  d.project.slug,
        deploymentId: d.id,
        errorMessage: d.errorMessage,
        startedAt:    d.startedAt.toISOString(),
      })),
    },

    backups: {
      scheduledEnabled,
      scheduledFailed24h,
      projectsWithoutRecentBackup,
    },

    domains: {
      total:   domainCount,
      active:  domainActive,
      errored: domainFailed,
    },

    recentAuditEvents: recentAuditEvents.map((e) => ({
      id:        e.id,
      action:    e.action,
      summary:   e.summary,
      result:    e.result,
      createdAt: e.createdAt.toISOString(),
    })),

    fastWarnings,
  };

  setCachedSection("fast", result);
  return result;
}

// ── runAdminPm2Section ────────────────────────────────────────────────────────

export async function runAdminPm2Section(forceRefresh = false): Promise<AdminPm2Section> {
  if (!forceRefresh) {
    const cached = getCachedSection<AdminPm2Section>("pm2");
    if (cached?.isFresh) return { ...cached.value, cacheStatus: "fresh" };
    if (cached)          return { ...cached.value, cacheStatus: "stale" };
  }

  const pm2 = await getPm2Health().catch(() => ({
    status:    "unknown" as const,
    processes: [],
  }));

  const warnings: AdminSystemWarning[] = [];
  if (pm2.status === "critical") {
    warnings.push({
      severity:    "critical",
      title:       "PM2 process error",
      description: "One or more managed processes are in an errored state.",
    });
  } else if (pm2.status === "warning") {
    warnings.push({
      severity:    "warning",
      title:       "PM2 process stopped",
      description: "One or more managed processes are stopped.",
    });
  }

  const result: AdminPm2Section = {
    generatedAt: new Date().toISOString(),
    cacheStatus: "miss",
    status:      pm2.status,
    processes:   pm2.processes,
    warnings,
  };

  setCachedSection("pm2", result);
  return result;
}

// ── runAdminDiskSection ───────────────────────────────────────────────────────

export async function runAdminDiskSection(forceRefresh = false): Promise<AdminDiskSection> {
  if (!forceRefresh) {
    const cached = getCachedSection<AdminDiskSection>("disk");
    if (cached?.isFresh) return { ...cached.value, cacheStatus: "fresh" };
    if (cached)          return { ...cached.value, cacheStatus: "stale" };
  }

  const disk = await getDiskUsage().catch((): import("./admin-disk-usage").DiskUsageResult => ({ status: "unknown" }));

  const warnings: AdminSystemWarning[] = [];
  if (disk.status === "critical") {
    warnings.push({
      severity:    "critical",
      title:       "Disk critically full",
      description: `System disk is ${disk.usagePct ?? "?"}% full. Free space is dangerously low.`,
    });
  } else if (disk.status === "warning") {
    warnings.push({
      severity:    "warning",
      title:       "Disk usage high",
      description: `System disk is ${disk.usagePct ?? "?"}% full. Consider cleaning up old releases or backups.`,
    });
  }

  const result: AdminDiskSection = {
    generatedAt:          new Date().toISOString(),
    cacheStatus:          "miss",
    status:               disk.status,
    totalBytes:           disk.totalBytes,
    usedBytes:            disk.usedBytes,
    freeBytes:            disk.freeBytes,
    usagePct:             disk.usagePct,
    projectStorageBytes:  disk.projectStorageBytes,
    releaseStorageBytes:  disk.releaseStorageBytes,
    backupStorageBytes:   disk.backupStorageBytes,
    warnings,
  };

  setCachedSection("disk", result);
  return result;
}

// ── runAdminSchedulersSection ─────────────────────────────────────────────────

export async function runAdminSchedulersSection(forceRefresh = false): Promise<AdminSchedulersSection> {
  if (!forceRefresh) {
    const cached = getCachedSection<AdminSchedulersSection>("schedulers");
    if (cached?.isFresh) return { ...cached.value, cacheStatus: "fresh" };
    if (cached)          return { ...cached.value, cacheStatus: "stale" };
  }

  const alertsSummary  = toSchedulerSummary("alerts");
  const backupsSummary = toSchedulerSummary("backups");

  const warnings: AdminSystemWarning[] = [];
  if (alertsSummary.status === "stale") {
    warnings.push({
      severity:    "warning",
      title:       "Alert scheduler stale",
      description: "The alert scheduler has not ticked recently. It may have crashed or been disabled.",
    });
  }
  if (backupsSummary.status === "stale") {
    warnings.push({
      severity:    "warning",
      title:       "Backup scheduler stale",
      description: "The backup scheduler has not ticked recently. Scheduled backups may not be running.",
    });
  }

  const result: AdminSchedulersSection = {
    generatedAt: new Date().toISOString(),
    cacheStatus: "miss",
    alerts:      alertsSummary,
    backups:     backupsSummary,
    warnings,
  };

  setCachedSection("schedulers", result);
  return result;
}
