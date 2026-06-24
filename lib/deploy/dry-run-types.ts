/**
 * lib/deploy/dry-run-types.ts
 *
 * Sprint 53: Types for the Deployment Dry Run system.
 * Pure types — no imports, no side effects.
 *
 * Safety rules:
 *  - dry run never restarts PM2, applies nginx, runs DB migrations, or writes secrets
 *  - "blocked" commands must never be executed automatically
 *  - build execution (if attempted) requires RUN BUILD DRY RUN confirmation phrase
 */

export type DeploymentDryRunStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed";

export type DeploymentDryRunCategory =
  | "source"
  | "package_manager"
  | "install"
  | "build"
  | "services"
  | "env"
  | "database"
  | "routing"
  | "domain"
  | "smoke"
  | "manual";

export type DeploymentDryRunCheck = {
  id:        string;
  category:  DeploymentDryRunCategory;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual";
  message:   string;
  required:  boolean;
  evidence?: string[];
  command?:  string;
  linkHref?: string;
};

export type DeploymentDryRunPlan = {
  projectId:   string;
  generatedAt: string;
  status:      DeploymentDryRunStatus;
  checks:      DeploymentDryRunCheck[];
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
};

export type DeploymentDryRunReport = {
  projectId:   string;
  generatedAt: string;
  status:      DeploymentDryRunStatus;
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
  };
  checks:    DeploymentDryRunCheck[];
  blockers:  string[];
  warnings:  string[];
  nextSteps: string[];
};

export type DeploymentDryRunBuildResult = {
  serviceId?:   string;
  serviceName?: string;
  command:      string;
  success:      boolean;
  stdout:       string;
  stderr:       string;
  durationMs:   number;
  error?:       string;
};
