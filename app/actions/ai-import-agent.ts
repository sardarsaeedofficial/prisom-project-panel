"use server";

/**
 * app/actions/ai-import-agent.ts
 *
 * Sprint 89: Server actions + orchestrator for the Live AI Import Agent Console.
 * Sprint 90: Chat messages woven into every orchestration step so the agent
 *            chat column in the console fills in live as each phase runs.
 *
 * Architecture note on "live" updates: there is no background worker in this
 * app. startAiImportAgentRunAction runs the whole analyze → preset → deploy →
 * verify sequence in one call, but persists the run to ProjectOperation.meta
 * after EVERY step (see agent-run-store.ts). Node serves requests concurrently
 * on its event loop, so a separate poll (getAiImportAgentRunAction) arriving
 * while the start action is still mid-flight reads freshly-written DB state —
 * this is what makes the timeline feel live without a real job queue.
 *
 * Safety:
 *  - project.view required for polling/export
 *  - deploy.trigger required (fallback: project.edit) for start/fix/retry,
 *    since these may deploy/redeploy the project
 *  - No secret values returned to the client
 *  - Only safe-fix-allowlisted config changes are applied automatically
 *  - No automatic go-live, no DNS mutation, no DB wipe
 *  - Only this project's PM2 process is ever touched (via existing deployProjectAction)
 */

import { revalidatePath }              from "next/cache";
import { requireProjectPermission }    from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }      from "@/lib/audit/project-audit";
import { getAuditRequestContext }      from "@/lib/audit/request-context";
import { db }                          from "@/lib/db";
import { getProjectByIdForImport }     from "@/lib/projects/project-lookup-fallback";
import { runAutoImportAnalysis }       from "@/lib/auto-import/auto-import-orchestrator";
import {
  getOrCreateAgentRun,
  getLatestAgentRun,
  saveAgentRun,
  logAgentStep,
}                                       from "@/lib/ai-import-agent/agent-run-store";
import {
  beginStep,
  addCompletedStep,
  completeStep,
  setRunError,
  clearRunError,
  setRunStatus,
  previewOutput,
  appendChatMessage,
  getAgentFixStartMessage,
}                                       from "@/lib/ai-import-agent/agent-step-builder";
import { runAgentDeploy }              from "@/lib/ai-import-agent/agent-command-runner";
import { checkAgentPreview }           from "@/lib/ai-import-agent/agent-preview-checker";
import { applyAgentFix }               from "@/lib/ai-import-agent/agent-fix-runner";
import {
  classifyAgentErrorOrFallback,
  classifyPreviewChecks,
}                                       from "@/lib/ai-import-agent/agent-error-classifier";
import { exportAiImportAgentRunbook }  from "@/lib/ai-import-agent/agent-run-export";
import type { AgentRun }               from "@/lib/ai-import-agent/agent-run-types";
import type { AgentPreviewResult }     from "@/lib/ai-import-agent/agent-preview-checker";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

async function assertProjectExists(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getProjectByIdForImport(projectId);
  if (!project) return { ok: false, error: "Project not found." };
  return { ok: true };
}

async function deployOrEditAuth(projectId: string) {
  const deploy = await requireProjectPermission(projectId, "deploy.trigger");
  if (deploy.ok) return deploy;
  return requireProjectPermission(projectId, "project.edit");
}

// ── Persist + mirror helper ───────────────────────────────────────────────────

async function saveAndLog(run: AgentRun, projectId: string): Promise<void> {
  await saveAgentRun(run);
  const last = run.steps[run.steps.length - 1];
  if (last && last.status !== "running" && last.status !== "pending") {
    await logAgentStep(projectId, last);
  }
}

// ── Shared: classify a failed preview check ───────────────────────────────────
// Structural classification (comparing /api/healthz vs / vs /products) runs
// FIRST — it catches "API works, frontend doesn't" even when the proxy's HTML
// error page text doesn't match any single recognizable phrase. Falls back to
// text-pattern matching only when the structural check finds nothing (e.g.
// /api/healthz itself is also failing, which is a different problem).

