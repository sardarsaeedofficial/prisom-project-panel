"use server";

/**
 * app/actions/admin-activity.ts
 *
 * Sprint 37: Server actions for the admin-wide activity feed.
 * OWNER/ADMIN only.
 */

import { requireAdmin }  from "@/lib/auth/require-admin";
import { listActivity }  from "@/lib/activity/activity-aggregator";
import { db }            from "@/lib/db";
import type {
  ListActivityInput,
  ListActivityOutput,
} from "@/lib/activity/activity-types";

export async function getAdminActivityAction(
  input: ListActivityInput,
): Promise<{ ok: true; result: ListActivityOutput } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const result = await listActivity(input);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load activity" };
  }
}

export type ProjectOption = { id: string; name: string; slug: string };

export async function getProjectsForActivityFilterAction(): Promise<
  { ok: true; projects: ProjectOption[] } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    const rows = await db.project.findMany({
      select:  { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return { ok: true, projects: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load projects" };
  }
}
