"use server";

/**
 * app/actions/project-services.ts
 *
 * Sprint 23: Server actions for multi-service project deployments.
 *
 * Safety rules:
 *  - All actions enforce project-level permissions via requireProjectPermission.
 *  - All commands validated through validateServiceCommand before storage.
 *  - All paths validated through validateServiceRelativePath.
 *  - Decrypted env vars are never returned to the client.
 *  - Audit events include only safe metadata (no secrets, no values).
 *  - PM2 process names follow project-<slug>-<serviceSlug> convention.
 *  - Never touches Doorsteps/LocalShop processes.
 */

import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { getAuditRequestContext } from "@/lib/audit/request-context";
import { decryptEnvValue } from "@/lib/projects/env-manager";
import {
  validateServiceCommand,
  validateServiceRelativePath,
  validateServiceSlug,
  validateHealthPath,
} from "@/lib/projects/service-command-validator";
import {
  deployMultiServiceProject,
  assignServicePort,
  buildServicePm2Name,
  getServicePm2Status,
  checkServiceHealth,
  type ServiceDeployInput,
} from "@/lib/projects/multi-service-runner";
import {
  startProjectOperation,
  completeProjectOperation,
  failProjectOperation,
  OperationConflictError,
} from "@/lib/operations/project-operation-service";
// Re-export pure preset data from a non-"use server" lib (all server action exports must be async)
export type { ServicePreset } from "@/lib/projects/service-presets";

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── DTO ───────────────────────────────────────────────────────────────────────

export type ServiceDTO = {
  id:              string;
  name:            string;
  slug:            string;
  serviceType:     string;
  workingDir:      string;
  packageManager:  string | null;
  installCommand:  string | null;
  buildCommand:    string | null;
  startCommand:    string | null;
  internalPort:    number | null;
  healthPath:      string | null;
  staticOutputDir: string | null;
  spaFallback:     boolean;
  envName:         string;
  isPrimary:       boolean;
  isEnabled:       boolean;
  requiredEnvKeys: string[];
  lastDeploymentRef: string | null;
  lastStatus:      string | null;
  lastError:       string | null;
  lastDeployedAt:  string | null;
  updatedAt:       string;
  createdAt:       string;
};

function toServiceDTO(r: {
  id: string; name: string; slug: string; serviceType: string; workingDir: string;
  packageManager: string | null; installCommand: string | null; buildCommand: string | null;
  startCommand: string | null; internalPort: number | null; healthPath: string | null;
  staticOutputDir: string | null; spaFallback: boolean; envName: string; isPrimary: boolean;
  isEnabled: boolean; requiredEnvKeysJson: string | null; lastDeploymentRef: string | null;
  lastStatus: string | null; lastError: string | null; lastDeployedAt: Date | null;
  updatedAt: Date; createdAt: Date;
}): ServiceDTO {
  let requiredEnvKeys: string[] = [];
  try {
    if (r.requiredEnvKeysJson) requiredEnvKeys = JSON.parse(r.requiredEnvKeysJson);
  } catch { /* ignore */ }

  return {
    id: r.id, name: r.name, slug: r.slug, serviceType: r.serviceType,
    workingDir: r.workingDir, packageManager: r.packageManager,
    installCommand: r.installCommand, buildCommand: r.buildCommand,
    startCommand: r.startCommand, internalPort: r.internalPort,
    healthPath: r.healthPath, staticOutputDir: r.staticOutputDir,
    spaFallback: r.spaFallback, envName: r.envName, isPrimary: r.isPrimary,
    isEnabled: r.isEnabled, requiredEnvKeys,
    lastDeploymentRef: r.lastDeploymentRef, lastStatus: r.lastStatus,
    lastError: r.lastError, lastDeployedAt: r.lastDeployedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString(),
  };
}

// ── 1. List services ──────────────────────────────────────────────────────────

export async function listProjectServicesAction(
  projectId: string,
): Promise<ActionResult<{ services: ServiceDTO[]; role: import("@/lib/auth/project-permissions").ProjectRole; projectSlug: string }>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const [project, services] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { slug: true } }),
    db.projectService.findMany({ where: { projectId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
  ]);

  if (!project) return { ok: false, error: "Project not found." };

  return {
    ok: true,
    data: {
      services:    services.map(toServiceDTO),
      role:        auth.role,
      projectSlug: project.slug,
    },
  };
}

// ── 2. Create service ─────────────────────────────────────────────────────────

export type CreateServiceInput = {
  projectId:       string;
  name:            string;
  slug:            string;
  serviceType:     string;
  workingDir?:     string;
  packageManager?: string;
  installCommand?: string;
  buildCommand?:   string;
  startCommand?:   string;
  internalPort?:   number;
  healthPath?:     string;
  staticOutputDir?: string;
  spaFallback?:    boolean;
  envName?:        string;
  isPrimary?:      boolean;
  requiredEnvKeys?: string[];
};

