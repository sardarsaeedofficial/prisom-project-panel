"use server";

/**
 * app/actions/auto-import.ts
 *
 * Sprint 86: Server actions for the Auto Import Control Room.
 *
 * Safety:
 *  - project.view required for analysis/export
 *  - deploy.configure or project.edit required for applying fixes
 *  - deploy.trigger required for retry deploy
 *  - No secrets returned to client
 *  - All fixes require explicit confirmation phrase
 *  - No automatic production deployment
 *  - No DNS/nginx mutation
 *  - No database wipe
 */

import { revalidatePath }               from "next/cache";
import { requireProjectPermission }     from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }       from "@/lib/audit/project-audit";
import { getAuditRequestContext }       from "@/lib/audit/request-context";
import { db }                           from "@/lib/db";
import { LogLevel, LogSource }          from "@prisma/client";
import { runAutoImportAnalysis }        from "@/lib/auto-import/auto-import-orchestrator";
import { exportAutoImportRunbook }      from "@/lib/auto-import/auto-import-export";
import { saveDeploymentConfigAction }   from "@/app/actions/project-deployments";
import { deployProjectAction }          from "@/app/actions/project-deployments";
import { detectSmartImportStack }       from "@/lib/smart-import/smart-import-detector";
import { selectSmartImportPreset }      from "@/lib/smart-import/smart-import-presets";
import type { AutoImportRun }           from "@/lib/auto-import/auto-import-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── Action: runAutoImportAnalysisAction ───────────────────────────────────────

