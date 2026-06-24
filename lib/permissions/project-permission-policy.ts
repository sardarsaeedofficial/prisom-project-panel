/**
 * lib/permissions/project-permission-policy.ts
 *
 * Sprint 59: Permission policy service.
 *
 * Server-only — never import from client code.
 * Uses existing requireProjectPermission + hasPermission infrastructure.
 */

import {
  requireProjectPermission,
  getProjectRoleForUser,
  ensureProjectOwnerMembership,
} from "@/lib/auth/project-membership";
import {
  hasPermission,
  type ProjectPermission,
  type ProjectRole,
} from "@/lib/auth/project-permissions";
import { getCurrentUser } from "@/lib/current-workspace";
import type {
  ProjectDangerousAction,
  ProjectPermissionPolicyCheck,
  ProjectPermissionPolicyReport,
} from "./project-permission-policy-types";
import { DANGEROUS_ACTION_LABELS } from "./project-permission-policy-types";

// ── Action → required permission mapping ──────────────────────────────────────
//
// "primary" is checked first; "fallback" is tried if primary is denied.
// If neither is held the action is blocked.

type PermissionSpec = {
  primary:  ProjectPermission;
  fallback?: ProjectPermission;
  note?:    string;
};

const ACTION_PERMISSION_MAP: Record<ProjectDangerousAction, PermissionSpec> = {
  "source.replace":                 { primary: "project.edit" },
  "env.write":                      { primary: "env.manage",      fallback: "project.edit" },
  "secret.write":                   { primary: "secrets.manage",  fallback: "project.edit" },
  "database.command_review":        { primary: "database.manage", fallback: "project.edit" },
  "deployment.trigger":             { primary: "deploy.trigger",  fallback: "project.edit" },
  "deployment.rollback":            { primary: "deploy.rollback", fallback: "project.edit" },
  "routing.apply":                  { primary: "deploy.trigger",  fallback: "project.edit",
    note: "Requires APPLY ROUTES confirmation phrase in addition to permission" },
  "routing.rollback":               { primary: "deploy.rollback", fallback: "project.edit" },
  "github.webhook_secret_generate": { primary: "project.edit" },
  "github.auto_deploy_toggle":      { primary: "project.edit" },
  "external_services.test":         { primary: "project.edit" },
  "cutover.smoke_checks":           { primary: "deploy.trigger",  fallback: "project.edit",
    note: "Requires RUN SMOKE CHECKS confirmation phrase" },
  "cutover.mark_complete":          { primary: "deploy.trigger",  fallback: "project.edit",
    note: "Requires MARK CUTOVER COMPLETE confirmation phrase" },
  "backup.create":                  { primary: "backup.create",   fallback: "project.edit" },
  "backup.restore":                 { primary: "backup.restore" },
  "team.manage":                    { primary: "project.manageTeam" },
  "settings.write":                 { primary: "project.edit" },
};

/** Human-readable label for a permission. */
function permissionLabel(spec: PermissionSpec): string {
  const p = spec.fallback
    ? `${spec.primary} or ${spec.fallback}`
    : spec.primary;
  return spec.note ? `${p} (${spec.note})` : p;
}

// ── Role resolution (no permission check — just get the role) ─────────────────

async function resolveCurrentUserRole(
  projectId: string,
): Promise<{ userId: string; role: ProjectRole } | null> {
  try {
    const user = await getCurrentUser();
    await ensureProjectOwnerMembership(projectId, user.id);
    const role = await getProjectRoleForUser(projectId, user.id);
    if (!role) return null;
    return { userId: user.id, role };
  } catch {
    return null;
  }
}

// ── Single action check ───────────────────────────────────────────────────────

export function checkActionForRole(
  action:    ProjectDangerousAction,
  role:      ProjectRole,
): ProjectPermissionPolicyCheck {
  const spec  = ACTION_PERMISSION_MAP[action];
  const label = DANGEROUS_ACTION_LABELS[action];
  const permLabel = permissionLabel(spec);

  const primaryOk  = hasPermission(role, spec.primary);
  const fallbackOk = spec.fallback ? hasPermission(role, spec.fallback) : false;
  const allowed    = primaryOk || fallbackOk;

  if (allowed) {
    return {
      action,
      label,
      status:             "allowed",
      requiredPermission: permLabel,
      userRole:           role,
      message:            `Your role (${role}) grants permission to perform this action.`,
    };
  }

  return {
    action,
    label,
    status:             "blocked",
    requiredPermission: permLabel,
    userRole:           role,
    message:            `Your role (${role}) does not have ${spec.primary}${spec.fallback ? ` or ${spec.fallback}` : ""}. Ask a project Owner or Admin to perform this action.`,
  };
}

// ── Full report ───────────────────────────────────────────────────────────────

export async function generateProjectPermissionPolicyReport(
  projectId: string,
): Promise<ProjectPermissionPolicyReport> {
  const now = new Date().toISOString();

  const resolved = await resolveCurrentUserRole(projectId);

  if (!resolved) {
    return {
      projectId,
      generatedAt:      now,
      currentUserRole:  null,
      isAdmin:          false,
      checks:           [],
      blockers:         ["Could not resolve your project role. Are you a project member?"],
      warnings:         [],
      nextSteps:        ["Ask a project Owner or Admin to add you as a team member."],
    };
  }

  const { role } = resolved;
  const isAdmin   = role === "owner" || role === "admin";

  const actions = Object.keys(ACTION_PERMISSION_MAP) as ProjectDangerousAction[];
  const checks  = actions.map((action) => checkActionForRole(action, role));

  const blockers = checks
    .filter((c) => c.status === "blocked")
    .map((c) => `${c.label}: requires ${c.requiredPermission}`);

  const warnings = checks
    .filter((c) => c.status === "warning")
    .map((c) => c.message);

  const nextSteps: string[] = [];
  if (blockers.length > 0) {
    nextSteps.push("Ask a project Owner or Admin to upgrade your role if you need to perform blocked actions.");
  }
  if (!isAdmin) {
    nextSteps.push("Owners and Admins can perform all dangerous actions.");
  }
  nextSteps.push("Review the Team page to confirm the right people have deploy and cutover access.");

  return {
    projectId,
    generatedAt:     now,
    currentUserRole: role,
    isAdmin,
    checks,
    blockers,
    warnings,
    nextSteps,
  };
}

// ── Per-action async check (for server actions) ───────────────────────────────

export async function canPerformDangerousProjectAction(input: {
  projectId: string;
  action:    ProjectDangerousAction;
}): Promise<ProjectPermissionPolicyCheck> {
  const { projectId, action } = input;

  const resolved = await resolveCurrentUserRole(projectId);

  if (!resolved) {
    return {
      action,
      label:              DANGEROUS_ACTION_LABELS[action],
      status:             "blocked",
      requiredPermission: permissionLabel(ACTION_PERMISSION_MAP[action]),
      userRole:           null,
      message:            "Could not resolve your project role.",
    };
  }

  return checkActionForRole(action, resolved.role);
}
