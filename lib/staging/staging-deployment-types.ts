/**
 * lib/staging/staging-deployment-types.ts
 *
 * Sprint 64: Type definitions for the Staging Deployment workflow.
 */

export type StagingDeploymentStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "complete"
  | "unknown";

export type StagingDeploymentStage =
  | "target"
  | "source"
  | "services"
  | "env"
  | "database"
  | "build"
  | "routing_preview"
  | "smoke_checks"
  | "manual";

export type StagingDeploymentStep = {
  id:                   string;
  stage:                StagingDeploymentStage;
  label:                string;
  status:               "pass" | "warning" | "fail" | "manual" | "pending";
  required:             boolean;
  message:              string;
  evidence?:            string[];
  command?:             string;
  linkHref?:            string;
  warning?:             string;
  confirmationRequired?: string;
};

export type StagingServicePlan = {
  name:          string;
  kind:          "api" | "static" | "worker" | "unknown";
  root:          string;
  buildCommand?: string;
  startCommand?: string;
  outputPath?:   string;
  healthPath?:   string;
  route?:        string;
};

export type StagingDeploymentPlan = {
  projectId:        string;
  generatedAt:      string;
  status:           StagingDeploymentStatus;
  sourceProjectSlug: string;
  stagingSlug:      string;
  stagingDomain:    string;
  steps:            StagingDeploymentStep[];
  blockers:         string[];
  warnings:         string[];
  nextSteps:        string[];
  servicePlan:      StagingServicePlan[];
};

export type StagingSmokeResult = {
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail";
  httpStatus?: number;
  message:     string;
};

export type StagingDeploymentProof = {
  projectId:    string;
  generatedAt:  string;
  status:       StagingDeploymentStatus;
  stagingSlug:  string;
  stagingDomain: string;
  plan:          StagingDeploymentPlan;
  smokeChecks?:  StagingSmokeResult[];
  blockers:      string[];
  warnings:      string[];
  nextSteps:     string[];
};
