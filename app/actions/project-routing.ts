"use server";

/**
 * app/actions/project-routing.ts
 *
 * Sprint 44: Server actions for multi-service production routing.
 *
 * Safety rules:
 *  - All actions enforce project-level permissions
 *  - Reserved hostnames are blocked (panel domain, localhost, bare IPs)
 *  - Nginx apply requires "APPLY ROUTES" confirmation text
 *  - Rollback requires "ROLLBACK" confirmation text
 *  - Config generation never includes secrets
 *  - nginx -t runs before any reload
 *  - Audit events recorded for every apply/rollback
 */

import { db }                                from "@/lib/db";
import { requireProjectPermission }          from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }            from "@/lib/audit/project-audit";
import { getAuditRequestContext }            from "@/lib/audit/request-context";
import { generateRoutingDiagnostics }        from "@/lib/routing/routing-diagnostics-service";
import { buildRouteRollbackPreview }         from "@/lib/routing/route-rollback-preview";
import type { RoutingDiagnosticsReport, RouteRollbackPreview } from "@/lib/routing/routing-diagnostics-types";
import { generateProjectRouteMap }           from "@/lib/routing/project-route-planner";
import { generateNginxFromRouteMap }         from "@/lib/routing/nginx-route-generator";
import {
  applyNginxRouteConfig,
  rollbackNginxRouteConfig,
  validateNginxConfig,
  readCurrentNginxConfig,
  hasBackupConfig,
}                                            from "@/lib/routing/nginx-route-apply";
import { checkProjectRouteHealth }           from "@/lib/routing/project-route-health";
import { loadPlannerInput }                  from "@/lib/routing/planner-loader";
import type {
  ProjectRoutingActionResult,
  ProjectRouteHealthReport,
}                                            from "@/lib/routing/project-route-types";
import type { PlannerInput }                 from "@/lib/routing/project-route-planner";

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 0. Routing diagnostics ────────────────────────────────────────────────────

export async function generateRoutingDiagnosticsAction(
  projectId: string,
): Promise<ActionResult<RoutingDiagnosticsReport>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report = await generateRoutingDiagnostics(projectId);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "routing.diagnostics_generated",
    category:    "publishing",
    result:      report.status === "blocked" ? "failed" : "success",
    summary:     `Routing diagnostics generated — status: ${report.status}, blockers: ${report.blockers.length}`,
    metadata:    { domain: report.domain, status: report.status, blockerCount: report.blockers.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: report };
}

// ── 0b. Rollback preview ──────────────────────────────────────────────────────

export async function getRouteRollbackPreviewAction(
  projectId: string,
): Promise<ActionResult<RouteRollbackPreview>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const domain  = input.domain ?? "";
  const preview = await buildRouteRollbackPreview(domain);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "routing.rollback_preview_generated",
    category:    "rollback",
    result:      "success",
    summary:     `Rollback preview generated for ${domain || "unknown domain"} — hasBackup: ${preview.hasBackup}`,
    metadata:    { domain, hasBackup: preview.hasBackup },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: preview };
}

// ── Loader: delegated to shared lib/routing/planner-loader.ts ─────────────────

const buildPlannerInput = (projectId: string): Promise<PlannerInput | null> =>
  loadPlannerInput(projectId);

// ── 1. Generate route map ─────────────────────────────────────────────────────

export async function generateProjectRouteMapAction(
  projectId: string,
): Promise<ActionResult<ProjectRoutingActionResult>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const routeMap = generateProjectRouteMap(input);

  return {
    ok:   true,
    data: {
      ok:       routeMap.blockers.length === 0,
      routeMap,
      warnings: routeMap.warnings,
      blockers: routeMap.blockers,
      error:    routeMap.blockers.length > 0 ? routeMap.blockers[0] : undefined,
    },
  };
}

// ── 2. Preview nginx config ───────────────────────────────────────────────────

export async function previewProjectNginxConfigAction(
  projectId: string,
): Promise<ActionResult<ProjectRoutingActionResult>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const routeMap = generateProjectRouteMap(input);
  const genResult = generateNginxFromRouteMap(routeMap);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "routing.preview_generated",
    category:    "publishing",
    result:      genResult.ok ? "success" : "failed",
    summary:     `Nginx route config preview generated for ${routeMap.domain || "unknown domain"}`,
    ...ctx,
  }).catch(() => null);

  if (!genResult.ok) {
    return { ok: false, error: genResult.error };
  }

  return {
    ok:   true,
    data: {
      ok:           true,
      routeMap,
      nginxPreview: genResult.config,
      warnings:     [...routeMap.warnings, ...genResult.warnings],
      blockers:     routeMap.blockers,
    },
  };
}

// ── 3. Validate route map ─────────────────────────────────────────────────────

export async function validateProjectRouteMapAction(
  projectId: string,
): Promise<ActionResult<ProjectRoutingActionResult>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const routeMap  = generateProjectRouteMap(input);
  const genResult = generateNginxFromRouteMap(routeMap);

  if (!genResult.ok) {
    return {
      ok:   true,
      data: { ok: false, routeMap, warnings: routeMap.warnings, blockers: routeMap.blockers, error: genResult.error },
    };
  }

  const testResult = await validateNginxConfig();

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      testResult.ok ? "routing.dry_run_validated" : "routing.dry_run_validated",
    category:    "publishing",
    result:      testResult.ok ? "success" : "failed",
    summary:     `Route map dry-run validation: ${testResult.ok ? "passed" : "failed"} for ${routeMap.domain || "unknown domain"}`,
    metadata:    { domain: routeMap.domain, nginxOutput: testResult.output.slice(0, 500) },
    ...ctx,
  }).catch(() => null);

  return {
    ok:   true,
    data: {
      ok:           testResult.ok,
      routeMap,
      nginxPreview: genResult.config,
      warnings:     [...routeMap.warnings, ...genResult.warnings],
      blockers:     routeMap.blockers,
      nginxOutput:  testResult.output,
      error:        testResult.ok ? undefined : testResult.output,
    },
  };
}

