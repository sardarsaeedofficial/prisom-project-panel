"use server";

/**
 * app/actions/ai-import-agent.ts
 *
 * Sprint 89: Server actions + orchestrator for the Live AI Import Agent Console.
 * Sprint 90: Chat messages woven into every orchestration step.
 * Sprint 92: Durable step-machine model.
 * Sprint 93: Real AI planning — Sonnet inspects the project and proposes fixes.
 *
 * Step executor (called by UI every 2 s):
 *   runNextAiImportAgentStepAction → advances one phase per call
 *
 * Phases (Sprint 93 additions):
 *   plan_with_ai     — builds context, calls Sonnet, stores AiImportPlan
 *   apply_ai_action  — executes one action from the plan (or pauses for approval)
 *
 * New actions:
 *   approveAiImportAgentPatchAction — writes AI-proposed file, continues
 *   rejectAiImportAgentPatchAction  — skips file edit, continues
 *   checkAiProviderStatusAction     — returns whether ANTHROPIC_API_KEY is set
 *
 * Safety:
 *  - deploy.trigger required for start/fix/retry/approve/reject
 *  - No secrets returned to the client
 *  - Only safe-allowlisted config changes applied automatically
 *  - File edits ALWAYS require user approval
 *  - Only this project's PM2 process is managed
 *  - No automatic go-live, no DNS mutation, no DB wipe
 */

import { revalidatePath }              from "next/cache";
import { requireProjectPermission }    from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }      from "@/lib/audit/project-audit";
import { getAuditRequestContext }      from "@/lib/audit/request-context";
import { db }                          from "@/lib/db";
import { getProjectByIdForImport }     from "@/lib/projects/project-lookup-fallback";
import { runAutoImportAnalysis }       from "@/lib/auto-import/auto-import-orchestrator";
import { writeProjectTextFile }        from "@/lib/projects/file-manager";
import {
  getOrCreateAgentRun,
  getLatestAgentRun,
  saveAgentRun,
  logAgentStep,
  isRunTimedOut,
  forceCloseAllActiveAgentOperations,
}                                       from "@/lib/ai-import-agent/agent-run-store";
import {
  beginStep,
  addCompletedStep,
  completeStep,
  setRunError,
  clearRunError,
  setRunPhase,
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
import {
  findLatestReleasePath,
  checkIndexHtmlAt,
  findIndexHtml,
  runBuildInRelease,
  FRONTEND_INDEX_HTML_CANDIDATE_DIRS,
}                                       from "@/lib/ai-import-agent/agent-output-inspector";
import { buildImportAiContext }        from "@/lib/ai-import-agent/agent-ai-context-builder";
import { planWithAi, isAiProviderAvailable } from "@/lib/ai-import-agent/agent-ai-planner";
import { executeAiAction }             from "@/lib/ai-import-agent/agent-ai-patch-executor";
import type { AgentRun, AiPlanMeta }   from "@/lib/ai-import-agent/agent-run-types";
import {
  IN_FLIGHT_STATUSES,
  TERMINAL_STATUSES,
  WAITING_STATUSES,
}                                       from "@/lib/ai-import-agent/agent-run-types";
import type { AgentPreviewResult }     from "@/lib/ai-import-agent/agent-preview-checker";

const MAX_FIX_ATTEMPTS       = 2;
const MAX_AI_ITERATIONS      = 3;   // max plan_with_ai cycles before giving up
const MAX_DEPLOY_AFTER_AI    = 3;   // max deploy attempts in AI-driven loop

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

// ── Preview classification helpers ───────────────────────────────────────────

function classifyPreviewFailure(preview: AgentPreviewResult) {
  const structural = classifyPreviewChecks(preview.checks, preview.staticOutputMissing);
  if (structural) return structural;
  const failingCheck = preview.checks.find((c) => c.status !== "success");
  const errText = preview.panelGateError ?? failingCheck?.summary ?? "Preview check failed.";
  return classifyAgentErrorOrFallback(errText, "Preview");
}

function previewFailureChatMessage(kind: string, _safeFixAvailable: boolean, whatHappened: string): string {
  if (kind === "frontend_build_output_missing") {
    return "The API is healthy, but the frontend build output is missing on disk. I'll inspect the release and fix the output path.";
  }
  if (kind === "frontend_static_not_served") {
    return "The API is healthy, but the storefront is returning 404. I can fix the frontend routing.";
  }
  if (kind === "panel_preview_proxy_db_unreachable") {
    return "The preview proxy hit an internal database issue. I can retry the preview check.";
  }
  return `Preview check failed: ${whatHappened}`;
}

// ── Phase executors ───────────────────────────────────────────────────────────

async function executeAnalyzePhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  setRunPhase(run, "analyze", "running", "Analyzing project…");
  appendChatMessage(run, "I'll read this project, detect the stack, and check what's needed.", { tone: "thinking" });
  beginStep(run, "start", "Starting agent", "Analyzing project…");
  await saveAndLog(run, projectId);

  const project = await getProjectByIdForImport(projectId);
  if (!project) {
    appendChatMessage(run, "I couldn't find this project. It may have been deleted.", { tone: "error" });
    completeStep(run, "start", "error", "Project not found.", { errorMessage: "Project not found." });
    setRunPhase(run, undefined, "failed", "Project not found.");
    await saveAndLog(run, projectId);
    return run;
  }
  completeStep(run, "start", "success", project.name);
  addCompletedStep(run, "project_found", "Project found", "success", project.name);
  appendChatMessage(run, `I found the project: ${project.name}.`, { tone: "info" });
  await saveAndLog(run, projectId);

  const autoRun = await runAutoImportAnalysis({ projectId });

  if (autoRun.issues.some((i) => i.id === "no-source")) {
    appendChatMessage(run, "I can't find any source files. Please upload a ZIP or connect a GitHub repository.", { tone: "error" });
    addCompletedStep(run, "source_found", "Source files found", "error", "No source uploaded yet.", {
      errorMessage: "Project source files not found.",
    });
    setRunPhase(run, undefined, "failed", "No source files. Upload a ZIP or connect a GitHub repository.");
    await saveAndLog(run, projectId);
    return run;
  }
  addCompletedStep(run, "source_found", "Source files found", "success", "Source files are present.");
  appendChatMessage(run, "The source files are present. I can inspect the app structure.", { tone: "info" });
  await saveAndLog(run, projectId);

  const stack = autoRun.detectedStack;
  const isSardar = stack.packageManager === "pnpm" && (stack.staticOutputPath?.includes("sardar-security") ?? false);
  addCompletedStep(run, "stack_detected", "Stack detected", "success",
    isSardar
      ? "pnpm workspace, Sardar ecommerce preset"
      : `${stack.packageManager} project, ${stack.framework.join(", ") || "unknown framework"}`,
  );
  if (isSardar) {
    appendChatMessage(run, "This looks like a pnpm workspace with an API service and a Vite storefront.", { tone: "info" });
    addCompletedStep(run, "api_detected",      "API detected",      "success", "artifacts/api-server");
    addCompletedStep(run, "frontend_detected", "Frontend detected", "success", "artifacts/sardar-security");
  } else {
    appendChatMessage(run, `Detected a ${stack.packageManager} project${stack.framework.length ? " using " + stack.framework.join(", ") : ""}.`, { tone: "info" });
  }
  await saveAndLog(run, projectId);

  const missingRequired = autoRun.missingEnvNames.filter((e) => e.required);
  if (missingRequired.length > 0) {
    const names = missingRequired.map((e) => e.name).join(", ");
    addCompletedStep(run, "secrets_checked", "Required secrets checked", "warning", `Missing: ${names}`);
    appendChatMessage(run, `I need a few secret values before I can deploy: ${names}.`, { tone: "warning" });
    setRunPhase(run, undefined, "waiting_for_user_input", `Missing secrets: ${names}`);
    await saveAndLog(run, projectId);
    return run;
  }
  addCompletedStep(run, "secrets_checked", "Required secrets checked", "success", "All required secrets are configured.");
  appendChatMessage(run, "All required secrets are configured. I can continue.", { tone: "success" });
  setRunPhase(run, "apply_preset", "queued", "Analysis complete — applying preset next.");
  await saveAndLog(run, projectId);
  return run;
}

