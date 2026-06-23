/**
 * lib/database/db-readiness-types.ts
 *
 * Sprint 45: Types for the Database Migration Readiness system.
 * Pure types — no imports, no side effects.
 *
 * Safety rules:
 *  - maskedPreview shows host only (never credentials)
 *  - "blocked" commands must never be executed automatically
 *  - caution commands require explicit user confirmation
 */

// ── Enumerations ──────────────────────────────────────────────────────────────

export type DatabaseTool =
  | "prisma"
  | "drizzle"
  | "mongoose"
  | "typeorm"
  | "sequelize"
  | "knex"
  | "raw_sql"
  | "none"
  | "unknown";

export type DatabaseProvider =
  | "postgresql"
  | "neon"
  | "supabase"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "redis"
  | "unknown";

/** Whether a command is safe to run automatically, needs confirmation, or is always blocked. */
export type CommandSafety = "safe" | "caution" | "blocked";

// ── Core finding types ────────────────────────────────────────────────────────

export type DatabaseCommand = {
  id:              string;
  label:           string;
  command:         string;
  safety:          CommandSafety;
  description:     string;
  requiresConfirm: boolean;
  confirmText?:    string;   // required if requiresConfirm; e.g. "RUN DB CHECK"
};

export type DatabaseEnvFinding = {
  name:            string;    // e.g. "DATABASE_URL"
  required:        boolean;
  presentInVault:  boolean;
  valueConfigured: boolean;
  maskedPreview?:  string;    // e.g. "postgresql://***@host.neon.tech/db"
  purpose:         string;
};

export type DatabaseToolFinding = {
  tool:          DatabaseTool;
  configFile?:   string;    // e.g. "schema.prisma" or "drizzle.config.ts"
  migrationsDir?: string;   // e.g. "prisma/migrations"
  detectedVia:   string;    // e.g. "migration report" | "service buildCommand" | "env var analysis"
};

export type DatabaseProviderFinding = {
  provider:      DatabaseProvider;
  host?:         string;   // host portion only — never includes credentials
  databaseName?: string;
  detectedVia:   string;
};

export type DatabaseManualStep = {
  id:          string;
  label:       string;
  description: string;
  severity:    "required" | "recommended" | "info";
};

export type DatabaseFileFinding = {
  path:        string;
  type:        "config" | "migration" | "seed" | "schema";
  description: string;
};

export type DatabaseCommandFinding = {
  source:         string;   // e.g. service name
  command:        string;   // raw command string
  matchedPattern: string;
};

// ── Main report ───────────────────────────────────────────────────────────────

export type DatabaseReadinessReport = {
  projectId:    string;
  generatedAt:  string;   // ISO date string

  tool:         DatabaseToolFinding | null;
  provider:     DatabaseProviderFinding | null;
  envFindings:  DatabaseEnvFinding[];
  commands:     DatabaseCommand[];
  manualSteps:  DatabaseManualStep[];
  warnings:     string[];
  blockers:     string[];

  connectionStatus?: {
    tested:     boolean;
    ok?:        boolean;
    latencyMs?: number;
    host?:      string;
    testedAt?:  string;
    error?:     string;
  };

  /** 0–100 completeness score used to drive the UI progress ring. */
  readinessScore: number;
  isReady:        boolean;
};
