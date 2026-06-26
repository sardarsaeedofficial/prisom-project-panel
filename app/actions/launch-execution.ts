"use server";

import { requireProjectPermission }        from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }          from "@/lib/audit/project-audit";
import { getAuditRequestContext }          from "@/lib/audit/request-context";
import { generateLaunchExecutionChecklist } from "@/lib/launch-execution/launch-execution-service";
import { exportLaunchExecutionChecklist }  from "@/lib/launch-execution/launch-execution-export";
import type { LaunchExecutionChecklist }   from "@/lib/launch-execution/launch-execution-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateLaunchExecutionChecklistAction(input: {
  projectId: string;
}): Promise<ActionResult<LaunchExecutionChecklist>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const checklist = await generateLaunchExecutionChecklist({ projectId });
    const ctx       = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_execution.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Launch execution checklist generated — status: ${checklist.status}`,
      metadata:    { status: checklist.status, blockers: checklist.blockers.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: checklist };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate launch execution checklist." };
  }
}

export async function exportLaunchExecutionChecklistAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const checklist = await generateLaunchExecutionChecklist({ projectId });
    const markdown  = exportLaunchExecutionChecklist(checklist);
    const ctx       = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "launch_execution.exported",
      category:    "publishing",
      result:      "success",
      summary:     "LAUNCH_EXECUTION_CHECKLIST.md exported",
      metadata:    { status: checklist.status },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "LAUNCH_EXECUTION_CHECKLIST.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export launch execution checklist." };
  }
}