async function executeApplyPresetPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  setRunPhase(run, "apply_preset", "running", "Checking deployment configuration…");
  await saveAndLog(run, projectId);

  const autoRun = await runAutoImportAnalysis({ projectId });
  const needsPreset = autoRun.issues.some((i) => i.id === "no-deploy-config");

  if (needsPreset) {
    appendChatMessage(run, "I'm applying the Sardar/Replit preset so /api goes to the backend and the storefront serves from /.", { tone: "thinking" });
    beginStep(run, "preset_applied", "Deployment preset", "Applying preset…");
    await saveAndLog(run, projectId);

    const fixRes = await applyAgentFix({ projectId, fixId: "apply-sardar-preset" });
    if (!fixRes.ok) {
      appendChatMessage(run, `I couldn't apply the preset: ${fixRes.error}`, { tone: "error" });
      completeStep(run, "preset_applied", "error", fixRes.error, { errorMessage: fixRes.error });
      setRunPhase(run, undefined, "failed", `Preset failed: ${fixRes.error}`);
      await saveAndLog(run, projectId);
      return run;
    }
    appendChatMessage(run, "Deployment preset applied. I can now run the install and build.", { tone: "success" });
    completeStep(run, "preset_applied", "success", fixRes.label);
  } else {
    addCompletedStep(run, "preset_applied", "Deployment preset", "success", "Using existing deployment config.");
    appendChatMessage(run, "Using the existing deployment configuration.", { tone: "info" });
  }

  setRunPhase(run, "deploy", "queued", "Config ready — deploying next.");
  await saveAndLog(run, projectId);
  return run;
}

async function executeDeployPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  setRunPhase(run, "deploy", "deploying", "Installing, building, and starting the app…");
  appendChatMessage(run, "I'm running the install, build, and PM2 start process now.", { tone: "thinking" });
  beginStep(run, "deploy", "Deploy", "Installing dependencies, building, and starting the app…");
  await saveAndLog(run, projectId);

  const deployResult = await runAgentDeploy(projectId);

  if (!deployResult.ok) {
    const errText = `${deployResult.output ?? ""}\n${deployResult.error ?? ""}`;
    const classified = classifyAgentErrorOrFallback(errText, "Deploy");
    appendChatMessage(run, `Deploy failed. ${classified.whatHappened}`, { tone: "error" });
    completeStep(run, "deploy", "error", deployResult.error || "Deploy failed", {
      errorMessage:  deployResult.error,
      fullOutput:    deployResult.output,
      outputPreview: previewOutput(deployResult.output ?? ""),
      fixAvailable:  classified.safeFixAvailable,
      fixId:         classified.safeFixId,
    });
    setRunError(run, classified);

    // Sprint 93: if no deterministic fix, ask Sonnet for a plan
    if (classified.safeFixAvailable) {
      setRunPhase(run, undefined, "waiting_for_fix_approval", classified.whatHappened);
      if (classified.safeFixId) run.pendingFixId = classified.safeFixId;
    } else {
      const deployCount = (run.attemptCount ?? 0);
      if (deployCount < MAX_DEPLOY_AFTER_AI && isAiProviderAvailable()) {
        appendChatMessage(run, "I'm asking the AI assistant to inspect the deployment failure.", { tone: "thinking" });
        run.aiPlan = undefined;
        run.aiPlanActionIndex = undefined;
        setRunPhase(run, "plan_with_ai", "queued", "Consulting AI for a fix plan…");
      } else {
        setRunPhase(run, undefined, "failed", classified.whatHappened);
      }
    }
    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "Deploy completed successfully. Now I'll check the preview.", { tone: "success" });
  completeStep(run, "deploy", "success", "Install, build, and PM2 start completed.", {
    fullOutput:    deployResult.output,
    outputPreview: previewOutput(deployResult.output ?? ""),
  });
  setRunPhase(run, "check_preview", "queued", "Deploy complete — checking preview.");
  await saveAndLog(run, projectId);
  return run;
}

