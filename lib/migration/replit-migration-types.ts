/**
 * lib/migration/replit-migration-types.ts
 *
 * Sprint 41: Normalized types for the enriched migration report.
 * Extends ReplitMigrationReport (from replit-detection-types.ts) with
 * structured external service findings, manual steps, and apply actions.
 *
 * Safety rules:
 *  - No secret values stored — only key names (DetectedSecret.name)
 */

export type {
  PackageManager,
  DetectedService,
  DatabaseDetection,
  MediaDetection,
  PaymentDetection,
  EmailDetection,
  BackgroundJobDetection,
  ReplitDependency,
  DetectedSecret,
  SuggestedProjectService,
  MigrationRisk,
  DatabaseMigrationPlan,
  MediaMigrationPlan,
  ReplitMigrationReport,
} from "./replit-detection-types";

import type { ReplitMigrationReport } from "./replit-detection-types";

// ── External service finding ──────────────────────────────────────────────────

export type ExternalServiceProvider =
  | "stripe"
  | "cloudinary"
  | "resend"
  | "sendgrid"
  | "openai"
  | "anthropic"
  | "github-oauth"
  | "google-oauth"
  | "supabase"
  | "neon"
  | "planetscale"
  | "upstash"
  | "pusher"
  | "twilio"
  | "s3"
  | "r2"
  | "postmark"
  | "nodemailer"
  | "unknown";

export type ExternalServiceFinding = {
  provider:      ExternalServiceProvider;
  label:         string;
  /** Env var key names (DetectedSecret.name) — never values */
  envKeys:       string[];
  /** Source file paths where this service is referenced */
  files:         string[];
  /** Webhook route if detected */
  webhookPath?:  string;
  /** OAuth callback path if detected */
  callbackPath?: string;
  /** Recommended action */
  action:        string;
  /** Is this service critical (blocking) to the project? */
  critical:      boolean;
};

// ── Manual step ───────────────────────────────────────────────────────────────

export type ManualStepSeverity = "required" | "recommended" | "optional";

export type ManualStep = {
  id:          string;
  title:       string;
  description: string;
  severity:    ManualStepSeverity;
  /** Related env var key names to configure */
  envKeys?:    string[];
  /** Related files to check */
  files?:      string[];
  /** Brief command(s) to run, if applicable */
  command?:    string;
  /** Reference doc path */
  docsHint?:   string;
};

// ── Apply action (safe pre-fill of Prisorm deploy config) ─────────────────────

export type PrisomApplyAction = {
  field:          string;
  suggestedValue: string;
  description:    string;
  safe:           boolean;
};

// ── Enriched migration report (base + external services + manual steps) ───────

export type EnrichedMigrationReport = ReplitMigrationReport & {
  /** Project slug — populated when the report is created in an action context */
  projectSlug?:     string;
  externalServices: ExternalServiceFinding[];
  manualSteps:      ManualStep[];
  applyActions:     PrisomApplyAction[];
  /** "ready" | "warnings" | "blocked" */
  readinessStatus:  "ready" | "warnings" | "blocked";
};

// ── Persisted report record (from DB) ─────────────────────────────────────────

export type PersistedMigrationReport = {
  id:              string;
  projectId:       string;
  sourceType:      string;
  status:          string;
  report:          EnrichedMigrationReport;
  createdByUserId: string | null;
  createdAt:       string;
  updatedAt:       string;
};
