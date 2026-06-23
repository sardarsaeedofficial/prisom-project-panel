/**
 * lib/migration/migration-apply-runner.ts
 *
 * Sprint 43: Applies a set of selected MigrationApplyChanges server-side.
 *
 * Safety rules:
 *  - Always regenerates the plan before applying (no client-supplied plan data trusted)
 *  - Requires "APPLY" confirmation text when any selected change overwrites
 *  - Never writes real secret values
 *  - Never triggers auto-deploy
 *  - Never touches Doorsteps/LocalShop
 *  - All changes are audit-logged
 */

import { db }                           from "@/lib/db";
import { writeProjectAuditEvent }       from "@/lib/audit/project-audit";
import { createBackgroundJob }          from "@/lib/jobs/background-job-service";
import { generateMigrationApplyPlan }   from "./migration-apply-planner";
import { analyzeReplitProject }         from "./replit-project-analyzer";
import { detectExternalServices }       from "./external-service-detector";
import { generateManualSteps }          from "./manual-steps-generator";
import type { EnrichedMigrationReport } from "./replit-migration-types";
import type {
  ApplyMigrationPlanInput,
  MigrationApplyChange,
  MigrationApplyChangeResult,
  MigrationApplyResult,
} from "./migration-apply-types";
import {
  validateServiceCommand,
  validateHealthPath,
  validateServiceRelativePath,
  validateServiceSlug,
} from "@/lib/projects/service-command-validator";
import { assignServicePort }            from "@/lib/projects/multi-service-runner";
import type { SuggestedProjectService } from "./replit-detection-types";

// ── Plan regeneration ─────────────────────────────────────────────────────────

async function regeneratePlan(projectId: string) {
  const [project, config, services, envVars, domains] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { installCommand: true, buildCommand: true, startCommand: true, healthPath: true },
    }),
    db.projectService.findMany({
      where:  { projectId },
      select: { slug: true },
    }),
    db.projectEnvVar.findMany({
      where:  { projectId, environment: "production" },
      select: { name: true },
    }),
    db.domain.findFirst({
      where:   { projectId, status: "ACTIVE", isPrimary: true },
      select:  { hostname: true },
      orderBy: { isPrimary: "desc" },
    }),
  ]);

  if (!project) return null;

  // Load latest persisted report or re-analyze
  const row = await db.projectMigrationReport.findFirst({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
  });

  let report: EnrichedMigrationReport | null = null;
  if (row) {
    report = row.reportJson as EnrichedMigrationReport;
  } else {
    const base = await analyzeReplitProject(project.slug).catch(() => null);
    if (base) {
      const externalServices = detectExternalServices(base);
      const manualSteps      = generateManualSteps(base, externalServices);
      const blockers         = base.risks.filter((r) => r.severity === "blocker").length;
      report = {
        ...base,
        projectSlug:     project.slug,
        externalServices,
        manualSteps,
        applyActions:    [],
        readinessStatus: blockers > 0 ? "blocked" : base.risks.some((r) => r.severity === "warning") ? "warnings" : "ready",
      };
    }
  }

  if (!report) return null;

  const plan = generateMigrationApplyPlan(report, {
    projectId,
    deploymentConfig: config,
    existingServiceSlugs: services.map((s) => s.slug),
    existingEnvVarNames:  envVars.map((v) => v.name),
    activeDomainHostname: domains?.hostname ?? null,
    liveUrl:              project.liveUrl   ?? null,
  });

  return { plan, report, project };
}

// ── Individual change appliers ────────────────────────────────────────────────

async function applyProjectConfig(
  projectId: string,
  change:    MigrationApplyChange,
): Promise<MigrationApplyChangeResult> {
  const field = change.target;
  const value = change.after ?? "";

  // Validate command fields
  if (["installCommand", "buildCommand", "startCommand"].includes(field) && value) {
    const r = validateServiceCommand(value);
    if (!r.ok) return { id: change.id, ok: false, error: r.error, summary: r.error };
  }
  if (field === "healthPath" && value) {
    const r = validateHealthPath(value);
    if (!r.ok) return { id: change.id, ok: false, error: r.error, summary: r.error };
  }

  const existing = await db.projectDeploymentConfig.findUnique({ where: { projectId } });
  if (!existing) {
    return { id: change.id, ok: false, error: "No deployment config found.", summary: "No deployment config found." };
  }

  await db.projectDeploymentConfig.update({
    where: { projectId },
    data:  { [field]: value },
  });

  return { id: change.id, ok: true, summary: `${field} set to: ${value}` };
}

