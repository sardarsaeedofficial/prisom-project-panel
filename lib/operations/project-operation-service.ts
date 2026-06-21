/**
 * lib/operations/project-operation-service.ts
 *
 * Sprint 27: Core CRUD and locking helpers for project operations.
 *
 * Public surface:
 *   startProjectOperation    — create a "running" row after conflict check
 *   completeProjectOperation — mark success
 *   failProjectOperation     — mark failed with error message
 *   cancelProjectOperation   — mark cancelled (used by request-cancel action)
 *   getActiveProjectOperations — list running ops for the banner
 *   getProjectOperationHistory — paginated list for history panel
 *   assertOperationAllowed   — throws OperationConflictError if blocked
 *
 * Wrappers:
 *   withOperationGuard — wrap an async action fn; handles acquire/release
 *
 * Safety:
 *   - Never reads or returns secret values
 *   - meta must be sanitized by the caller (no env var values, no secrets)
 */

import { db }                   from "@/lib/db";
import { markStaleOperations }  from "./project-operation-cleanup";
import {
  BLOCKS_IF_RUNNING,
  getBlockingReason,
}                               from "./project-operation-locks";
import type {
  OperationType,
  OperationStatus,
  ProjectOperationDTO,
  StartOperationInput,
}                               from "./project-operation-types";
import { OPERATION_TYPE_LABELS } from "./project-operation-types";

// ── Custom error ──────────────────────────────────────────────────────────────

export class OperationConflictError extends Error {
  constructor(
    message: string,
    public readonly blockingOperationType: OperationType,
    public readonly blockingOperationId:   string,
  ) {
    super(message);
    this.name = "OperationConflictError";
  }
}

// ── DB row → DTO ──────────────────────────────────────────────────────────────

function toDTO(
  row: {
    id:                  string;
    projectId:           string;
    operationType:       string;
    title:               string;
    status:              string;
    serviceId:           string | null;
    meta:                import("@prisma/client").Prisma.JsonValue;
    lastError:           string | null;
    startedAt:           Date;
    completedAt:         Date | null;
    updatedAt:           Date;
    initiatedBy?:        { name: string | null; email: string | null } | null;
    initiatedByUserId?:  string | null;
  },
): ProjectOperationDTO {
  const initiatedByName =
    (row as { initiatedBy?: { name: string | null; email: string | null } | null }).initiatedBy?.name ??
    (row as { initiatedBy?: { name: string | null; email: string | null } | null }).initiatedBy?.email ??
    null;

  return {
    id:              row.id,
    projectId:       row.projectId,
    operationType:   row.operationType as OperationType,
    title:           row.title,
    status:          row.status as OperationStatus,
    initiatedByName,
    serviceId:       row.serviceId,
    meta:            (row.meta as Record<string, unknown> | null) ?? null,
    lastError:       row.lastError,
    startedAt:       row.startedAt.toISOString(),
    completedAt:     row.completedAt?.toISOString() ?? null,
    updatedAt:       row.updatedAt.toISOString(),
  };
}

// ── Internal: conflict marker thrown inside a Prisma transaction ─────────────
// Prisma transactions roll back on any thrown Error. We need to communicate
// conflict details back out, so we use a typed sentinel class.

class _ConflictInsideTx extends Error {
  constructor(
    public readonly blockingType: string,
    public readonly blockingId:   string,
    public readonly reason:       string,
  ) {
    super("__op_conflict__");
    this.name = "_ConflictInsideTx";
  }
}

// ── Start (atomic) ────────────────────────────────────────────────────────────

/**
 * Acquires an operation lock atomically:
 *
 * 1. Mark stale ops for this project.
 * 2. Inside a Prisma transaction: check for blocking ops → insert running row.
 *    If a conflicting operation is found, the transaction is rolled back and
 *    `OperationConflictError` is thrown.
 * 3. Post-create re-check: if two transactions raced and both inserted, the
 *    loser cancels its own row and throws.
 *
 * Returns the created operation's ID.
 * Throws `OperationConflictError` if blocked.
 */
