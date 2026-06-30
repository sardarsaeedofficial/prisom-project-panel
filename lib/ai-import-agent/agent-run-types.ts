/**
 * lib/ai-import-agent/agent-run-types.ts
 *
 * Sprint 89: Types for the Replit-style Live AI Import Agent Console.
 * Pure type definitions — no runtime dependencies.
 */

export type AgentTimelineStepStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "fixed";

export type AgentTimelineStep = {
  id: string;
  title: string;
  status: AgentTimelineStepStatus;
  summary: string;
  startedAt?: string;   // ISO
  completedAt?: string; // ISO
  command?: string;
  outputPreview?: string;
  fullOutput?: string;
  errorMessage?: string;
  fixAvailable?: boolean;
  fixId?: string;
};

/** Fix safety level shown to the user alongside an error explanation. */
export type AgentFixSafetyLevel = "safe" | "needs_approval";

export type AgentError = {
  kind: string;
  /** "What happened" — plain English. */
  whatHappened: string;
  /** "Why it happened" — plain English root cause. */
  why: string;
  /** "What I can do" — plain English next step. */
  whatICanDo: string;
  fixSafetyLevel: AgentFixSafetyLevel;
  safeFixAvailable: boolean;
  safeFixId?: string;
  technicalReason: string;
  /** Manual SSH instructions when no safe automated fix exists. No secret values. */
  manualInstructions?: string;
};

export type AgentRunStatus =
  | "idle"
  | "running"
  | "waiting_for_user"
  | "fix_available"
  | "fixing"
  | "retrying"
  | "preview_live"
  | "failed";

export type AgentRun = {
  id: string;
  projectId: string;
  status: AgentRunStatus;
  currentStep: string;
  summary: string;
  steps: AgentTimelineStep[];
  lastError?: AgentError;
  previewUrl?: string;
  publicUrl?: string;
  startedAt: string; // ISO
  updatedAt: string; // ISO
};

/** Statuses where the UI should keep polling. */
export const POLLING_STATUSES: AgentRunStatus[] = ["running", "fixing", "retrying"];

/** Statuses where the run is done driving itself and waits on the user. */
export const STOPPED_STATUSES: AgentRunStatus[] = [
  "preview_live",
  "waiting_for_user",
  "fix_available",
  "failed",
];
