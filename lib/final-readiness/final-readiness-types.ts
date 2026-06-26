export type FinalReadinessStatus =
  | "blocked"
  | "needs_fixes"
  | "ready_to_execute"
  | "continue_building";

export type FinalReadinessCategory =
  | "qa"
  | "release"
  | "migration"
  | "staging"
  | "ecommerce"
  | "routing"
  | "monitoring"
  | "logs"
  | "backups"
  | "security"
  | "team"
  | "documentation"
  | "training"
  | "launch_day"
  | "post_launch";

export type FinalReadinessCheck = {
  id: string;
  category: FinalReadinessCategory;
  label: string;
  description: string;
  required: boolean;
  status: "pass" | "warning" | "blocked" | "manual" | "not_applicable";
  evidence?: string;
  nextStep?: string;
};

export type FinalKnownIssue = {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "cosmetic";
  category: FinalReadinessCategory;
  title: string;
  description: string;
  evidenceToCheck: string[];
  recommendedAction: string;
  blocksLaunch: boolean;
};

export type FinalReadinessAudit = {
  projectId: string;
  generatedAt: string;
  status: FinalReadinessStatus;
  score: number;
  checks: FinalReadinessCheck[];
  knownIssues: FinalKnownIssue[];
  blockers: string[];
  warnings: string[];
  readyEvidence: string[];
  finalRecommendation: string;
  recommendedNextSteps: string[];
};
