"use server";

/**
 * app/actions/smart-import.ts
 *
 * Sprint 85: Server actions for the Smart Import wizard.
 *
 * Safety:
 *  - project.view required for report/checks/export
 *  - deploy.trigger or project.edit required for applying preset
 *  - No secrets returned to client
 *  - No automatic production deployment triggered
 *  - No DNS/nginx mutation
 *  - No PM2 restart beyond normal deploy flow
 */

import { revalidatePath } from "next/cache";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { LogLevel, LogSource }      from "@prisma/client";
import { generateSmartImportReport } from "@/lib/smart-import/smart-import-service";
import { runSmartPreviewChecks }     from "@/lib/smart-import/smart-preview-checks";
import { exportSmartImportMarkdown } from "@/lib/smart-import/smart-import-export";
import { selectSmartImportPreset }   from "@/lib/smart-import/smart-import-presets";
import { detectSmartImportStack }    from "@/lib/smart-import/smart-import-detector";
import { saveDeploymentConfigAction } from "@/app/actions/project-deployments";
import type { SmartImportReport }     from "@/lib/smart-import/smart-import-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── Action: generateSmartImportReportAction ───────────────────────────────────

export async function generateSmartImportReportAction(input: {
  projectId: string;
}): Promise<ActionResult<SmartImportReport>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const report = await generateSmartImportReport({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "smart_import.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Smart import report generated — preset: ${report.selectedPreset?.id ?? "none"}, blockers: ${report.blockers.length}`,
      metadata:    {
        presetId:    report.selectedPreset?.id,
        confidence:  report.selectedPreset?.confidence,
        blockers:    report.blockers.length,
        warnings:    report.warnings.length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Failed to generate report" };
  }
}

// ── Action: applySmartImportPresetAction ──────────────────────────────────────

/**
 * Detects the recommended preset for the project and saves it as the deployment
 * config. Validates all commands through validateAndParseCommand allowlist.
 * Does NOT trigger a deployment — caller must go to Publishing to deploy.
 */
export async function applySmartImportPresetAction(input: {
  projectId: string;
}): Promise<ActionResult<{ presetId: string; presetLabel: string }>> {
  // Require deploy.trigger; fall back to project.edit for project owners
  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  const editAuth = auth.ok ? auth : await requireProjectPermission(input.projectId, "project.edit");
  if (!editAuth.ok) return { ok: false, error: editAuth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { slug: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  // Detect stack and select preset
  const stack = await detectSmartImportStack({ projectId: input.projectId, slug: project.slug });
  const preset = selectSmartImportPreset({ detectedStack: stack });

  // Save via the validated config action (all commands pass through allowlist)
  const saveResult = await saveDeploymentConfigAction(input.projectId, {
    installCommand:  preset.installCommand,
    buildCommand:    preset.buildCommand,
    startCommand:    preset.startCommand || "node server.js",
    rootDirectory:   ".",
    healthPath:      preset.healthPath,
    nodeEnv:         "production",
    routeMode:       preset.routeMode,
    staticOutputDir: preset.staticOutputPath,
    apiPrefix:       preset.apiPrefix,
  });

  if (!saveResult.ok) {
    return { ok: false, error: `Preset validation failed: ${saveResult.error}` };
  }

  // Log
  await db.projectLog.create({
    data: {
      projectId: input.projectId,
      level:     LogLevel.INFO,
      source:    LogSource.DEPLOY,
      message:   `Smart import preset applied: ${preset.label} (${preset.confidence} confidence)`,
      metadata:  { presetId: preset.id, routeMode: preset.routeMode } as object,
    },
  }).catch(() => {});

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: editAuth.userId,
    actorRole:   editAuth.role,
    action:      "smart_import.preset_applied",
    category:    "publishing",
    result:      "success",
    summary:     `Smart import preset applied: ${preset.label}`,
    metadata:    {
      presetId:        preset.id,
      confidence:      preset.confidence,
      routeMode:       preset.routeMode,
      staticOutputPath: preset.staticOutputPath,
    },
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);
  revalidatePath(`/projects/${input.projectId}/publishing`);

  return { ok: true, data: { presetId: preset.id, presetLabel: preset.label } };
}

// ── Action: runSmartPreviewChecksAction ───────────────────────────────────────

export async function runSmartPreviewChecksAction(input: {
  projectId: string;
}): Promise<ActionResult<SmartImportReport["previewChecks"]>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const checks = await runSmartPreviewChecks({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "smart_import.preview_checked",
      category:    "publishing",
      result:      checks.every((c) => c.status === "passed") ? "success" : "failed",
      summary:     `Smart preview checks: ${checks.filter((c) => c.status === "passed").length}/${checks.length} passed`,
      metadata:    { checkCount: checks.length, passed: checks.filter((c) => c.status === "passed").length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: checks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Preview checks failed" };
  }
}

// ── Action: exportSmartImportReportAction ─────────────────────────────────────

export async function exportSmartImportReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true },
  });

  try {
    const report = await generateSmartImportReport({ projectId: input.projectId });
    const markdown = exportSmartImportMarkdown(report, project?.name ?? input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "smart_import.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     "Smart import report exported as SMART_IMPORT_REPORT.md",
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "SMART_IMPORT_REPORT.md" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Export failed" };
  }
}
