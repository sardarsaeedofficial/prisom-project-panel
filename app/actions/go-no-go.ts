"use server";

import { requireProjectPermission }   from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }     from "@/lib/audit/project-audit";
import { getAuditRequestContext }     from "@/lib/audit/request-context";
import { generateGoNoGoEvidencePack } from "@/lib/go-no-go/go-no-go-service";
import { exportGoNoGoEvidencePack }   from "@/lib/go-no-go/go-no-go-export";
import type { GoNoGoEvidencePack }    from "@/lib/go-no-go/go-no-go-types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function generateGoNoGoEvidencePackAction(input: {
  projectId: string;
}): Promise<ActionResult<GoNoGoEvidencePack>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const pack = await generateGoNoGoEvidencePack(input);
    const ctx  = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "go_no_go.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Go/no-go evidence pack generated — decision: ${pack.decision}`,
      metadata:    { decision: pack.decision, blockers: pack.blockers.length },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: pack };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to generate go/no-go evidence pack." };
  }
}

export async function exportGoNoGoEvidencePackAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const result = await exportGoNoGoEvidencePack(input);
    const ctx    = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "go_no_go.exported",
      category:    "publishing",
      result:      "success",
      summary:     `GO_NO_GO_EVIDENCE_PACK.md exported`,
      metadata:    { filename: result.filename },
      ...ctx,
    }).catch(() => null);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Failed to export go/no-go evidence pack." };
  }
}
