/**
 * lib/ai-import-agent/agent-run-store.ts
 *
 * Sprint 89: Persists AgentRun state so progress survives a page refresh and
 * a separate polling request can observe live progress while a run is
 * in-flight (Node serves concurrent requests on the same event loop — a
 * long-running synchronous action that awaits DB/IO between steps yields
 * naturally, so a poll arriving mid-run sees freshly written state).
 *
 * Storage: ProjectOperation (operationType: "ai_import_agent"), with the full
 * AgentRun (including steps[]) serialized into the `meta` Json field. No
 * Prisma schema changes — meta already exists for exactly this purpose.
 *
 * Each completed/errored step is also mirrored into ProjectLog so the run is
 * visible from the existing Logs page, not only this console (per spec: "Do
 * not hide logs only in Operations").
 *
 * This intentionally does NOT use startProjectOperation()'s cross-type lock
 * matrix — an agent run orchestrates its own internal "deploy" operation via
 * deployProjectAction(), and locking "ai_import_agent" against "deploy" would
 * make the agent's own internal deploy call block on itself. Only a simple
 * one-running-run-per-project guard is enforced here directly.
 */

import { db }                  from "@/lib/db";
import { LogLevel, LogSource } from "@prisma/client";
import { markStaleOperations } from "@/lib/operations/project-operation-cleanup";
import type { AgentRun, AgentTimelineStep, AgentRunStatus } from "./agent-run-types";

const OPERATION_TYPE = "ai_import_agent";

function mapRunStatusToOperationStatus(status: AgentRunStatus): "running" | "success" | "failed" {
  if (status === "preview_live") return "success";
  if (status === "failed") return "failed";
  return "running"; // running | fixing | retrying | waiting_for_user | fix_available | idle
}

function rowToAgentRun(row: { id: string; meta: unknown; startedAt: Date; updatedAt: Date }): AgentRun | null {
  const meta = row.meta as { run?: AgentRun } | null;
  if (!meta?.run) return null;
  // chatMessages may be absent on runs written before Sprint 90 — default to [].
  return { ...meta.run, id: row.id, chatMessages: meta.run.chatMessages ?? [] };
}

/** Returns the most recent agent run for a project, or null if none exists. */
export async function getLatestAgentRun(projectId: string): Promise<AgentRun | null> {
  const row = await db.projectOperation.findFirst({
    where:   { projectId, operationType: OPERATION_TYPE },
    orderBy: { startedAt: "desc" },
    select:  { id: true, meta: true, startedAt: true, updatedAt: true },
  });
  if (!row) return null;
  return rowToAgentRun(row);
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
    id: "", // filled in after create
    projectId,
    status: "running",
    currentStep: "start",
    summary: "Starting…",
    steps: [],
    chatMessages: [],
    startedAt: nowIso,
    updatedAt: nowIso,
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

/** Persists the full run (including its steps[]) back to the operation row. */
export async function saveAgentRun(run: AgentRun): Promise<void> {
  await db.projectOperation.update({
    where: { id: run.id },
    data: {
      status:      mapRunStatusToOperationStatus(run.status),
      meta:        { run } as object,
      lastError:   run.lastError?.whatHappened?.slice(0, 1000) ?? null,
      completedAt: run.status === "preview_live" || run.status === "failed" ? new Date() : null,
    },
  }).catch(() => null); // non-fatal — the in-memory run is still returned to the caller
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
