/**
 * lib/admin/admin-health-cache.ts
 *
 * Sprint 33: In-memory per-section cache for Admin Console health data.
 *
 * Uses globalThis so the cache survives hot-reloads in dev and is shared
 * across concurrent requests in production (same Node.js process).
 *
 * Cache is server-only — never imported by client components.
 * No secrets are stored here — only aggregated health data.
 */

export type CacheKey = "fast" | "pm2" | "disk" | "schedulers" | "storage";

// TTLs per section
const CACHE_TTL_MS: Record<CacheKey, number> = {
  fast:       15_000,  // 15 s — DB stats
  pm2:        10_000,  // 10 s — pm2 jlist
  disk:       60_000,  // 60 s — recursive fs walk + df
  schedulers: 10_000,  // 10 s — globalThis heartbeat registry
  storage:    60_000,  // 60 s — backup size aggregation
};

type CacheEntry = {
  value:       unknown;
  generatedAt: string;  // ISO
  expiresAt:   number;  // epoch ms
};

type CacheStore = Partial<Record<CacheKey, CacheEntry>>;

const g = globalThis as unknown as { __prisomAdminHealthCache?: CacheStore };

function store(): CacheStore {
  if (!g.__prisomAdminHealthCache) g.__prisomAdminHealthCache = {};
  return g.__prisomAdminHealthCache;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export type CachedResult<T> = {
  value:       T;
  generatedAt: string;
  isFresh:     boolean;
};

export function getCachedSection<T>(key: CacheKey): CachedResult<T> | null {
  const entry = store()[key];
  if (!entry) return null;
  return {
    value:       entry.value as T,
    generatedAt: entry.generatedAt,
    isFresh:     Date.now() < entry.expiresAt,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function setCachedSection<T>(key: CacheKey, value: T): string {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  store()[key] = {
    value,
    generatedAt,
    expiresAt: now + CACHE_TTL_MS[key],
  };
  return generatedAt;
}

// ── Invalidate ────────────────────────────────────────────────────────────────

export function clearCachedSection(key?: CacheKey): void {
  if (key) {
    delete store()[key];
  } else {
    g.__prisomAdminHealthCache = {};
  }
}

// ── TTL accessor (for debug logging) ─────────────────────────────────────────

export function getCacheTtlMs(key: CacheKey): number {
  return CACHE_TTL_MS[key];
}
