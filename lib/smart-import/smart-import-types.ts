/**
 * lib/smart-import/smart-import-types.ts
 *
 * Sprint 85: Shared types for the Smart Import wizard.
 * Pure type definitions — no runtime dependencies.
 */

export type SmartImportSourceType =
  | "zip"
  | "github"
  | "existing_project_storage"
  | "replit_export";

export type SmartImportStage =
  | "source"
  | "detect"
  | "configure"
  | "secrets"
  | "database"
  | "build"
  | "deploy_preview"
  | "verify_preview"
  | "auto_fix"
  | "ready_for_go_live"
  | "blocked";

export type SmartImportStatus =
  | "pending"
  | "running"
  | "passed"
  | "warning"
  | "blocked"
  | "skipped";

export type SmartImportDetectedStack = {
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  framework: string[];
  language: string[];
  database: {
    tool?: "drizzle" | "prisma" | "none" | "unknown";
    provider?: "postgres" | "mysql" | "sqlite" | "unknown";
    requiredEnvNames: string[];
  };
  services: Array<{
    name: string;
    type: "api" | "static" | "worker" | "fullstack" | "unknown";
    root: string;
    buildCommand?: string;
    startCommand?: string;
    outputPath?: string;
    healthPath?: string;
    route?: string;
  }>;
  envNames: Array<{
    name: string;
    required: boolean;
    secret: boolean;
    purpose: string;
  }>;
  replitMarkers: string[];
};

export type SmartImportDeploymentPreset = {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low";
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  healthPath: string;
  routeMode: "fullstack_node" | "static_plus_api" | "static_only" | "api_only";
  staticOutputPath?: string;
  spaFallback?: boolean;
  apiPrefix?: string;
  notes: string[];
};

export type SmartImportStep = {
  id: string;
  stage: SmartImportStage;
  label: string;
  status: SmartImportStatus;
  message: string;
  evidence?: string;
  recommendedFix?: string;
  safeToRetry: boolean;
};

export type SmartImportReport = {
  projectId: string;
  generatedAt: string;
  sourceType: SmartImportSourceType;
  detectedStack: SmartImportDetectedStack;
  selectedPreset?: SmartImportDeploymentPreset;
  steps: SmartImportStep[];
  blockers: string[];
  warnings: string[];
  missingEnvNames: string[];
  previewChecks: Array<{
    path: string;
    expected: string;
    status: SmartImportStatus;
    result?: string;
  }>;
  recommendedNextSteps: string[];
};
