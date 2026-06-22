"use server";

/**
 * app/actions/project-activity.ts
 *
 * Sprint 37: Server actions for the project activity timeline.
 *
 * Safety rules:
 *  - requireProjectPermission enforced before every query
 *  - admin users may also see project activity (via requireAdmin fallback)
 *  - no secrets returned
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { requireAdmin }             from "@/lib/auth/require-admin";
import { listActivity }             from "@/lib/activity/activity-aggregator";
import type {
  ListActivityInput,
  ListActivityOutput,
} from "@/lib/activity/activity-types";

export async function getProjectActivityAction(
  projectId: string,
  input: Omit<ListActivityInput, "projectId">,
): Promise<{ ok: true; result: ListActivityOutput } | { ok: false; error: string }> {
  try {
    if (!projectId || typeof projectId !== "string") {
      return { ok: false, error: "Invalid project ID" };
    }

    // Allow project members with view permission OR global admins
    const perm = await requireProjectPermission(projectId, "project.view");
    if (!perm.ok) {
      // Try admin fallback
      try {
        await requireAdmin();
      } catch {
        return { ok: false, error: "You do not have access to this project." };
      }
    }

    const result = await listActivity({ ...input, projectId });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load activity" };
  }
}