async function executeCheckPreviewPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  setRunPhase(run, "check_preview", "verifying", "Checking preview…");
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

    // Hotfix: never re-offer the same deterministic fix after MAX_FIX_ATTEMPTS
    const attemptsExhausted = (run.attemptCount ?? 0) >= MAX_FIX_ATTEMPTS;

    if (classified.safeFixAvailable && !attemptsExhausted) {
      // Deterministic fix available and still within attempt budget
      setRunPhase(run, undefined, "waiting_for_fix_approval", classified.whatHappened);
      if (classified.safeFixId) run.pendingFixId = classified.safeFixId;
    } else {
      // No deterministic fix, or attempts exhausted — escalate to AI or fail
      const iterCount = run.iterationCount ?? 0;
      if (isAiProviderAvailable() && iterCount < MAX_AI_ITERATIONS) {
        const msg = attemptsExhausted
          ? "The automatic fix was tried twice and did not solve the issue. I'm asking Claude Sonnet to inspect the project files and build logs now."
          : "I'm asking the AI assistant to inspect the build output problem.";
        appendChatMessage(run, msg, { tone: "thinking" });
        run.aiPlan = undefined;
        run.aiPlanActionIndex = undefined;
        setRunPhase(run, "plan_with_ai", "queued", "Consulting Claude Sonnet for a fix plan…");
      } else if (!isAiProviderAvailable()) {
        if (attemptsExhausted) {
          setRunError(run, {
            kind: "deterministic_fix_exhausted",
            title: "Automatic fix did not work",
            whatHappened: `The rule-based fix was tried ${MAX_FIX_ATTEMPTS} times but the preview is still not live.`,
            why: "AI provider (ANTHROPIC_API_KEY) is not configured.",
            whatICanDo: "Configure ANTHROPIC_API_KEY to enable Claude Sonnet planning, or review the build output manually.",
            fixSafetyLevel: "safe",
            safeFixAvailable: false,
            technicalReason: `attemptCount=${run.attemptCount ?? 0} >= MAX_FIX_ATTEMPTS=${MAX_FIX_ATTEMPTS}`,
          });
        }
        appendChatMessage(
          run,
          "AI provider not configured — rule-based import only. Manual review required.",
          { tone: "warning" },
        );
        setRunPhase(run, undefined, "failed", classified.whatHappened);
      } else {
        appendChatMessage(
          run,
          `I could not make this live automatically after ${iterCount} AI planning iterations. Here is the exact blocker and what needs manual review.`,
          { tone: "error" },
        );
        setRunPhase(run, undefined, "failed", `${classified.whatHappened} (AI iterations exhausted)`);
      }
    }

    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "The preview is live. The project is now working through the panel preview.", { tone: "success" });
  completeStep(run, "preview", "success", "All preview checks passed.");
  run.steps.push(...preview.checks);
  setRunPhase(
    run,
    undefined,
    "preview_live",
    preview.publicUrl
      ? `Preview is live at ${preview.publicUrl}.`
      : "Preview is live through the panel proxy. Add a public domain when ready.",
  );
  await saveAndLog(run, projectId);
  return run;
}

async function executeVerifyPreviewPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  return executeCheckPreviewPhase(run, projectId);
}

async function executeApplyFixPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  const fixId = run.pendingFixId ?? "unknown";
  const attemptCount = (run.attemptCount ?? 0) + 1;
  run.attemptCount = attemptCount;

  if (attemptCount > MAX_FIX_ATTEMPTS) {
    const iterCount = run.iterationCount ?? 0;
    if (isAiProviderAvailable() && iterCount < MAX_AI_ITERATIONS) {
      // Escalate to Claude Sonnet planning instead of stopping
      appendChatMessage(
        run,
        "The automatic fix was tried twice and did not solve the issue. I'm asking Claude Sonnet to inspect the project files and build logs now.",
        { tone: "thinking" },
      );
      run.aiPlan = undefined;
      run.aiPlanActionIndex = undefined;
      setRunPhase(run, "plan_with_ai", "queued", "Consulting Claude Sonnet for a fix plan…");
    } else {
      const reason = !isAiProviderAvailable()
        ? "Configure ANTHROPIC_API_KEY to enable Claude Sonnet planning."
        : "AI planning iterations also exhausted.";
      const msg = `Maximum fix attempts (${MAX_FIX_ATTEMPTS}) reached. ${reason}`;
      appendChatMessage(run, msg, { tone: "error" });
      setRunError(run, {
        kind: "deterministic_fix_exhausted",
        title: "Automatic fix did not work",
        whatHappened: `The rule-based fix was tried ${MAX_FIX_ATTEMPTS} times but the preview is still not live.`,
        why: !isAiProviderAvailable()
          ? "AI provider (ANTHROPIC_API_KEY) is not configured."
          : "AI planning iterations are also exhausted.",
        whatICanDo: !isAiProviderAvailable()
          ? "Configure ANTHROPIC_API_KEY to enable Claude Sonnet planning, or review the build output manually."
          : "Manual review of build output and deployment config is required.",
        fixSafetyLevel: "safe",
        safeFixAvailable: false,
        technicalReason: `attemptCount=${attemptCount} > MAX_FIX_ATTEMPTS=${MAX_FIX_ATTEMPTS}`,
      });
      setRunPhase(run, undefined, "failed", msg);
    }
    await saveAndLog(run, projectId);
    return run;
  }

  setRunPhase(run, "apply_fix", "fixing", `Applying fix (attempt ${attemptCount})…`);
  await saveAndLog(run, projectId);

  if (fixId === "inspect_and_fix_frontend_build_output") {
    return executeInspectOutputFix(run, projectId);
  }

  if (fixId === "refresh_panel_pm2_env_and_retry_preview") {
    const fixRes = await applyAgentFix({ projectId, fixId });
    if (!fixRes.ok) {
      addCompletedStep(run, `fix-${fixId}`, "Fix attempt", "error", fixRes.error, { errorMessage: fixRes.error });
      if (fixRes.agentError) setRunError(run, fixRes.agentError);
      appendChatMessage(run, `I couldn't apply the fix: ${fixRes.error}`, { tone: "error" });
      setRunPhase(run, undefined, "waiting_for_fix_approval", fixRes.error);
      await saveAndLog(run, projectId);
      return run;
    }
    addCompletedStep(run, `fix-${fixId}`, "Fix applied", "fixed", fixRes.label);
    clearRunError(run);

    if (fixRes.preview) {
      run.previewUrl = fixRes.preview.browserPreviewUrl;
      run.publicUrl  = fixRes.preview.publicUrl;
      run.steps.push(...fixRes.preview.checks);
      if (fixRes.preview.allPass) {
        appendChatMessage(run, "The preview is live. The project is now working through the panel preview.", { tone: "success" });
        setRunPhase(
          run, undefined, "preview_live",
          fixRes.preview.publicUrl
            ? `Preview is live at ${fixRes.preview.publicUrl}.`
            : "Preview is live through the panel proxy.",
        );
      } else {
        setRunPhase(run, undefined, "waiting_for_fix_approval", "Preview is still failing after the fix.");
      }
      await saveAndLog(run, projectId);
      return run;
    }
    setRunPhase(run, "verify_preview", "queued", "Fix applied — verifying preview.");
    await saveAndLog(run, projectId);
    return run;
  }

  const fixRes = await applyAgentFix({ projectId, fixId });
  if (!fixRes.ok) {
    addCompletedStep(run, `fix-${fixId}`, "Fix attempt", "error", fixRes.error, { errorMessage: fixRes.error });
    if (fixRes.agentError) setRunError(run, fixRes.agentError);
    appendChatMessage(run, `I couldn't apply the fix: ${fixRes.error}`, { tone: "error" });
    setRunPhase(run, undefined, "waiting_for_fix_approval", fixRes.error);
    await saveAndLog(run, projectId);
    return run;
  }

  addCompletedStep(run, `fix-${fixId}`, "Fix applied", "fixed", fixRes.label);
  appendChatMessage(run, "The fix was applied. I'll redeploy and check preview again.", { tone: "success" });
  clearRunError(run);
  setRunPhase(run, "deploy", "queued", "Fix applied — deploying next.");
  await saveAndLog(run, projectId);
  return run;
}