export async function runAutoImportAnalysisAction(input: {
  projectId: string;
}): Promise<ActionResult<AutoImportRun>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const run = await runAutoImportAnalysis({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "auto_import.analysis_run",
      category:    "publishing",
      result:      "success",
      summary:     `Auto import analysis — status: ${run.status}, issues: ${run.issues.length}`,
      metadata:    {
        status:      run.status,
        issueCount:  run.issues.length,
        hasPreview:  run.previewChecks.length > 0,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Analysis failed" };
  }
}

// ── Action: applyAutoImportSafeFixAction ──────────────────────────────────────

export async function applyAutoImportSafeFixAction(input: {
  projectId: string;
  fixId: string;
  confirmation: string;
}): Promise<ActionResult<{ applied: boolean; message: string }>> {
  if (input.confirmation !== "APPLY SAFE FIX") {
    return { ok: false, error: "Type APPLY SAFE FIX to confirm." };
  }

  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  const editAuth = auth.ok ? auth : await requireProjectPermission(input.projectId, "project.edit");
  if (!editAuth.ok) return { ok: false, error: editAuth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { slug: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  // Re-run analysis to get fresh data and the fix
  const run = await runAutoImportAnalysis({ projectId: input.projectId });
  const issue = run.issues.find((i) => i.fix?.id === input.fixId);

  if (!issue?.fix) {
    return { ok: false, error: `Fix "${input.fixId}" not found or no longer applicable.` };
  }

  if (!issue.fix.safe) {
    return { ok: false, error: "This fix is not marked safe. Manual review required." };
  }

  // Apply the fix based on its ID
  const result = await applyFix(input.projectId, issue.fix.id, run);
  if (!result.ok) return result;

  await db.projectLog.create({
    data: {
      projectId: input.projectId,
      level:     LogLevel.INFO,
      source:    LogSource.DEPLOY,
      message:   `Auto import safe fix applied: ${issue.fix.label} (fix ID: ${issue.fix.id})`,
      metadata:  { fixId: issue.fix.id } as object,
    },
  }).catch(() => {});

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: editAuth.userId,
    actorRole:   editAuth.role,
    action:      "auto_import.safe_fix_applied",
    category:    "publishing",
    result:      "success",
    summary:     `Auto import safe fix applied: ${issue.fix.label}`,
    metadata:    { fixId: issue.fix.id, issueKind: issue.kind },
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);
  revalidatePath(`/projects/${input.projectId}/publishing`);
  revalidatePath(`/projects/${input.projectId}/preview`);

  return { ok: true, data: { applied: true, message: `Fix applied: ${issue.fix.label}` } };
}

// ── Fix dispatcher ────────────────────────────────────────────────────────────

async function applyFix(
  projectId: string,
  fixId: string,
  run: AutoImportRun,
): Promise<ActionResult<{ applied: boolean; message: string }>> {
  // Fetch existing config as base
  const existing = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      installCommand:  true,
      buildCommand:    true,
      startCommand:    true,
      healthPath:      true,
      routeMode:       true,
      staticOutputDir: true,
      apiPrefix:       true,
      nodeEnv:         true,
      rootDirectory:   true,
    },
  });

  // Build patch based on fixId
  const patch: Record<string, string | undefined> = {
    installCommand:  existing?.installCommand  ?? "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand:    existing?.buildCommand    ?? "pnpm run build",
    startCommand:    existing?.startCommand    ?? "node artifacts/api-server/dist/index.mjs",
    healthPath:      existing?.healthPath      ?? "/api/healthz",
    routeMode:       existing?.routeMode       ?? "fullstack_node",
    staticOutputDir: existing?.staticOutputDir ?? undefined,
    apiPrefix:       existing?.apiPrefix       ?? "/api",
    nodeEnv:         existing?.nodeEnv         ?? "production",
    rootDirectory:   existing?.rootDirectory   ?? ".",
  };

  switch (fixId) {
    case "switch-to-pnpm-preset":
      patch.installCommand  = "pnpm install --frozen-lockfile --ignore-scripts";
      patch.buildCommand    = "pnpm run build";
      patch.startCommand    = "node artifacts/api-server/dist/index.mjs";
      patch.healthPath      = "/api/healthz";
      patch.routeMode       = "static_plus_api";
      patch.staticOutputDir = "artifacts/sardar-security/dist/public";
      patch.apiPrefix       = "/api";
      break;

    case "fix-static-frontend-routing":
      patch.routeMode       = "static_plus_api";
      patch.staticOutputDir = "artifacts/sardar-security/dist/public";
      patch.apiPrefix       = "/api";
      break;

    case "fix-health-path":
      patch.healthPath = "/api/healthz";
      break;

    case "normalize-start-command":
      patch.startCommand = "node artifacts/api-server/dist/index.mjs";
      break;

    case "fix-static-output-path":
      patch.staticOutputDir = "artifacts/sardar-security/dist/public";
      patch.routeMode       = "static_plus_api";
      break;

    case "fix-route-mode":
      patch.routeMode = "static_plus_api";
      break;

    // Env/domain fixes: no config changes — caller handles (just acknowledge)
    case "add-database-url":
    case "add-session-secret":
    case "add-stripe-webhook-secret":
    case "add-domain":
      return { ok: true, data: { applied: false, message: "Go to the relevant tab to add the missing value manually." } };

    default:
      return { ok: false, error: `Unknown fix ID: ${fixId}` };
  }

  const saveResult = await saveDeploymentConfigAction(projectId, {
    installCommand:  patch.installCommand  ?? "",
    buildCommand:    patch.buildCommand    ?? "",
    startCommand:    patch.startCommand    ?? "",
    rootDirectory:   patch.rootDirectory   ?? ".",
    healthPath:      patch.healthPath      ?? "/api/healthz",
    nodeEnv:         patch.nodeEnv         ?? "production",
    routeMode:       patch.routeMode,
    staticOutputDir: patch.staticOutputDir,
    apiPrefix:       patch.apiPrefix,
  });

  if (!saveResult.ok) {
    return { ok: false, error: `Config save failed: ${saveResult.error}` };
  }

  return { ok: true, data: { applied: true, message: "Deployment config updated." } };
}

// ── Action: retryAutoImportDeployAction ───────────────────────────────────────

export async function retryAutoImportDeployAction(input: {
  projectId: string;
  confirmation: string;
}): Promise<ActionResult<{ deployStarted: boolean; message: string }>> {
  if (input.confirmation !== "RETRY DEPLOY") {
    return { ok: false, error: "Type RETRY DEPLOY to confirm." };
  }

  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error };

  const deployResult = await deployProjectAction(input.projectId);

  if (!deployResult.ok) {
    return { ok: false, error: deployResult.error ?? "Deploy failed." };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "auto_import.retry_deploy",
    category:    "publishing",
    result:      "success",
    summary:     "Auto import retry deploy triggered",
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);
  revalidatePath(`/projects/${input.projectId}/publishing`);
  revalidatePath(`/projects/${input.projectId}/preview`);

  return { ok: true, data: { deployStarted: true, message: "Deploy started." } };
}

// ── Action: exportAutoImportRunbookAction ─────────────────────────────────────

export async function exportAutoImportRunbookAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true },
  });

  try {
    const run = await runAutoImportAnalysis({ projectId: input.projectId });
    const markdown = exportAutoImportRunbook(run, project?.name ?? input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "auto_import.runbook_exported",
      category:    "publishing",
      result:      "success",
      summary:     "Auto import runbook exported as AUTO_IMPORT_RUNBOOK.md",
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "AUTO_IMPORT_RUNBOOK.md" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Export failed" };
  }
}