function classifyPreviewFailure(preview: AgentPreviewResult) {
  const structural = classifyPreviewChecks(preview.checks, preview.staticOutputMissing);
  if (structural) return structural;

  const failingCheck = preview.checks.find((c) => c.status !== "success");
  const errText = preview.panelGateError ?? failingCheck?.summary ?? "Preview check failed.";
  return classifyAgentErrorOrFallback(errText, "Preview");
}

// ── Preview failure chat message ──────────────────────────────────────────────

function previewFailureChatMessage(kind: string, safeFixAvailable: boolean, whatHappened: string): string {
  if (kind === "frontend_static_not_served" || kind === "frontend_build_output_missing") {
    return "The API is healthy, but the storefront is returning 404. I can fix the frontend routing.";
  }
  if (kind === "panel_preview_proxy_db_unreachable") {
    return "The preview proxy hit an internal database issue. I can retry the preview check.";
  }
  return `Preview check failed: ${whatHappened}`;
}

// ── Shared: deploy + verify preview (used by initial run, fix, and retry) ────

async function runDeployAndPreview(run: AgentRun, projectId: string): Promise<AgentRun> {
  appendChatMessage(run, "I'm running the install, build, and PM2 start process now.", { tone: "thinking" });
  beginStep(run, "deploy", "Deploy", "Installing dependencies, building, and starting the app…");
  await saveAndLog(run, projectId);

  const deployResult = await runAgentDeploy(projectId);

  if (!deployResult.ok) {
    const errText = `${deployResult.output ?? ""}\n${deployResult.error ?? ""}`;
    const classified = classifyAgentErrorOrFallback(errText, "Deploy");
    appendChatMessage(run, `Deploy failed. ${classified.whatHappened}`, { tone: "error" });
    completeStep(run, "deploy", "error", deployResult.error || "Deploy failed", {
      errorMessage:   deployResult.error,
      fullOutput:     deployResult.output,
      outputPreview:  previewOutput(deployResult.output ?? ""),
      fixAvailable:   classified.safeFixAvailable,
      fixId:          classified.safeFixId,
    });
    setRunError(run, classified);
    setRunStatus(run, classified.safeFixAvailable ? "fix_available" : "failed", classified.whatHappened);
    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "Deploy completed successfully. Now I'll check the API and storefront preview.", { tone: "success" });
  completeStep(run, "deploy", "success", "Install, build, and PM2 start completed.", {
    fullOutput:    deployResult.output,
    outputPreview: previewOutput(deployResult.output ?? ""),
  });
  await saveAndLog(run, projectId);

  appendChatMessage(run, "I'll check the API and storefront preview now.", { tone: "thinking" });
  beginStep(run, "preview", "Checking preview", "Verifying API health and preview routes…");
  await saveAndLog(run, projectId);

  const preview = await checkAgentPreview({ projectId });
  run.previewUrl = preview.browserPreviewUrl;
  run.publicUrl  = preview.publicUrl;

  if (!preview.allPass) {
    const classified = classifyPreviewFailure(preview);
    const errText = preview.panelGateError
      ?? preview.checks.find((c) => c.status !== "success")?.summary
      ?? "Preview check failed.";
    appendChatMessage(
      run,
      previewFailureChatMessage(classified.kind, classified.safeFixAvailable, classified.whatHappened),
      { tone: classified.safeFixAvailable ? "warning" : "error" },
    );
    completeStep(run, "preview", "error", classified.whatHappened, {
      errorMessage: errText,
      fixAvailable: classified.safeFixAvailable,
      fixId:        classified.safeFixId,
    });
    run.steps.push(...preview.checks);
    setRunError(run, classified);
    setRunStatus(run, classified.safeFixAvailable ? "fix_available" : "failed", classified.whatHappened);
    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "The preview is live. The project is now working through the panel preview.", { tone: "success" });
  completeStep(run, "preview", "success", "All preview checks passed.");
  run.steps.push(...preview.checks);
  setRunStatus(
    run,
    "preview_live",
    preview.publicUrl
      ? `Preview is live at ${preview.publicUrl}.`
      : "Preview is live through the panel proxy. Add a public domain when ready.",
  );
  await saveAndLog(run, projectId);
  return run;
}

