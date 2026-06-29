/**
 * lib/auto-import/auto-import-types.ts
 *
 * Sprint 86: Types for the Auto Import Control Room.
 * Pure type definitions — no runtime dependencies.
 */

export type AutoImportStatus =
  | "not_started"
  | "analyzing"
  | "needs_env"
  | "needs_database"
  | "config_ready"
  | "deploying"
  | "fix_available"
  | "retry_ready"
  | "preview_live"
  | "ready_for_go_live"
  | "blocked";

export type AutoImportIssueKind =
  | "missing_env"
  | "missing_database"
  | "wrong_package_manager"
  | "build_failed"
  | "start_failed"
  | "health_failed"
  | "frontend_not_served"
  | "domain_missing"
  | "static_output_missing"
  | "route_mode_wrong"
  | "unknown";

export type AutoImportDetectedDomain = {
  type: "preview" | "internal" | "public";
  url: string;
  status: "working" | "not_configured" | "failing" | "unknown";
  evidence?: string;
};

export type AutoImportSafeFix = {
  id: string;
  issueKind: AutoImportIssueKind;
  label: string;
  description: string;
  confirmationRequired: boolean;
  confirmationPhrase?: string;
  changes: string[];
  safe: boolean;
};

export type AutoImportRun = {
  projectId: string;
  generatedAt: string;
  status: AutoImportStatus;
  detectedStack: {
    packageManager: string;
    framework: string[];
    database: string[];
    services: string[];
    routeMode?: string;
    staticOutputPath?: string;
    healthPath?: string;
  };
  domains: AutoImportDetectedDomain[];
  missingEnvNames: Array<{
    name: string;
    required: boolean;
    secret: boolean;
    purpose: string;
  }>;
  database: {
    required: boolean;
    targetConfigured: boolean;
    sourceMigrationAvailable: boolean;
    message: string;
  };
  issues: Array<{
    id: string;
    kind: AutoImportIssueKind;
    title: string;
    message: string;
    evidence?: string;
    fix?: AutoImportSafeFix;
  }>;
  previewChecks: Array<{
    path: string;
    status: "pass" | "warning" | "blocked";
    result: string;
  }>;
  recommendedNextSteps: string[];
};
