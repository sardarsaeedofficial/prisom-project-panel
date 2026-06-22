/**
 * lib/activity/activity-aggregator.ts
 *
 * Sprint 37: Aggregate activity from multiple sources into normalized ActivityItem[].
 *
 * Sources:
 *  - ProjectAuditEvent  (Sprint 18)
 *  - ProjectOperation   (Sprint 27)
 *  - Deployment         (core)
 *  - ProjectBackup      (Sprint 21)
 *  - BackgroundJob      (Sprint 35)
 *
 * Safety rules:
 *  - No secret values — all sourced from safe DB fields
 *  - No raw env values
 *  - projectId filter enforced server-side before calling
 *  - Results sorted newest-first
 */

import { db } from "@/lib/db";
import type {
  ActivityItem,
  ActivityCategory,
  ActivitySeverity,
  ListActivityInput,
  ListActivityOutput,
} from "./activity-types";

// ── Per-source normalizers ────────────────────────────────────────────────────

function auditToActivity(
  row: {
    id:          string;
    projectId:   string;
    project?:    { name: string; slug: string } | null;
    actorEmail:  string | null;
    action:      string;
    category:    string;
    result:      string;
    summary:     string;
    createdAt:   Date;
  },
): ActivityItem {
  const sev: ActivitySeverity =
    row.result === "failed" || row.result === "denied" ? "error" : "info";
  const cat: ActivityCategory =
    row.category === "backups"    ? "backup"     :
    row.category === "storage"    ? "storage"    :
    row.category === "domains"    ? "domain"     :
    row.category === "alerts"     ? "alert"      :
    row.category === "monitoring" ? "alert"      :
    row.category === "auth"       ? "security"   :
    row.category === "team"       ? "audit"      :
    "audit";

  return {
    id:          `audit:${row.id}`,
    occurredAt:  row.createdAt.toISOString(),
    projectId:   row.projectId,
    projectName: row.project?.name,
    projectSlug: row.project?.slug,
    actorEmail:  row.actorEmail,
    category:    cat,
    severity:    sev,
    title:       row.summary,
    description: row.action,
    href:        `/projects/${row.projectId}/audit`,
    sourceType:  "audit",
    sourceId:    row.id,
  };
}

function operationToActivity(
  row: {
    id:          string;
    projectId:   string;
    project?:    { name: string; slug: string } | null;
    operationType: string;
    title:       string;
    status:      string;
    lastError:   string | null;
    startedAt:   Date;
  },
): ActivityItem {
  const sev: ActivitySeverity =
    row.status === "failed" || row.status === "stale" ? "error"   :
    row.status === "success"                          ? "success" :
    row.status === "cancelled"                        ? "warning" :
    "info";

  const href =
    row.operationType.includes("deploy")
      ? `/projects/${row.projectId}/publishing`
      : row.operationType.includes("backup")
        ? `/projects/${row.projectId}/backups`
        : `/projects/${row.projectId}/operations`;

  return {
    id:          `op:${row.id}`,
    occurredAt:  row.startedAt.toISOString(),
    projectId:   row.projectId,
    projectName: row.project?.name,
    projectSlug: row.project?.slug,
    category:    "operation",
    severity:    sev,
    title:       row.title,
    description: row.lastError ?? undefined,
    href,
    sourceType:  "operation",
    sourceId:    row.id,
  };
}

function deploymentToActivity(
  row: {
    id:            string;
    projectId:     string;
    project?:      { name: string; slug: string } | null;
    status:        string;
    source:        string;
    branch:        string | null;
    commitMessage: string | null;
    errorMessage:  string | null;
    startedAt:     Date;
  },
): ActivityItem {
  const sev: ActivitySeverity =
    row.status === "FAILED"    ? "error"   :
    row.status === "SUCCESS"   ? "success" :
    row.status === "CANCELLED" ? "warning" :
    "info";

  const label =
    row.status === "FAILED"    ? "Deployment failed"     :
    row.status === "SUCCESS"   ? "Deployment succeeded"  :
    row.status === "BUILDING"  ? "Deployment in progress":
    row.status === "CANCELLED" ? "Deployment cancelled"  :
    "Deployment queued";

  return {
    id:          `deploy:${row.id}`,
    occurredAt:  row.startedAt.toISOString(),
    projectId:   row.projectId,
    projectName: row.project?.name,
    projectSlug: row.project?.slug,
    category:    "deployment",
    severity:    sev,
    title:       label,
    description: row.commitMessage ?? row.branch ?? undefined,
    href:        `/projects/${row.projectId}/publishing`,
    sourceType:  "deployment",
    sourceId:    row.id,
  };
}

