/**
 * lib/monitoring/post-cutover-monitoring-types.ts
 *
 * Sprint 66: Types for Post-Cutover Monitoring + Incident Response.
 */

export type PostCutoverStatus =
  | "healthy"
  | "warning"
  | "incident"
  | "critical"
  | "unknown";

export type IncidentSeverity =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type MonitoringCategory =
  | "frontend"
  | "api"
  | "routing"
  | "ssl"
  | "database"
  | "ecommerce"
  | "external_services"
  | "performance"
  | "logs"
  | "rollback"
  | "manual";

export type MonitoringCheck = {
  id:          string;
  category:    MonitoringCategory;
  label:       string;
  status:      "pass" | "warning" | "fail" | "manual" | "pending";
  required:    boolean;
  message:     string;
  evidence?:   string[];
  url?:        string;
  httpStatus?: number;
  linkHref?:   string;
  command?:    string;
  warning?:    string;
};

export type PostCutoverMonitoringReport = {
  projectId:        string;
  generatedAt:      string;
  status:           PostCutoverStatus;
  incidentSeverity: IncidentSeverity;
  checks:           MonitoringCheck[];
  blockers:         string[];
  warnings:         string[];
  nextSteps:        string[];
  rollbackRecommendation: {
    shouldConsiderRollback: boolean;
    severity:               IncidentSeverity;
    reason:                 string;
    checklist:              string[];
  };
  summary: {
    total:    number;
    passed:   number;
    warnings: number;
    failed:   number;
    manual:   number;
    pending:  number;
  };
};