// ── Sprint 93: AI planning phase ──────────────────────────────────────────────

async function executePlanWithAiPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  run.iterationCount = (run.iterationCount ?? 0) + 1;
  const { modelLabel, exactModel } = getAiModelInfo();
  setRunPhase(run, "plan_with_ai", "planning", `Consulting ${modelLabel} for a fix plan…`);
  appendChatMessage(
    run,
    `I'm asking ${modelLabel} to inspect the build output problem (iteration ${run.iterationCount}/${MAX_AI_ITERATIONS}).`,
    { tone: "thinking" },
  );
  beginStep(run, `ai-plan-${run.iterationCount}`, "AI Planning", `Building context and calling ${modelLabel}…`);
  await saveAndLog(run, projectId);

  // Get the most recent preview result from run state for context
  const lastPreviewError = run.lastError;
  const lastDeployLog = run.steps.find((s) => s.id === "deploy")?.fullOutput;

  const contextResult = await buildImportAiContext({
    projectId,
    errorKind:  lastPreviewError?.kind,
    deployLog:  lastDeployLog,
  });

  if (!contextResult.ok) {
    appendChatMessage(run, `I couldn't build the AI context: ${contextResult.error}`, { tone: "error" });
    completeStep(run, `ai-plan-${run.iterationCount}`, "error", contextResult.error, { errorMessage: contextResult.error });
    setRunPhase(run, undefined, "failed", contextResult.error);
    await saveAndLog(run, projectId);
    return run;
  }

  // Record proof-of-call metadata BEFORE the request so the UI shows "Calling..."
  const requestedAt = new Date().toISOString();
  run.aiPlanMeta = {
    provider:    "anthropic",
    modelLabel,
    exactModel,
    requestedAt,
    success:     false, // updated below on success
  };
  appendChatMessage(
    run,
    `Calling ${modelLabel}…`,
    { tone: "thinking" },
  );
  appendChatMessage(
    run,
    `${modelLabel} is inspecting your package.json, build logs, and output directories.`,
    { tone: "thinking" },
  );
  await saveAndLog(run, projectId);

  const planResult = await planWithAi(contextResult.context);

  if (!planResult.ok) {
    const safeError = planResult.error.slice(0, 200);
    run.aiPlanMeta = { ...run.aiPlanMeta, respondedAt: new Date().toISOString(), success: false, error: safeError };
    if (planResult.code === "NO_API_KEY") {
      appendChatMessage(run, `${modelLabel} call failed: API key not configured.`, { tone: "warning" });
      completeStep(run, `ai-plan-${run.iterationCount}`, "warning", "AI provider not configured.", {});
      setRunPhase(run, undefined, "failed", "AI provider not configured — manual review required.");
    } else {
      appendChatMessage(run, `${modelLabel} call failed: ${safeError}`, { tone: "error" });
      completeStep(run, `ai-plan-${run.iterationCount}`, "error", planResult.error, { errorMessage: planResult.error });
      setRunPhase(run, undefined, "failed", planResult.error);
    }
    await saveAndLog(run, projectId);
    return run;
  }

  run.aiPlanMeta = { ...run.aiPlanMeta, respondedAt: new Date().toISOString(), success: true };

  const { plan } = planResult;
  run.aiPlan = plan;
  run.aiPlanActionIndex = 0;

  appendChatMessage(run, `${modelLabel} returned a fix plan.`, { tone: "success" });
  appendChatMessage(run, `${modelLabel} says: ${plan.summary}`, { tone: "info" });
  appendChatMessage(run, `Diagnosis: ${plan.diagnosis}`, { tone: "thinking" });

  if (plan.stopReason) {
    appendChatMessage(run, `Sonnet says it cannot fix this automatically: ${plan.stopReason}`, { tone: "error" });
    completeStep(run, `ai-plan-${run.iterationCount}`, "warning", plan.stopReason);
    setRunPhase(run, undefined, "failed", `AI blocked: ${plan.stopReason}`);
    await saveAndLog(run, projectId);
    return run;
  }

  if (plan.recommendedActions.length === 0) {
    appendChatMessage(run, "Sonnet has no more actions to suggest.", { tone: "warning" });
    completeStep(run, `ai-plan-${run.iterationCount}`, "warning", "No actions recommended.");
    setRunPhase(run, undefined, "failed", "AI returned no actionable fixes.");
    await saveAndLog(run, projectId);
    return run;
  }

  completeStep(run, `ai-plan-${run.iterationCount}`, "success",
    `${plan.recommendedActions.length} action(s) recommended (confidence: ${plan.confidence})`);
  setRunPhase(run, "apply_ai_action", "queued", "AI plan ready — applying first action.");
  await saveAndLog(run, projectId);
  return run;
}