// ── Full run: analyze → ask → preset → deploy → verify ───────────────────────

async function runFullAgent(run: AgentRun, projectId: string): Promise<AgentRun> {
  appendChatMessage(run, "I'll read this project, detect the stack, run the correct commands, and verify the preview.", { tone: "thinking" });
  await saveAndLog(run, projectId);

  const project = await getProjectByIdForImport(projectId);
  if (!project) {
    appendChatMessage(run, "I couldn't find this project. It may have been deleted.", { tone: "error" });
    addCompletedStep(run, "project_found", "Project found", "error", "Project not found.", {
      errorMessage: "Project not found.",
    });
    setRunStatus(run, "failed", "Project not found.");
    await saveAndLog(run, projectId);
    return run;
  }
  addCompletedStep(run, "project_found", "Project found", "success", project.name);
  appendChatMessage(run, `I found the project: ${project.name}.`, { tone: "info" });
  await saveAndLog(run, projectId);

  const autoRun = await runAutoImportAnalysis({ projectId });

  if (autoRun.issues.some((i) => i.id === "no-source")) {
    appendChatMessage(run, "I can't find any source files for this project. Please upload a ZIP or connect a GitHub repository.", { tone: "error" });
    addCompletedStep(run, "source_found", "Source files found", "error", "No source uploaded yet.", {
      errorMessage: "Project source files not found.",
    });
    setRunStatus(run, "failed", "Project source files not found. Upload a ZIP or connect a GitHub repository to get started.");
    await saveAndLog(run, projectId);
    return run;
  }
  addCompletedStep(run, "source_found", "Source files found", "success", "Source files are present.");
  appendChatMessage(run, "The source files are present. I can inspect the app structure.", { tone: "info" });
  await saveAndLog(run, projectId);

  const stack = autoRun.detectedStack;
  const isSardar = stack.packageManager === "pnpm" && (stack.staticOutputPath?.includes("sardar-security") ?? false);
  addCompletedStep(
    run, "stack_detected", "Stack detected", "success",
    isSardar ? "pnpm workspace, Sardar ecommerce preset" : `${stack.packageManager} project, ${stack.framework.join(", ") || "unknown framework"}`,
  );
  if (isSardar) {
    appendChatMessage(run, "This looks like a pnpm workspace with an API service and a Vite storefront.", { tone: "info" });
  } else {
    appendChatMessage(
      run,
      `Detected a ${stack.packageManager} project${stack.framework.length ? " using " + stack.framework.join(", ") : ""}.`,
      { tone: "info" },
    );
  }
  await saveAndLog(run, projectId);

  if (isSardar) {
    addCompletedStep(run, "api_detected", "API detected", "success", "artifacts/api-server");
    appendChatMessage(run, "I found the API service in artifacts/api-server.", { tone: "info" });
    await saveAndLog(run, projectId);
    addCompletedStep(run, "frontend_detected", "Frontend detected", "success", "artifacts/sardar-security");
    appendChatMessage(run, "I found the storefront in artifacts/sardar-security.", { tone: "info" });
    await saveAndLog(run, projectId);
  }

  const missingRequired = autoRun.missingEnvNames.filter((e) => e.required);
  if (missingRequired.length > 0) {
    const names = missingRequired.map((e) => e.name).join(", ");
    addCompletedStep(run, "secrets_checked", "Required secrets checked", "warning", `Missing: ${names}`);
    appendChatMessage(run, `I need a few secret values before I can make this live: ${names}.`, { tone: "warning" });
    setRunStatus(run, "waiting_for_user", `I need ${missingRequired.length} missing secret${missingRequired.length > 1 ? "s" : ""} before I can deploy: ${names}.`);
    await saveAndLog(run, projectId);
    return run;
  }
  addCompletedStep(run, "secrets_checked", "Required secrets checked", "success", "All required secrets are configured.");
  appendChatMessage(run, "All required secrets are configured. I can continue.", { tone: "success" });
  await saveAndLog(run, projectId);

  if (autoRun.issues.some((i) => i.id === "no-deploy-config")) {
    appendChatMessage(run, "I'm applying the Sardar/Replit deployment preset so /api goes to the backend and the storefront serves from /.", { tone: "thinking" });
    beginStep(run, "preset_applied", "Deployment preset", "Applying the detected deployment preset…");
    await saveAndLog(run, projectId);
    const fixRes = await applyAgentFix({ projectId, fixId: "apply-sardar-preset" });
    if (!fixRes.ok) {
      appendChatMessage(run, `I couldn't apply the deployment preset: ${fixRes.error}`, { tone: "error" });
      completeStep(run, "preset_applied", "error", fixRes.error, { errorMessage: fixRes.error });
      setRunStatus(run, "failed", `I couldn't apply the deployment preset: ${fixRes.error}`);
      await saveAndLog(run, projectId);
      return run;
    }
    appendChatMessage(run, "Deployment preset applied. I can now run the install and build.", { tone: "success" });
    completeStep(run, "preset_applied", "success", fixRes.label);
  } else {
    addCompletedStep(run, "preset_applied", "Deployment preset", "success", "Using existing deployment config.");
    appendChatMessage(run, "Using the existing deployment configuration.", { tone: "info" });
  }
  await saveAndLog(run, projectId);

  return runDeployAndPreview(run, projectId);
}

