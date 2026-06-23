/**
 * components/admin/admin-async-section-state.ts
 *
 * Sprint 42: Standard state shape for Admin Console async sections.
 * Pure types — safe to import from any component.
 *
 * This replaces the ad-hoc { data, loading, error } pattern with a proper
 * discriminated union that carries timing, cache, and stale-data info.
 */

export type AdminAsyncSectionState<T> =
  | {
      status:     "idle";
      data?:      null;
      startedAt?: null;
      finishedAt?: null;
      error?:     null;
    }
  | {
      status:    "loading";
      data?:     T | null;          // stale data shown while refreshing
      startedAt: number;            // epoch ms
      finishedAt?: null;
      error?:    null;
      slow?:     boolean;           // true after slowAfterMs
    }
  | {
      status:      "success";
      data:        T;
      startedAt:   number;
      finishedAt:  number;
      durationMs:  number;
      cacheStatus?: "hit" | "miss" | "stale";
      generatedAt?: string;         // ISO from server
      error?:      null;
    }
  | {
      status:      "error";
      data?:       T | null;        // stale data still shown on error
      startedAt:   number;
      finishedAt:  number;
      durationMs:  number;
      error:       string;
      canRetry:    boolean;
      cacheStatus?: "stale";
      generatedAt?: string;         // ISO of stale data
    };

/** Convenience guard */
export function isSectionLoaded<T>(
  s: AdminAsyncSectionState<T>,
): s is Extract<AdminAsyncSectionState<T>, { status: "success" }> {
  return s.status === "success";
}

/** True when we have _any_ data (fresh or stale) to show */
export function hasSectionData<T>(
  s: AdminAsyncSectionState<T>,
): s is AdminAsyncSectionState<T> & { data: T } {
  return s.data != null;
}
