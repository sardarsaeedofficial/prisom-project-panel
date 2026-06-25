"use server";

/**
 * app/actions/launch-freeze.ts
 *
 * Sprint 75: Server actions for launch freeze report generation and export.
 *
 * Safety rules:
 *  - project.view required
 *  - No secret values returned
 *  - No production mutation
 */

import { requireProjectPermission }   from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }     from "@/lib/audit/project-audit";
import { getAuditRequestContext }     from "@/lib/audit/request-context";
import { generateLaunchFreezeReport } from "@/lib/launch-freeze/launch-freeze-service";
import { exportLaunchFreezeReport }   from "@/lib/launch-freeze/launch-freeze-export";
import type { LaunchFreezeReport }    from "@/lib/launch-freeze/launch-freeze-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export async function generateLaunchFreezeReportAction(input: {
  projectId: string;
}): Promise<ActionResult<LaunchFreezeReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateLaunchFreezeReport({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_freeze.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Launch freeze report generated — status: ${report.status}`,
      metadata:    { status: report.status, blockers: report.blockers.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate launch freeze report.";
    return { ok: false, error: msg };
  }
}

export async function exportLaunchFreezeReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateLaunchFreezeReport({ projectId });
    const markdown = exportLaunchFreezeReport(report);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_freeze.exported",
      category:    "publishing",
      result:      "success",
      summary:     `LAUNCH_FREEZE_CHECKLIST.md exported — status: ${report.status}`,
      metadata:    { status: report.status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "LAUNCH_FREEZE_CHECKLIST.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export launch freeze report.";
    return { ok: false, error: msg };
  }
}
