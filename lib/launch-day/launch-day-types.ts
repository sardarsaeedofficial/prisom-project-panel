export type LaunchDayStatus =
  | "not_started"
  | "pre_launch"
  | "launch_in_progress"
  | "monitoring"
  | "stabilizing"
  | "complete"
  | "blocked";

export type LaunchDayTimelineItem = {
  id: string;
  phase:
    | "pre_launch"
    | "cutover"
    | "smoke_test"
    | "ecommerce"
    | "monitoring"
    | "client_handover"
    | "post_launch";
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  command?: string;
  evidence?: string;
  operatorNote?: string;
  safetyNote?: string;
};

export type LaunchDaySupportReport = {
  projectId: string;
  generatedAt: string;
  status: LaunchDayStatus;
  timeline: LaunchDayTimelineItem[];
  blockers: string[];
  warnings: string[];
  requiredEvidence: string[];
  operatorChecklist: string[];
  smokeCommands: string[];
  rollbackReminder: string[];
  recommendedNextSteps: string[];
};
