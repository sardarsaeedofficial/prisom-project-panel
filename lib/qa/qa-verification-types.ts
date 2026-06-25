/**
 * lib/qa/qa-verification-types.ts
 *
 * Sprint 69: Types for the Live QA Verification report.
 */

export type QaVerificationStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "unknown";

export type QaVerificationCategory =
  | "routes"
  | "navigation"
  | "pages"
  | "exports"
  | "confirmations"
  | "permissions"
  | "safety"
  | "smoke_checks"
  | "sardar"
  | "admin"
  | "ui"
  | "manual";

export type QaVerificationCheck = {
  id:        string;
  category:  QaVerificationCategory;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual" | "pending";
  required:  boolean;
  message:   string;
  evidence?: string[];
  linkHref?: string;
  command?:  string;
  warning?:  string;
};

export type QaVerificationReport = {
  projectId:   string;
  generatedAt: string;
  status:      QaVerificationStatus;
  score:       number;
  checks:      QaVerificationCheck[];
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
    pending:  number;
  };
};

export type LiveSmokeCheckResult = {
  label:       string;
  url:         string;
  status:      "pass" | "warning" | "fail";
  httpStatus?: number;
  message:     string;
  durationMs?: number;
};

export type LiveSmokeReport = {
  projectId:   string;
  generatedAt: string;
  status:      "passed" | "warning" | "failed";
  results:     LiveSmokeCheckResult[];
  warnings:    string[];
};
