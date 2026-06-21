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

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Analyze project ────────────────────────────────────────────────────────

export async function analyzeMigrationAction(
  projectId: string,
): Promise<ActionResult<ReplitMigrationReport>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  let report: ReplitMigrationReport | null;
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

  return { ok: true, data: report };
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

// ── 3. Record migration report copied ────────────────────────────────────────

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