export async function startProjectOperation(
  input: StartOperationInput,
): Promise<string> {
  const { projectId, operationType, title, initiatedByUserId, serviceId, meta } = input;

  await markStaleOperations(projectId);

  const blockSet = BLOCKS_IF_RUNNING[operationType];

  // ── Phase 1: atomic check + insert ───────────────────────────────────────
  let opId: string;
  try {
    opId = await db.$transaction(async (tx) => {
      // Conflict check inside the transaction
      if (blockSet.size > 0) {
        const blocking = await tx.projectOperation.findFirst({
          where: {
            projectId,
            status:        "running",
            operationType: { in: [...blockSet] },
          },
          select: { id: true, operationType: true, title: true },
        });
        if (blocking) {
          const reason = getBlockingReason(
            operationType,
            blocking.operationType as OperationType,
            blocking.title,
          );
          throw new _ConflictInsideTx(blocking.operationType, blocking.id, reason);
        }
      }

      // Insert the operation row
      const op = await tx.projectOperation.create({
        data: {
          projectId,
          operationType,
          title,
          status:            "running",
          initiatedByUserId: initiatedByUserId ?? null,
          serviceId:         serviceId ?? null,
          meta:              (meta as object) ?? null,
          startedAt:         new Date(),
        },
        select: { id: true },
      });
      return op.id;
    });
  } catch (err) {
    if (err instanceof _ConflictInsideTx) {
      throw new OperationConflictError(err.reason, err.blockingType as OperationType, err.blockingId);
    }
    throw err;
  }

  // ── Phase 2: post-create re-check (handles simultaneous double-click) ────
  // Two concurrent transactions could both pass the conflict check before
  // either inserts. The one that "lost" cancels its own row here.
  if (blockSet.size > 0) {
    const raceConflict = await db.projectOperation.findFirst({
      where: {
        projectId,
        status:        "running",
        operationType: { in: [...blockSet] },
        id:            { not: opId },
      },
      select: { id: true, operationType: true, title: true },
    });
    if (raceConflict) {
      await db.projectOperation.update({
        where: { id: opId },
        data: {
          status:      "cancelled",
          completedAt: new Date(),
          lastError:   "Cancelled: conflicting operation detected post-insert (race).",
        },
      }).catch(() => null);
      const reason = getBlockingReason(
        operationType,
        raceConflict.operationType as OperationType,
        raceConflict.title,
      );
      throw new OperationConflictError(reason, raceConflict.operationType as OperationType, raceConflict.id);
    }
  }

  return opId;
}

// ── assertOperationAllowed (kept for external use in tests / admin tools) ────

export async function assertOperationAllowed(
  projectId: string,
  proposed:  OperationType,
): Promise<void> {
  const blockSet = BLOCKS_IF_RUNNING[proposed];
  if (blockSet.size === 0) return;

  const blocking = await db.projectOperation.findFirst({
    where: {
      projectId,
      status:        "running",
      operationType: { in: [...blockSet] },
    },
    select: { id: true, operationType: true, title: true },
  });
  if (!blocking) return;

  const reason = getBlockingReason(proposed, blocking.operationType as OperationType, blocking.title);
  throw new OperationConflictError(reason, blocking.operationType as OperationType, blocking.id);
}

// ── Complete ──────────────────────────────────────────────────────────────────

export async function completeProjectOperation(opId: string): Promise<void> {
  await db.projectOperation.update({
    where: { id: opId },
    data:  { status: "success", completedAt: new Date() },
  }).catch(() => null); // non-fatal
}

// ── Fail ──────────────────────────────────────────────────────────────────────

