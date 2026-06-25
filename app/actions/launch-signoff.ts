"use server";

/**
 * app/actions/launch-signoff.ts
 *
 * Sprint 74: Server actions for the final launch signoff workflow.
 *
 * Safety rules:
 *  - project.view required
 *  - No secret values returned
 *  - No production mutation
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateLaunchSignoffReport } from "@/lib/launch-signoff/launch-signoff-service";
import { exportLaunchSignoffReport }   from "@/lib/launch-signoff/launch-signoff-export";
import type { LaunchSignoffReport }    from "@/lib/launch-signoff/launch-signoff-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export async function generateLaunchSignoffReportAction(input: {
  projectId: string;
}): Promise<ActionResult<LaunchSignoffReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateLaunchSignoffReport({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_signoff.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Launch signoff report generated — status: ${report.status}, score: ${report.score}%`,
      metadata:    { status: report.status, score: report.score, blockers: report.blockers.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate launch signoff report.";
    return { ok: false, error: msg };
  }
}

export async function exportLaunchSignoffReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateLaunchSignoffReport({ projectId });
    const markdown = exportLaunchSignoffReport(report);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_signoff.exported",
      category:    "publishing",
      result:      "success",
      summary:     `FINAL_LAUNCH_SIGNOFF.md exported — status: ${report.status}`,
      metadata:    { status: report.status, score: report.score },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "FINAL_LAUNCH_SIGNOFF.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export launch signoff.";
    return { ok: false, error: msg };
  }
}
