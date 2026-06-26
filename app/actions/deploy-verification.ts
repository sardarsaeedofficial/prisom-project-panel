"use server";

import { requireProjectPermission }          from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }            from "@/lib/audit/project-audit";
import { getAuditRequestContext }            from "@/lib/audit/request-context";
import { generateDeployVerificationReport }  from "@/lib/deploy-verification/deploy-verification-service";
import { exportDeployVerificationReport }    from "@/lib/deploy-verification/deploy-verification-export";
import type { DeployVerificationReport }     from "@/lib/deploy-verification/deploy-verification-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateDeployVerificationReportAction(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<ActionResult<DeployVerificationReport>> {
  const { projectId, expectedCommit } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateDeployVerificationReport({ projectId, expectedCommit });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "deploy_verification.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Deploy verification report generated — status: ${report.status}`,
      metadata:    { status: report.status, expectedCommit: expectedCommit ?? null, blockers: report.blockers.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate deploy verification report." };
  }
}

export async function exportDeployVerificationReportAction(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId, expectedCommit } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generateDeployVerificationReport({ projectId, expectedCommit });
    const markdown = exportDeployVerificationReport(report);
    const ctx      = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "deploy_verification.exported",
      category:    "publishing",
      result:      "success",
      summary:     "DEPLOY_VERIFICATION_REPORT.md exported",
      metadata:    { status: report.status },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "DEPLOY_VERIFICATION_REPORT.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export deploy verification report." };
  }
}
