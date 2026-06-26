"use server";

import { requireProjectPermission }       from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }         from "@/lib/audit/project-audit";
import { getAuditRequestContext }         from "@/lib/audit/request-context";
import { generateStopBuildGateReport }    from "@/lib/stop-build/stop-build-service";
import { exportStopBuildGateReport }      from "@/lib/stop-build/stop-build-export";
import type { StopBuildGateReport }       from "@/lib/stop-build/stop-build-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateStopBuildGateReportAction(input: {
  projectId: string;
}): Promise<ActionResult<StopBuildGateReport>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateStopBuildGateReport({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "stop_build.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Stop-build gate generated — decision: ${report.decision}`,
      metadata:    { decision: report.decision, blockers: report.blockers.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate stop-build gate report." };
  }
}

export async function exportStopBuildGateReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateStopBuildGateReport({ projectId });
    const markdown = exportStopBuildGateReport(report);
    const ctx      = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "stop_build.exported",
      category:    "publishing",
      result:      "success",
      summary:     "STOP_BUILD_GATE.md exported",
      metadata:    { decision: report.decision },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "STOP_BUILD_GATE.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export stop-build gate report." };
  }
}
