"use server";

/**
 * app/actions/project-permission-policy.ts
 *
 * Sprint 59: Server actions for the project permission policy system.
 *
 * Safety rules:
 *  - project.view required for all actions.
 *  - No secrets returned.
 *  - Read-only — no mutations.
 */

import { requireProjectPermission }              from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }                from "@/lib/audit/project-audit";
import { getAuditRequestContext }                from "@/lib/audit/request-context";
import {
  generateProjectPermissionPolicyReport,
  canPerformDangerousProjectAction,
} from "@/lib/permissions/project-permission-policy";
import type {
  ProjectPermissionPolicyReport,
  ProjectPermissionPolicyCheck,
  ProjectDangerousAction,
} from "@/lib/permissions/project-permission-policy-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Generate full permission policy report ─────────────────────────────────

export async function generateProjectPermissionPolicyReportAction(
  projectId: string,
): Promise<ActionResult<ProjectPermissionPolicyReport>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateProjectPermissionPolicyReport(projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "permissions.policy_generated",
      category:    "permissions",
      result:      "success",
      summary:     `Permission policy report generated — role: ${report.currentUserRole}, blockers: ${report.blockers.length}`,
      metadata:    {
        role:          report.currentUserRole,
        isAdmin:       report.isAdmin,
        blockerCount:  report.blockers.length,
        warningCount:  report.warnings.length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate permission policy report.";
    return { ok: false, error: msg };
  }
}

// ── 2. Check a single dangerous action ────────────────────────────────────────

export async function checkDangerousActionPermissionAction(input: {
  projectId: string;
  action:    ProjectDangerousAction;
}): Promise<ActionResult<ProjectPermissionPolicyCheck>> {
  const { projectId, action } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const check = await canPerformDangerousProjectAction({ projectId, action });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "permissions.dangerous_action_checked",
      category:    "permissions",
      result:      "success",
      summary:     `Dangerous action checked: ${action} — ${check.status}`,
      metadata:    { dangerousAction: action, status: check.status, role: check.userRole },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: check };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to check permission.";
    return { ok: false, error: msg };
  }
}
