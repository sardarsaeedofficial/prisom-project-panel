"use server";

/**
 * app/actions/project-monitoring.ts
 *
 * Sprint 14: Server action for per-project monitoring snapshots.
 *
 * Safety:
 *  - Ownership verified before any data is read
 *  - Never returns env var values or DATABASE_URL
 *  - Only checks the project's configured PM2 process
 *  - All checks are read-only (no restart / rollback / deploy)
 */

import { getCurrentWorkspaceId }      from "@/lib/current-workspace";
import { db }                         from "@/lib/db";
import {
  getProjectMonitoringSnapshot,
  type ProjectMonitoringSnapshot,
  type MonitorSeverity,
  type MonitorCheckStatus,
} from "@/lib/projects/project-monitoring";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export type {
  ProjectMonitoringSnapshot,
  MonitorSeverity,
  MonitorCheckStatus,
} from "@/lib/projects/project-monitoring";

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return { ok: false, error: "Not authenticated." };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found." };
  }
  return { ok: true, projectId: project.id };
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Gather a full monitoring snapshot for the selected project.
 * Read-only. All checks run concurrently. Individual failures are
 * captured and do not crash the snapshot.
 */
export async function getProjectMonitoringSnapshotAction(input: {
  projectId:    string;
  environment?: "production" | "preview" | "development";
}): Promise<ActionResult<ProjectMonitoringSnapshot>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return getProjectMonitoringSnapshot(input);
}
