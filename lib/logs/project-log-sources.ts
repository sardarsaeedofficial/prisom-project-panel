/**
 * lib/logs/project-log-sources.ts
 *
 * Sprint 28: Discovers available log sources for a given project.
 *
 * Returns a stable list of LogSource descriptors that the client can display
 * in the sidebar.  The IDs are opaque tokens validated server-side before any
 * log data is read; they never contain raw file paths.
 *
 * Source categories:
 *  1. pm2_app      — main PM2 process from ProjectDeploymentConfig
 *  2. pm2_service  — per-service PM2 processes from ProjectService rows
 *  3. db_logs      — ProjectLog table (structured, always available)
 *  4. operation    — last 15 operations that stored log output in meta.log
 *  5. deployment   — last 10 deployments that stored metadata output
 */

import { db }              from "@/lib/db";
import type { LogSource }  from "./project-log-types";
import { buildServicePm2Name } from "@/lib/projects/multi-service-runner";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Deployed operation types that may carry log output in meta.log. */
const OP_LOG_TYPES = [
  "deploy",
  "multi_service_deploy",
  "backup_create",
  "backup_restore",
  "patch_apply",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day:   "numeric",
    hour:  "2-digit",
    minute:"2-digit",
  });
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function discoverLogSources(projectId: string): Promise<LogSource[]> {
  const sources: LogSource[] = [];

  // ── 1. Project info (slug + deploymentConfig + services) ─────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: {
      slug: true,
      deploymentConfig: {
        select: { pm2Name: true, routeMode: true },
      },
      services: {
        select: { id: true, slug: true, name: true, serviceType: true },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!project) return [];

  // ── 2. Main PM2 process ───────────────────────────────────────────────────
  if (project.deploymentConfig?.pm2Name) {
    const pm2Name = project.deploymentConfig.pm2Name;
    sources.push({
      id:       "pm2_app",
      kind:     "pm2_app",
      label:    "Application logs",
      subLabel: pm2Name,
      available: true,
      pm2Name,
    });
  }

  // ── 3. Multi-service PM2 processes ───────────────────────────────────────
  for (const svc of project.services) {
    if (svc.serviceType !== "node") continue; // static services have no PM2 process
    const pm2Name = buildServicePm2Name(project.slug, svc.slug);
    sources.push({
      id:          `pm2_service:${svc.id}`,
      kind:        "pm2_service",
      label:       svc.name,
      subLabel:    pm2Name,
      available:   true,
      pm2Name,
      serviceId:   svc.id,
      serviceSlug: svc.slug,
    });
  }

  // ── 4. DB-structured logs ─────────────────────────────────────────────────
  const logCount = await db.projectLog.count({ where: { projectId } });
  sources.push({
    id:       "db_logs",
    kind:     "db_logs",
    label:    "Structured logs",
    subLabel: `${logCount} entries`,
    available: true,
  });

  // ── 5. Recent operations with log output ─────────────────────────────────
  const ops = await db.projectOperation.findMany({
    where: {
      projectId,
      operationType: { in: OP_LOG_TYPES },
    },
    orderBy: { startedAt: "desc" },
    take:    15,
    select:  {
      id:            true,
      operationType: true,
      title:         true,
      status:        true,
      startedAt:     true,
      meta:          true,
    },
  });

  for (const op of ops) {
    const hasMeta = op.meta !== null && typeof op.meta === "object";
    // Only include if meta.log exists (a log array or string was stored)
    const hasLog =
      hasMeta &&
      ("log" in (op.meta as object) ||
       "output" in (op.meta as object) ||
       "lines" in (op.meta as object));
    sources.push({
      id:          `operation:${op.id}`,
      kind:        "operation",
      label:       op.title,
      subLabel:    `${op.status} · ${formatDate(op.startedAt)}`,
      available:   hasLog,
      operationId: op.id,
    });
  }

  // ── 6. Recent deployments ─────────────────────────────────────────────────
  const deps = await db.deployment.findMany({
    where:   { projectId },
    orderBy: { startedAt: "desc" },
    take:    10,
    select:  {
      id:        true,
      status:    true,
      startedAt: true,
      metadata:  true,
    },
  });

  for (const dep of deps) {
    const hasMeta = dep.metadata !== null && typeof dep.metadata === "object";
    const hasOutput =
      hasMeta &&
      ("output" in (dep.metadata as object) ||
       "log" in (dep.metadata as object) ||
       "lines" in (dep.metadata as object));
    sources.push({
      id:           `deployment:${dep.id}`,
      kind:         "deployment",
      label:        `Deploy ${formatDate(dep.startedAt)}`,
      subLabel:     dep.status,
      available:    hasOutput,
      deploymentId: dep.id,
    });
  }

  return sources;
}