async function applyServiceCreate(
  projectId: string,
  change:    MigrationApplyChange,
  report:    EnrichedMigrationReport,
): Promise<MigrationApplyChangeResult> {
  const svc: SuggestedProjectService | undefined = report.suggestedServices.find(
    (s) => s.slug === change.target,
  );
  if (!svc) {
    return { id: change.id, ok: false, error: "Service definition not found in report.", summary: "Not found." };
  }

  // Validate slug
  const slugCheck = validateServiceSlug(svc.slug);
  if (!slugCheck.ok) return { id: change.id, ok: false, error: slugCheck.error, summary: slugCheck.error };

  // Validate commands
  for (const [field, cmd] of [
    ["installCommand", svc.installCommand],
    ["buildCommand",   svc.buildCommand],
    ["startCommand",   svc.startCommand],
  ] as [string, string | undefined][]) {
    if (cmd) {
      const r = validateServiceCommand(cmd);
      if (!r.ok) return { id: change.id, ok: false, error: `${field}: ${r.error}`, summary: r.error };
    }
  }
  if (svc.workingDir) {
    const r = validateServiceRelativePath(svc.workingDir, "workingDir");
    if (!r.ok) return { id: change.id, ok: false, error: r.error, summary: r.error };
  }
  if (svc.staticOutputDir) {
    const r = validateServiceRelativePath(svc.staticOutputDir, "staticOutputDir");
    if (!r.ok) return { id: change.id, ok: false, error: r.error, summary: r.error };
  }

  // Duplicate check
  const existing = await db.projectService.findUnique({
    where: { projectId_slug: { projectId, slug: svc.slug } },
  });
  if (existing) {
    return { id: change.id, ok: true, summary: `Service "${svc.slug}" already exists — skipped.` };
  }

  // Assign port for node services
  let port: number | undefined;
  if (svc.serviceType === "node" && !svc.internalPort) {
    try { port = await assignServicePort(); } catch { /* leave undefined */ }
  } else {
    port = svc.internalPort ?? undefined;
  }

  await db.projectService.create({
    data: {
      projectId,
      name:            svc.name,
      slug:            svc.slug.trim().toLowerCase(),
      serviceType:     svc.serviceType,
      workingDir:      svc.workingDir      ?? ".",
      packageManager:  svc.packageManager  ?? null,
      installCommand:  svc.installCommand  ?? null,
      buildCommand:    svc.buildCommand    ?? null,
      startCommand:    svc.startCommand    ?? null,
      internalPort:    port                ?? null,
      healthPath:      svc.healthPath      ?? null,
      staticOutputDir: svc.staticOutputDir ?? null,
      spaFallback:     svc.spaFallback     ?? false,
      envName:         "production",
      isPrimary:       svc.isPrimary       ?? false,
    },
  });

  return { id: change.id, ok: true, summary: `Created ${svc.serviceType} service "${svc.name}"${port ? ` on port ${port}` : ""}.` };
}

async function applyServiceUpdate(
  projectId: string,
  change:    MigrationApplyChange,
  report:    EnrichedMigrationReport,
): Promise<MigrationApplyChangeResult> {
  const svc = report.suggestedServices.find((s) => s.slug === change.target);
  if (!svc) {
    return { id: change.id, ok: false, error: "Service definition not found.", summary: "Not found." };
  }

  const existing = await db.projectService.findUnique({
    where:  { projectId_slug: { projectId, slug: svc.slug } },
    select: { id: true, name: true },
  });
  if (!existing) {
    return { id: change.id, ok: false, error: `Service "${svc.slug}" not found.`, summary: "Not found." };
  }

  // Validate commands before updating
  for (const [field, cmd] of [
    ["installCommand", svc.installCommand],
    ["buildCommand",   svc.buildCommand],
    ["startCommand",   svc.startCommand],
  ] as [string, string | undefined][]) {
    if (cmd) {
      const r = validateServiceCommand(cmd);
      if (!r.ok) return { id: change.id, ok: false, error: `${field}: ${r.error}`, summary: r.error };
    }
  }

  await db.projectService.update({
    where: { id: existing.id },
    data: {
      installCommand:  svc.installCommand  ?? undefined,
      buildCommand:    svc.buildCommand    ?? undefined,
      startCommand:    svc.startCommand    ?? undefined,
      healthPath:      svc.healthPath      ?? undefined,
      staticOutputDir: svc.staticOutputDir ?? undefined,
      spaFallback:     svc.spaFallback     ?? undefined,
    },
  });

  return { id: change.id, ok: true, summary: `Updated service "${svc.name}".` };
}

async function applyEnvPlaceholder(
  projectId: string,
  change:    MigrationApplyChange,
): Promise<MigrationApplyChangeResult> {
  const name = change.target;

  // Validate name
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return { id: change.id, ok: false, error: `Invalid env var name: ${name}`, summary: "Invalid name." };
  }

  // Check if already exists
  const existing = await db.projectEnvVar.findFirst({
    where:  { projectId, name, environment: "production" },
    select: { id: true },
  });
  if (existing) {
    return { id: change.id, ok: true, summary: `${name} already exists — skipped.` };
  }

  // Create placeholder — value is empty string (encrypted empty value)
  // Use env-manager to encrypt the placeholder
  const { encryptEnvValue, isLikelySecret } = await import("@/lib/projects/env-manager");
  const encryptedEmpty = encryptEnvValue("");

  await db.projectEnvVar.create({
    data: {
      projectId,
      name,
      value:       encryptedEmpty,
      isSecret:    isLikelySecret(name),
      isEnabled:   false, // disabled until user fills it in
      environment: "production",
      description: (change.description?.slice(0, 200) ?? null) ||
                   "Detected by migration wizard — set value before deploying",
      source:      "import",
      required:    true,
    },
  });

  return { id: change.id, ok: true, summary: `Created placeholder for ${name} in Secrets Vault.` };
}

