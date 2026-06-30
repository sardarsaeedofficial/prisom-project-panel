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

export function setRunStatus(run: AgentRun, status: AgentRun["status"], summary?: string): AgentRun {
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
