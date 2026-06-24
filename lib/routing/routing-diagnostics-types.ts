/**
 * lib/routing/routing-diagnostics-types.ts
 *
 * Sprint 52: Types for routing diagnostics and route apply preview.
 * Pure types — no server imports — safe to use in both client and server code.
 */

// ── Diagnostic status ─────────────────────────────────────────────────────────

export type RoutingDiagnosticStatus = "ready" | "warning" | "blocked";

// ── Individual check ──────────────────────────────────────────────────────────

export type RoutingDiagnosticCheck = {
  id:        string;
  label:     string;
  status:    "pass" | "warning" | "fail";
  message:   string;
  evidence?: string[];
  fixHref?:  string;
};

// ── Full diagnostics report ───────────────────────────────────────────────────

export type RoutingDiagnosticsReport = {
  projectId:   string;
  generatedAt: string;
  status:      RoutingDiagnosticStatus;
  domain?:     string | null;
  checks:      RoutingDiagnosticCheck[];
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
};

// ── Route apply preview ───────────────────────────────────────────────────────

export type RouteApplyPreview = {
  projectId:          string;
  domain:             string;
  generatedAt:        string;
  routeSummary:       string[];
  nginxPreview:       string;
  rollbackSummary:    string[];
  confirmationPhrase: "APPLY ROUTES";
  warnings:           string[];
  blockers:           string[];
};

// ── Rollback preview ──────────────────────────────────────────────────────────

export type RouteRollbackPreview = {
  domain:              string;
  hasBackup:           boolean;
  backupConfigSnippet: string | null;
  manualChecklist:     string[];
  nginxTestCommand:    string;
  nginxReloadCommand:  string;
  warnings:            string[];
};
