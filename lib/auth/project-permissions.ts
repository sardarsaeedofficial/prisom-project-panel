/**
 * lib/auth/project-permissions.ts
 *
 * Sprint 17: Project-level permission matrix.
 *
 * No server-only dependencies — safe to import in both client and server code.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectRole =
  | "owner"
  | "admin"
  | "developer"
  | "operator"
  | "viewer";

export type ProjectPermission =
  // Project metadata
  | "project.view"
  | "project.edit"
  | "project.delete"
  | "project.manageTeam"
  // Files
  | "files.read"
  | "files.write"
  // Terminal
  | "terminal.use"
  // Environment variables
  | "env.view"       // See key names only
  | "env.manage"     // Read / write values
  // Deployments
  | "deploy.trigger"
  | "deploy.rollback"
  // Monitoring & alerts
  | "monitoring.view"
  | "monitoring.manage"
  // Logs
  | "logs.view"
  // Database
  | "database.view"
  | "database.manage"
  // Domains
  | "domains.view"
  | "domains.manage"
  // Packages
  | "packages.view"
  | "packages.manage"
  // AI assistant
  | "ai.use"
  // GitHub
  | "github.view"
  // Sprint 18: Audit log
  | "audit.view"
  | "audit.export";

// ── Permission sets per role ───────────────────────────────────────────────────

const VIEWER_PERMISSIONS = new Set<ProjectPermission>([
  "project.view",
  "files.read",
  "env.view",
  "monitoring.view",
  "logs.view",
  "database.view",
  "domains.view",
  "packages.view",
  "github.view",
  // Viewers do NOT get audit.view — audit is sensitive operational metadata
]);

const OPERATOR_PERMISSIONS = new Set<ProjectPermission>([
  ...VIEWER_PERMISSIONS,
  "deploy.trigger",
  "deploy.rollback",
  "monitoring.manage",
  "audit.view",    // Operators can view audit log (read-only)
]);

const DEVELOPER_PERMISSIONS = new Set<ProjectPermission>([
  ...VIEWER_PERMISSIONS,
  "project.edit",
  "files.write",
  "terminal.use",
  "deploy.trigger",
  "packages.manage",
  "ai.use",
  "audit.view",    // Developers can view audit log
]);

const ADMIN_PERMISSIONS = new Set<ProjectPermission>([
  "project.view",
  "project.edit",
  "project.delete",
  "project.manageTeam",
  "files.read",
  "files.write",
  "terminal.use",
  "env.view",
  "env.manage",
  "deploy.trigger",
  "deploy.rollback",
  "monitoring.view",
  "monitoring.manage",
  "logs.view",
  "database.view",
  "database.manage",
  "domains.view",
  "domains.manage",
  "packages.view",
  "packages.manage",
  "ai.use",
  "github.view",
  "audit.view",
  "audit.export",
]);

const OWNER_PERMISSIONS = new Set<ProjectPermission>([...ADMIN_PERMISSIONS]);

const ROLE_PERMISSIONS: Record<ProjectRole, Set<ProjectPermission>> = {
  owner:     OWNER_PERMISSIONS,
  admin:     ADMIN_PERMISSIONS,
  developer: DEVELOPER_PERMISSIONS,
  operator:  OPERATOR_PERMISSIONS,
  viewer:    VIEWER_PERMISSIONS,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hasPermission(
  role: ProjectRole,
  permission: ProjectPermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** All permissions granted to a role — useful for UI permission inspection. */
export function getPermissionsForRole(role: ProjectRole): Set<ProjectPermission> {
  return ROLE_PERMISSIONS[role];
}

// ── Display metadata ──────────────────────────────────────────────────────────

export const PROJECT_ROLES: ProjectRole[] = [
  "owner",
  "admin",
  "developer",
  "operator",
  "viewer",
];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  owner:     "Owner",
  admin:     "Admin",
  developer: "Developer",
  operator:  "Operator",
  viewer:    "Viewer",
};

export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  owner:
    "Full control — can manage team, delete project, and access all secrets.",
  admin:
    "Same as Owner, but cannot transfer ownership or change the Owner's role.",
  developer:
    "Can write code, run terminal, trigger deploys, and view env var names.",
  operator:
    "Can deploy, rollback, and configure monitoring. Read-only code access.",
  viewer:
    "Read-only access to project resources. Cannot deploy or run commands.",
};

/** Roles a given actor can assign (owners cannot be invited by non-owners). */
export function assignableRoles(actorRole: ProjectRole): ProjectRole[] {
  if (actorRole === "owner") return PROJECT_ROLES;
  if (actorRole === "admin") return ["admin", "developer", "operator", "viewer"];
  return [];
}
