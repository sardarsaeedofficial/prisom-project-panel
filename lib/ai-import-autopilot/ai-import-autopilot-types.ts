/**
 * lib/ai-import-autopilot/ai-import-autopilot-types.ts
 *
 * Sprint 88: Types for the AI Import Autopilot.
 * Pure type definitions — no runtime dependencies.
 */

export type AiImportAutopilotState =
  | "idle"
  | "analyzing_source"
  | "waiting_for_user_input"
  | "applying_preset"
  | "installing"
  | "building"
  | "deploying"
  | "checking_api"
  | "checking_preview"
  | "fixing_issue"
  | "retrying"
  | "preview_live"
  | "needs_manual_approval"
  | "blocked";

export type RequiredInputGroup = "core" | "payments" | "media" | "advanced";

export type RequiredInput = {
  id: string;
  group: RequiredInputGroup;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  fieldName: string;
  placeholder?: string;
  /** Clarifies ambiguity, e.g. "This is the Sardar app database, not the panel database." */
  distinguishHint?: string;
};

export type DetectedStack = {
  isSardarPreset: boolean;
  packageManager: string;
  framework: string[];
  services: string[];
  evidence: string[];
};

export type AppliedFix = {
  id: string;
  label: string;
  appliedAt: string;
  fieldsChanged: string[];
};

export type ProposedFix = {
  id: string;
  title: string;
  plainEnglishSummary: string;
  /** True for safe fixes the autopilot may apply on its own. */
  safe: boolean;
  /** True for fixes that fall outside the safe-fix allowlist (DNS, DB wipe, secrets, other PM2 processes). */
  requiresApproval: boolean;
  approvalReason?: string;
  confirmationPhrase?: string;
};

export type VerificationCheck = {
  id: string;
  label: string;
  scope: "internal" | "browser";
  status: "pass" | "warning" | "blocked";
  result: string;
};

export type NextAction = {
  label: string;
  description: string;
  buttonText: string;
  confirmationPhrase?: string;
};

export type TechnicalDetails = {
  packageManager?:    string;
  installCommand?:    string;
  buildCommand?:       string;
  startCommand?:       string;
  pm2Name?:            string;
  port?:               number;
  healthPath?:         string;
  routeMode?:          string;
  staticOutputPath?:   string;
  lastDeploymentLog?:  string;
  fixAttempts:         Record<string, number>;
  // ── Debug-safe project lookup summary — names/status only, no secret values ──
  projectId?:               string;
  projectSlug?:              string;
  deploymentConfigFound?:    boolean;
  envVarNamesFound?:         string[];
  latestDeploymentStatus?:   string | null;
  sourceDirectoryChecked?:   boolean;
};

export type LogClassification = {
  kind: string;
  userMessage: string;
  safeFixAvailable: boolean;
  safeFixId?: string;
  technicalReason: string;
};

export type AiImportAutopilotRun = {
  projectId: string;
  generatedAt: string;
  state: AiImportAutopilotState;
  summary: string;
  log: string[];
  detectedStack: DetectedStack;
  requiredInputs: RequiredInput[];
  safeFixesApplied: AppliedFix[];
  pendingFix?: ProposedFix;
  checks: VerificationCheck[];
  nextAction: NextAction;
  browserPreviewUrl?: string;
  publicUrl?: string;
  /** Server-side only — never rendered as a clickable browser link. */
  internalHealthUrl?: string;
  hiddenTechnicalDetails: TechnicalDetails;
};
