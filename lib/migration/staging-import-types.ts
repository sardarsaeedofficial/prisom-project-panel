/**
 * lib/migration/staging-import-types.ts
 *
 * Sprint 51: Types for the staging import executor.
 *
 * Safety: no secret values, no destructive commands, no auto-cutover.
 */

export type StagingImportStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed";

export type StagingImportStepCategory =
  | "project"
  | "source"
  | "services"
  | "env"
  | "database"
  | "routing"
  | "build"
  | "smoke"
  | "manual";

export type StagingImportStep = {
  id:          string;
  category:    StagingImportStepCategory;
  title:       string;
  description: string;
  status:      StagingImportStatus;
  required:    boolean;
  evidence?:   string[];
  command?:    string;
  linkHref?:   string;
  warning?:    string;
};

export type StagingImportPlan = {
  sourceProjectId:          string;
  recommendedStagingSlug:   string;
  recommendedStagingDomain: string;
  generatedAt:              string;
  status:                   StagingImportStatus;
  steps:                    StagingImportStep[];
  blockers:                 string[];
  warnings:                 string[];
  nextSteps:                string[];
};

export type StagingImportReport = {
  sourceProjectId:   string;
  stagingProjectId?: string;
  generatedAt:       string;
  status:            StagingImportStatus;
  checks:            StagingImportStep[];
  blockers:          string[];
  warnings:          string[];
  summary: {
    total:    number;
    passed:   number;
    failed:   number;
    warnings: number;
    manual:   number;
  };
};

// ── Smoke check result ────────────────────────────────────────────────────────

export type StagingSmokeCheck = {
  id:          string;
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail" | "skipped";
  statusCode?: number;
  durationMs?: number;
  message:     string;
};

export type StagingSmokeReport = {
  stagingDomain: string;
  runAt:         string;
  overallPass:   boolean;
  checks:        StagingSmokeCheck[];
};

// ── Category labels ───────────────────────────────────────────────────────────

export const STAGING_CATEGORY_LABEL: Record<StagingImportStepCategory, string> = {
  project:  "Project Setup",
  source:   "Source Import",
  services: "Service Config",
  env:      "Env / Secrets",
  database: "Database",
  routing:  "Routing",
  build:    "Build Validation",
  smoke:    "Smoke Checks",
  manual:   "Manual Steps",
};

export const STAGING_CATEGORY_ORDER: StagingImportStepCategory[] = [
  "project",
  "source",
  "services",
  "env",
  "database",
  "routing",
  "build",
  "smoke",
  "manual",
];

// ── Recommended staging values ────────────────────────────────────────────────

export const STAGING_SLUG   = "sardar-security-staging";
export const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";