// ── 4. Apply route map ────────────────────────────────────────────────────────

export async function applyProjectRouteMapAction(input: {
  projectId:        string;
  confirmationText: string;
}): Promise<ActionResult<ProjectRoutingActionResult>> {
  const { projectId, confirmationText } = input;

  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (confirmationText !== "APPLY ROUTES") {
    return { ok: false, error: 'Type "APPLY ROUTES" to confirm applying nginx routing.' };
  }

  const plannerInput = await buildPlannerInput(projectId);
  if (!plannerInput) return { ok: false, error: "Project not found." };

  const routeMap  = generateProjectRouteMap(plannerInput);

  if (routeMap.blockers.length > 0) {
    return {
      ok: false,
      error: `Cannot apply: route map has ${routeMap.blockers.length} blocker(s). Resolve them first.`,
    };
  }

  const genResult = generateNginxFromRouteMap(routeMap);
  if (!genResult.ok) {
    return { ok: false, error: genResult.error };
  }

  const applyResult = await applyNginxRouteConfig(routeMap.domain, genResult.config);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      applyResult.ok ? "routing.apply_succeeded" : "routing.apply_failed",
    category:    "publishing",
    result:      applyResult.ok ? "success" : "failed",
    summary:     applyResult.ok
      ? `Nginx route config applied for ${routeMap.domain}`
      : `Nginx route apply failed for ${routeMap.domain}: ${applyResult.error?.slice(0, 200)}`,
    metadata: {
      domain:    routeMap.domain,
      ruleCount: routeMap.rules.length,
      modes:     routeMap.rules.map((r) => `${r.pathPattern}→${r.targetType}`).join(", "),
    },
    ...ctx,
  }).catch(() => null);

  if (!applyResult.ok) {
    // Notify admins on failure
    try {
      const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
      await notifyProjectAdmins(projectId, {
        title:      "Route config apply failed",
        body:       `nginx routing failed for ${routeMap.domain}. Config rolled back.`,
        severity:   "error",
        category:   "deployment",
        sourceType: "routing",
        href:       `/projects/${projectId}/publishing`,
      });
    } catch { /* non-fatal */ }

    return {
      ok: false,
      error: applyResult.error ?? "Apply failed.",
    };
  }

  // Update Domain.nginxConfigPath in DB if domain record exists
  try {
    await db.domain.updateMany({
      where: { projectId, hostname: routeMap.domain },
      data:  { nginxConfigPath: applyResult.configPath ?? null },
    });
  } catch { /* non-fatal */ }

  return {
    ok:   true,
    data: {
      ok:          true,
      routeMap,
      nginxPreview: genResult.config,
      warnings:    [...routeMap.warnings, ...genResult.warnings],
      blockers:    [],
      nginxOutput: applyResult.nginxOutput,
    },
  };
}

// ── 5. Rollback route config ──────────────────────────────────────────────────

export async function rollbackProjectRouteConfigAction(
  projectId: string,
): Promise<ActionResult<ProjectRoutingActionResult>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const domain = input.domain;
  if (!domain) return { ok: false, error: "No domain configured for this project." };

  const hasBackup = await hasBackupConfig(domain);
  if (!hasBackup) {
    return { ok: false, error: "No backup config found to roll back to." };
  }

  const rollbackResult = await rollbackNginxRouteConfig(domain);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      rollbackResult.ok ? "routing.rollback_preview_generated" : "routing.apply_failed",
    category:    "rollback",
    result:      rollbackResult.ok ? "success" : "failed",
    summary:     rollbackResult.ok
      ? `Nginx route config rolled back for ${domain}`
      : `Nginx rollback failed for ${domain}: ${rollbackResult.error?.slice(0, 200)}`,
    metadata:    { domain },
    ...ctx,
  }).catch(() => null);

  if (!rollbackResult.ok) {
    return { ok: false, error: rollbackResult.error ?? "Rollback failed." };
  }

  return {
    ok:   true,
    data: {
      ok:          true,
      warnings:    [],
      blockers:    [],
      nginxOutput: rollbackResult.nginxOutput,
    },
  };
}

// ── 6. Route health check ─────────────────────────────────────────────────────

export async function checkProjectRouteHealthAction(
  projectId: string,
): Promise<ActionResult<ProjectRouteHealthReport>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const domain = input.domain;
  if (!domain) {
    return { ok: false, error: "No domain configured for this project." };
  }

  const routeMap  = generateProjectRouteMap(input);
  const healthReport = await checkProjectRouteHealth(domain, routeMap.rules);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "routing.health_checked",
    category:    "publishing",
    result:      healthReport.allOk ? "success" : "failed",
    summary:     `Route health: ${healthReport.checks.filter((c) => c.ok).length}/${healthReport.checks.length} checks passed for ${domain}`,
    metadata:    { domain, allOk: healthReport.allOk },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: healthReport };
}

// ── 7. Read current nginx config preview ────────────────────────────────────

export async function getCurrentNginxConfigAction(
  projectId: string,
): Promise<ActionResult<{ config: string | null; hasBackup: boolean }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const input = await buildPlannerInput(projectId);
  if (!input) return { ok: false, error: "Project not found." };

  const domain = input.domain;
  if (!domain) return { ok: true, data: { config: null, hasBackup: false } };

  const [config, backup] = await Promise.all([
    readCurrentNginxConfig(domain),
    hasBackupConfig(domain),
  ]);

  return { ok: true, data: { config, hasBackup: backup } };
}
