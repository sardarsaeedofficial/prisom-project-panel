/**
 * lib/release-candidate/release-candidate-types.ts
 *
 * Sprint 68: Types for the Release Candidate hardening report.
 */

export type ReleaseCandidateStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "unknown";

export type ReleaseCandidateCategory =
  | "navigation"
  | "actions"
  | "permissions"
  | "confirmations"
  | "exports"
  | "readiness"
  | "monitoring"
  | "backup"
  | "staging"
  | "go_live"
  | "ecommerce"
  | "runbook"
  | "safety"
  | "ui";

export type ReleaseCandidateCheck = {
  id:        string;
  category:  ReleaseCandidateCategory;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual" | "pending";
  required:  boolean;
  message:   string;
  evidence?: string[];
  linkHref?: string;
  warning?:  string;
};

export type ReleaseCandidateReport = {
  projectId:   string;
  generatedAt: string;
  status:      ReleaseCandidateStatus;
  score:       number;
  checks:      ReleaseCandidateCheck[];
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
