/**
 * lib/releases/release-types.ts
 *
 * Sprint 39: Types for release readiness and promotion workflow.
 * Pure types — no server deps, safe to import from client or server.
 */

// ── Preflight check ───────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "warning" | "fail" | "not_run";

export type ReleaseReadinessCheck = {
  id:      string;
  label:   string;
  status:  CheckStatus;
  message: string;
  href?:   string;
};

export type ReleaseReadinessReport = {
  projectId:     string;
  deploymentId:  string;
  deploymentRef: string;
  generatedAt:   string;
  overallStatus: "ready" | "warning" | "blocked";
  checks:        ReleaseReadinessCheck[];
  rollbackTarget?: {
    deploymentId:  string;
    deploymentRef: string;
    createdAt?:    string;
    status?:       string;
  };
};

// ── Promotion ─────────────────────────────────────────────────────────────────

export type PromotionStatus =
  | "pending"
  | "approved"
  | "promoting"
  | "promoted"
  | "failed"
  | "cancelled";

export type PromotionPreflightStatus =
  | "not_run"
  | "running"
  | "passed"
  | "failed"
  | "warning";

export type ReleasePromotionDTO = {
  id:            string;
  projectId:     string;
  deploymentId:  string | null;
  deploymentRef: string;
  sourceRef:     string | null;

  status:         PromotionStatus;
  preflightStatus: PromotionPreflightStatus;
  preflightChecks: ReleaseReadinessCheck[] | null;

  approvedByEmail: string | null;
  approvedAt:      string | null;

  promotedAt:    string | null;
  failedAt:      string | null;
  failureReason: string | null;

  rollbackDeploymentRef: string | null;
  rollbackDeploymentId:  string | null;
  rollbackReady:         boolean;

  createdAt: string;
  updatedAt: string;
};

// ── Action results ────────────────────────────────────────────────────────────

export type PromotionActionResult =
  | { ok: true;  promotion: ReleasePromotionDTO }
  | { ok: false; error: string };

export type PreflightActionResult =
  | { ok: true;  report: ReleaseReadinessReport }
  | { ok: false; error: string };