export async function createProjectServiceAction(
  input: CreateServiceInput,
): Promise<ActionResult<{ id: string; port?: number }>> {
  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // Validate slug
  const slugCheck = validateServiceSlug(input.slug);
  if (!slugCheck.ok) return { ok: false, error: slugCheck.error };

  // Validate service type
  if (!["node", "static"].includes(input.serviceType)) {
    return { ok: false, error: 'serviceType must be "node" or "static".' };
  }

  // Validate working directory
  if (input.workingDir) {
    const check = validateServiceRelativePath(input.workingDir, "workingDir");
    if (!check.ok) return { ok: false, error: check.error };
  }

  // Validate staticOutputDir
  if (input.staticOutputDir) {
    const check = validateServiceRelativePath(input.staticOutputDir, "staticOutputDir");
    if (!check.ok) return { ok: false, error: check.error };
  }

  // Validate commands
  for (const [field, cmd] of [
    ["installCommand", input.installCommand],
    ["buildCommand",   input.buildCommand],
    ["startCommand",   input.startCommand],
  ] as [string, string | undefined][]) {
    if (cmd) {
      const r = validateServiceCommand(cmd);
      if (!r.ok) return { ok: false, error: `${field}: ${r.error}` };
    }
  }

  // Validate health path
  const hpCheck = validateHealthPath(input.healthPath);
  if (!hpCheck.ok) return { ok: false, error: hpCheck.error };

  // Port: for node services, assign if not provided
  let port = input.internalPort;
  if (input.serviceType === "node" && !port) {
    try {
      port = await assignServicePort();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  if (port && (port < 4100 || port > 4999)) {
    return { ok: false, error: "Port must be in range 4100–4999." };
  }

  // Duplicate slug check
  const existing = await db.projectService.findUnique({
    where: { projectId_slug: { projectId: input.projectId, slug: input.slug.trim().toLowerCase() } },
  });
  if (existing) return { ok: false, error: `A service with slug "${input.slug}" already exists.` };

  const service = await db.projectService.create({
    data: {
      projectId:       input.projectId,
      name:            input.name.trim(),
      slug:            input.slug.trim().toLowerCase(),
      serviceType:     input.serviceType,
      workingDir:      input.workingDir?.trim() || ".",
      packageManager:  input.packageManager ?? null,
      installCommand:  input.installCommand?.trim() || null,
      buildCommand:    input.buildCommand?.trim()   || null,
      startCommand:    input.startCommand?.trim()   || null,
      internalPort:    port ?? null,
      healthPath:      input.healthPath?.trim()     || null,
      staticOutputDir: input.staticOutputDir?.trim()|| null,
      spaFallback:     input.spaFallback             ?? false,
      envName:         input.envName                 ?? "production",
      isPrimary:       input.isPrimary               ?? false,
      requiredEnvKeysJson: input.requiredEnvKeys?.length
        ? JSON.stringify(input.requiredEnvKeys)
        : null,
    },
  });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.service.created",
    category:    "publishing",
    result:      "success",
    targetType:  "service",
    targetLabel: service.name,
    summary:     `Service created: ${service.name} (${service.serviceType})`,
    metadata:    { slug: service.slug, serviceType: service.serviceType, port },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { id: service.id, port: port ?? undefined } };
}

// ── 3. Update service ─────────────────────────────────────────────────────────

export type UpdateServiceInput = Partial<Omit<CreateServiceInput, "projectId" | "slug">> & {
  projectId: string;
  serviceId: string;
};

export async function updateProjectServiceAction(
  input: UpdateServiceInput,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const existing = await db.projectService.findFirst({
    where: { id: input.serviceId, projectId: input.projectId },
    select: { id: true, name: true, slug: true, serviceType: true },
  });
  if (!existing) return { ok: false, error: "Service not found." };

  // Validate updated commands
  for (const [field, cmd] of [
    ["installCommand", input.installCommand],
    ["buildCommand",   input.buildCommand],
    ["startCommand",   input.startCommand],
  ] as [string, string | undefined][]) {
    if (cmd) {
      const r = validateServiceCommand(cmd);
      if (!r.ok) return { ok: false, error: `${field}: ${r.error}` };
    }
  }

  // Validate paths
  if (input.workingDir) {
    const c = validateServiceRelativePath(input.workingDir, "workingDir");
    if (!c.ok) return { ok: false, error: c.error };
  }
  if (input.staticOutputDir) {
    const c = validateServiceRelativePath(input.staticOutputDir, "staticOutputDir");
    if (!c.ok) return { ok: false, error: c.error };
  }
  if (input.healthPath !== undefined) {
    const c = validateHealthPath(input.healthPath);
    if (!c.ok) return { ok: false, error: c.error };
  }

  const updateData: Record<string, unknown> = {};
  if (input.name        !== undefined) updateData.name            = input.name.trim();
  if (input.serviceType !== undefined) updateData.serviceType     = input.serviceType;
  if (input.workingDir  !== undefined) updateData.workingDir      = input.workingDir.trim() || ".";
  if (input.packageManager !== undefined) updateData.packageManager = input.packageManager;
  if (input.installCommand !== undefined) updateData.installCommand = input.installCommand?.trim() || null;
  if (input.buildCommand   !== undefined) updateData.buildCommand   = input.buildCommand?.trim()   || null;
  if (input.startCommand   !== undefined) updateData.startCommand   = input.startCommand?.trim()   || null;
  if (input.internalPort   !== undefined) updateData.internalPort   = input.internalPort;
  if (input.healthPath     !== undefined) updateData.healthPath     = input.healthPath?.trim()     || null;
  if (input.staticOutputDir !== undefined) updateData.staticOutputDir = input.staticOutputDir?.trim() || null;
  if (input.spaFallback    !== undefined) updateData.spaFallback    = input.spaFallback;
  if (input.isPrimary      !== undefined) updateData.isPrimary      = input.isPrimary;
  if (input.requiredEnvKeys !== undefined) {
    updateData.requiredEnvKeysJson = input.requiredEnvKeys.length ? JSON.stringify(input.requiredEnvKeys) : null;
  }

  if (Object.keys(updateData).length === 0) return { ok: true, data: undefined };

  await db.projectService.update({ where: { id: existing.id }, data: updateData });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.service.updated",
    category:    "publishing",
    result:      "success",
    targetType:  "service",
    targetLabel: existing.name,
    summary:     `Service updated: ${existing.name}`,
    metadata:    { slug: existing.slug, changedFields: Object.keys(updateData) },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 4. Toggle service enabled ─────────────────────────────────────────────────

export async function toggleProjectServiceAction(
  projectId: string,
  serviceId: string,
  enabled:   boolean,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const existing = await db.projectService.findFirst({
    where: { id: serviceId, projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!existing) return { ok: false, error: "Service not found." };

  await db.projectService.update({ where: { id: existing.id }, data: { isEnabled: enabled } });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      enabled ? "project.service.enabled" : "project.service.disabled",
    category:    "publishing",
    result:      "success",
    targetType:  "service",
    targetLabel: existing.name,
    summary:     `Service ${enabled ? "enabled" : "disabled"}: ${existing.name}`,
    metadata:    { slug: existing.slug },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 5. Delete service ─────────────────────────────────────────────────────────

export async function deleteProjectServiceAction(
  projectId: string,
  serviceId: string,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const existing = await db.projectService.findFirst({
    where: { id: serviceId, projectId },
    select: { id: true, name: true, slug: true, serviceType: true },
  });
  if (!existing) return { ok: false, error: "Service not found." };

  await db.projectService.delete({ where: { id: existing.id } });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.service.deleted",
    category:    "publishing",
    result:      "success",
    targetType:  "service",
    targetLabel: existing.name,
    summary:     `Service deleted: ${existing.name} (${existing.serviceType})`,
    metadata:    { slug: existing.slug, serviceType: existing.serviceType },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 6. Deploy all services ────────────────────────────────────────────────────

export type DeployAllServicesResult = {
  ok:            boolean;
  deploymentRef: string;
  services:      Array<{ slug: string; ok: boolean; error?: string }>;
  nginxUpdated:  boolean;
  durationMs:    number;
  output:        string;
};

export async function deployAllServicesAction(
  projectId: string,
): Promise<ActionResult<DeployAllServicesResult>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const [project, services, envRows, domains] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { id: true, slug: true, name: true } }),
    db.projectService.findMany({ where: { projectId, isEnabled: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    db.projectEnvVar.findMany({ where: { projectId, environment: "production", isEnabled: true } }),
    db.domain.findMany({ where: { projectId, status: "ACTIVE" }, orderBy: [{ isPrimary: "desc" }], take: 1, select: { hostname: true } }),
  ]);

  if (!project) return { ok: false, error: "Project not found." };
  if (services.length === 0) return { ok: false, error: "No enabled services to deploy." };

  // Sprint 27: operation lock
  let multiDeployOpId: string | null = null;
  try {
    multiDeployOpId = await startProjectOperation({
      projectId,
      operationType:    "multi_service_deploy",
      title:            `Deploy ${services.length} service${services.length !== 1 ? "s" : ""} for ${project.name}`,
      initiatedByUserId: auth.userId,
      meta:             { serviceCount: services.length, services: services.map((s) => s.slug) },
    });
  } catch (err) {
    if (err instanceof OperationConflictError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not verify operation state. Please try again." };
  }

  // Decrypt env vars server-side — NEVER log or return values
  const envVars: Record<string, string> = {};
  for (const row of envRows) {
    try {
      envVars[row.name] = decryptEnvValue(row.value);
    } catch { /* skip corrupt values */ }
  }

  const serviceInputs: ServiceDeployInput[] = services.map((s) => ({
    id:             s.id,
    slug:           s.slug,
    name:           s.name,
    serviceType:    s.serviceType,
    workingDir:     s.workingDir,
    installCommand: s.installCommand,
    buildCommand:   s.buildCommand,
    startCommand:   s.startCommand,
    internalPort:   s.internalPort,
    healthPath:     s.healthPath,
    staticOutputDir: s.staticOutputDir,
    spaFallback:    s.spaFallback,
    isEnabled:      s.isEnabled,
  }));

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.multiservice.deploy.started",
    category:    "publishing",
    result:      "success",
    summary:     `Multi-service deploy started (${services.length} services)`,
    metadata:    { serviceCount: services.length, services: services.map((s) => s.slug) },
    ...ctx,
  }).catch(() => null);

  const result = await deployMultiServiceProject({
    projectId:     project.id,
    projectSlug:   project.slug,
    projectName:   project.name,
    services:      serviceInputs,
    envVars,
    nodeEnv:       "production",
    primaryDomain: domains[0]?.hostname ?? null,
  });

  // Update per-service status in DB
  for (const sr of result.services) {
    await db.projectService.updateMany({
      where: { projectId, slug: sr.serviceSlug },
      data: {
        lastStatus:        sr.ok ? "success" : "failed",
        lastError:         sr.error ?? null,
        lastDeploymentRef: result.deploymentRef,
        lastDeployedAt:    new Date(),
      },
    }).catch(() => null);
  }

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      result.ok ? "project.multiservice.deploy.completed" : "project.multiservice.deploy.failed",
    category:    "publishing",
    result:      result.ok ? "success" : "failed",
    summary:     `Multi-service deploy ${result.ok ? "completed" : "failed"} in ${result.totalDurationMs}ms`,
    metadata: {
      deploymentRef:  result.deploymentRef,
      nginxUpdated:   result.nginxUpdated,
      durationMs:     result.totalDurationMs,
      services:       result.services.map((s) => ({ slug: s.serviceSlug, ok: s.ok })),
    },
    ...ctx,
  }).catch(() => null);

  // Sprint 27: release lock
  if (multiDeployOpId) {
    if (result.ok) await completeProjectOperation(multiDeployOpId);
    else await failProjectOperation(multiDeployOpId, `Multi-service deploy failed after ${result.totalDurationMs}ms`);
  }

  return {
    ok: true,
    data: {
      ok:            result.ok,
      deploymentRef: result.deploymentRef,
      services:      result.services.map((s) => ({ slug: s.serviceSlug, ok: s.ok, error: s.error })),
      nginxUpdated:  result.nginxUpdated,
      durationMs:    result.totalDurationMs,
      output:        result.output,
    },
  };
}

// ── 7. Get service PM2 status ─────────────────────────────────────────────────

export async function getServiceStatusAction(
  projectId:  string,
  serviceId:  string,
): Promise<ActionResult<{ pm2Status: import("@/lib/projects/project-deploy-runner").Pm2AppStatus | null; health?: { ok: boolean; status?: number; latencyMs: number } }>> {
  const auth = await requireProjectPermission(projectId, "monitoring.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const service = await db.projectService.findFirst({
    where: { id: serviceId, projectId },
    select: { slug: true, serviceType: true, internalPort: true, healthPath: true },
  });
  if (!service) return { ok: false, error: "Service not found." };

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const pm2Status = service.serviceType === "node"
    ? await getServicePm2Status(project.slug, service.slug).catch(() => null)
    : null;

  let health: { ok: boolean; status?: number; latencyMs: number } | undefined;
  if (service.serviceType === "node" && service.internalPort && service.healthPath) {
    health = await checkServiceHealth(service.internalPort, service.healthPath).catch(() => ({ ok: false, latencyMs: 0 }));

    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "project.service.health_checked",
      category:    "publishing",
      result:      health.ok ? "success" : "failed",
      targetType:  "service",
      targetLabel: service.slug,
      summary:     `Health check ${health.ok ? "passed" : "failed"} for ${service.slug}`,
      metadata:    { port: service.internalPort, healthPath: service.healthPath, status: health.status },
    }).catch(() => null);
  }

  return { ok: true, data: { pm2Status, health } };
}

// ── 8. Service preset configurations ─────────────────────────────────────────
// getServicePresets() lives in lib/projects/service-presets.ts (not a server action).
