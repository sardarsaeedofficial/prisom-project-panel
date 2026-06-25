"use server";

/**
 * app/actions/operator-training.ts
 *
 * Sprint 74: Server actions for operator training pack generation and export.
 *
 * Safety rules:
 *  - project.view required
 *  - No secret values returned
 *  - No production mutation
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateOperatorTrainingPack } from "@/lib/operator-training/operator-training-service";
import { exportOperatorTrainingPack }   from "@/lib/operator-training/operator-training-export";
import type { OperatorTrainingPack }    from "@/lib/operator-training/operator-training-types";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export async function generateOperatorTrainingPackAction(input: {
  projectId: string;
}): Promise<ActionResult<OperatorTrainingPack>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const pack = await generateOperatorTrainingPack({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "operator_training.generated",
      category:    "publishing",
      result:      "success",
      summary:     `Operator training pack generated — ${pack.sections.length} sections`,
      metadata:    { sectionCount: pack.sections.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: pack };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate operator training pack.";
    return { ok: false, error: msg };
  }
}

export async function exportOperatorTrainingPackAction(input: {
  projectId: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const pack     = await generateOperatorTrainingPack({ projectId });
    const markdown = exportOperatorTrainingPack(pack);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "operator_training.exported",
      category:    "publishing",
      result:      "success",
      summary:     "OPERATOR_TRAINING_PACK.md exported",
      metadata:    {},
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "OPERATOR_TRAINING_PACK.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export operator training pack.";
    return { ok: false, error: msg };
  }
}
