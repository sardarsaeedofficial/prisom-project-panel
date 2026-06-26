"use server";

import { requireProjectPermission }       from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }         from "@/lib/audit/project-audit";
import { getAuditRequestContext }         from "@/lib/audit/request-context";
import { generateLaunchDaySupportReport } from "@/lib/launch-day/launch-day-service";
import { exportLaunchDaySupportReport }   from "@/lib/launch-day/launch-day-export";
import type { LaunchDaySupportReport }    from "@/lib/launch-day/launch-day-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateLaunchDaySupportReportAction(input: {
  projectId: string;
}): Promise<ActionResult<LaunchDaySupportReport>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateLaunchDaySupportReport({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_day.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Launch-day support report generated — status: ${report.status}`,
      metadata:    { status: report.status, steps: report.timeline.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate launch-day report." };
  }
}

export async function exportLaunchDaySupportReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateLaunchDaySupportReport({ projectId });
    const markdown = exportLaunchDaySupportReport(report);
    const ctx      = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_day.exported",
      category:    "publishing",
      result:      "success",
      summary:     "LAUNCH_DAY_SUPPORT_REPORT.md exported",
      metadata:    { status: report.status },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "LAUNCH_DAY_SUPPORT_REPORT.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export launch-day report." };
  }
}