async function applyBackup(
  projectId: string,
  change:    MigrationApplyChange,
  actorUserId: string,
): Promise<MigrationApplyChangeResult & { backupRef?: string }> {
  try {
    const jobId = await createBackgroundJob({
      jobType:     "scheduled_backup",
      scopeType:   "project",
      projectId,
      title:       "Pre-migration backup",
      description: "Backup queued by migration apply wizard",
      metadata:    { projectId, label: "pre-migration", backupType: "manual", triggeredBy: "migration_apply" },
      maxAttempts: 1,
      priority:    5,
    });
    return { id: change.id, ok: true, summary: `Pre-migration backup queued (job ${jobId}).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { id: change.id, ok: false, error: msg, summary: `Backup queue failed: ${msg}` };
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function applyMigrationPlan(
  input: ApplyMigrationPlanInput,
): Promise<MigrationApplyResult & { error?: string }> {
  const { projectId, changeIds, confirmationText, actorUserId } = input;

  if (!changeIds || changeIds.length === 0) {
    return { ok: false, appliedCount: 0, skippedCount: 0, errorCount: 0, results: [], error: "No changes selected." };
  }
  if (changeIds.length > 50) {
    return { ok: false, appliedCount: 0, skippedCount: 0, errorCount: 0, results: [], error: "Too many changes (max 50)." };
  }

  // Re-generate plan server-side — never trust client-supplied plan data
  const ctx = await regeneratePlan(projectId);
  if (!ctx) {
    return { ok: false, appliedCount: 0, skippedCount: 0, errorCount: 0, results: [], error: "Could not regenerate plan. Run analysis first." };
  }

  const { plan, report } = ctx;

  // Filter to selected + valid changes
  const selected = plan.changes.filter((c) => changeIds.includes(c.id));
  if (selected.length === 0) {
    return { ok: false, appliedCount: 0, skippedCount: 0, errorCount: 0, results: [], error: "None of the selected change IDs were found in the regenerated plan." };
  }

  // If any selected change requires confirmation, check APPLY text
  const needsConfirmation = selected.some((c) => c.requiresConfirmation && !c.alreadyApplied);
  if (needsConfirmation && confirmationText !== "APPLY") {
    return {
      ok: false, appliedCount: 0, skippedCount: 0, errorCount: 0, results: [],
      error: 'One or more changes will overwrite existing settings. Type "APPLY" to confirm.',
    };
  }

  const results: MigrationApplyChangeResult[] = [];
  let appliedCount = 0, skippedCount = 0, errorCount = 0;
  let backupRef: string | undefined;
  const jobIds: string[] = [];

  for (const change of selected) {
    // Skip already applied items
    if (change.alreadyApplied) {
      results.push({ id: change.id, ok: true, summary: "Already applied — skipped." });
      skippedCount++;
      continue;
    }

    let result: MigrationApplyChangeResult;

    switch (change.type) {
      case "project_config":
      case "health_check":
        result = await applyProjectConfig(projectId, change);
        break;
      case "service_create":
        result = await applyServiceCreate(projectId, change, report);
        break;
      case "service_update":
        result = await applyServiceUpdate(projectId, change, report);
        break;
      case "env_placeholder":
        result = await applyEnvPlaceholder(projectId, change);
        break;
      case "backup": {
        const br = await applyBackup(projectId, change, actorUserId);
        if (br.backupRef) backupRef = br.backupRef;
        result = br;
        break;
      }
      default:
        result = { id: change.id, ok: true, summary: `${change.type} noted (informational only).` };
    }

    results.push(result);
    if (result.ok) appliedCount++;
    else errorCount++;
  }

  // Write aggregate audit event
  void writeProjectAuditEvent({
    projectId,
    actorUserId,
    actorRole:   "owner",
    action:      errorCount === 0 ? "migration.apply_completed" : "migration.apply_failed",
    category:    "publishing",
    result:      errorCount === 0 ? "success" : "failed",
    summary:     `Migration apply: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors`,
    metadata:    {
      changeIds:    changeIds.slice(0, 20),
      appliedCount,
      skippedCount,
      errorCount,
    },
  }).catch(() => null);

  return {
    ok:           errorCount === 0,
    appliedCount,
    skippedCount,
    errorCount,
    results,
    backupRef,
    jobIds:       jobIds.length > 0 ? jobIds : undefined,
  };
}
