"use server";

import { requireProjectPermission }             from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }               from "@/lib/audit/project-audit";
import { getAuditRequestContext }               from "@/lib/audit/request-context";
import { generateFinalLiveVerificationRun }     from "@/lib/final-live-verification/final-live-verification-service";
import { exportFinalLiveVerificationRun }       from "@/lib/final-live-verification/final-live-verification-export";
import type { FinalLiveVerificationRun }        from "@/lib/final-live-verification/final-live-verification-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateFinalLiveVerificationRunAction(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<ActionResult<FinalLiveVerificationRun>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateFinalLiveVerificationRun(input);
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_live_verification.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Final live verification generated — status: ${report.status}, score: ${report.score}%`,
      metadata:    { status: report.status, score: report.score },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate final live verification run." };
  }
}

export async function exportFinalLiveVerificationRunAction(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportFinalLiveVerificationRun(input);
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_live_verification.exported",
      category:    "publishing",
      result:      "success",
      summary:     `FINAL_LIVE_VERIFICATION_RUN.md exported`,
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export final live verification run." };
  }
}
