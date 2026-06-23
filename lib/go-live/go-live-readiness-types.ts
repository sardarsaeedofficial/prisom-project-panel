/**
 * lib/go-live/go-live-readiness-types.ts
 *
 * Sprint 49: Types for the unified go-live readiness report.
 * Pure data — safe to import from client or server.
 *
 * Safety rules:
 *  - no secrets, no env values
 *  - evidence strings are human-readable descriptions only
 */

// ── Status ─────────────────────────────────────────────────────────────────────

export type GoLiveReadinessStatus = "ready" | "warning" | "blocked";

// ── Check categories ──────────────────────────────────────────────────────────

export type GoLiveCheckCategory =
  | "deployment"
  | "release"
  | "env"
  | "database"
  | "domain"
  | "routing"
  | "github"
  | "backup"
  | "monitoring"
  | "manual";

// ── Individual check ──────────────────────────────────────────────────────────

export type GoLiveReadinessCheck = {
  id:        string;
  category:  GoLiveCheckCategory;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual";
  severity:  "required" | "recommended" | "optional";
  message:   string;
  linkHref?: string;
  evidence?: string[];
};

// ── Full report ───────────────────────────────────────────────────────────────

export type GoLiveReadinessReport = {
  projectId:   string;
  generatedAt: string;
  status:      GoLiveReadinessStatus;
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
  };
  checks:    GoLiveReadinessCheck[];
  blockers:  string[];
  warnings:  string[];
  nextSteps: string[];
};

// ── Smoke check result ────────────────────────────────────────────────────────

export type SmokeCheckResult = {
  id:         string;
  label:      string;
  url?:       string;
  status:     "pass" | "warning" | "fail";
  statusCode?: number;
  message:    string;
  durationMs?: number;
};

export type GoLiveSmokeReport = {
  projectId:   string;
  runAt:       string;
  overallPass: boolean;
  checks:      SmokeCheckResult[];
};

// ── Server action results ─────────────────────────────────────────────────────

export type GoLiveReadinessResult =
  | { ok: true;  report: GoLiveReadinessReport }
  | { ok: false; error: string };

export type GoLiveSmokeResult =
  | { ok: true;  report: GoLiveSmokeReport }
  | { ok: false; error: string };

export type GoLiveManualCheckResult =
  | { ok: true }
  | { ok: false; error: string };
