/**
 * lib/env/env-readiness-types.ts
 *
 * Sprint 46: Types for the Env/Secrets Readiness system.
 * Pure types — no imports, no side effects.
 *
 * Safety rules:
 *  - No raw secret values in any type
 *  - maskedPreview shows safe portions only (host, key prefix, last 4 chars)
 */

export type EnvVarCategory =
  | "database"
  | "stripe"
  | "cloudinary"
  | "email"
  | "auth"
  | "app_url"
  | "oauth"
  | "storage"
  | "replit"
  | "analytics"
  | "unknown";

export type EnvVarSeverity = "required" | "recommended" | "optional";

export type EnvVarStatus =
  | "configured"
  | "missing"
  | "empty"
  | "placeholder"
  | "suspicious"
  | "duplicate";

export type EnvReadinessStatus = "ready" | "warning" | "blocked";

export type EnvReadinessFinding = {
  name:            string;
  category:        EnvVarCategory;
  severity:        EnvVarSeverity;
  status:          EnvVarStatus;
  presentInVault:  boolean;
  valueConfigured: boolean;
  maskedPreview?:  string;   // safe display — never contains raw credentials
  source:          "code" | "migration_report" | "service" | "template" | "manual";
  evidence:        string[];
  description?:    string;
  fixHint?:        string;
};

export type EnvReadinessReport = {
  projectId:   string;
  generatedAt: string;
  status:      EnvReadinessStatus;
  summary: {
    total:           number;
    configured:      number;
    missing:         number;
    placeholders:    number;
    suspicious:      number;
    requiredBlocked: number;
  };
  findings:           EnvReadinessFinding[];
  blockers:           string[];
  warnings:           string[];
  recommendedActions: EnvRecommendedAction[];
};

export type EnvRecommendedAction = {
  id:                   string;
  type:
    | "create_placeholder"
    | "replace_placeholder"
    | "open_secret"
    | "remove_replit_leftover"
    | "verify_provider";
  label:                string;
  description:          string;
  envNames:             string[];
  confirmationRequired: boolean;
};
