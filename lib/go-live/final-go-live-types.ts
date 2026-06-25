/**
 * lib/go-live/final-go-live-types.ts
 *
 * Sprint 63: Type definitions for the Final Go-Live Control Room.
 */

export type FinalGoLiveStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "unknown";

export type FinalGoLiveCategory =
  | "source"
  | "staging"
  | "ecommerce"
  | "env"
  | "database"
  | "external_services"
  | "routing"
  | "domains"
  | "deployment"
  | "backup"
  | "permissions"
  | "monitoring"
  | "rollback"
  | "manual";

export type FinalGoLiveCheck = {
  id:        string;
  category:  FinalGoLiveCategory;
  label:     string;
  status:    "pass" | "warning" | "fail" | "manual" | "pending";
  required:  boolean;
  message:   string;
  evidence?: string[];
  linkHref?: string;
  command?:  string;
  warning?:  string;
};

export type FinalGoLiveGateReport = {
  projectId:      string;
  generatedAt:    string;
  status:         FinalGoLiveStatus;
  readinessScore: number;
  checks:         FinalGoLiveCheck[];
  blockers:       string[];
  warnings:       string[];
  nextSteps:      string[];
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
    pending:  number;
  };
};
