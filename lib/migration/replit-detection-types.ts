/**
 * lib/migration/replit-detection-types.ts
 *
 * Sprint 24: Type definitions for the Replit Migration Assistant.
 *
 * Pure data — no server deps. Safe to import from server or client.
 */

// ── Building blocks ───────────────────────────────────────────────────────────

export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown";

export type DetectedService = {
  name:           string;
  framework?:     string;
  entryFile?:     string;
  buildScript?:   string;
  startCommand?:  string;
  workingDir?:    string;
  outputDir?:     string;
  estimatedPort?: number;
  packageName?:   string;  // pnpm workspace package name e.g. @workspace/api-server
};

export type DatabaseDetection = {
  type:             "postgres" | "mysql" | "sqlite" | "mongo" | "replit-db" | "none" | "unknown";
  orm?:             "drizzle" | "prisma" | "mongoose" | "none";
  configFile?:      string;
  migrationsDir?:   string;
  connectionEnvKey?: string;
};

export type MediaDetection = {
  provider:        "cloudinary" | "s3" | "r2" | "local" | "none" | "unknown";
  hasLocalUploads: boolean;
  localUploadPaths: string[];
};

export type PaymentDetection = {
  provider:    "stripe" | "paypal" | "unknown";
  hasWebhook:  boolean;
  webhookPath?: string;
};

export type EmailDetection = {
  provider:        "replit-connector" | "nodemailer" | "resend" | "sendgrid" | "postmark" | "smtp" | "unknown";
  isReplitConnector: boolean;
  smtpConfigured:  boolean;
  detectedPackage?: string;
};

export type BackgroundJobDetection = {
  library: string;
  notes:   string;
};

export type ReplitDependency = {
  name:        string;
  type:        "env" | "package" | "config" | "file";
  detail:      string;
  replacement?: string;
};

export type DetectedSecret = {
  name:               string;
  category:           "database" | "payments" | "email" | "media" | "auth" | "app" | "replit-specific" | "other";
  required:           boolean;
  replitReplacement?: string;
  notes?:             string;
};

export type SuggestedProjectService = {
  name:             string;
  slug:             string;
  serviceType:      "node" | "static";
  workingDir:       string;
  packageManager?:  string;
  installCommand?:  string;
  buildCommand?:    string;
  startCommand?:    string;
  internalPort?:    number;
  healthPath?:      string;
  staticOutputDir?: string;
  spaFallback?:     boolean;
  isPrimary?:       boolean;
  notes?:           string;
};

export type MigrationRisk = {
  severity:      "blocker" | "warning" | "info";
  title:         string;
  details:       string;
  suggestedFix:  string;
  filesInvolved: string[];
};

export type DatabaseMigrationPlan = {
  dbType:  string;
  orm?:    string;
  steps:   string[];
  notes:   string;
};

export type MediaMigrationPlan = {
  provider:   string;
  isExternal: boolean;
  steps:      string[];
  notes:      string;
};

// ── Top-level report ──────────────────────────────────────────────────────────

export type ReplitMigrationReport = {
  projectType:        string;
  packageManager:     PackageManager;
  isMonorepo:         boolean;
  monorepoPaths:      string[];
  nodeVersion?:       string;
  frontend?:          DetectedService;
  backend?:           DetectedService;
  database?:          DatabaseDetection;
  dbPlan?:            DatabaseMigrationPlan;
  media?:             MediaDetection;
  mediaPlan?:         MediaMigrationPlan;
  payments:           PaymentDetection[];
  email?:             EmailDetection;
  backgroundJobs:     BackgroundJobDetection[];
  replitDependencies: ReplitDependency[];
  requiredSecrets:    DetectedSecret[];
  suggestedServices:  SuggestedProjectService[];
  risks:              MigrationRisk[];
  analyzedAt:         string;
  filesScanned:       number;
};
