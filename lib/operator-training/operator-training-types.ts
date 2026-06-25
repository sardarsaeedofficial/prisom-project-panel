/**
 * lib/operator-training/operator-training-types.ts
 *
 * Sprint 74: Types for the operator training pack.
 * No secrets. No production mutation.
 */

export type TrainingAudience = "admin" | "operator" | "developer" | "client";

export type TrainingSection = {
  id: string;
  title: string;
  audience: TrainingAudience;
  summary: string;
  steps: string[];
  safetyNotes: string[];
};

export type OperatorTrainingPack = {
  projectId: string;
  generatedAt: string;
  sections: TrainingSection[];
  dailyChecklist: string[];
  weeklyChecklist: string[];
  launchDayChecklist: string[];
  emergencyChecklist: string[];
  escalationRules: string[];
  pagesToUse: Array<{ label: string; path: string; note: string }>;
  pagesToAvoid: Array<{ label: string; note: string }>;
};
