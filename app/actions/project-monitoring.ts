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

import { requireProjectPermission }    from "@/lib/auth/project-membership";
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
  // Sprint 17: monitoring snapshots require monitoring.view permission
  const auth = await requireProjectPermission(projectId, "monitoring.view");
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, projectId };
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
