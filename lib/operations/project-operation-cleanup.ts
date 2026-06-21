/**
 * lib/operations/project-operation-cleanup.ts
 *
 * Sprint 27: Marks stale "running" operations for a project.
 *
 * Call this BEFORE checking for conflicts so that long-since-dead
 * processes don't permanently block new operations.
 *
 * A "running" operation is stale when:
 *   updatedAt < now - STALE_THRESHOLD_MS[operationType]
 *
 * This is intentionally conservative: we use updatedAt (not startedAt)
 * so that heartbeating operations (future enhancement) would stay fresh.
 * Currently no heartbeat is implemented — all operations complete in one
 * server action call — so updatedAt == startedAt in practice.
 */

import { db }                    from "@/lib/db";
import { STALE_THRESHOLD_MS }    from "./project-operation-locks";
import type { OperationType }    from "./project-operation-types";
import { OPERATION_TYPES }       from "./project-operation-types";

export async function markStaleOperations(projectId: string): Promise<void> {
  const now = Date.now();

  // Build per-type cutoff times
  const staleBefore: Record<string, Date> = {};
  for (const opType of OPERATION_TYPES) {
    const threshold = STALE_THRESHOLD_MS[opType as OperationType];
    staleBefore[opType] = new Date(now - threshold);
  }

  // Find all running operations for this project
  const running = await db.projectOperation.findMany({
    where:  { projectId, status: "running" },
    select: { id: true, operationType: true, updatedAt: true },
  });

  if (running.length === 0) return;

  const staleIds: string[] = [];
  for (const op of running) {
    const cutoff = staleBefore[op.operationType];
    if (cutoff && op.updatedAt < cutoff) {
      staleIds.push(op.id);
    }
  }

  if (staleIds.length === 0) return;

  await db.projectOperation.updateMany({
    where: { id: { in: staleIds } },
    data:  {
      status:      "stale",
      completedAt: new Date(),
      lastError:   "Operation timed out — marked stale by cleanup.",
    },
  });
}
