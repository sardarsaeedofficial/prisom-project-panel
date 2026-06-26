export type DeployVerificationStatus =
  | "not_checked"
  | "blocked"
  | "warnings"
  | "verified";

export type DeployVerificationCheck = {
  id: string;
  category:
    | "commit"
    | "panel_route"
    | "project_route"
    | "export"
    | "action"
    | "permissions"
    | "safety"
    | "runtime";
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  evidence?: string;
  nextStep?: string;
  command?: string;
  safetyNote?: string;
};

export type DeployVerificationReport = {
  projectId: string;
  generatedAt: string;
  status: DeployVerificationStatus;
  expectedCommit?: string;
  observedCommit?: string;
  checks: DeployVerificationCheck[];
  blockers: string[];
  warnings: string[];
  verifiedRoutes: string[];
  exportsToVerify: string[];
  actionsToVerify: string[];
  recommendedNextSteps: string[];
};
