/**
 * lib/migration/trial-migration-types.ts
 *
 * Sprint 61: Types for the Sardar staging trial migration run workflow.
 *
 * Pure types — no server imports, safe to reference from client components.
 */

export type TrialMigrationStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "complete";

export type TrialMigrationStage =
  | "source_intake"
  | "staging_import"
  | "services"
  | "env"
  | "database"
  | "routing"
  | "dry_run"
  | "external_services"
  | "backup_drill"
  | "smoke_checks"
  | "manual_review";

export type TrialMigrationStep = {
  id: string;
  stage: TrialMigrationStage;
  title: string;
  description: string;
  status: "pass" | "warning" | "fail" | "manual" | "pending";
  required: boolean;
  evidence?: string[];
  linkHref?: string;
  command?: string;
  warning?: string;
  confirmationRequired?: string;
};

export type TrialMigrationStageGroup = {
  stage: TrialMigrationStage;
  title: string;
  status: TrialMigrationStatus;
  steps: TrialMigrationStep[];
};

export type TrialMigrationRun = {
  projectId: string;
  generatedAt: string;
  status: TrialMigrationStatus;
  recommendedStagingSlug: string;
  recommendedStagingDomain: string;
  stages: TrialMigrationStageGroup[];
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
};

export type SmokeCheckResult = {
  url: string;
  status: "pass" | "warning" | "fail";
  httpStatus: number | null;
  message: string;
  durationMs: number | null;
};

export type StagingSmokeCheckReport = {
  domain: string;
  checkedAt: string;
  overall: "pass" | "warning" | "fail";
  results: SmokeCheckResult[];
};
