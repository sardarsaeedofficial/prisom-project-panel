/**
 * lib/import/source-intake-types.ts
 *
 * Sprint 57: Shared types for source intake readiness reporting.
 * No server deps — safe to import in client components.
 */

export type SourceIntakeStatus =
  | "ready"
  | "warning"
  | "blocked"
  | "unknown";

export type SourceIntakeSourceType =
  | "github"
  | "zip"
  | "replit_export"
  | "existing_storage"
  | "unknown";

export type SourceIntakeCheck = {
  id:       string;
  label:    string;
  category:
    | "source"
    | "package_manager"
    | "monorepo"
    | "services"
    | "database"
    | "env"
    | "replit"
    | "security"
    | "manual";
  status:   "pass" | "warning" | "fail" | "manual";
  required: boolean;
  message:  string;
  evidence?: string[];
  linkHref?: string;
  command?:  string;
};

export type SourceIntakeReport = {
  projectId?:   string;
  generatedAt:  string;
  sourceType:   SourceIntakeSourceType;
  status:       SourceIntakeStatus;
  checks:       SourceIntakeCheck[];
  detected: {
    packageManager?: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
    monorepo?:        boolean;
    workspaceFile?:   string | null;
    packageJsonCount?: number;
    services?: Array<{
      name:          string;
      kind:          "api" | "static" | "worker" | "fullstack" | "unknown";
      root:          string;
      buildCommand:  string | null;
      startCommand:  string | null;
      outputPath:    string | null;
      healthPath:    string | null;
    }>;
    database?: {
      tool?:     "drizzle" | "prisma" | "knex" | "sequelize" | "unknown";
      provider?: "postgres" | "mysql" | "sqlite" | "unknown";
    };
    envNames?:      string[];
    replitMarkers?: string[];
  };
  blockers:   string[];
  warnings:   string[];
  nextSteps:  string[];
};

export type GitHubImportInput = {
  repositoryUrl: string;
  branch?:       string;
};

export type GitHubImportValidation = {
  isValid:     boolean;
  owner?:      string;
  repo?:       string;
  branch:      string;
  cloneUrl?:   string;
  destPath?:   string;
  alreadyExists?: boolean;
  errors:      string[];
  warnings:    string[];
};