// ── Resume from the failed step (retry) ──────────────────────────────────────

async function resumeAgent(run: AgentRun, projectId: string): Promise<AgentRun> {
  clearRunError(run);
  appendChatMessage(run, "I'm retrying from where I left off.", { tone: "thinking" });
  setRunStatus(run, "retrying", "Retrying…");
  await saveAndLog(run, projectId);

  if (run.currentStep === "preview") {
    appendChatMessage(run, "I'll recheck the preview now.", { tone: "thinking" });
    beginStep(run, "preview", "Checking preview", "Rechecking preview routes…");
    await saveAndLog(run, projectId);
    const preview = await checkAgentPreview({ projectId });
    run.previewUrl = preview.browserPreviewUrl;
    run.publicUrl  = preview.publicUrl;

    if (!preview.allPass) {
      const classified = classifyPreviewFailure(preview);
      const errText = preview.panelGateError
        ?? preview.checks.find((c) => c.status !== "success")?.summary
        ?? "Preview check failed.";
      appendChatMessage(
        run,
        previewFailureChatMessage(classified.kind, classified.safeFixAvailable, classified.whatHappened),
        { tone: classified.safeFixAvailable ? "warning" : "error" },
      );
      completeStep(run, "preview", "error", classified.whatHappened, {
        errorMessage: errText,
        fixAvailable: classified.safeFixAvailable,
        fixId:        classified.safeFixId,
      });
      run.steps.push(...preview.checks);
      setRunError(run, classified);
      setRunStatus(run, classified.safeFixAvailable ? "fix_available" : "failed", classified.whatHappened);
      await saveAndLog(run, projectId);
      return run;
    }

    appendChatMessage(run, "The preview is live. The project is now working through the panel preview.", { tone: "success" });
    completeStep(run, "preview", "success", "All preview checks passed.");
    run.steps.push(...preview.checks);
    setRunStatus(
      run, "preview_live",
      preview.publicUrl ? `Preview is live at ${preview.publicUrl}.` : "Preview is live through the panel proxy. Add a public domain when ready.",
    );
    await saveAndLog(run, projectId);
    return run;
  }

  // Any earlier failure (preset/deploy) — redeploy and reverify.
  return runDeployAndPreview(run, projectId);
}

// ── Action: startAiImportAgentRunAction ───────────────────────────────────────

export async function startAiImportAgentRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    let run = await getOrCreateAgentRun({ projectId: input.projectId, userId: auth.userId });

    // Only execute if this is a fresh run — avoid double-running a run that's
    // already mid-flight from a concurrent/duplicate click.
    if (run.steps.length === 0) {
      run = await runFullAgent(run, input.projectId);
    }

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.run",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent run — status: ${run.status}`,
      metadata:    { status: run.status, stepCount: run.steps.length },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    revalidatePath(`/projects/${input.projectId}/publishing`);
    revalidatePath(`/projects/${input.projectId}/preview`);

    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Agent run failed" };
  }
}

// ── Action: getAiImportAgentRunAction ─────────────────────────────────────────

