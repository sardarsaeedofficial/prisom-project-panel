/**
 * lib/admin/admin-section-timing.ts
 *
 * Sprint 42: Safe server-side timing instrumentation for Admin Console sections.
 *
 * Logs only when ADMIN_HEALTH_DEBUG=1.
 * Never logs secrets, env values, file paths, or stack traces.
 * Logging is fire-and-forget — never throws.
 */

export type SectionTimingResult = "success" | "error" | "timeout";

export type SectionTimingRecord = {
  section:     string;
  startedAt:   number;   // epoch ms
  durationMs:  number;
  cacheStatus: string;   // "hit" | "miss" | "stale" | "n/a"
  result:      SectionTimingResult;
};

const DEBUG = process.env.ADMIN_HEALTH_DEBUG === "1";

export function recordSectionTiming(rec: SectionTimingRecord): void {
  if (!DEBUG) return;
  try {
    // Safe structured log — no interpolation of user data
    console.log(
      `[admin-health] ${rec.section} finished in ${rec.durationMs}ms` +
      ` cache=${rec.cacheStatus} result=${rec.result}`,
    );
  } catch { /* never throw */ }
}

/** Creates a timer; call the returned function to log the result. */
export function startSectionTimer(section: string) {
  const startedAt = Date.now();
  return function finish(result: SectionTimingResult, cacheStatus = "n/a") {
    const durationMs = Date.now() - startedAt;
    recordSectionTiming({ section, startedAt, durationMs, cacheStatus, result });
    return durationMs;
  };
}
