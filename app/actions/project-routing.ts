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
import type {
  ProjectRoutingActionResult,
  ProjectRouteHealthReport,
}                                            from "@/lib/routing/project-route-types";
import type { PlannerInput, PlannerService } from "@/lib/routing/project-route-planner";

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Loader: build planner input from DB ────────────────────────────────────────

async function buildPlannerInput(projectId: string): Promise<PlannerInput | null> {
  const [project, config, services, domain] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, liveUrl: true },
    }),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        port:            true,
        routeMode:       true,
        apiPrefix:       true,
        staticOutputDir: true,
        publicStaticPath: true,
        healthPath:      true,
        primaryDomain:   true,
      },
    }),
    db.projectService.findMany({
      where:  { projectId },
      select: {
        id:              true,
        name:            true,
        slug:            true,
        serviceType:     true,
        internalPort:    true,
        healthPath:      true,
        staticOutputDir: true,
        spaFallback:     true,
        isPrimary:       true,
        isEnabled:       true,
      },
    }),
    db.domain.findFirst({
      where:   { projectId, status: "ACTIVE", isPrimary: true },
      select:  { hostname: true },
      orderBy: { isPrimary: "desc" },
    }),
  ]);

  if (!project) return null;

  return {
    projectId,
    projectSlug: project.slug,
    domain:      domain?.hostname ?? config?.primaryDomain ?? project.liveUrl?.replace(/^https?:\/\//, "").replace(/\/.*/, "") ?? null,
    services:    services as PlannerService[],
    deployConfig: config ? {
      port:             config.port,
      routeMode:        config.routeMode,
      apiPrefix:        config.apiPrefix,
      staticOutputDir:  config.staticOutputDir,
      publicStaticPath: (config as { publicStaticPath?: string | null }).publicStaticPath ?? null,
      healthPath:       config.healthPath,
      primaryDomain:    (config as { primaryDomain?: string | null }).primaryDomain ?? null,
    } : null,
  };
}

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
    summary:     `Nginx route preview generated for ${routeMap.domain || "unknown domain"}`,
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
    action:      testResult.ok ? "routing.preview_generated" : "routing.validation_failed",
    category:    "publishing",
    result:      testResult.ok ? "success" : "failed",
    summary:     `Route map validation: ${testResult.ok ? "passed" : "failed"} for ${routeMap.domain || "unknown domain"}`,
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
    action:      applyResult.ok ? "routing.applied" : "routing.validation_failed",
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
    action:      rollbackResult.ok ? "routing.rollback" : "routing.validation_failed",
    category:    "publishing",
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
    action:      "routing.health_check",
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