export async function getAiImportAgentRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AgentRun | null>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const run = await getLatestAgentRun(input.projectId);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Could not load agent run" };
  }
}

// ── Action: fixAiImportAgentIssueAction ───────────────────────────────────────

export async function fixAiImportAgentIssueAction(input: {
  projectId: string;
  runId: string;
  fixId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found. Click Make Project Live first." };

  try {
    appendChatMessage(run, getAgentFixStartMessage(input.fixId), { tone: "thinking" });
    setRunStatus(run, "fixing", "Applying fix…");
    await saveAndLog(run, input.projectId);

    const fixRes = await applyAgentFix({ projectId: input.projectId, fixId: input.fixId });
    if (!fixRes.ok) {
      addCompletedStep(run, `fix-${input.fixId}`, "Fix attempt", "error", fixRes.error, { errorMessage: fixRes.error });
      if (fixRes.agentError) setRunError(run, fixRes.agentError);
      appendChatMessage(run, `I couldn't apply the fix: ${fixRes.error}`, { tone: "error" });
      setRunStatus(run, "fix_available", fixRes.error);
      await saveAndLog(run, input.projectId);
      return { ok: true, data: run };
    }

    addCompletedStep(run, `fix-${input.fixId}`, "Fix applied", "fixed", fixRes.label);
    appendChatMessage(run, "The fix was applied. I'll redeploy and check preview again.", { tone: "success" });
    clearRunError(run);
    await saveAndLog(run, input.projectId);

    // refresh_panel_pm2_env_and_retry_preview already retried preview itself —
    // use that result directly instead of redeploying. Every other fix
    // changes deployment config, so it needs a real redeploy + recheck.
    let finalRun: AgentRun;
    if (input.fixId === "refresh_panel_pm2_env_and_retry_preview" && fixRes.preview) {
      run.previewUrl = fixRes.preview.browserPreviewUrl;
      run.publicUrl  = fixRes.preview.publicUrl;
      run.steps.push(...fixRes.preview.checks);
      if (fixRes.preview.allPass) {
        appendChatMessage(run, "The preview is live. The project is now working through the panel preview.", { tone: "success" });
        setRunStatus(
          run, "preview_live",
          fixRes.preview.publicUrl
            ? `Preview is live at ${fixRes.preview.publicUrl}.`
            : "Preview is live through the panel proxy. Add a public domain when ready.",
        );
      } else {
        setRunStatus(run, "fix_available", "Preview is still not passing after the fix.");
      }
      await saveAndLog(run, input.projectId);
      finalRun = run;
    } else {
      finalRun = await runDeployAndPreview(run, input.projectId);
    }

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.fix_applied",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent: fix applied — ${input.fixId}`,
      metadata:    { fixId: input.fixId, resultStatus: finalRun.status },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    revalidatePath(`/projects/${input.projectId}/publishing`);
    revalidatePath(`/projects/${input.projectId}/preview`);

    return { ok: true, data: finalRun };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Fix failed" };
  }
}

// ── Action: retryAiImportAgentRunAction ───────────────────────────────────────

export async function retryAiImportAgentRunAction(input: {
  projectId: string;
  runId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found. Click Make Project Live first." };

  try {
    const finalRun = await resumeAgent(run, input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.retried",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent retried from step: ${run.currentStep} — result: ${finalRun.status}`,
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    revalidatePath(`/projects/${input.projectId}/publishing`);
    revalidatePath(`/projects/${input.projectId}/preview`);

    return { ok: true, data: finalRun };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Retry failed" };
  }
}

// ── Action: exportAiImportAgentRunAction ──────────────────────────────────────

export async function exportAiImportAgentRunAction(input: {
  projectId: string;
  runId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await requireProjectPermission(input.projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true },
  });

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  try {
    const markdown = exportAiImportAgentRunbook(run, project?.name ?? input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.runbook_exported",
      category:    "publishing",
      result:      "success",
      summary:     "AI import agent runbook exported as AI_IMPORT_AGENT_RUNBOOK.md",
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "AI_IMPORT_AGENT_RUNBOOK.md" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Export failed" };
  }
}
