"use server";

/**
 * app/actions/operator-runbook.ts
 *
 * Sprint 67: Server actions for Operator Runbook + Admin Onboarding.
 *
 * Safety:
 *  - no secrets returned
 *  - no production mutation
 *  - read-only service calls
 *  - Doorsteps/LocalShop untouched
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { getCurrentUser }           from "@/lib/current-workspace";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateOperatorRunbook }  from "@/lib/runbook/operator-runbook-service";
import { exportOperatorRunbook }    from "@/lib/runbook/operator-runbook-export";
import type { OperatorRunbook }     from "@/lib/runbook/operator-runbook-types";

// ── Result type ───────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Generate runbook ───────────────────────────────────────────────────────

export async function generateOperatorRunbookAction(input: {
  projectId?: string;
}): Promise<ActionResult<OperatorRunbook>> {
  const { projectId } = input;

  // If projectId provided, require project.view; otherwise require global admin
  if (projectId) {
    const auth = await requireProjectPermission(projectId, "project.view");
    if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

    const runbook = await generateOperatorRunbook({ projectId }).catch(
      (e: unknown) => {
        throw new Error(`Failed to generate runbook: ${e instanceof Error ? e.message : String(e)}`);
      },
    );

    try {
      const ctx = await getAuditRequestContext();
      await writeProjectAuditEvent({
        projectId,
        actorUserId: auth.userId,
        action:      "operator_runbook.generated",
        category:    "publishing",
        result:      "success",
        summary:     "Operator runbook generated",
        metadata:    { ...ctx },
      });
    } catch { /* audit is best-effort */ }

    return { ok: true, data: runbook };
  }

  // Global admin path — no projectId
  try {
    const user = await getCurrentUser();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return { ok: false, error: "Admin access required", code: "FORBIDDEN" };
    }
  } catch {
    return { ok: false, error: "Not authenticated", code: "UNAUTHENTICATED" };
  }

  const runbook = await generateOperatorRunbook({}).catch(
    (e: unknown) => {
      throw new Error(`Failed to generate runbook: ${e instanceof Error ? e.message : String(e)}`);
    },
  );

  return { ok: true, data: runbook };
}

// ── 2. Export runbook ─────────────────────────────────────────────────────────

export async function exportOperatorRunbookAction(input: {
  projectId?: string;
}): Promise<ActionResult<{ content: string; filename: string }>> {
  const { projectId } = input;

  if (projectId) {
    const auth = await requireProjectPermission(projectId, "project.view");
    if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

    const runbook = await generateOperatorRunbook({ projectId });
    const content = exportOperatorRunbook(runbook);

    try {
      const ctx = await getAuditRequestContext();
      await writeProjectAuditEvent({
        projectId,
        actorUserId: auth.userId,
        action:      "operator_runbook.exported",
        category:    "publishing",
        result:      "success",
        summary:     "OPERATOR_RUNBOOK.md exported",
        metadata:    { ...ctx },
      });
    } catch { /* audit is best-effort */ }

    return { ok: true, data: { content, filename: "OPERATOR_RUNBOOK.md" } };
  }

  // Global admin path
  try {
    const user = await getCurrentUser();
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return { ok: false, error: "Admin access required", code: "FORBIDDEN" };
    }
  } catch {
    return { ok: false, error: "Not authenticated", code: "UNAUTHENTICATED" };
  }

  const runbook = await generateOperatorRunbook({});
  const content = exportOperatorRunbook(runbook);

  return { ok: true, data: { content, filename: "OPERATOR_RUNBOOK.md" } };
}
