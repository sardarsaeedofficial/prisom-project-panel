/**
 * lib/launch-signoff/launch-signoff-types.ts
 *
 * Sprint 74: Type definitions for the final launch signoff workflow.
 * Read-only — no production mutation.
 */

export type LaunchSignoffStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "ready"
  | "signed_off";

export type LaunchSignoffCheckCategory =
  | "qa"
  | "release_candidate"
  | "staging"
  | "ecommerce"
  | "backups"
  | "monitoring"
  | "security"
  | "team"
  | "runbook"
  | "client_handover";

export type LaunchSignoffCheck = {
  id: string;
  category: LaunchSignoffCheckCategory;
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  evidence?: string;
  nextStep?: string;
};

export type LaunchSignoffReport = {
  projectId: string;
  generatedAt: string;
  status: LaunchSignoffStatus;
  score: number;
  checks: LaunchSignoffCheck[];
  blockers: string[];
  warnings: string[];
  requiredEvidence: string[];
  recommendedNextSteps: string[];
};
