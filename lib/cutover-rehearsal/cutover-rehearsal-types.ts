/**
 * lib/cutover-rehearsal/cutover-rehearsal-types.ts
 *
 * Sprint 75: Types for the production cutover rehearsal workflow.
 * Read-only — no production mutation.
 */

export type CutoverRehearsalStatus =
  | "not_started"
  | "blocked"
  | "needs_review"
  | "ready_for_launch";

export type CutoverRehearsalPhase =
  | "pre_launch"
  | "backup"
  | "routing"
  | "smoke_test"
  | "ecommerce"
  | "monitoring"
  | "rollback"
  | "handover";

export type CutoverRehearsalStep = {
  id: string;
  phase: CutoverRehearsalPhase;
  label: string;
  description: string;
  required: boolean;
  status: "pending" | "pass" | "warning" | "blocked" | "manual";
  command?: string;
  evidence?: string;
  safetyNote?: string;
};

export type CutoverRehearsalReport = {
  projectId: string;
  generatedAt: string;
  status: CutoverRehearsalStatus;
  score: number;
  steps: CutoverRehearsalStep[];
  blockers: string[];
  warnings: string[];
  operatorCommands: string[];
  rollbackDecisionTree: string[];
  finalGoNoGoQuestions: string[];
  recommendedNextSteps: string[];
};
