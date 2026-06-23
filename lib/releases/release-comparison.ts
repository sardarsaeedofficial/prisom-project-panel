/**
 * lib/releases/release-comparison.ts
 *
 * Sprint 49: Release comparison utility.
 * Builds a side-by-side view of the current live release,
 * the promotion candidate, and the available rollback target.
 *
 * Safety: no secrets, no raw env values.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReleaseSlot = {
  label:          string;
  id:             string;
  ref:            string;
  createdAt?:     string;
  activatedAt?:   string;
  branch?:        string;
  commitSha?:     string;
  commitMessage?: string;
  isActive:       boolean;
};

export type ReleaseComparison = {
  currentLive:    ReleaseSlot | null;
  candidate:      ReleaseSlot | null;
  rollbackTarget: ReleaseSlot | null;
  isFirstRelease: boolean;
};

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildReleaseComparison(input: {
  currentLive?:    { id: string; ref: string; activatedAt?: string; branch?: string; commitSha?: string; commitMessage?: string } | null;
  candidate?:      { id: string; ref: string; createdAt: string;   branch?: string; commitSha?: string; commitMessage?: string } | null;
  rollbackTarget?: { id: string; ref: string; createdAt: string } | null;
}): ReleaseComparison {
  const currentLive: ReleaseSlot | null = input.currentLive
    ? {
        label:         "Current Live",
        id:            input.currentLive.id,
        ref:           input.currentLive.ref,
        activatedAt:   input.currentLive.activatedAt,
        branch:        input.currentLive.branch,
        commitSha:     input.currentLive.commitSha,
        commitMessage: input.currentLive.commitMessage,
        isActive:      true,
      }
    : null;

  const candidate: ReleaseSlot | null = input.candidate
    ? {
        label:         "Candidate",
        id:            input.candidate.id,
        ref:           input.candidate.ref,
        createdAt:     input.candidate.createdAt,
        branch:        input.candidate.branch,
        commitSha:     input.candidate.commitSha,
        commitMessage: input.candidate.commitMessage,
        isActive:      false,
      }
    : null;

  const rollbackTarget: ReleaseSlot | null = input.rollbackTarget
    ? {
        label:     "Rollback Target",
        id:        input.rollbackTarget.id,
        ref:       input.rollbackTarget.ref,
        createdAt: input.rollbackTarget.createdAt,
        isActive:  false,
      }
    : null;

  return {
    currentLive,
    candidate,
    rollbackTarget,
    isFirstRelease: !currentLive,
  };
}