function backupToActivity(
  row: {
    id:          string;
    projectId:   string;
    project?:    { name: string; slug: string } | null;
    status:      string;
    backupType:  string;
    label:       string | null;
    lastError:   string | null;
    createdAt:   Date;
  },
): ActivityItem {
  const sev: ActivitySeverity =
    row.status === "failed"  ? "error"   :
    row.status === "ready"   ? "success" :
    "info";

  const prefix =
    row.backupType === "scheduled" ? "Scheduled backup" :
    row.backupType === "manual"    ? "Manual backup"    :
    "Backup";

  const title =
    row.status === "failed"  ? `${prefix} failed`   :
    row.status === "ready"   ? `${prefix} completed` :
    `${prefix} in progress`;

  return {
    id:          `backup:${row.id}`,
    occurredAt:  row.createdAt.toISOString(),
    projectId:   row.projectId,
    projectName: row.project?.name,
    projectSlug: row.project?.slug,
    category:    "backup",
    severity:    sev,
    title,
    description: row.label ?? row.lastError ?? undefined,
    href:        `/projects/${row.projectId}/backups`,
    sourceType:  "backup",
    sourceId:    row.id,
  };
}

function jobToActivity(
  row: {
    id:          string;
    projectId:   string | null;
    project?:    { name: string; slug: string } | null;
    jobType:     string;
    title:       string;
    status:      string;
    lastError:   string | null;
    createdAt:   Date;
  },
): ActivityItem {
  const sev: ActivitySeverity =
    row.status === "failed" || row.status === "stale" ? "error"   :
    row.status === "success"                          ? "success" :
    row.status === "cancelled"                        ? "warning" :
    "info";

  const href = row.projectId
    ? `/projects/${row.projectId}/operations`
    : "/admin/jobs";

  return {
    id:          `job:${row.id}`,
    occurredAt:  row.createdAt.toISOString(),
    projectId:   row.projectId ?? undefined,
    projectName: row.project?.name,
    projectSlug: row.project?.slug,
    category:    "background_job",
    severity:    sev,
    title:       row.title,
    description: row.lastError ?? undefined,
    href,
    sourceType:  "background_job",
    sourceId:    row.id,
  };
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export async function listActivity(
  input: ListActivityInput,
): Promise<ListActivityOutput> {
  const {
    projectId,
    category,
    severity,
    search,
    from,
    to,
    page     = 1,
    pageSize = 30,
  } = input;

  // Per-source date range
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = from;
  if (to)   dateFilter.lte = to;

  // Decide which sources to query
  const wantAudit  = !category || category === "audit" || category === "security" || category === "domain" || category === "storage" || category === "alert" || category === "backup";
  const wantOp     = !category || category === "operation";
  const wantDeploy = !category || category === "deployment";
  const wantBackup = !category || category === "backup";
  const wantJob    = !category || category === "background_job";

  const projectSelect = { name: true, slug: true };

  const [audits, ops, deploys, backups, jobs] = await Promise.all([
    wantAudit ? db.projectAuditEvent.findMany({
      where:   {
        ...(projectId ? { projectId } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take:    500,
      select: {
        id: true, projectId: true, actorEmail: true, action: true,
        category: true, result: true, summary: true, createdAt: true,
        project: { select: projectSelect },
      },
    }) : Promise.resolve([]),

    wantOp ? db.projectOperation.findMany({
      where:   {
        ...(projectId ? { projectId } : {}),
        ...(Object.keys(dateFilter).length ? { startedAt: dateFilter } : {}),
      },
      orderBy: { startedAt: "desc" },
      take:    200,
      select: {
        id: true, projectId: true, operationType: true, title: true,
        status: true, lastError: true, startedAt: true,
        project: { select: projectSelect },
      },
    }) : Promise.resolve([]),

    wantDeploy ? db.deployment.findMany({
      where:   {
        ...(projectId ? { projectId } : {}),
        ...(Object.keys(dateFilter).length ? { startedAt: dateFilter } : {}),
      },
      orderBy: { startedAt: "desc" },
      take:    200,
      select: {
        id: true, projectId: true, status: true, source: true,
        branch: true, commitMessage: true, errorMessage: true, startedAt: true,
        project: { select: projectSelect },
      },
    }) : Promise.resolve([]),

    wantBackup ? db.projectBackup.findMany({
      where:   {
        ...(projectId ? { projectId } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take:    200,
      select: {
        id: true, projectId: true, status: true, backupType: true,
        label: true, lastError: true, createdAt: true,
        project: { select: projectSelect },
      },
    }) : Promise.resolve([]),

    wantJob ? db.backgroundJob.findMany({
      where:   {
        ...(projectId ? { projectId } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take:    200,
      select: {
        id: true, projectId: true, jobType: true, title: true,
        status: true, lastError: true, createdAt: true,
        project: { select: projectSelect },
      },
    }) : Promise.resolve([]),
  ]);

  // Normalize all sources into ActivityItem[]
  let all: ActivityItem[] = [
    ...audits.map(auditToActivity),
    ...ops.map(operationToActivity),
    ...deploys.map(deploymentToActivity),
    ...backups.map(backupToActivity),
    ...jobs.map(jobToActivity),
  ];

  // Severity filter
  if (severity) {
    all = all.filter((a) => a.severity === severity);
  }

  // Search filter (title + description)
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    all = all.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.projectName?.toLowerCase().includes(q),
    );
  }

  // Sort newest first
  all.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
