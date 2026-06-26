export type PostLaunchIssueSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "cosmetic";

export type PostLaunchIssueCategory =
  | "availability"
  | "routing"
  | "checkout"
  | "payments"
  | "orders"
  | "email"
  | "admin"
  | "content"
  | "performance"
  | "logs"
  | "unknown";

export type PostLaunchIssueTemplate = {
  id: string;
  severity: PostLaunchIssueSeverity;
  category: PostLaunchIssueCategory;
  title: string;
  description: string;
  evidenceToCollect: string[];
  immediateChecks: string[];
  escalationRule: string;
};

export type PostLaunchBugCaptureReport = {
  projectId: string;
  generatedAt: string;
  issueTemplates: PostLaunchIssueTemplate[];
  triageRules: string[];
  immediateFixAllowed: string[];
  changesRequiringApproval: string[];
  recommendedNextSteps: string[];
};
