/**
 * lib/ai-import-agent/agent-run-store.ts
 *
 * Sprint 89: Persists AgentRun state so progress survives a page refresh.
 * Sprint 92: Normalizes legacy status values on read; initial run has
 *            status="queued" + nextPhase="analyze" for the step executor.
 * Sprint 94: Auto-marks timed-out runs on load so the operation banner never
 *            shows a run that has been stuck for hours. Handles "stopped".
 */

import { db }                  from "@/lib/db";
import { LogLevel, LogSource } from "@prisma/client";
import { markStaleOperations } from "@/lib/operations/project-operation-cleanup";
import type { AgentRun, AgentTimelineStep, AgentRunStatus } from "./agent-run-types";
import { STATUS_TIMEOUT_MS, ACTIVE_STATUSES } from "./agent-run-types";

const OPERATION_TYPE = "ai_import_agent";

function mapRunStatusToOperationStatus(status: AgentRunStatus): "running" | "success" | "failed" {
  if (status === "preview_live") return "success";
  if (status === "failed" || status === "timed_out" || status === "stopped" || status === "blocked") return "failed";
  return "running";
}

/** Normalize Sprint 89/90 legacy status strings to Sprint 92 canonical values. */
function normalizeStatus(raw: string): AgentRunStatus {
  switch (raw) {
    case "idle":             return "not_started";
    case "waiting_for_user": return "waiting_for_user_input";
    case "fix_available":    return "waiting_for_fix_approval";
    default: return raw as AgentRunStatus;
  }
}

function rowToAgentRun(row: { id: string; meta: unknown; startedAt: Date; updatedAt: Date }): AgentRun | null {
  const meta = row.meta as { run?: AgentRun } | null;
  if (!meta?.run) return null;
  const raw = meta.run;

  const status = normalizeStatus(raw.status as string);

  // Legacy runs without nextPhase that are still active get a safe default
  // so the step executor can resume without hanging.
  let nextPhase = raw.nextPhase;
  if (!nextPhase && ACTIVE_STATUSES.includes(status)) {
    nextPhase = raw.currentStep === "preview" ? "check_preview" : "deploy";
  }

  return {
    ...raw,
    id:           row.id,
    status,
    nextPhase,
    chatMessages: raw.chatMessages ?? [],
    attemptCount: raw.attemptCount ?? 0,
  };
}

/** Returns true if the run has been stuck in an in-flight status past its timeout. */
export function isRunTimedOut(run: AgentRun): boolean {
  const timeout = STATUS_TIMEOUT_MS[run.status];
  if (!timeout) return false;
  return Date.now() - new Date(run.updatedAt).getTime() > timeout;
}

/**
 * Persists the full run (including its steps[]) back to the operation row.
 *
 * Sets completedAt for all terminal statuses (including "stopped") so the
 * active operations banner clears immediately on stop/timeout. Explicitly
 * sets completedAt=null for non-terminal statuses so Resume works (re-opens
 * the operation and makes the banner active again).
 */
export async function saveAgentRun(run: AgentRun): Promise<void> {
  const isTerminal =
    run.status === "preview_live" ||
    run.status === "failed"       ||
    run.status === "timed_out"    ||
    run.status === "stopped"      ||
    run.status === "blocked";

  await db.projectOperation.update({
    where: { id: run.id },
    data: {
      status:      mapRunStatusToOperationStatus(run.status),
      meta:        { run } as object,
      lastError:   run.lastError?.whatHappened?.slice(0, 1000) ?? null,
      completedAt: isTerminal ? new Date() : null,
    },
  }).catch(() => null); // non-fatal — the in-memory run is still returned to the caller
}

/**
 * Force-closes ALL running ai_import_agent operations for a project so the
 * active operation banner clears immediately regardless of how many orphan rows
 * exist. Called on Stop and Clear to guarantee the banner disappears.
 */
export async function forceCloseAllActiveAgentOperations(projectId: string): Promise<void> {
  await db.projectOperation.updateMany({
    where: { projectId, operationType: OPERATION_TYPE, status: "running" },
    data:  { status: "failed", completedAt: new Date(), lastError: "Agent stopped by user." },
  }).catch(() => null);
}

