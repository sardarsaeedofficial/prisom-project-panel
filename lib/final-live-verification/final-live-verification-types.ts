export type FinalLiveVerificationStatus =
  | "not_started"
  | "blocked"
  | "needs_review"
  | "verified_ready";

export type FinalLiveVerificationCheck = {
  id: string;
  category:
    | "deployment"
    | "route"
    | "panel"
    | "export"
    | "confirmation_gate"
    | "sardar"
    | "security"
    | "monitoring"
    | "rollback"
    | "handoff";
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  evidence?: string;
  command?: string;
  nextStep?: string;
  safetyNote?: string;
};

export type FinalLiveVerificationRun = {
  projectId: string;
  generatedAt: string;
  status: FinalLiveVerificationStatus;
  score: number;
  expectedCommit?: string;
  checks: FinalLiveVerificationCheck[];
  blockers: string[];
  warnings: string[];
  evidenceRequired: string[];
  verifiedExports: string[];
  verifiedPanels: string[];
  recommendedNextSteps: string[];
};
