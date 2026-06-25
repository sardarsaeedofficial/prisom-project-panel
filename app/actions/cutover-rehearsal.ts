"use server";

/**
 * app/actions/cutover-rehearsal.ts
 *
 * Sprint 75: Server actions for cutover rehearsal report generation and export.
 *
 * Safety rules:
 *  - project.view required
 *  - No secret values returned
 *  - No production mutation
 */

import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { getAuditRequestContext }        from "@/lib/audit/request-context";
import { generateCutoverRehearsalReport } from "@/lib/cutover-rehearsal/cutover-rehearsal-service";
import { exportCutoverRehearsalReport }   from "@/lib/cutover-rehearsal/cutover-rehearsal-export";
import type { CutoverRehearsalReport }    from "@/lib/cutover-rehearsal/cutover-rehearsal-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export async function generateCutoverRehearsalReportAction(input: {
  projectId: string;
}): Promise<ActionResult<CutoverRehearsalReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateCutoverRehearsalReport({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "cutover_rehearsal.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Cutover rehearsal report generated — status: ${report.status}, score: ${report.score}%`,
      metadata:    { status: report.status, score: report.score, blockers: report.blockers.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate cutover rehearsal report.";
    return { ok: false, error: msg };
  }
}

export async function exportCutoverRehearsalReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateCutoverRehearsalReport({ projectId });
    const markdown = exportCutoverRehearsalReport(report);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "cutover_rehearsal.exported",
      category:    "publishing",
      result:      "success",
      summary:     `FINAL_CUTOVER_REHEARSAL.md exported — status: ${report.status}`,
      metadata:    { status: report.status, score: report.score },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "FINAL_CUTOVER_REHEARSAL.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export cutover rehearsal report.";
    return { ok: false, error: msg };
  }
}