/**
 * Returns the most recent agent run for a project, or null if none exists.
 *
 * Sprint 94: auto-detects timed-out runs and saves them immediately so the
 * operation banner disappears — no need to wait for a UI poll to fire.
 */
export async function getLatestAgentRun(projectId: string): Promise<AgentRun | null> {
  const row = await db.projectOperation.findFirst({
    where:   { projectId, operationType: OPERATION_TYPE },
    orderBy: { startedAt: "desc" },
    select:  { id: true, meta: true, startedAt: true, updatedAt: true },
  });
  if (!row) return null;
  const run = rowToAgentRun(row);
  if (!run) return null;

  // Auto-mark timed-out runs on load so the banner clears and the UI shows
  // the correct "timed out" state even if no user is actively polling.
  if (isRunTimedOut(run)) {
    const staleStatus = run.status;
    const staleMinutes = Math.round((Date.now() - new Date(run.updatedAt).getTime()) / 60_000);

    run.status    = "timed_out";
    run.nextPhase = undefined;
    run.summary   = "Agent run timed out.";

    if (!run.lastError) {
      run.lastError = {
        kind:             "timeout",
        title:            "Agent run timed out",
        whatHappened:     `The agent stopped making progress while ${staleStatus}.`,
        why:              "A step may have hung, or the page was closed before the agent finished.",
        whatICanDo:       "Click Resume to retry from the last safe step, or Start Fresh to clear.",
        fixSafetyLevel:   "safe",
        safeFixAvailable: false,
        technicalReason:  `Status "${staleStatus}" with no update for ${staleMinutes} minute(s).`,
      };
    }
    run.updatedAt = new Date().toISOString();
    await saveAgentRun(run);
  }

  return run;
}

/**
 * Returns an existing running run if one exists (reuse, per spec), otherwise
 * creates a fresh one. Mirrors the same "one active run per project" guard
 * Sprint 27's operation locking uses for other operation types.
 */
export async function getOrCreateAgentRun(input: {
  projectId: string;
  userId?: string;
}): Promise<AgentRun> {
  const { projectId, userId } = input;
  await markStaleOperations(projectId);

  const existing = await db.projectOperation.findFirst({
    where:   { projectId, operationType: OPERATION_TYPE, status: "running" },
    orderBy: { startedAt: "desc" },
    select:  { id: true, meta: true, startedAt: true, updatedAt: true },
  });
  if (existing) {
    const run = rowToAgentRun(existing);
    if (run) return run;
  }

  const nowIso = new Date().toISOString();
  const run: AgentRun = {
    id:           "",
    projectId,
    status:       "queued",
    currentStep:  "start",
    summary:      "Queued…",
    steps:        [],
    chatMessages: [],
    nextPhase:    "analyze",
    attemptCount: 0,
    startedAt:    nowIso,
    updatedAt:    nowIso,
  };

  const row = await db.projectOperation.create({
    data: {
      projectId,
      operationType:     OPERATION_TYPE,
      title:             "AI Import Agent run",
      status:            "running",
      initiatedByUserId: userId ?? null,
      meta:              { run } as object,
      startedAt:         new Date(),
    },
    select: { id: true },
  });

  run.id = row.id;
  return run;
}

/** Mirrors a completed timeline step into ProjectLog so it shows on the Logs page too. */
export async function logAgentStep(projectId: string, step: AgentTimelineStep): Promise<void> {
  const level =
    step.status === "error"   ? LogLevel.ERROR :
    step.status === "warning" ? LogLevel.WARN  :
    LogLevel.INFO;

  await db.projectLog.create({
    data: {
      projectId,
      level,
      source:  LogSource.DEPLOY,
      message: `[AI Import Agent] ${step.title}: ${step.summary}`,
      metadata: {
        stepId: step.id,
        status: step.status,
        command: step.command ?? null,
        fixAvailable: step.fixAvailable ?? false,
        fixId: step.fixId ?? null,
      },
    },
  }).catch(() => null); // non-fatal
}
