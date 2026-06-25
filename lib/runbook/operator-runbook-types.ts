/**
 * lib/runbook/operator-runbook-types.ts
 *
 * Sprint 67: Types for the Operator Runbook + Admin Onboarding system.
 */

export type RunbookSectionId =
  | "overview"
  | "access"
  | "project_map"
  | "daily_operations"
  | "staging"
  | "go_live"
  | "monitoring"
  | "incident_response"
  | "rollback"
  | "backups"
  | "ecommerce"
  | "permissions"
  | "debugging"
  | "handoff";

export type RunbookStep = {
  id:          string;
  label:       string;
  description: string;
  linkHref?:   string;
  command?:    string;
  warning?:    string;
};

export type RunbookSection = {
  id:       RunbookSectionId;
  title:    string;
  summary:  string;
  priority: "critical" | "high" | "medium" | "low";
  audience: Array<"owner" | "admin" | "developer" | "operator" | "support">;
  steps:    RunbookStep[];
};

export type OperatorRunbook = {
  projectId?:  string;
  generatedAt: string;
  title:       string;
  status:      "ready" | "warning" | "incomplete";
  sections:    RunbookSection[];
  blockers:    string[];
  warnings:    string[];
  nextSteps:   string[];
};
