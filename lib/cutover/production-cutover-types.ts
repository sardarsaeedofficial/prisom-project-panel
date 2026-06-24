/**
 * lib/cutover/production-cutover-types.ts
 *
 * Sprint 55: Types for the production cutover assistant.
 * Pure data — safe to import from client or server.
 *
 * Safety rules:
 *  - no secrets, no env values
 *  - evidence strings are human-readable descriptions only
 */

// ── Status ─────────────────────────────────────────────────────────────────────

export type ProductionCutoverStatus =
  | "not_started"
  | "ready"
  | "warning"
  | "blocked"
  | "in_progress"
  | "complete"
  | "failed";

// ── Stages ─────────────────────────────────────────────────────────────────────

export type ProductionCutoverStage =
  | "preflight"
  | "freeze"
  | "backup"
  | "database"
  | "services"
  | "routing"
  | "external_services"
  | "smoke_checks"
  | "monitoring"
  | "rollback"
  | "post_go_live";

// ── Step ──────────────────────────────────────────────────────────────────────

export type ProductionCutoverStep = {
  id:                    string;
  stage:                 ProductionCutoverStage;
  title:                 string;
  description:           string;
  status:                "pass" | "warning" | "fail" | "manual" | "pending";
  required:              boolean;
  confirmationRequired?: string;
  evidence?:             string[];
  command?:              string;
  linkHref?:             string;
  warning?:              string;
};

// ── Plan ──────────────────────────────────────────────────────────────────────

export type ProductionCutoverPlan = {
  projectId:   string;
  generatedAt: string;
  status:      ProductionCutoverStatus;
  stages: {
    stage:  ProductionCutoverStage;
    title:  string;
    status: ProductionCutoverStatus;
    steps:  ProductionCutoverStep[];
  }[];
  blockers:  string[];
  warnings:  string[];
  nextSteps: string[];
};

// ── Smoke check ───────────────────────────────────────────────────────────────

export type ProductionCutoverSmokeResult = {
  id:          string;
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail";
  httpStatus?: number;
  message:     string;
};

export type ProductionCutoverSmokeReport = {
  projectId:   string;
  runAt:       string;
  overallPass: boolean;
  results:     ProductionCutoverSmokeResult[];
};

// ── Rollback readiness ────────────────────────────────────────────────────────

export type RollbackReadiness = {
  hasPreviousRelease:      boolean;
  rollbackDeploymentRef:   string | null;
  routeSnapshotAvailable:  boolean;
  dbRollbackWarning:       string;
  checklist:               string[];
  warnings:                string[];
};

// ── Action results ────────────────────────────────────────────────────────────

export type ProductionCutoverPlanResult =
  | { ok: true;  data: ProductionCutoverPlan }
  | { ok: false; error: string; code?: string };

export type ProductionCutoverSmokeResult2 =
  | { ok: true;  data: ProductionCutoverSmokeReport }
  | { ok: false; error: string; code?: string };

export type ProductionCutoverExportResult =
  | { ok: true;  data: { markdown: string } }
  | { ok: false; error: string; code?: string };

export type ProductionCutoverStepMarkResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export type ProductionCutoverCompleteResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };
