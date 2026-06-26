export type GoNoGoDecision =
  | "go"
  | "no_go"
  | "go_with_warnings"
  | "needs_manual_review";

export type GoNoGoEvidenceItem = {
  id: string;
  category:
    | "deployment"
    | "qa"
    | "release"
    | "migration"
    | "backup"
    | "monitoring"
    | "security"
    | "rollback"
    | "operator"
    | "client";
  label: string;
  description: string;
  required: boolean;
  status: "missing" | "collected" | "warning" | "blocked" | "manual";
  evidencePrompt: string;
};

export type GoNoGoEvidencePack = {
  projectId: string;
  generatedAt: string;
  decision: GoNoGoDecision;
  evidence: GoNoGoEvidenceItem[];
  blockers: string[];
  warnings: string[];
  finalQuestions: string[];
  requiredApprovals: string[];
  launchAllowedOnlyIf: string[];
  launchBlockedIf: string[];
  finalOperatorMessage: string;
};
