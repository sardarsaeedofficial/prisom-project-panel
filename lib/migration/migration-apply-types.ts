/**
 * lib/migration/migration-apply-types.ts
 *
 * Sprint 43: Types for the Replit Migration Apply Plan.
 *
 * Pure types — no server dependencies, safe to import from client or server.
 *
 * Safety rules:
 *  - No secret values ever stored in these types
 *  - before/after fields contain only command strings, paths, or placeholder text
 *  - destructive is always false for migration changes (we never delete)
 */

// ── Individual change ─────────────────────────────────────────────────────────

export type MigrationApplyChangeType =
  | "project_config"  // installCommand, buildCommand, startCommand, healthPath
  | "service_create"  // create a new ProjectService
  | "service_update"  // update an existing ProjectService
  | "env_placeholder" // add a missing env var as an empty placeholder
  | "health_check"    // set healthPath on the deployment config
  | "domain_hint"     // informational: APP_URL suggestion
  | "backup"          // queue a pre-migration backup
  | "job";            // queue a background job

export type MigrationApplyChange = {
  /** Stable ID used to select/deselect this change */
  id:                  string;
  type:                MigrationApplyChangeType;
  /** Short label shown in the UI */
  label:               string;
  /** Longer description of what this change does */
  description:         string;
  /** Human-readable target (field name, env var name, service name, …) */
  target:              string;
  /** Current value (null if not set yet). Never a secret. */
  before?:             string | null;
  /** Proposed value. Never a secret. */
  after?:              string | null;
  /** False for all migration changes — we never auto-delete */
  destructive:         boolean;
  /** True when applying would overwrite an existing non-empty value */
  requiresConfirmation: boolean;
  /** Shown in UI when requiresConfirmation is true */
  confirmationText?:   string;
  /** True if the current config already matches the recommended value */
  alreadyApplied:      boolean;
  /** Grouped display category */
  group:               "commands" | "services" | "env" | "infra" | "backup";
};

// ── Full plan ─────────────────────────────────────────────────────────────────

export type MigrationApplyPlan = {
  projectId:                      string;
  generatedAt:                    string; // ISO
  status:                         "ready" | "warning" | "blocked";
  changes:                        MigrationApplyChange[];
  blockers:                       string[];
  warnings:                       string[];
  estimatedManualStepsRemaining:  number;
  /** True if a deployment config exists (commands can be applied) */
  hasDeploymentConfig:            boolean;
};

// ── Apply result ──────────────────────────────────────────────────────────────

export type MigrationApplyChangeResult = {
  id:      string;
  ok:      boolean;
  error?:  string;
  /** Short human-readable summary of what was done */
  summary: string;
};

export type MigrationApplyResult = {
  ok:              boolean;
  appliedCount:    number;
  skippedCount:    number;
  errorCount:      number;
  results:         MigrationApplyChangeResult[];
  backupRef?:      string; // if a backup was created
  jobIds?:         string[]; // if jobs were queued
};

// ── Apply input ───────────────────────────────────────────────────────────────

export type ApplyMigrationPlanInput = {
  projectId:         string;
  changeIds:         string[];
  /** Must equal "APPLY" when any change has requiresConfirmation=true */
  confirmationText?: string;
  actorUserId:       string;
};
