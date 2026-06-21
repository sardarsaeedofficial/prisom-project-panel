/**
 * lib/migration/portability-patch-types.ts
 *
 * Sprint 25: Types for the Replit portability patch system.
 *
 * Pure data — no server deps. Safe to import from client or server.
 */

// ── Status / severity ─────────────────────────────────────────────────────────

export type PatchStatus   = "available" | "not_applicable" | "already_applied" | "blocked";
export type PatchSeverity = "required" | "recommended" | "optional";
export type PatchOperation = "create" | "update";

// ── Patch IDs ─────────────────────────────────────────────────────────────────

export const PATCH_IDS = {
  APP_URL:         "app-url-replacement",
  EMAIL_TRANSPORT: "email-transport-replacement",
} as const;

export type PatchId = (typeof PATCH_IDS)[keyof typeof PATCH_IDS];

// ── File-level patch ──────────────────────────────────────────────────────────

export type PortabilityPatchFile = {
  path:       string;           // relative to project root — always validated before apply
  operation:  PatchOperation;
  before?:    string;           // current file content (for update ops)
  after:      string;           // new file content
  diff:       string;           // unified-style diff for display
};

// ── Full patch plan ───────────────────────────────────────────────────────────

export type PortabilityPatchPlan = {
  id:               PatchId;
  projectId:        string;
  title:            string;
  description:      string;
  severity:         PatchSeverity;
  status:           PatchStatus;
  statusReason?:    string;
  files:            PortabilityPatchFile[];
  requiredSecrets:  string[];
  requiredPackages: string[];
  warnings:         string[];
  manualSteps:      string[];   // steps the user must do manually after the patch
  gitStatus:        "clean" | "dirty" | "no_git";
  hasRecentBackup:  boolean;
  createdAt:        string;
};

// ── Apply result ──────────────────────────────────────────────────────────────

export type ApplyPatchResult = {
  patchId:          PatchId;
  filesCreated:     number;
  filesUpdated:     number;
  requiredSecrets:  string[];
  requiredPackages: string[];
  manualSteps:      string[];
  errors:           string[];
  ok:               boolean;
};

// ── List summary (no file content) ───────────────────────────────────────────

export type PatchSummary = {
  id:          PatchId;
  title:       string;
  description: string;
  severity:    PatchSeverity;
  status:      PatchStatus;
  statusReason?: string;
  affectedFilesCount: number;
  requiredSecrets:    string[];
  requiredPackages:   string[];
};
