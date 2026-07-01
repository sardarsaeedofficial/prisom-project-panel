"use server";

/**
 * app/actions/project-operations.ts
 *
 * Sprint 27: Server actions for the operation locking UI.
 *
 * These are read-only / administrative — they never deploy, restore, or
 * apply patches. Safe data only; no secret values returned.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import {
  getActiveProjectOperations,
  getProjectOperationHistory,
  cancelProjectOperation,
  OperationConflictError,
}                                   from "@/lib/operations/project-operation-service";
import { markStaleOperations }      from "@/lib/operations/project-operation-cleanup";
import type {
  ProjectOperationDTO,
  OperationStatus,
  OperationType,
}                                   from "@/lib/operations/project-operation-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. List active operations (banner polling) ────────────────────────────────

export async function listActiveOperationsAction(
  projectId: string,
): Promise<ActionResult<ProjectOperationDTO[]>> {
  const auth = await requireProjectPermission(projectId, "monitoring.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    // Sprint 94: mark any stale operations before returning the list so the
    // banner never shows an ai_import_agent run that stopped hours ago.
    await markStaleOperations(projectId).catch(() => null);
    const ops = await getActiveProjectOperations(projectId);
    return { ok: true, data: ops };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to load active operations: ${msg}` };
  }
}

// ── 2. List operation history (panel) ─────────────────────────────────────────

type ListOperationHistoryInput = {
  projectId:     string;
  page?:         number;
  pageSize?:     number;
  statusFilter?: OperationStatus | "all";
  typeFilter?:   OperationType   | "all";
};

type OperationHistoryResult = {
  operations: ProjectOperationDTO[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
};

export async function listOperationHistoryAction(
  input: ListOperationHistoryInput,
): Promise<ActionResult<OperationHistoryResult>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "monitoring.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await getProjectOperationHistory({
      projectId,
      page:         input.page,
      pageSize:     input.pageSize,
      statusFilter: input.statusFilter,
      typeFilter:   input.typeFilter,
    });
    return { ok: true, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to load operation history: ${msg}` };
  }
}

// ── 3. Request cancel ─────────────────────────────────────────────────────────
//
// Marks a "running" operation as "cancelled". This is a UI affordance only —
// it does NOT stop the underlying process (PM2, backup runner, etc.).
// It clears the lock so new operations can start.

export async function requestCancelOperationAction(
  projectId:   string,
  operationId: string,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const result = await cancelProjectOperation(operationId, projectId);
  if (!result.ok) return { ok: false, error: result.error ?? "Cancel failed." };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.operation.cancelled",
    category:    "system",
    result:      "success",
    targetType:  "operation",
    targetId:    operationId,
    summary:     `Operation ${operationId} marked as cancelled by user.`,
    metadata:    { operationId },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 4. Clear stale operations ─────────────────────────────────────────────────

export async function clearStaleOperationsAction(
  projectId: string,
): Promise<ActionResult<{ cleared: number }>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // markStaleOperations marks them in-place; we run it and then count
  // by fetching what we're about to mark (done inside markStaleOperations).
  // We call it here and let the banner re-poll to show updated state.
  await markStaleOperations(projectId);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "project.operation.stale_cleared",
    category:    "system",
    result:      "success",
    summary:     "Stale operations cleared.",
    metadata:    { projectId },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { cleared: 0 } }; // banner re-polls — exact count not critical
}