// ── Sprint 93: AI action execution phase ─────────────────────────────────────

async function executeApplyAiActionPhase(run: AgentRun, projectId: string): Promise<AgentRun> {
  const plan = run.aiPlan;
  if (!plan) {
    setRunPhase(run, "plan_with_ai", "queued", "No plan found — re-planning.");
    await saveAndLog(run, projectId);
    return run;
  }

  const actionIndex = run.aiPlanActionIndex ?? 0;
  const action = plan.recommendedActions[actionIndex];

  if (!action) {
    // All actions done — trigger a deploy to apply changes, then verify
    appendChatMessage(run, "All AI-recommended actions have been applied. Deploying and checking preview.", { tone: "thinking" });
    run.aiPlan = undefined;
    run.aiPlanActionIndex = undefined;
    setRunPhase(run, "deploy", "queued", "AI actions applied — deploying next.");
    await saveAndLog(run, projectId);
    return run;
  }

  setRunPhase(run, "apply_ai_action", "running", `Executing AI action: ${action.title}`);
  appendChatMessage(run, `Sonnet recommends: ${action.title}. Reason: ${action.reason}`, { tone: "thinking" });
  beginStep(run, `ai-action-${actionIndex}`, action.title, action.reason ?? action.title);
  await saveAndLog(run, projectId);

  const result = await executeAiAction(projectId, action, actionIndex);

  switch (result.outcome) {
    case "done": {
      appendChatMessage(run, result.message, { tone: "success" });
      completeStep(run, `ai-action-${actionIndex}`, "fixed", result.message, {
        outputPreview: result.output ? previewOutput(result.output) : undefined,
        fullOutput:    result.output,
      });
      run.aiPlanActionIndex = actionIndex + 1;
      setRunPhase(run, "apply_ai_action", "queued", "Action done — next action queued.");
      await saveAndLog(run, projectId);
      return run;
    }

    case "needs_approval": {
      appendChatMessage(
        run,
        `Sonnet recommends changing ${result.pendingPatch.filePath}. Please approve this patch.`,
        { tone: "warning" },
      );
      completeStep(run, `ai-action-${actionIndex}`, "warning", "Awaiting patch approval.");
      run.pendingPatch = { ...result.pendingPatch, actionIndex };
      setRunPhase(run, undefined, "waiting_for_patch_approval", `Patch pending approval: ${result.pendingPatch.filePath}`);
      await saveAndLog(run, projectId);
      return run;
    }

    case "needs_input": {
      appendChatMessage(run, `I need your input: ${result.message}`, { tone: "warning" });
      completeStep(run, `ai-action-${actionIndex}`, "warning", result.message);
      setRunPhase(run, undefined, "waiting_for_user_input", result.message);
      await saveAndLog(run, projectId);
      return run;
    }

    case "blocked": {
      appendChatMessage(run, `This fix requires manual action: ${result.message}`, { tone: "error" });
      completeStep(run, `ai-action-${actionIndex}`, "error", result.message, { errorMessage: result.message });
      setRunPhase(run, undefined, "failed", `Manual action required: ${result.message}`);
      await saveAndLog(run, projectId);
      return run;
    }

    case "error": {
      appendChatMessage(run, `Action failed: ${result.message}`, { tone: "error" });
      completeStep(run, `ai-action-${actionIndex}`, "error", result.message, { errorMessage: result.message });
      // Skip this action and try the next one
      run.aiPlanActionIndex = actionIndex + 1;
      setRunPhase(run, "apply_ai_action", "queued", "Action failed — trying next action.");
      await saveAndLog(run, projectId);
      return run;
    }
  }
}

// ── inspect_and_fix_frontend_build_output ────────────────────────────────────

