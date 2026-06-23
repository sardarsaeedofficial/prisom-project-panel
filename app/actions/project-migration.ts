"use server";

/**
 * app/actions/project-migration.ts
 *
 * Sprint 24: Server actions for the Replit Migration Assistant.
 *
 * Safety rules:
 *  - Never returns secret values — only key names.
 *  - Never reads .env files directly.
 *  - All file access goes through the migration analyzer (path-safe).
 *  - All service creation goes through Sprint 23 project-services actions
 *    (which validate commands, slugs, and paths).
 *  - Audit events include only sanitized metadata.
 */

import { db }                             from "@/lib/db";
import { requireProjectPermission }       from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }         from "@/lib/audit/project-audit";
import { getAuditRequestContext }         from "@/lib/audit/request-context";
import { analyzeReplitProject }           from "@/lib/migration/replit-project-analyzer";
import {
  createProjectServiceAction,
  type CreateServiceInput,
}                                         from "@/app/actions/project-services";
import type { ReplitMigrationReport, SuggestedProjectService } from "@/lib/migration/replit-detection-types";
import type { EnrichedMigrationReport, PersistedMigrationReport } from "@/lib/migration/replit-migration-types";
import { detectExternalServices }  from "@/lib/migration/external-service-detector";
import { generateManualSteps }     from "@/lib/migration/manual-steps-generator";
import { generateHandoffMarkdown } from "@/lib/migration/handoff-export";
import { createBackgroundJob }     from "@/lib/jobs/background-job-service";

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Analyze project ────────────────────────────────────────────────────────

export async function analyzeMigrationAction(
  projectId: string,
): Promise<ActionResult<EnrichedMigrationReport>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  let report: ReplitMigrationReport | null | undefined;
  try {
    report = await analyzeReplitProject(project.slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[migration] analyzeReplitProject error:", msg);
    return { ok: false, error: "Analysis failed. Check that the project has source files." };
  }

  if (!report) {
    return { ok: false, error: "Could not analyze project. Ensure source files exist under storage/projects." };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.analyzed",
    category:    "publishing",
    result:      "success",
    summary:     `Migration analysis completed (${report.filesScanned} files, ${report.risks.length} risks)`,
    metadata: {
      packageManager:       report.packageManager,
      isMonorepo:           report.isMonorepo,
      projectType:          report.projectType,
      detectedFrontend:     report.frontend?.framework ?? null,
      detectedBackend:      report.backend?.framework ?? null,
      databaseType:         report.database?.type ?? null,
      mediaProvider:        report.media?.provider ?? null,
      riskCount:            report.risks.length,
      blockerCount:         report.risks.filter((r) => r.severity === "blocker").length,
      replitDependencies:   report.replitDependencies.length,
      requiredSecretCount:  report.requiredSecrets.filter((s) => s.required).length,
      suggestedServiceCount: report.suggestedServices.length,
      filesScanned:         report.filesScanned,
    },
    ...ctx,
  }).catch(() => null);

  // Enrich with external services + manual steps
  const externalServices = detectExternalServices(report);
  const manualSteps      = generateManualSteps(report, externalServices);
  const blockers         = report.risks.filter((r) => r.severity === "blocker").length;
  const readinessStatus: "blocked" | "warnings" | "ready"  =
    blockers > 0
      ? "blocked"
      : report.risks.some((r) => r.severity === "warning") ? "warnings" : "ready";

  const enriched: EnrichedMigrationReport = {
    ...report,
    projectSlug:     project.slug,
    externalServices,
    manualSteps,
    applyActions:    [],
    readinessStatus,
  };

  // Persist the report (upsert: keep latest per project)
  try {
    await db.projectMigrationReport.create({
      data: {
        projectId:       projectId,
        sourceType:      "replit",
        status:          readinessStatus === "blocked" ? "blocked" : readinessStatus === "warnings" ? "draft" : "ready",
        reportJson:      enriched as object,
        createdByUserId: auth.userId,
      },
    });
  } catch { /* non-fatal — wizard still works without persistence */ }

  // Emit activity notifications for blockers
  if (blockers > 0) {
    try {
      const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
      await notifyProjectAdmins(projectId, {
        title:      "Migration scan: blockers found",
        body:       `${blockers} blocker(s) must be resolved before deployment.`,
        severity:   "warning",
        category:   "deployment",
        sourceType: "migration_report",
        href:       `/projects/${projectId}/migration`,
      });
    } catch { /* non-fatal */ }
  }

  return { ok: true, data: enriched };
}

// ── 2. Create services from migration recommendation ──────────────────────────

export type CreateServicesFromMigrationInput = {
  projectId: string;
  services:  SuggestedProjectService[];
};

export type CreateServicesResult = {
  created: number;
  skipped: number;
  errors:  Array<{ slug: string; error: string }>;
};

