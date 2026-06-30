"use server";

/**
 * app/actions/ai-import-operator.ts
 *
 * Sprint 87: Server actions for the AI Import Operator panel.
 *
 * Safety:
 *  - project.view required for analysis/export
 *  - project.edit required for saving user inputs (env vars)
 *  - deploy.trigger required for fix and retry (fallback: project.edit)
 *  - No secret values returned to client
 *  - All fixes require APPLY FIX or RETRY DEPLOY confirmation
 *  - No automatic go-live
 *  - No DNS mutation
 *  - No database wipe
 */

import { revalidatePath }                 from "next/cache";
import { requireProjectPermission }       from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }         from "@/lib/audit/project-audit";
import { getAuditRequestContext }         from "@/lib/audit/request-context";
import { db }                             from "@/lib/db";
import { getProjectByIdForImport }        from "@/lib/projects/project-lookup-fallback";
import { generateAiImportOperatorRun }    from "@/lib/ai-import-operator/ai-import-operator-service";
import { executeAiImportFix }             from "@/lib/ai-import-operator/ai-import-fix-executor";
import { retryAiImportDeploy }            from "@/lib/ai-import-operator/ai-import-retry-deploy";
import { exportAiImportOperatorRunbook }  from "@/lib/ai-import-operator/ai-import-operator-export";
import { upsertEnvVarAction }             from "@/app/actions/project-envvars";
import type { AiImportOperatorRun }       from "@/lib/ai-import-operator/ai-import-operator-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

/**
 * Checks the project exists via a direct DB read BEFORE the workspace/session
 * permission check, so a genuine permission failure is never reported to the
 * client as the misleading "Project not found." — see lib/projects/project-lookup-fallback.ts.
 */
async function assertProjectExists(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProjectByIdForImport(projectId);
  if (!project) return { ok: false, error: "Project not found." };
  return { ok: true };
}

// ── Action: generateAiImportOperatorRunAction ─────────────────────────────────

export async function generateAiImportOperatorRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AiImportOperatorRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const run = await generateAiImportOperatorRun({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_operator.analyzed",
      category:    "publishing",
      result:      "success",
      summary:     `AI import operator analyzed — status: ${run.status}`,
      metadata:    { status: run.status, inputsNeeded: run.userInputsNeeded.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Analysis failed" };
  }
}

// ── Action: saveAiImportUserInputsAction ──────────────────────────────────────

export async function saveAiImportUserInputsAction(input: {
  projectId: string;
  values: Record<string, string>;
}): Promise<ActionResult<AiImportOperatorRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.edit");
  if (!auth.ok) return { ok: false, error: auth.error };

  const savedNames: string[] = [];
  const errors: string[]     = [];

  for (const [name, value] of Object.entries(input.values)) {
    if (!value.trim()) continue;

    // Skip domain — handled separately via domain management
    if (name === "PUBLIC_DOMAIN") continue;

    const result = await upsertEnvVarAction(
      input.projectId,
      name,
      value,
      "production",
      undefined,
      { source: "ai_import_operator", required: true },
    );

    if (result.ok) {
      savedNames.push(name);
    } else {
      errors.push(`${name}: ${result.error}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "ai_import_operator.inputs_saved",
    category:    "publishing",
    result:      "success",
    summary:     `AI import operator: saved env var names: ${savedNames.join(", ")} (values encrypted)`,
    metadata:    { savedNames },
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);

  try {
    const run = await generateAiImportOperatorRun({ projectId: input.projectId });
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Could not reload run after save" };
  }
}

// ── Action: executeAiImportFixAction ─────────────────────────────────────────

export async function executeAiImportFixAction(input: {
  projectId: string;
  fixId: string;
  confirmation: string;
}): Promise<ActionResult<AiImportOperatorRun>> {
  if (input.confirmation !== "APPLY FIX") {
    return { ok: false, error: "Type APPLY FIX to confirm." };
  }

  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  const editAuth = auth.ok ? auth : await requireProjectPermission(input.projectId, "project.edit");
  if (!editAuth.ok) return { ok: false, error: editAuth.error };

  const result = await executeAiImportFix({
    projectId:    input.projectId,
    fixId:        input.fixId,
    confirmation: input.confirmation,
  });

  if (!result.ok) return { ok: false, error: result.error };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: editAuth.userId,
    actorRole:   editAuth.role,
    action:      "ai_import_operator.fix_applied",
    category:    "publishing",
    result:      "success",
    summary:     `AI import operator: fix applied — ${input.fixId}`,
    metadata:    { fixId: input.fixId },
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);
  revalidatePath(`/projects/${input.projectId}/publishing`);

  return { ok: true, data: result.run };
}

// ── Action: retryAiImportDeployAction ────────────────────────────────────────

export async function retryAiImportDeployAction(input: {
  projectId: string;
  confirmation: string;
}): Promise<ActionResult<{ run: AiImportOperatorRun; deployStarted: boolean }>> {
  if (input.confirmation !== "RETRY DEPLOY") {
    return { ok: false, error: "Type RETRY DEPLOY to confirm." };
  }

  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await retryAiImportDeploy({
    projectId:    input.projectId,
    confirmation: input.confirmation,
  });

  if (!result.ok) return { ok: false, error: result.error };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId:   input.projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "ai_import_operator.deploy_retried",
    category:    "publishing",
    result:      "success",
    summary:     "AI import operator: deploy retried",
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);
  revalidatePath(`/projects/${input.projectId}/publishing`);
  revalidatePath(`/projects/${input.projectId}/preview`);

  return { ok: true, data: { run: result.run, deployStarted: result.deployStarted } };
}

// ── Action: exportAiImportOperatorRunbookAction ───────────────────────────────

export async function exportAiImportOperatorRunbookAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true },
  });

  try {
    const run      = await generateAiImportOperatorRun({ projectId: input.projectId });
    const markdown = exportAiImportOperatorRunbook(run, project?.name ?? input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_operator.runbook_exported",
      category:    "publishing",
      result:      "success",
      summary:     "AI import operator runbook exported as AI_IMPORT_OPERATOR_RUNBOOK.md",
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "AI_IMPORT_OPERATOR_RUNBOOK.md" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Export failed" };
  }
}