async function executeInspectOutputFix(run: AgentRun, projectId: string): Promise<AgentRun> {
  const project = await getProjectByIdForImport(projectId);
  if (!project) {
    appendChatMessage(run, "I couldn't find the project.", { tone: "error" });
    setRunPhase(run, undefined, "failed", "Project not found.");
    await saveAndLog(run, projectId);
    return run;
  }

  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { staticOutputDir: true, buildCommand: true },
  });

  if (!config) {
    appendChatMessage(run, "No deployment config found — I can't inspect without it.", { tone: "error" });
    setRunPhase(run, undefined, "failed", "No deployment config found.");
    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "I'm checking the expected frontend output folder.", { tone: "thinking" });
  beginStep(run, "inspect_release", "Inspect release", "Looking for the latest release snapshot…");
  await saveAndLog(run, projectId);

  const releasePath = findLatestReleasePath(project.slug);
  if (!releasePath) {
    const errMsg = "No release directory found — run a full deploy first.";
    appendChatMessage(run, errMsg, { tone: "error" });
    completeStep(run, "inspect_release", "error", errMsg, { errorMessage: errMsg });
    setRunError(run, {
      kind: "frontend_build_output_never_produced",
      title: "No release directory found",
      whatHappened: errMsg,
      why: "The project has no release snapshots yet.",
      whatICanDo: "Click 'Make Project Live' to run a full deploy first.",
      fixSafetyLevel: "needs_approval",
      safeFixAvailable: false,
      technicalReason: `No entries found in storage/releases/${project.slug}/`,
    });
    setRunPhase(run, undefined, "failed", errMsg);
    await saveAndLog(run, projectId);
    return run;
  }

  appendChatMessage(run, "Found the latest release snapshot.", { tone: "info" });

  const expectedDir = config.staticOutputDir ?? "artifacts/sardar-security/dist/public";
  let found = checkIndexHtmlAt(releasePath, expectedDir)
    ? { relativeDir: expectedDir }
    : null;

  if (found) {
    appendChatMessage(run, `Found index.html at the expected path: ${expectedDir}.`, { tone: "success" });
    completeStep(run, "inspect_release", "success", `Found index.html at ${expectedDir}.`);
  } else {
    appendChatMessage(run, "I did not find index.html there. I'm searching common build output folders.", { tone: "thinking" });
    found = findIndexHtml(releasePath);

    if (found) {
      appendChatMessage(run, `Found index.html at ${found.relativeDir}. I'll update the config path.`, { tone: "success" });
      completeStep(run, "inspect_release", "success", `Found index.html at ${found.relativeDir}.`);
    } else {
      appendChatMessage(run, "I'm rebuilding the frontend now.", { tone: "thinking" });
      completeStep(run, "inspect_release", "warning", "No build output found — attempting build.");
      await saveAndLog(run, projectId);

      if (!config.buildCommand) {
        const errMsg = "No build command is configured — I can't generate the build output automatically.";
        appendChatMessage(run, errMsg, { tone: "error" });
        setRunError(run, {
          kind: "frontend_build_output_never_produced",
          title: "No build command configured",
          whatHappened: errMsg,
          why: "The deployment config has no build command.",
          whatICanDo: "Configure a build command in deployment settings.",
          fixSafetyLevel: "needs_approval",
          safeFixAvailable: false,
          technicalReason: "config.buildCommand is null or empty.",
        });
        setRunPhase(run, undefined, "failed", errMsg);
        await saveAndLog(run, projectId);
        return run;
      }

      appendChatMessage(run, `Running: ${config.buildCommand}`, { tone: "thinking" });
      beginStep(run, "build_attempt", "Build frontend", `Running ${config.buildCommand}…`);
      await saveAndLog(run, projectId);

      const buildResult = await runBuildInRelease(releasePath, config.buildCommand);

      if (!buildResult.ok) {
        const errMsg = "The build command failed — the frontend output was never produced.";
        appendChatMessage(run, errMsg, { tone: "error" });
        completeStep(run, "build_attempt", "error", errMsg, {
          errorMessage:  errMsg,
          fullOutput:    buildResult.output,
          outputPreview: previewOutput(buildResult.output),
        });
        setRunError(run, {
          kind: "frontend_build_output_never_produced",
          title: "Frontend build failed",
          whatHappened: errMsg,
          why: "The build command exited with a non-zero code.",
          whatICanDo: "Check the build output below, fix the source code, and try again.",
          fixSafetyLevel: "needs_approval",
          safeFixAvailable: false,
          technicalReason: buildResult.output.slice(0, 500),
        });
        // Sprint 93: escalate to AI if build output is consistently missing
        const iterCount = run.iterationCount ?? 0;
        if (iterCount < MAX_AI_ITERATIONS && isAiProviderAvailable()) {
          appendChatMessage(run, "I'm asking the AI assistant to inspect the Vite build config.", { tone: "thinking" });
          run.aiPlan = undefined;
          run.aiPlanActionIndex = undefined;
          setRunPhase(run, "plan_with_ai", "queued", "Build failed — consulting AI.");
        } else {
          setRunPhase(run, undefined, "failed", errMsg);
        }
        await saveAndLog(run, projectId);
        return run;
      }

      appendChatMessage(run, "Build finished.", { tone: "success" });
      completeStep(run, "build_attempt", "success", "Build completed successfully.");
      await saveAndLog(run, projectId);

      found = findIndexHtml(releasePath);
      if (!found) {
        const errMsg = "I could not find index.html after build — the build configuration may point to an unexpected output directory.";
        appendChatMessage(run, errMsg, { tone: "error" });
        setRunError(run, {
          kind: "frontend_build_output_never_produced",
          title: "Build produced no output",
          whatHappened: errMsg,
          why: "Build exited 0 but wrote no index.html to any candidate path.",
          whatICanDo: "Check the Vite/webpack outDir setting in the frontend package.json.",
          fixSafetyLevel: "needs_approval",
          safeFixAvailable: false,
          technicalReason: `Searched: ${FRONTEND_INDEX_HTML_CANDIDATE_DIRS.join(", ")}`,
        });
        const iterCount = run.iterationCount ?? 0;
        if (iterCount < MAX_AI_ITERATIONS && isAiProviderAvailable()) {
          appendChatMessage(run, "I'm asking Sonnet to inspect the Vite config and output directory.", { tone: "thinking" });
          run.aiPlan = undefined;
          run.aiPlanActionIndex = undefined;
          setRunPhase(run, "plan_with_ai", "queued", "No output found — consulting AI.");
        } else {
          setRunPhase(run, undefined, "failed", errMsg);
        }
        await saveAndLog(run, projectId);
        return run;
      }

      appendChatMessage(run, `I found index.html at ${found.relativeDir}.`, { tone: "success" });
    }
  }

  await saveAndLog(run, projectId);

  if (found.relativeDir !== config.staticOutputDir) {
    appendChatMessage(
      run,
      `Updating staticOutputDir from "${config.staticOutputDir ?? "(none)"}" to "${found.relativeDir}".`,
      { tone: "thinking" },
    );
    await db.projectDeploymentConfig.update({
      where: { projectId },
      data:  { staticOutputDir: found.relativeDir },
    });
    addCompletedStep(run, "config_updated", "Config updated", "fixed", `staticOutputDir → ${found.relativeDir}`);
  } else {
    addCompletedStep(run, "config_verified", "Config verified", "success", `staticOutputDir is already correct: ${found.relativeDir}`);
  }

  appendChatMessage(run, "Config is correct. I'll now redeploy and verify the preview.", { tone: "success" });
  clearRunError(run);
  setRunPhase(run, "deploy", "queued", "Output path confirmed — deploying next.");
  await saveAndLog(run, projectId);
  return run;
}

