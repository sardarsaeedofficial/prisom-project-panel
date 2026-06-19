"use server";

/**
 * app/actions/project-preview.ts
 *
 * Sprint 4: server actions for the project Preview tab.
 *
 * These are called client-side (from PreviewIframe) to refresh the preview
 * target and PM2 status on demand.
 *
 * No secrets are returned. No VPS changes are made.
 */

import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  resolveProjectLiveEndpoints,
  buildPreviewTarget,
  type ProjectPreviewTarget,
} from "@/lib/projects/live-endpoint-resolver";
import { getPm2AppStatus } from "@/lib/projects/project-deploy-runner";

// ── Shared result type ─────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Data types ─────────────────────────────────────────────────────────────

export interface ProjectPreviewStatus {
  /** Raw PM2 process status string ("online" | "stopped" | "errored" | …) */
  pm2Status:  string | null;
  /** PM2 process name for display */
  pm2Name:    string | null;
  /** Whether the PM2 process is currently "online" */
  isOnline:   boolean;
  /** The resolved preview target (URL, mode, iframe src) */
  target:     ProjectPreviewTarget;
}

// ── Ownership guard ────────────────────────────────────────────────────────

async function verifyOwnership(projectId: string) {
  // Sprint 17: preview requires project.view permission
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return null;
  return db.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true } });
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Resolves the current preview target and PM2 status for a project.
 *
 * Used on initial page load (server component) and on client-side refresh.
 */
export async function getProjectPreviewTargetAction(
  projectId: string
): Promise<ActionResult<ProjectPreviewStatus>> {
  const project = await verifyOwnership(projectId);
  if (!project) {
    return { ok: false, error: "Not found or access denied.", code: "FORBIDDEN" };
  }

  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true },
  });

  const [endpoints, pm2Raw] = await Promise.all([
    resolveProjectLiveEndpoints(projectId),
    config
      ? getPm2AppStatus(config.pm2Name).catch(() => null)
      : Promise.resolve(null),
  ]);

  const isOnline = pm2Raw?.status === "online";
  const target   = buildPreviewTarget(projectId, endpoints, isOnline);

  return {
    ok:   true,
    data: {
      pm2Status: pm2Raw?.status ?? null,
      pm2Name:   config?.pm2Name ?? null,
      isOnline,
      target,
    },
  };
}

/**
 * Alias — re-checks preview status (same logic as getProjectPreviewTargetAction).
 * Exported separately to match the Sprint 4 spec interface.
 */
export async function checkProjectPreviewStatusAction(
  projectId: string
): Promise<ActionResult<ProjectPreviewStatus>> {
  return getProjectPreviewTargetAction(projectId);
}
