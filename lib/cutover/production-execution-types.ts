/**
 * lib/cutover/production-execution-types.ts
 *
 * Sprint 65: Types for the Production Cutover Execution Guard.
 */

export type ProductionExecutionStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "complete"
  | "unknown";

export type ProductionExecutionStage =
  | "final_gate"
  | "staging_proof"
  | "backup"
  | "permissions"
  | "domain"
  | "routing"
  | "deployment"
  | "smoke_checks"
  | "rollback"
  | "manual";

export type ProductionExecutionStep = {
  id:                    string;
  stage:                 ProductionExecutionStage;
  label:                 string;
  status:                "pass" | "warning" | "fail" | "manual" | "pending";
  required:              boolean;
  message:               string;
  evidence?:             string[];
  command?:              string;
  linkHref?:             string;
  warning?:              string;
  confirmationRequired?: string;
};

export type ProductionRouteEntry = {
  path:    string;
  target:  string;
  type:    "api" | "static" | "spa_fallback" | "unknown";
  message: string;
};

export type ProductionRouteApplyPreview = {
  projectId:     string;
  generatedAt:   string;
  domain:        string;
  status:        ProductionExecutionStatus;
  routes:        ProductionRouteEntry[];
  nginxPreview?: string[];
  blockers:      string[];
  warnings:      string[];
};

export type ProductionExecutionSmokeResult = {
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail";
  httpStatus?: number;
  message:     string;
};

export type ProductionExecutionSmokeReport = {
  projectId:   string;
  generatedAt: string;
  domain:      string;
  status:      "passed" | "warning" | "failed";
  results:     ProductionExecutionSmokeResult[];
  warnings:    string[];
};

export type ProductionExecutionPlan = {
  projectId:    string;
  generatedAt:  string;
  status:       ProductionExecutionStatus;
  domain:       string;
  steps:        ProductionExecutionStep[];
  routePreview: ProductionRouteApplyPreview;
  blockers:     string[];
  warnings:     string[];
  nextSteps:    string[];
};
