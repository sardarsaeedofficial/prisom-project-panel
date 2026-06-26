export type LaunchExecutionStatus =
  | "not_started"
  | "ready"
  | "blocked"
  | "in_progress"
  | "complete";

export type LaunchExecutionStep = {
  id: string;
  phase:
    | "freeze"
    | "backup"
    | "preflight"
    | "cutover"
    | "smoke"
    | "ecommerce"
    | "monitoring"
    | "handover"
    | "rollback";
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "manual" | "pass" | "warning" | "blocked";
  operator?: string;
  command?: string;
  evidence?: string;
  safetyNote?: string;
  nextStep?: string;
};

export type LaunchExecutionChecklist = {
  projectId: string;
  generatedAt: string;
  status: LaunchExecutionStatus;
  steps: LaunchExecutionStep[];
  operatorCommands: string[];
  smokeCommands: string[];
  rollbackCommands: string[];
  goNoGoQuestions: string[];
  evidenceChecklist: string[];
  blockers: string[];
  warnings: string[];
  recommendedNextSteps: string[];
};