export async function createServicesFromMigrationAction(
  input: CreateServicesFromMigrationInput,
): Promise<ActionResult<CreateServicesResult>> {
  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (!input.services || input.services.length === 0) {
    return { ok: false, error: "No services provided." };
  }
  if (input.services.length > 10) {
    return { ok: false, error: "Too many services (max 10 per migration)." };
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ slug: string; error: string }> = [];

  for (const svc of input.services) {
    // Check if a service with this slug already exists
    const existing = await db.projectService.findFirst({
      where: { projectId: input.projectId, slug: svc.slug },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const createInput: CreateServiceInput = {
      projectId:       input.projectId,
      name:            svc.name,
      slug:            svc.slug,
      serviceType:     svc.serviceType,
      workingDir:      svc.workingDir      || undefined,
      packageManager:  svc.packageManager  || undefined,
      installCommand:  svc.installCommand  || undefined,
      buildCommand:    svc.buildCommand    || undefined,
      startCommand:    svc.startCommand    || undefined,
      internalPort:    svc.internalPort    ?? undefined,
      healthPath:      svc.healthPath      || undefined,
      staticOutputDir: svc.staticOutputDir || undefined,
      spaFallback:     svc.spaFallback     ?? false,
      isPrimary:       svc.isPrimary       ?? false,
      requiredEnvKeys: [],
    };

    const result = await createProjectServiceAction(createInput);
    if (result.ok) {
      created++;
    } else {
      errors.push({ slug: svc.slug, error: result.error });
    }
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.services_created",
    category:    "publishing",
    result:      errors.length === 0 ? "success" : "failed",
    summary:     `Migration services created: ${created} created, ${skipped} skipped, ${errors.length} errors`,
    metadata: {
      created,
      skipped,
      errorCount:  errors.length,
      serviceCount: input.services.length,
    },
    ...ctx,
  }).catch(() => null);

  return {
    ok:   true,
    data: { created, skipped, errors },
  };
}

// ── 3. Queue background migration scan ───────────────────────────────────────

export async function queueMigrationScanAction(
  projectId: string,
): Promise<ActionResult<{ jobId: string }>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const jobId = await createBackgroundJob({
      jobType:     "replit_migration_scan",
      scopeType:   "project",
      projectId,
      title:       "Replit Migration Scan",
      description: "Scan project source files and generate migration report",
      metadata:    { projectId },
      maxAttempts: 1,
      priority:    6,
    });
    return { ok: true, data: { jobId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to queue scan." };
  }
}

// ── 4. Get latest persisted migration report ──────────────────────────────────

export async function getLatestMigrationReportAction(
  projectId: string,
): Promise<ActionResult<PersistedMigrationReport | null>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const row = await db.projectMigrationReport.findFirst({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
  });

  if (!row) return { ok: true, data: null };

  return {
    ok:   true,
    data: {
      id:              row.id,
      projectId:       row.projectId,
      sourceType:      row.sourceType,
      status:          row.status,
      report:          row.reportJson as EnrichedMigrationReport,
      createdByUserId: row.createdByUserId,
      createdAt:       row.createdAt.toISOString(),
      updatedAt:       row.updatedAt.toISOString(),
    },
  };
}

// ── 5. Export migration handoff as Markdown ───────────────────────────────────

export async function exportHandoffMarkdownAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const row = await db.projectMigrationReport.findFirst({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    return { ok: false, error: "No migration report found. Run analysis first." };
  }

  const enriched  = row.reportJson as EnrichedMigrationReport;
  const markdown  = generateHandoffMarkdown(enriched);
  const slug      = enriched.projectSlug ?? projectId;
  const filename  = `migration-handoff-${slug}.md`;

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.handoff_exported",
    category:    "publishing",
    result:      "success",
    summary:     "Migration handoff Markdown exported",
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { markdown, filename } };
}

// ── 6. Apply deployment commands from migration analysis ──────────────────────

export async function applyMigrationCommandsAction(
  projectId: string,
  commands: {
    installCommand?: string;
    buildCommand?:   string;
    startCommand?:   string;
    port?:           number;
  },
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // Only update fields that were provided and are non-empty
  const update: Record<string, string | number> = {};
  if (commands.installCommand?.trim()) update.installCommand = commands.installCommand.trim();
  if (commands.buildCommand?.trim())   update.buildCommand   = commands.buildCommand.trim();
  if (commands.startCommand?.trim())   update.startCommand   = commands.startCommand.trim();
  if (commands.port && commands.port > 0 && commands.port < 65536) {
    update.port = commands.port;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "No commands to apply." };
  }

  const existing = await db.projectDeploymentConfig.findUnique({ where: { projectId } });
  if (!existing) {
    return { ok: false, error: "No deployment config exists. Set up deployment first." };
  }

  await db.projectDeploymentConfig.update({
    where: { projectId },
    data:  update,
  });

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.commands_applied",
    category:    "publishing",
    result:      "success",
    summary:     `Applied migration commands: ${Object.keys(update).join(", ")}`,
    metadata:    update,
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 7. Add missing env vars as placeholder secrets ────────────────────────────

export async function addMissingEnvVarsAction(
  projectId: string,
  keys:      string[],
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (keys.length === 0) return { ok: true, data: { added: 0, skipped: 0 } };
  if (keys.length > 50) return { ok: false, error: "Too many keys (max 50)." };

  // Only allow valid env var names
  const VALID_KEY = /^[A-Z_][A-Z0-9_]*$/;
  const safeKeys  = keys.filter((k) => VALID_KEY.test(k) && k.length <= 80);
  if (safeKeys.length === 0) return { ok: false, error: "No valid env var names provided." };

  let added = 0, skipped = 0;
  for (const varName of safeKeys) {
    const existing = await db.projectEnvVar.findFirst({
      where: { projectId, name: varName },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    await db.projectEnvVar.create({
      data: {
        projectId,
        name:        varName,
        value:       "",
        isSecret:    true,
        description: "Detected by migration wizard — set value before deploying",
        source:      "import",
      },
    });
    added++;
  }

  return { ok: true, data: { added, skipped } };
}

// ── 8. Record migration report copied ────────────────────────────────────────

export async function recordMigrationReportCopiedAction(
  projectId: string,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.migration.report_copied",
    category:    "publishing",
    result:      "success",
    summary:     "Migration report copied to clipboard",
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}
