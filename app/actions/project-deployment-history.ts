"use server";

/**
 * app/actions/project-deployment-history.ts
 *
 * Sprint 13: Server actions for deployment history and safe rollback.
 *
 * Safety:
 *  - Ownership verified on every call
 *  - Protected PM2 processes blocked in deployment-history.ts
 *  - Release paths validated before rollback
 *  - confirm=true required for rollback execution
 *  - Only selected project's PM2 process is restarted
 */

import { revalidatePath }           from "next/cache";
import { db }                       from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  listProjectDeploymentHistory,
  getProjectDeploymentDetail,
  rollbackProjectDeployment,
  backfillActiveDeployment,
  type DeploymentHistoryResponse,
  type DeploymentHistoryDetail,
  type RollbackResult,
  type BackfillResult,
} from "@/lib/projects/deployment-history";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// Re-export so the client can import types from one place
export type {
  DeploymentHistoryResponse,
  DeploymentHistoryDetail,
  RollbackResult,
  BackfillResult,
  DeploymentHistoryItem,
  DeploymentLogEntry,
  RollbackReadinessCheck,
} from "@/lib/projects/deployment-history";

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  // Sprint 17: viewing deployment history requires deploy.trigger permission
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, projectId };
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Retrieve the deployment history for a project (up to 100 most recent).
 */
export async function getProjectDeploymentHistoryAction(
  projectId: string,
): Promise<ActionResult<DeploymentHistoryResponse>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return listProjectDeploymentHistory({ projectId, limit: 100 });
}

/**
 * Get full detail (metadata + logs) for a single deployment.
 */
export async function getProjectDeploymentDetailAction(input: {
  projectId:    string;
  deploymentId: string;
}): Promise<ActionResult<DeploymentHistoryDetail>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return getProjectDeploymentDetail(input);
}

/**
 * Roll back to a previous deployment.
 *
 * Requires confirm=true. Validates release path. Restarts only the
 * selected project's PM2 process. Runs readiness after rollback.
 */
export async function rollbackProjectDeploymentAction(input: {
  projectId:          string;
  targetDeploymentId: string;
  confirm:            boolean;
}): Promise<ActionResult<RollbackResult>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await rollbackProjectDeployment(input);

  if (result.ok) {
    revalidatePath(`/projects/${input.projectId}/publishing`);
  }

  return result;
}

/**
 * Backfill: mark the newest successful deployment (with existing release folder)
 * as active, when no deployment currently has isActive=true.
 *
 * Requires an explicit button click. Never auto-invoked.
 */
export async function backfillActiveDeploymentAction(
  projectId: string,
): Promise<ActionResult<BackfillResult>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await backfillActiveDeployment({ projectId });

  if (result.ok) {
    revalidatePath(`/projects/${projectId}/publishing`);
  }

  return result;
}
