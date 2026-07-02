/**
 * lib/ai-import-agent/agent-step-builder.ts
 *
 * Sprint 89: Pure helpers for constructing/updating AgentTimelineStep entries
 * and the overall AgentRun. No async, no DB, no side effects.
 */

import type {
  AgentRun,
  AgentTimelineStep,
  AgentTimelineStepStatus,
  AgentError,
  AgentChatMessage,
  AgentPhase,
  AgentRunStatus,
} from "./agent-run-types";

function nowIso(): string {
  return new Date().toISOString();
}

/** Adds a new step in "running" status. Mutates and returns the run for chaining. */
export function beginStep(
  run: AgentRun,
  id: string,
  title: string,
  summary: string,
): AgentRun {
  const step: AgentTimelineStep = {
    id,
    title,
    status: "running",
    summary,
    startedAt: nowIso(),
  };
  run.steps.push(step);
  run.currentStep = id;
  run.updatedAt = nowIso();
  return run;
}

/** Adds a step that is immediately complete (no separate running phase). */
export function addCompletedStep(
  run: AgentRun,
  id: string,
  title: string,
  status: AgentTimelineStepStatus,
  summary: string,
  extra?: Partial<AgentTimelineStep>,
): AgentRun {
  const step: AgentTimelineStep = {
    id,
    title,
    status,
    summary,
    startedAt: nowIso(),
    completedAt: nowIso(),
    ...extra,
  };
  run.steps.push(step);
  run.currentStep = id;
  run.updatedAt = nowIso();
  return run;
}

/** Finds the most recently added step with the given id and updates it in place. */
export function completeStep(
  run: AgentRun,
  id: string,
  status: AgentTimelineStepStatus,
  summary?: string,
  extra?: Partial<AgentTimelineStep>,
): AgentRun {
  for (let i = run.steps.length - 1; i >= 0; i--) {
    if (run.steps[i].id === id) {
      run.steps[i] = {
        ...run.steps[i],
        status,
        summary: summary ?? run.steps[i].summary,
        completedAt: nowIso(),
        ...extra,
      };
      break;
    }
  }
  run.updatedAt = nowIso();
  return run;
}

export function setRunError(run: AgentRun, error: AgentError): AgentRun {
  run.lastError = error;
  run.updatedAt = nowIso();
  return run;
}

export function clearRunError(run: AgentRun): AgentRun {
  run.lastError = undefined;
  run.updatedAt = nowIso();
  return run;
}

export function setRunStatus(run: AgentRun, status: AgentRunStatus, summary?: string): AgentRun {
  run.status = status;
  if (summary) run.summary = summary;
  run.updatedAt = nowIso();
  return run;
}

/**
 * Sprint 92: Sets both the run status and the next phase the step executor
 * should pick up on its next call.
 */
export function setRunPhase(
  run: AgentRun,
  phase: AgentPhase | undefined,
  status: AgentRunStatus,
  summary?: string,
): AgentRun {
  run.nextPhase = phase;
  run.status = status;
  if (summary) run.summary = summary;
  run.updatedAt = nowIso();
  return run;
}

/** Truncates command output for the collapsible preview, keeping the tail (most relevant for errors). */
export function previewOutput(output: string, maxChars = 600): string {
  const trimmed = output.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `…\n${trimmed.slice(-maxChars)}`;
}

let _msgSeq = 0;

/**
 * Appends a narrated chat message to the run. Used by the orchestrator to keep
 * the agent chat column in the console updated as each step runs.
 * Pure mutation — call saveAgentRun (via saveAndLog) to persist.
 */
export function appendChatMessage(
  run: AgentRun,
  message: string,
  options?: { tone?: AgentChatMessage["tone"]; relatedStepId?: string },
): AgentRun {
  const msg: AgentChatMessage = {
    id: `msg-${Date.now()}-${(_msgSeq = (_msgSeq + 1) % 1_000_000)}`,
    role: "agent",
    tone: options?.tone,
    message,
    createdAt: nowIso(),
    relatedStepId: options?.relatedStepId,
  };
  run.chatMessages.push(msg);
  run.updatedAt = nowIso();
  return run;
}

/**
 * The chat message shown when a safe fix starts applying. Pure/sync — kept
 * here (not in the "use server" actions file, which may only export async
 * functions) so both the server orchestrator and the client console's
 * optimistic update can share the exact same wording.
 */
export function getAgentFixStartMessage(fixId: string): string {
  if (fixId === "plan_with_ai") {
    return "Automatic fixes did not work. Asking Claude Sonnet to inspect the project files and build logs now.";
  }
  if (fixId === "normalize_pnpm_deploy_commands") {
    return "I'm replacing the invalid pnpm workspace command with the safe Sardar pnpm deploy preset.";
  }
  if (fixId === "inspect_and_fix_frontend_build_output") {
    return "I'm inspecting the release directory for the built frontend output now.";
  }
  if (fixId === "repair_static_frontend_routing" || fixId === "fix-static-frontend-routing") {
    return "I'm applying the safe frontend routing fix now.";
  }
  if (fixId === "apply-sardar-preset" || fixId === "switch-to-pnpm-preset") {
    return "I'm applying the Sardar/Replit deployment preset now.";
  }
  if (fixId === "refresh_panel_pm2_env_and_retry_preview") {
    return "I'm checking the panel database connection and retrying the preview.";
  }
  if (fixId === "retry-deploy") {
    return "I'm queueing a fresh deploy now.";
  }
  return "I'm applying the safe fix now.";
}
