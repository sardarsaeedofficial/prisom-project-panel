/**
 * lib/ai-import-agent/agent-run-types.ts
 *
 * Sprint 89: Types for the Replit-style Live AI Import Agent Console.
 * Sprint 92: Durable step-machine model — each step runs in its own action
 *            call so no single request can hang forever.
 */

export type AgentTimelineStepStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "fixed"
  | "skipped";

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

/** A single agent-narrated message shown in the chat column of the console. */
export type AgentChatMessage = {
  id: string;
  role: "agent" | "system" | "user";
  tone?: "thinking" | "success" | "warning" | "error" | "info";
  message: string;
  createdAt: string; // ISO
  relatedStepId?: string;
};

export type AgentError = {
  kind: string;
  /** Short headline for the error card, e.g. "Frontend is not being served". */
  title?: string;
  whatHappened: string;
  why: string;
  whatICanDo: string;
  fixSafetyLevel: AgentFixSafetyLevel;
  safeFixAvailable: boolean;
  safeFixId?: string;
  technicalReason: string;
  manualInstructions?: string;
};

/**
 * Which phase the step executor should run on the next call.
 * Sprint 92 — replaces the monolithic "run full agent in one request" design.
 */
export type AgentPhase =
  | "analyze"         // detect stack, check secrets
  | "apply_preset"    // apply Sardar/pnpm preset if needed
  | "deploy"          // install + build + PM2 start
  | "check_preview"   // HTTP health + root check
  | "apply_fix"       // apply pendingFixId (may include build inspection)
  | "verify_preview"; // post-fix preview recheck

export type AgentRunStatus =
  // Sprint 92 canonical values
  | "not_started"
  | "queued"                   // ready for next step executor call
  | "running"                  // executing an analysis step
  | "deploying"                // executing the deploy step
  | "verifying"                // executing a preview check
  | "fixing"                   // executing a fix step
  | "waiting_for_user_input"   // missing secrets — user must act
  | "waiting_for_fix_approval" // fix available — user must click
  | "preview_live"
  | "failed"
  | "timed_out"                // watchdog caught a stale in-flight run
  | "blocked"
  // Legacy values stored in DB by Sprint 89/90 — normalized on read
  | "idle"
  | "waiting_for_user"
  | "fix_available"
  | "retrying";

export type AgentRun = {
  id: string;
  projectId: string;
  status: AgentRunStatus;
  currentStep: string;
  summary: string;
  steps: AgentTimelineStep[];
  chatMessages: AgentChatMessage[];
  lastError?: AgentError;
  previewUrl?: string;
  publicUrl?: string;
  startedAt: string; // ISO
  updatedAt: string; // ISO
  /** Sprint 92: which phase executes on the next runNextAiImportAgentStepAction call. */
  nextPhase?: AgentPhase;
  /** Sprint 92: fix to apply in the apply_fix phase. */
  pendingFixId?: string;
  /** Sprint 92: how many fix/retry attempts have run — guards against infinite loops. */
  attemptCount?: number;
};

// ── Status groups ─────────────────────────────────────────────────────────────

/** Statuses where the UI should call runNextAiImportAgentStepAction. */
export const ACTIVE_STATUSES: AgentRunStatus[] = [
  "queued", "running", "deploying", "verifying", "fixing",
  "retrying", // legacy
];

/** Statuses where a step is already executing — return current run without re-starting. */
export const IN_FLIGHT_STATUSES: AgentRunStatus[] = [
  "running", "deploying", "verifying", "fixing",
];

/** Statuses where the UI waits for a user action before the agent can continue. */
export const WAITING_STATUSES: AgentRunStatus[] = [
  "waiting_for_user_input", "waiting_for_fix_approval",
  "waiting_for_user", "fix_available", // legacy
];

/** Statuses where the run is permanently stopped. */
export const TERMINAL_STATUSES: AgentRunStatus[] = [
  "preview_live", "failed", "timed_out", "not_started", "idle", "blocked",
];

/** Backwards-compat alias — used by Sprint 89/90 polling logic. */
export const POLLING_STATUSES: AgentRunStatus[] = ACTIVE_STATUSES;

/** Backwards-compat alias. */
export const STOPPED_STATUSES: AgentRunStatus[] = [
  ...TERMINAL_STATUSES,
  ...WAITING_STATUSES,
];

// ── Watchdog timeouts ─────────────────────────────────────────────────────────

/**
 * If a run has been in one of these statuses longer than the threshold
 * without a DB update, the watchdog marks it timed_out.
 *
 * "fixing" is 600 s because apply_fix can include an 8-minute build run
 * (runBuildInRelease timeout = 480 s + overhead).
 */
export const STATUS_TIMEOUT_MS: Partial<Record<AgentRunStatus, number>> = {
  deploying: 300_000,  // 5 min
  verifying: 120_000,  // 2 min
  fixing:    600_000,  // 10 min
  running:   300_000,  // 5 min
  retrying:  300_000,  // 5 min (legacy)
};
