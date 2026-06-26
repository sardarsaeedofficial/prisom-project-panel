export type StopBuildDecision =
  | "stop_building_ready_to_launch"
  | "fix_blockers_only"
  | "continue_building";

export type StopBuildGateCheck = {
  id: string;
  category:
    | "core_platform"
    | "migration_workflow"
    | "launch_workflow"
    | "safety"
    | "documentation"
    | "operations"
    | "client_handover";
  label: string;
  description: string;
  status: "pass" | "warning" | "blocked" | "manual";
  required: boolean;
};

export type StopBuildGateReport = {
  projectId: string;
  generatedAt: string;
  decision: StopBuildDecision;
  checks: StopBuildGateCheck[];
  blockers: string[];
  warnings: string[];
  allowedNextWork: string[];
  blockedNextWork: string[];
  finalOperatorMessage: string;
};
