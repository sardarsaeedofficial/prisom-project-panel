"use server";

import { requireProjectPermission }           from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }             from "@/lib/audit/project-audit";
import { getAuditRequestContext }             from "@/lib/audit/request-context";
import { generatePostLaunchBugCaptureReport } from "@/lib/post-launch/post-launch-bug-service";
import { exportPostLaunchBugCaptureReport }   from "@/lib/post-launch/post-launch-bug-export";
import type { PostLaunchBugCaptureReport }    from "@/lib/post-launch/post-launch-bug-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generatePostLaunchBugCaptureReportAction(input: {
  projectId: string;
}): Promise<ActionResult<PostLaunchBugCaptureReport>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generatePostLaunchBugCaptureReport({ projectId });
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "post_launch_bug_capture.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Post-launch bug capture report generated — ${report.issueTemplates.length} templates`,
      metadata:    { issueCount: report.issueTemplates.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate bug capture report." };
  }
}

export async function exportPostLaunchBugCaptureReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report   = await generatePostLaunchBugCaptureReport({ projectId });
    const markdown = exportPostLaunchBugCaptureReport(report);
    const ctx      = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "post_launch_bug_capture.exported",
      category:    "publishing",
      result:      "success",
      summary:     "POST_LAUNCH_BUG_CAPTURE.md exported",
      metadata:    {},
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "POST_LAUNCH_BUG_CAPTURE.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export bug capture report." };
  }
}
