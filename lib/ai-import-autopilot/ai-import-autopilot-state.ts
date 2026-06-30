/**
 * lib/ai-import-autopilot/ai-import-autopilot-state.ts
 *
 * Sprint 88: Pure state-machine helpers for the AI Import Autopilot.
 * No async, no DB, no side effects.
 */

import type { AiImportAutopilotState } from "./ai-import-autopilot-types";

export const MAX_RETRIES_PER_ISSUE_KIND = 3;
export const MAX_TOTAL_RETRIES_PER_RUN  = 8;

/** Tracks how many times each issue kind has been auto-fixed within a single run. */
export class RetryBudget {
  private perKind: Record<string, number> = {};
  private total = 0;

  canRetry(kind: string): boolean {
    return this.total < MAX_TOTAL_RETRIES_PER_RUN &&
      (this.perKind[kind] ?? 0) < MAX_RETRIES_PER_ISSUE_KIND;
  }

  record(kind: string): void {
    this.perKind[kind] = (this.perKind[kind] ?? 0) + 1;
    this.total += 1;
  }

  totalAttempts(): number {
    return this.total;
  }

  attemptsByKind(): Record<string, number> {
    return { ...this.perKind };
  }
}

/** Terminal states the orchestrator loop must stop at. */
export const TERMINAL_STATES: AiImportAutopilotState[] = [
  "preview_live",
  "waiting_for_user_input",
  "needs_manual_approval",
  "blocked",
];

export function isTerminalState(state: AiImportAutopilotState): boolean {
  return TERMINAL_STATES.includes(state);
}
