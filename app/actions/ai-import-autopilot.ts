"use server";

/**
 * app/actions/ai-import-autopilot.ts
 *
 * Sprint 88: Server actions for the AI Import Autopilot panel.
 *
 * Safety:
 *  - project.view required for export
 *  - project.edit required for saving secret inputs
 *  - deploy.trigger required (fallback: project.edit) for running the autopilot loop,
 *    since it may deploy/redeploy the project as part of the safe-fix cycle
 *  - No secret values returned to the client
 *  - Only safe-fix-allowlisted config changes are applied automatically — no DB wipe,
 *    no DNS mutation, no public domain publishing, no other PM2 process touched
 *  - No automatic go-live
 */

import { revalidatePath }                  from "next/cache";
import { requireProjectPermission }        from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }          from "@/lib/audit/project-audit";
import { getAuditRequestContext }          from "@/lib/audit/request-context";
import { db }                              from "@/lib/db";
import { getProjectByIdForImport }         from "@/lib/projects/project-lookup-fallback";
import { runAiImportAutopilot }            from "@/lib/ai-import-autopilot/ai-import-autopilot-orchestrator";
import { exportAiImportAutopilotRunbook }  from "@/lib/ai-import-autopilot/ai-import-autopilot-export";
import { upsertEnvVarAction }              from "@/app/actions/project-envvars";
import type { AiImportAutopilotRun }       from "@/lib/ai-import-autopilot/ai-import-autopilot-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

async function deployOrEditAuth(projectId: string) {
  const deploy = await requireProjectPermission(projectId, "deploy.trigger");
  if (deploy.ok) return deploy;
  return requireProjectPermission(projectId, "project.edit");
}

/**
 * Checks the project exists via a direct DB read BEFORE the workspace/session
 * permission check. This guarantees a genuine permission failure (project
 * exists, user lacks access) is never reported to the client as the
 * misleading "Project not found." — those are different problems.
 */
async function assertProjectExists(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProjectByIdForImport(projectId);
  if (!project) return { ok: false, error: "Project not found." };
  return { ok: true };
}

// ── Action: runAiImportAutopilotAction ────────────────────────────────────────

export async function runAiImportAutopilotAction(input: {
  projectId: string;
}): Promise<ActionResult<AiImportAutopilotRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const run = await runAiImportAutopilot({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_autopilot.run",
      category:    "publishing",
      result:      "success",
      summary:     `AI import autopilot run — state: ${run.state}, fixes applied: ${run.safeFixesApplied.length}`,
      metadata:    {
        state: run.state,
        fixesApplied: run.safeFixesApplied.map((f) => f.id),
        attempts: run.hiddenTechnicalDetails.fixAttempts,
      },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    revalidatePath(`/projects/${input.projectId}/publishing`);
    revalidatePath(`/projects/${input.projectId}/preview`);

    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Autopilot run failed" };
  }
}

// ── Action: saveAutopilotInputsAction ─────────────────────────────────────────

export async function saveAutopilotInputsAction(input: {
  projectId: string;
  values: Record<string, string>;
}): Promise<ActionResult<AiImportAutopilotRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.edit");
  if (!auth.ok) return { ok: false, error: auth.error };

  const savedNames: string[] = [];
  const errors: string[]     = [];

  for (const [name, value] of Object.entries(input.values)) {
    if (!value.trim()) continue;
    if (name === "PUBLIC_DOMAIN") continue; // handled via domain management

    const result = await upsertEnvVarAction(
      input.projectId,
      name,
      value,
      "production",
      undefined,
      { source: "ai_import_autopilot", required: true },
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
    action:      "ai_import_autopilot.inputs_saved",
    category:    "publishing",
    result:      "success",
    summary:     `AI import autopilot: saved env var names: ${savedNames.join(", ")} (values encrypted)`,
    metadata:    { savedNames },
    ...ctx,
  }).catch(() => null);

  revalidatePath(`/projects/${input.projectId}/import`);

  // Continue automatically — re-run the autopilot loop now that values are saved.
  try {
    const run = await runAiImportAutopilot({ projectId: input.projectId });
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Could not continue after saving values" };
  }
}

// ── Action: approveAutopilotFixAction ─────────────────────────────────────────
// Resumes the autopilot loop after a needs_manual_approval stop. Requires explicit
// confirmation since the autopilot stopped specifically because automatic retries
// were exhausted or a check needs human review.

export async function approveAutopilotFixAction(input: {
  projectId: string;
  confirmation: string;
}): Promise<ActionResult<AiImportAutopilotRun>> {
  if (input.confirmation !== "I APPROVE") {
    return { ok: false, error: "Type I APPROVE to confirm." };
  }

  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const run = await runAiImportAutopilot({ projectId: input.projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_autopilot.approved_and_resumed",
      category:    "publishing",
      result:      "success",
      summary:     `AI import autopilot resumed after manual approval — state: ${run.state}`,
      metadata:    { state: run.state },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);

    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Resume failed" };
  }
}

// ── Action: exportAiImportAutopilotRunbookAction ──────────────────────────────

export async function exportAiImportAutopilotRunbookAction(input: {
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
    const run      = await runAiImportAutopilot({ projectId: input.projectId });
    const markdown = exportAiImportAutopilotRunbook(run, project?.name ?? input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_autopilot.runbook_exported",
      category:    "publishing",
      result:      "success",
      summary:     "AI import autopilot runbook exported as AI_IMPORT_AUTOPILOT_RUNBOOK.md",
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "AI_IMPORT_AUTOPILOT_RUNBOOK.md" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Export failed" };
  }
}
