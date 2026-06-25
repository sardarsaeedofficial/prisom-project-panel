/**
 * lib/launch-freeze/launch-freeze-types.ts
 *
 * Sprint 75: Types for the launch freeze checklist workflow.
 * Read-only — no production mutation.
 */

export type LaunchFreezeStatus =
  | "not_frozen"
  | "freeze_recommended"
  | "frozen_pending_launch"
  | "blocked";

export type LaunchFreezeCheckCategory =
  | "code"
  | "deployment"
  | "database"
  | "secrets"
  | "routing"
  | "qa"
  | "team"
  | "documentation"
  | "monitoring";

export type LaunchFreezeCheck = {
  id: string;
  category: LaunchFreezeCheckCategory;
  label: string;
  description: string;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  required: boolean;
  freezeRule?: string;
};

export type LaunchFreezeReport = {
  projectId: string;
  generatedAt: string;
  status: LaunchFreezeStatus;
  checks: LaunchFreezeCheck[];
  blockers: string[];
  warnings: string[];
  freezeRules: string[];
  allowedChanges: string[];
  blockedChanges: string[];
  recommendedNextSteps: string[];
};
