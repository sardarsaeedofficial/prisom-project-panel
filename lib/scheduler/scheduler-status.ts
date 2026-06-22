/**
 * lib/scheduler/scheduler-status.ts
 *
 * Sprint 31: In-memory scheduler heartbeat registry.
 *
 * Schedulers call registerSchedulerHeartbeat() on each tick so the Admin
 * Console can display running / stale / unknown status without a DB round-trip.
 *
 * Status is process-local (globalThis) — it resets on restart, which is fine
 * for a monitoring dashboard.  No schema change required.
 */

// ── Registry (process-local singleton) ───────────────────────────────────────

type HeartbeatEntry = {
  name:            string;
  lastHeartbeatAt: number; // Date.now()
  startedAt:       number;
  tickCount:       number;
  lastError?:      string;
};

const globalForStatus = globalThis as unknown as {
  __prisomSchedulerRegistry?: Map<string, HeartbeatEntry>;
};

function getRegistry(): Map<string, HeartbeatEntry> {
  if (!globalForStatus.__prisomSchedulerRegistry) {
    globalForStatus.__prisomSchedulerRegistry = new Map();
  }
  return globalForStatus.__prisomSchedulerRegistry;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type SchedulerStatusValue = "running" | "stale" | "unknown";

export type SchedulerStatusEntry = {
  name:            string;
  status:          SchedulerStatusValue;
  lastHeartbeatAt?: string; // ISO
  startedAt?:      string;  // ISO
  tickCount?:      number;
  lastError?:      string;
};

// 15 min — if no heartbeat in this window, scheduler is considered stale
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

// ── Public API ────────────────────────────────────────────────────────────────

/** Called by a scheduler on every successful tick. */
export function registerSchedulerHeartbeat(name: string, error?: string): void {
  const registry = getRegistry();
  const existing = registry.get(name);
  registry.set(name, {
    name,
    lastHeartbeatAt: Date.now(),
    startedAt:       existing?.startedAt ?? Date.now(),
    tickCount:       (existing?.tickCount ?? 0) + 1,
    lastError:       error ?? undefined,
  });
}

/** Returns the status of a single named scheduler. */
export function getSchedulerStatus(name: string): SchedulerStatusEntry {
  const registry = getRegistry();
  const entry    = registry.get(name);
  if (!entry) {
    return { name, status: "unknown" };
  }
  const age    = Date.now() - entry.lastHeartbeatAt;
  const status = age > STALE_THRESHOLD_MS ? "stale" : "running";
  return {
    name,
    status,
    lastHeartbeatAt: new Date(entry.lastHeartbeatAt).toISOString(),
    startedAt:       new Date(entry.startedAt).toISOString(),
    tickCount:       entry.tickCount,
    lastError:       entry.lastError,
  };
}

/** Returns statuses for all registered schedulers. */
export function getAllSchedulerStatuses(): SchedulerStatusEntry[] {
  const registry = getRegistry();
  return Array.from(registry.keys()).map(getSchedulerStatus);
}
