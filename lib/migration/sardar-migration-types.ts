/**
 * lib/migration/sardar-migration-types.ts
 *
 * Sprint 50: Types for the Sardar Security Supplies ecommerce
 * migration runbook and staging import workflow.
 *
 * Safety: no secret values, no destructive commands, no auto-cutover.
 */

export type SardarMigrationStage =
  | "source_audit"
  | "staging_import"
  | "service_config"
  | "env_config"
  | "database_config"
  | "external_services"
  | "routing"
  | "staging_validation"
  | "production_cutover"
  | "post_go_live";

export type SardarMigrationStatus =
  | "not_started"
  | "in_progress"
  | "ready"
  | "blocked"
  | "manual";

export type SardarMigrationChecklistItem = {
  id:          string;
  stage:       SardarMigrationStage;
  title:       string;
  description: string;
  status:      SardarMigrationStatus;
  required:    boolean;
  evidence?:   string[];
  fixHref?:    string;
  command?:    string;
  warning?:    string;
};

export type SardarMigrationRunbook = {
  projectId:    string;
  generatedAt:  string;
  overallStatus: "ready" | "warning" | "blocked";
  stages: {
    stage:  SardarMigrationStage;
    title:  string;
    status: SardarMigrationStatus;
    items:  SardarMigrationChecklistItem[];
  }[];
  blockers:              string[];
  warnings:              string[];
  recommendedNextSteps:  string[];
};

// ── Stage metadata ────────────────────────────────────────────────────────────

export const SARDAR_STAGE_TITLES: Record<SardarMigrationStage, string> = {
  source_audit:        "Source Audit",
  staging_import:      "Staging Import",
  service_config:      "Service Configuration",
  env_config:          "Env / Secrets",
  database_config:     "Database",
  external_services:   "External Services",
  routing:             "Routing",
  staging_validation:  "Staging Validation",
  production_cutover:  "Production Cutover",
  post_go_live:        "Post Go-Live",
};

export const SARDAR_STAGE_ORDER: SardarMigrationStage[] = [
  "source_audit",
  "staging_import",
  "service_config",
  "env_config",
  "database_config",
  "external_services",
  "routing",
  "staging_validation",
  "production_cutover",
  "post_go_live",
];

// ── Sardar project identifiers ────────────────────────────────────────────────

export const SARDAR_NAME_PATTERNS = [
  "sardar",
  "sardar-security",
  "sardar_security",
  "sardarsecurity",
  "sardar security",
];

export function isSardarProject(nameOrSlug: string): boolean {
  const lower = nameOrSlug.toLowerCase();
  return SARDAR_NAME_PATTERNS.some((p) => lower.includes(p));
}
