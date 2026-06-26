"use server";

import { requireProjectPermission }    from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }      from "@/lib/audit/project-audit";
import { getAuditRequestContext }      from "@/lib/audit/request-context";
import { generateFinalReadinessAudit } from "@/lib/final-readiness/final-readiness-service";
import { exportFinalReadinessAudit }   from "@/lib/final-readiness/final-readiness-export";
import type { FinalReadinessAudit }    from "@/lib/final-readiness/final-readiness-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateFinalReadinessAuditAction(input: {
  projectId: string;
}): Promise<ActionResult<FinalReadinessAudit>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const audit = await generateFinalReadinessAudit({ projectId });
    const ctx   = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_readiness.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Final readiness audit generated — status: ${audit.status}, score: ${audit.score}%`,
      metadata:    { status: audit.status, score: audit.score, blockers: audit.blockers.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: audit };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate final readiness audit." };
  }
}

export async function exportFinalReadinessAuditAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const audit    = await generateFinalReadinessAudit({ projectId });
    const markdown = exportFinalReadinessAudit(audit);
    const ctx      = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_readiness.exported",
      category:    "publishing",
      result:      "success",
      summary:     `FINAL_READINESS_AUDIT.md exported — status: ${audit.status}`,
      metadata:    { status: audit.status, score: audit.score },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: { markdown, filename: "FINAL_READINESS_AUDIT.md" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export final readiness audit." };
  }
}