export async function failProjectOperation(
  opId:  string,
  error: string,
): Promise<void> {
  await db.projectOperation.update({
    where: { id: opId },
    data:  {
      status:      "failed",
      completedAt: new Date(),
      lastError:   error.slice(0, 1_000), // truncate
    },
  }).catch(() => null); // non-fatal
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelProjectOperation(
  opId:      string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const op = await db.projectOperation.findFirst({
    where:  { id: opId, projectId },
    select: { status: true },
  });

  if (!op) return { ok: false, error: "Operation not found." };
  if (op.status !== "running") {
    return { ok: false, error: `Cannot cancel an operation with status "${op.status}".` };
  }

  await db.projectOperation.update({
    where: { id: opId },
    data:  { status: "cancelled", completedAt: new Date() },
  });
  return { ok: true };
}

// ── Active operations (for banner) ────────────────────────────────────────────

export async function getActiveProjectOperations(
  projectId: string,
): Promise<ProjectOperationDTO[]> {
  await markStaleOperations(projectId);

  const rows = await db.projectOperation.findMany({
    where:   { projectId, status: "running" },
    orderBy: { startedAt: "asc" },
    include: {
      initiatedBy: { select: { name: true, email: true } },
    },
  });

  return rows.map(toDTO);
}

// ── History (for operations panel) ───────────────────────────────────────────

export type GetOperationHistoryInput = {
  projectId:     string;
  page?:         number;
  pageSize?:     number;
  statusFilter?: OperationStatus | "all";
  typeFilter?:   OperationType   | "all";
};

export type OperationHistoryPage = {
  operations: ProjectOperationDTO[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
};

export async function getProjectOperationHistory(
  input: GetOperationHistoryInput,
): Promise<OperationHistoryPage> {
  const page     = Math.max(1, input.page     ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));

  const statusWhere = input.statusFilter && input.statusFilter !== "all"
    ? { status: input.statusFilter as string }
    : {};
  const typeWhere = input.typeFilter && input.typeFilter !== "all"
    ? { operationType: input.typeFilter as string }
    : {};

  const where = { projectId: input.projectId, ...statusWhere, ...typeWhere };

  const [rows, total] = await Promise.all([
    db.projectOperation.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      include: {
        initiatedBy: { select: { name: true, email: true } },
      },
    }),
    db.projectOperation.count({ where }),
  ]);

  return {
    operations: rows.map(toDTO),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── withOperationGuard ────────────────────────────────────────────────────────
//
// Wraps an async action fn with operation locking.
//
// Usage:
//   const result = await withOperationGuard(
//     projectId, "deploy", { title: "Deploy project", userId },
//     async () => { ... return { ok, ... }; },
//   );
//   if ("lockError" in result) return { ok: false, error: result.lockError };
//   return result.value;
//

export type OperationGuardMeta = {
  title:     string;
  userId?:   string;
  serviceId?: string;
  meta?:     Record<string, unknown>;
};

export type OperationGuardResult<T> =
  | { lockError: string }
  | { value: T };

export async function withOperationGuard<T>(
  projectId: string,
  opType:    OperationType,
  opMeta:    OperationGuardMeta,
  fn:        () => Promise<T & { ok: boolean }>,
): Promise<OperationGuardResult<T>> {
  let opId: string | null = null;

  try {
    opId = await startProjectOperation({
      projectId,
      operationType:     opType,
      title:             opMeta.title,
      initiatedByUserId: opMeta.userId,
      serviceId:         opMeta.serviceId,
      meta:              opMeta.meta,
    });
  } catch (err) {
    if (err instanceof OperationConflictError) {
      return { lockError: err.message };
    }
    // DB error during lock — fail safe (block the operation)
    return { lockError: "Could not verify operation state. Please try again." };
  }

  let result: T & { ok: boolean };
  try {
    result = await fn();
  } catch (err) {
    // fn threw — mark failed and re-throw
    const msg = err instanceof Error ? err.message : String(err);
    if (opId) await failProjectOperation(opId, msg);
    throw err;
  }

  // Release lock based on action result
  if (opId) {
    if (result.ok) {
      await completeProjectOperation(opId);
    } else {
      const errMsg =
        (result as { error?: string }).error ??
        (result as { errors?: string[] }).errors?.join("; ") ??
        "Operation failed";
      await failProjectOperation(opId, errMsg);
    }
  }

  return { value: result };
}
