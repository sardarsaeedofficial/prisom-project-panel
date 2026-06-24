/**
 * lib/permissions/project-permission-policy-types.ts
 *
 * Sprint 59: Types for the project permission policy and dangerous-action
 * access control system.
 *
 * Pure types — safe to import from client or server.
 */

export type ProjectDangerousAction =
  | "source.replace"
  | "env.write"
  | "secret.write"
  | "database.command_review"
  | "deployment.trigger"
  | "deployment.rollback"
  | "routing.apply"
  | "routing.rollback"
  | "github.webhook_secret_generate"
  | "github.auto_deploy_toggle"
  | "external_services.test"
  | "cutover.smoke_checks"
  | "cutover.mark_complete"
  | "backup.create"
  | "backup.restore"
  | "team.manage"
  | "settings.write";

export type ProjectPermissionPolicyStatus =
  | "allowed"
  | "blocked"
  | "warning";

export type ProjectPermissionPolicyCheck = {
  action:             ProjectDangerousAction;
  label:              string;
  status:             ProjectPermissionPolicyStatus;
  requiredPermission: string;
  userRole?:          string | null;
  message:            string;
  evidence?:          string[];
};

export type ProjectPermissionPolicyReport = {
  projectId:          string;
  generatedAt:        string;
  currentUserRole?:   string | null;
  isAdmin:            boolean;
  checks:             ProjectPermissionPolicyCheck[];
  blockers:           string[];
  warnings:           string[];
  nextSteps:          string[];
};

// ── Labels ─────────────────────────────────────────────────────────────────────

export const DANGEROUS_ACTION_LABELS: Record<ProjectDangerousAction, string> = {
  "source.replace":                  "Replace Project Source",
  "env.write":                       "Write Environment Variables",
  "secret.write":                    "Write Secrets",
  "database.command_review":         "Review Database Commands",
  "deployment.trigger":              "Trigger Deployment",
  "deployment.rollback":             "Rollback Deployment",
  "routing.apply":                   "Apply Production Routes",
  "routing.rollback":                "Rollback Production Routes",
  "github.webhook_secret_generate":  "Generate GitHub Webhook Secret",
  "github.auto_deploy_toggle":       "Toggle Auto-Deploy",
  "external_services.test":          "Test External Service Credentials",
  "cutover.smoke_checks":            "Run Cutover Smoke Checks",
  "cutover.mark_complete":           "Mark Cutover Complete",
  "backup.create":                   "Create Backup",
  "backup.restore":                  "Restore from Backup",
  "team.manage":                     "Manage Team Members",
  "settings.write":                  "Write Project Settings",
};

// ── Group membership ───────────────────────────────────────────────────────────

export type ActionGroup =
  | "Source & Import"
  | "Env & Secrets"
  | "Database"
  | "Deployment"
  | "Routing"
  | "GitHub"
  | "Cutover"
  | "Backups"
  | "Team & Settings";

export const ACTION_GROUPS: Record<ProjectDangerousAction, ActionGroup> = {
  "source.replace":                 "Source & Import",
  "env.write":                      "Env & Secrets",
  "secret.write":                   "Env & Secrets",
  "database.command_review":        "Database",
  "deployment.trigger":             "Deployment",
  "deployment.rollback":            "Deployment",
  "routing.apply":                  "Routing",
  "routing.rollback":               "Routing",
  "github.webhook_secret_generate": "GitHub",
  "github.auto_deploy_toggle":      "GitHub",
  "external_services.test":         "Env & Secrets",
  "cutover.smoke_checks":           "Cutover",
  "cutover.mark_complete":          "Cutover",
  "backup.create":                  "Backups",
  "backup.restore":                 "Backups",
  "team.manage":                    "Team & Settings",
  "settings.write":                 "Team & Settings",
};
