/**
 * lib/permissions/dangerous-action-guard.ts
 *
 * Sprint 59: Guard helper for dangerous project actions.
 *
 * Server-only — never import from client code.
 *
 * Usage in a server action:
 *
 *   const auth = await assertCanPerformDangerousProjectAction({
 *     projectId,
 *     action: "cutover.mark_complete",
 *   });
 *   // auth.userId, auth.role available for subsequent audit events
 *
 * Throws a user-facing Error if blocked. Never throws for unexpected errors.
 */

import {
  requireProjectPermission,
  type MembershipContext,
} from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }      from "@/lib/audit/project-audit";
import { getAuditRequestContext }      from "@/lib/audit/request-context";
import type { ProjectDangerousAction } from "./project-permission-policy-types";
import type { ProjectPermission }      from "@/lib/auth/project-permissions";

export type { ProjectDangerousAction };

// ── Permission spec per dangerous action ──────────────────────────────────────

const GUARD_MAP: Record<ProjectDangerousAction, {
  primary:  ProjectPermission;
  fallback?: ProjectPermission;
}> = {
  "source.replace":                 { primary: "project.edit" },
  "env.write":                      { primary: "env.manage",      fallback: "project.edit" },
  "secret.write":                   { primary: "secrets.manage",  fallback: "project.edit" },
  "database.command_review":        { primary: "database.manage", fallback: "project.edit" },
  "deployment.trigger":             { primary: "deploy.trigger",  fallback: "project.edit" },
  "deployment.rollback":            { primary: "deploy.rollback", fallback: "project.edit" },
  "routing.apply":                  { primary: "deploy.trigger",  fallback: "project.edit" },
  "routing.rollback":               { primary: "deploy.rollback", fallback: "project.edit" },
  "github.webhook_secret_generate": { primary: "project.edit" },
  "github.auto_deploy_toggle":      { primary: "project.edit" },
  "external_services.test":         { primary: "project.edit" },
  "cutover.smoke_checks":           { primary: "deploy.trigger",  fallback: "project.edit" },
  "cutover.mark_complete":          { primary: "deploy.trigger",  fallback: "project.edit" },
  "backup.create":                  { primary: "backup.create",   fallback: "project.edit" },
  "backup.restore":                 { primary: "backup.restore" },
  "team.manage":                    { primary: "project.manageTeam" },
  "settings.write":                 { primary: "project.edit" },
};

// ── Guard function ─────────────────────────────────────────────────────────────

/**
 * Assert that the current user can perform the given dangerous action.
 *
 * - Checks primary permission; tries fallback if primary denied.
 * - Writes `permissions.dangerous_action_denied` audit event on denial.
 * - Throws a clear user-facing Error if blocked.
 * - Returns MembershipContext (userId + role) on success.
 *
 * Never includes secrets in audit metadata.
 */
export async function assertCanPerformDangerousProjectAction(input: {
  projectId:   string;
  action:      ProjectDangerousAction;
  auditEvent?: string;
}): Promise<MembershipContext> {
  const { projectId, action, auditEvent } = input;
  const spec = GUARD_MAP[action];

  // Try primary permission
  const primary = await requireProjectPermission(projectId, spec.primary);
  if (primary.ok) return primary;

  // Try fallback permission if available
  if (spec.fallback) {
    const fallback = await requireProjectPermission(projectId, spec.fallback);
    if (fallback.ok) return fallback;
  }

  // Both failed — write denied audit event and throw
  const ctx = await getAuditRequestContext().catch(() => ({
    ipAddress: null as string | null,
    userAgent: null as string | null,
  }));

  void writeProjectAuditEvent({
    projectId,
    actorUserId: undefined,
    actorRole:   undefined,
    action:      auditEvent ?? "permissions.dangerous_action_denied",
    category:    "permissions",
    result:      "denied",
    summary:     `Dangerous action blocked: ${action} — requires ${spec.primary}${spec.fallback ? ` or ${spec.fallback}` : ""}`,
    metadata:    {
      dangerousAction:    action,
      requiredPermission: spec.primary,
      fallbackPermission: spec.fallback ?? null,
    },
    ...ctx,
  }).catch(() => null);

  const permLabel = spec.fallback
    ? `${spec.primary} or ${spec.fallback}`
    : spec.primary;

  throw new Error(
    `Permission denied: ${action} requires ${permLabel}. Ask a project Owner or Admin.`,
  );
}