// ── Step executor ─────────────────────────────────────────────────────────────

export async function runNextAiImportAgentStepAction(input: {
  projectId: string;
  runId: string;
}): Promise<ActionResult<AgentRun>> {
  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  try {
    if (isRunTimedOut(run)) {
      appendChatMessage(
        run,
        "I stopped receiving progress from the last action. You can retry safely.",
        { tone: "warning" },
      );
      setRunPhase(run, undefined, "timed_out", "Timed out — retry safely.");
      await saveAndLog(run, input.projectId);
      revalidatePath(`/projects/${input.projectId}/import`);
      return { ok: true, data: run };
    }

    if (IN_FLIGHT_STATUSES.includes(run.status)) {
      return { ok: true, data: run };
    }

    if (TERMINAL_STATUSES.includes(run.status) || WAITING_STATUSES.includes(run.status)) {
      return { ok: true, data: run };
    }

    if (!run.nextPhase) {
      return { ok: true, data: run };
    }

    let finalRun: AgentRun;
    switch (run.nextPhase) {
      case "analyze":          finalRun = await executeAnalyzePhase(run, input.projectId);       break;
      case "apply_preset":     finalRun = await executeApplyPresetPhase(run, input.projectId);   break;
      case "deploy":           finalRun = await executeDeployPhase(run, input.projectId);        break;
      case "check_preview":    finalRun = await executeCheckPreviewPhase(run, input.projectId);  break;
      case "apply_fix":        finalRun = await executeApplyFixPhase(run, input.projectId);      break;
      case "verify_preview":   finalRun = await executeVerifyPreviewPhase(run, input.projectId); break;
      case "plan_with_ai":     finalRun = await executePlanWithAiPhase(run, input.projectId);    break;
      case "apply_ai_action":  finalRun = await executeApplyAiActionPhase(run, input.projectId); break;
      default:                 finalRun = run; break;
    }

    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: finalRun };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Step execution failed" };
  }
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
    const run = await getOrCreateAgentRun({ projectId: input.projectId, userId: auth.userId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.run",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent queued — status: ${run.status}`,
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

// ── Action: checkAiProviderStatusAction ───────────────────────────────────────
// Returns AI availability and the friendly model label.
// Never returns the API key or any secret.

function getAiModelInfo(): { available: boolean; modelLabel: string; exactModel: string } {
  const modelId = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  const modelLabel =
    modelId.includes("sonnet") ? "Claude Sonnet" :
    modelId.includes("haiku")  ? "Claude Haiku"  :
    modelId.includes("opus")   ? "Claude Opus"   :
    "Claude";
  return { available: isAiProviderAvailable(), modelLabel, exactModel: modelId };
}

export async function checkAiProviderStatusAction(): Promise<ActionResult<{
  available: boolean;
  modelLabel: string;
  exactModel: string;
}>> {
  return { ok: true, data: getAiModelInfo() };
}

// ── Action: stopAiImportAgentRunAction ────────────────────────────────────────
// Pauses the run — polling stops and no new phases execute.
// The run can be resumed from the same nextPhase via resumeAiImportAgentRunAction.

export async function stopAiImportAgentRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  try {
    appendChatMessage(run, "I stopped the agent run. You can resume from the last safe step.", { tone: "info" });
    run.status  = "stopped";
    run.summary = "Agent stopped by user.";
    run.updatedAt = new Date().toISOString();
    await saveAgentRun(run);
    // Force-close ALL active ai_import_agent operations so the banner clears
    // immediately, even if there are orphan "running" rows from previous starts.
    await forceCloseAllActiveAgentOperations(input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.stopped",
      category:    "publishing",
      result:      "success",
      summary:     "AI import agent stopped by user.",
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Stop failed" };
  }
}

// ── Action: resumeAiImportAgentRunAction ──────────────────────────────────────
// Resumes a stopped or timed-out run from the last saved nextPhase.

export async function resumeAiImportAgentRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  // If the run hasn't been touched in > 60 min, the saved chat/phase state is
  // too stale to continue — start fresh so the banner shows a new operation.
  const RESUME_STALE_MS = 60 * 60_000;
  const isStaleForResume = Date.now() - new Date(run.updatedAt).getTime() > RESUME_STALE_MS;

  try {
    if (isStaleForResume) {
      // Close all orphan "running" ops, then create a clean new run
      await forceCloseAllActiveAgentOperations(input.projectId);
      const freshRun = await getOrCreateAgentRun({ projectId: input.projectId, userId: auth.userId });
      appendChatMessage(freshRun, "The previous run was stale, so I started a fresh run.", { tone: "thinking" });
      setRunPhase(freshRun, "analyze", "queued", "Starting fresh run…");
      await saveAndLog(freshRun, input.projectId);

      const ctx0 = await getAuditRequestContext();
      void writeProjectAuditEvent({
        projectId:   input.projectId,
        actorUserId: auth.userId,
        actorRole:   auth.role,
        action:      "ai_import_agent.resumed",
        category:    "publishing",
        result:      "success",
        summary:     "AI import agent: stale run detected — started fresh",
        metadata:    { stale: true },
        ...ctx0,
      }).catch(() => null);

      revalidatePath(`/projects/${input.projectId}/import`);
      return { ok: true, data: freshRun };
    }

    const resumePhase =
      run.nextPhase ??
      (run.currentStep === "preview" ? "check_preview" : "deploy");

    clearRunError(run);
    appendChatMessage(run, "I'm resuming from the last safe step.", { tone: "thinking" });
    setRunPhase(run, resumePhase, "queued", "Resuming…");
    await saveAndLog(run, input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.resumed",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent resumed from phase: ${resumePhase}`,
      metadata:    { resumePhase },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Resume failed" };
  }
}

// ── Action: clearStaleAiImportAgentRunAction ──────────────────────────────────
// Marks the current run as timed_out so the banner clears and the user can
// start a fresh run. This is destructive — resume is not possible after clear.

export async function clearStaleAiImportAgentRunAction(input: {
  projectId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  try {
    appendChatMessage(run, "I cleared the stale run. Start a fresh run when ready.", { tone: "info" });
    run.status    = "timed_out";
    run.summary   = "Agent run cleared.";
    run.nextPhase = undefined;
    run.updatedAt = new Date().toISOString();
    await saveAgentRun(run);
    // Force-close ALL active ai_import_agent operations including any orphan rows
    await forceCloseAllActiveAgentOperations(input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.cleared",
      category:    "publishing",
      result:      "success",
      summary:     "Stale AI import agent run cleared by user.",
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Clear failed" };
  }
}

// ── Action: approveAiImportAgentPatchAction ───────────────────────────────────
// Writes the AI-proposed file to disk, then resumes execution.

export async function approveAiImportAgentPatchAction(input: {
  projectId: string;
  runId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  const patch = run.pendingPatch;
  if (!patch) return { ok: false, error: "No pending patch to approve." };

  try {
    const writeResult = await writeProjectTextFile(input.projectId, patch.filePath, patch.proposedContent);
    if (!writeResult.ok) {
      appendChatMessage(run, `Could not write ${patch.filePath}: ${writeResult.error}`, { tone: "error" });
      addCompletedStep(run, `patch-${patch.actionId}`, `Write ${patch.filePath}`, "error", writeResult.error, {
        errorMessage: writeResult.error,
      });
      run.pendingPatch = undefined;
      setRunPhase(run, undefined, "failed", writeResult.error);
      await saveAndLog(run, input.projectId);
      return { ok: true, data: run };
    }

    appendChatMessage(run, `Patch applied to ${patch.filePath}. Continuing with the plan.`, { tone: "success" });
    addCompletedStep(run, `patch-${patch.actionId}`, `Write ${patch.filePath}`, "fixed",
      `Updated ${patch.filePath} (${writeResult.data.size} bytes)`);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.patch_approved",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent patch approved: ${patch.filePath}`,
      metadata:    { filePath: patch.filePath, actionId: patch.actionId },
      ...ctx,
    }).catch(() => null);

    run.pendingPatch = undefined;
    run.aiPlanActionIndex = patch.actionIndex + 1;
    clearRunError(run);
    setRunPhase(run, "apply_ai_action", "queued", "Patch applied — continuing plan.");
    await saveAndLog(run, input.projectId);
    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Patch application failed" };
  }
}

// ── Action: rejectAiImportAgentPatchAction ────────────────────────────────────
// Skips the file edit and advances to the next action in the plan.

export async function rejectAiImportAgentPatchAction(input: {
  projectId: string;
  runId: string;
}): Promise<ActionResult<AgentRun>> {
  const exists = await assertProjectExists(input.projectId);
  if (!exists.ok) return { ok: false, error: exists.error };

  const auth = await deployOrEditAuth(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const run = await getLatestAgentRun(input.projectId);
  if (!run) return { ok: false, error: "No agent run found." };

  const patch = run.pendingPatch;
  if (!patch) return { ok: false, error: "No pending patch to reject." };

  try {
    appendChatMessage(run, `Patch for ${patch.filePath} rejected. Skipping to the next action.`, { tone: "info" });
    addCompletedStep(run, `patch-${patch.actionId}`, `Write ${patch.filePath}`, "skipped", "Rejected by user.");

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.patch_rejected",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent patch rejected: ${patch.filePath}`,
      metadata:    { filePath: patch.filePath, actionId: patch.actionId },
      ...ctx,
    }).catch(() => null);

    run.pendingPatch = undefined;
    run.aiPlanActionIndex = patch.actionIndex + 1;
    setRunPhase(run, "apply_ai_action", "queued", "Patch skipped — continuing plan.");
    await saveAndLog(run, input.projectId);
    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Patch rejection failed" };
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
    // Special case: "plan_with_ai" bypasses the apply_fix phase entirely
    if (input.fixId === "plan_with_ai") {
      appendChatMessage(
        run,
        "Automatic fixes did not work. Asking Claude Sonnet to inspect the project files, build logs, and output folders.",
        { tone: "thinking" },
      );
      run.aiPlan = undefined;
      run.aiPlanActionIndex = undefined;
      setRunPhase(run, "plan_with_ai", "queued", "Consulting Claude Sonnet for a fix plan…");
      await saveAndLog(run, input.projectId);

      const ctx0 = await getAuditRequestContext();
      void writeProjectAuditEvent({
        projectId:   input.projectId,
        actorUserId: auth.userId,
        actorRole:   auth.role,
        action:      "ai_import_agent.fix_queued",
        category:    "publishing",
        result:      "success",
        summary:     "AI import agent: escalated to Claude Sonnet planning",
        metadata:    { fixId: "plan_with_ai" },
        ...ctx0,
      }).catch(() => null);

      revalidatePath(`/projects/${input.projectId}/import`);
      return { ok: true, data: run };
    }

    run.pendingFixId = input.fixId;
    appendChatMessage(run, getAgentFixStartMessage(input.fixId), { tone: "thinking" });
    setRunPhase(run, "apply_fix", "queued", "Fix queued…");
    await saveAndLog(run, input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.fix_queued",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent: fix queued — ${input.fixId}`,
      metadata:    { fixId: input.fixId },
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    return { ok: true, data: run };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Fix queuing failed" };
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
    clearRunError(run);
    appendChatMessage(run, "I'm retrying from where I left off.", { tone: "thinking" });
    const retryPhase = run.currentStep === "preview" ? "check_preview" : "deploy";
    setRunPhase(run, retryPhase, "queued", "Retrying…");
    await saveAndLog(run, input.projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ai_import_agent.retried",
      category:    "publishing",
      result:      "success",
      summary:     `AI import agent retried from step: ${run.currentStep}`,
      ...ctx,
    }).catch(() => null);

    revalidatePath(`/projects/${input.projectId}/import`);
    revalidatePath(`/projects/${input.projectId}/publishing`);
    revalidatePath(`/projects/${input.projectId}/preview`);

    return { ok: true, data: run };
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
