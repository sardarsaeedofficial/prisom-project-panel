/**
 * lib/ai-import-operator/ai-import-operator-types.ts
 *
 * Sprint 87: Types for the AI Import Operator.
 * Pure type definitions — no runtime dependencies.
 */

export type AiImportOperatorStatus =
  | "not_started"
  | "reading_project"
  | "needs_user_input"
  | "ready_to_fix"
  | "applying_fix"
  | "deploying"
  | "checking_preview"
  | "preview_live"
  | "ready_for_go_live"
  | "blocked";

export type AiImportUserInputRequest = {
  id: string;
  kind:
    | "env_var"
    | "database_url"
    | "domain"
    | "confirmation"
    | "manual_choice";
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  fieldName?: string;
  placeholder?: string;
  options?: string[];
  safetyNote?: string;
};

export type AiImportFixPlan = {
  id: string;
  title: string;
  plainEnglishSummary: string;
  technicalChanges: string[];
  safe: boolean;
  requiresConfirmation: boolean;
  confirmationPhrase: "APPLY FIX" | "RETRY DEPLOY" | "GO LIVE";
};

export type AiImportOperatorStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "passed" | "warning" | "blocked";
  message: string;
  evidence?: string;
};

export type AiImportOperatorRun = {
  projectId: string;
  generatedAt: string;
  status: AiImportOperatorStatus;
  plainEnglishSummary: string;
  currentQuestion?: string;
  userInputsNeeded: AiImportUserInputRequest[];
  fixPlan?: AiImportFixPlan;
  steps: AiImportOperatorStep[];
  previewUrl?: string;
  publicDomain?: string;
  healthUrl?: string;
  previewChecks: Array<{
    label: string;
    urlOrPath: string;
    status: "pass" | "warning" | "blocked";
    result: string;
  }>;
  nextBestAction: {
    label: string;
    description: string;
    buttonText: string;
    confirmationPhrase?: string;
  };
  hiddenTechnicalDetails: {
    packageManager?: string;
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    routeMode?: string;
    staticOutputPath?: string;
    healthPath?: string;
    missingEnvNames: string[];
    knownErrors: string[];
  };
};
