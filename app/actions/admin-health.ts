"use server";

/**
 * app/actions/admin-health.ts
 *
 * Sprint 31: Full report actions (kept for backward compat).
 * Sprint 33: Fast summary + per-section async actions with caching.
 * Sprint 42: Timeouts + stale-data fallback on every async section.
 *
 * All actions require OWNER or ADMIN role via requireAdmin().
 * No secret values are returned — only aggregated counts and status labels.
 *
 * Safety:
 *  - Every async section is wrapped with withTimeout (12s default)
 *  - On timeout/error, stale cache data is returned if available
 *  - No secrets, no env values, no shell commands
 *  - Page render time is not increased (fast summary is DB-only, unchanged)
 *  - Doorsteps/LocalShop not touched
 */

import { requireAdmin }              from "@/lib/auth/require-admin";
import {
  runAdminHealthReport,
  runAdminFastSummary,
  runAdminPm2Section,
  runAdminDiskSection,
  runAdminSchedulersSection,
  runAdminJobsSection,
}                                    from "@/lib/admin/admin-health-runner";
import { runAdminStorageSection }    from "@/lib/admin/admin-storage-summary";
import {
  getCachedSection,
}                                    from "@/lib/admin/admin-health-cache";
import { withTimeout }               from "@/lib/admin/with-admin-section-timeout";
import { startSectionTimer }         from "@/lib/admin/admin-section-timing";
import type {
  GetAdminHealthResult,
  GetFastSummaryResult,
  GetPm2SectionResult,
  GetDiskSectionResult,
  GetSchedulersSectionResult,
  GetStorageSectionResult,
  GetJobsSectionResult,
  AdminPm2Section,
  AdminDiskSection,
  AdminSchedulersSection,
  AdminStorageSection,
  AdminJobsSection,
}                                    from "@/lib/admin/admin-health-types";

// Section timeout — generous enough that a real response always wins on healthy infra.
const SECTION_TIMEOUT_MS = 12_000;

// ── Sprint 31 — full report (still used by manual Refresh when no fast split) ──

export async function getAdminHealthReportAction(): Promise<GetAdminHealthResult> {
  try {
    await requireAdmin();
    const report = await runAdminHealthReport();
    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load admin health report";
    return { ok: false, error: msg };
  }
}

export async function refreshAdminHealthAction(): Promise<GetAdminHealthResult> {
  return getAdminHealthReportAction();
}

// ── Sprint 33 — fast summary (DB-only, called on initial page render) ─────────
// This is NOT wrapped with withTimeout — it must not increase initial render time.

export async function getAdminFastSummaryAction(
  forceRefresh = false,
): Promise<GetFastSummaryResult> {
  try {
    await requireAdmin();
    const summary = await runAdminFastSummary(forceRefresh);
    return { ok: true, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load admin summary";
    return { ok: false, error: msg };
  }
}

// ── Sprint 42 helpers ─────────────────────────────────────────────────────────

function safeError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0].slice(0, 300) || fallback;
}

// ── Sprint 33 + Sprint 42 — async section actions ────────────────────────────

export async function getAdminPm2SectionAction(
  forceRefresh = false,
): Promise<GetPm2SectionResult> {
  const finish = startSectionTimer("pm2");
  try {
    await requireAdmin();
    const result = await withTimeout<AdminPm2Section>(
      runAdminPm2Section(forceRefresh),
      SECTION_TIMEOUT_MS,
      "PM2 status",
    );
    if (result.ok) {
      finish("success", result.data.cacheStatus);
      return { ok: true, data: result.data };
    }
    // Timeout or inner error — try to serve stale cache
    finish("timeout", "stale");
    const cached = getCachedSection<AdminPm2Section>("pm2");
    return {
      ok: false,
      error: result.error,
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  } catch (err) {
    finish("error");
    const cached = getCachedSection<AdminPm2Section>("pm2");
    return {
      ok: false,
      error: safeError(err, "Failed to load PM2 status"),
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  }
}

export async function getAdminDiskSectionAction(
  forceRefresh = false,
): Promise<GetDiskSectionResult> {
  const finish = startSectionTimer("disk");
  try {
    await requireAdmin();
    const result = await withTimeout<AdminDiskSection>(
      runAdminDiskSection(forceRefresh),
      SECTION_TIMEOUT_MS,
      "Disk usage",
    );
    if (result.ok) {
      finish("success", result.data.cacheStatus);
      return { ok: true, data: result.data };
    }
    finish("timeout", "stale");
    const cached = getCachedSection<AdminDiskSection>("disk");
    return {
      ok: false,
      error: result.error,
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  } catch (err) {
    finish("error");
    const cached = getCachedSection<AdminDiskSection>("disk");
    return {
      ok: false,
      error: safeError(err, "Failed to load disk usage"),
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  }
}

export async function getAdminSchedulersSectionAction(
  forceRefresh = false,
): Promise<GetSchedulersSectionResult> {
  const finish = startSectionTimer("schedulers");
  try {
    await requireAdmin();
    const result = await withTimeout<AdminSchedulersSection>(
      runAdminSchedulersSection(forceRefresh),
      SECTION_TIMEOUT_MS,
      "Scheduler status",
    );
    if (result.ok) {
      finish("success", result.data.cacheStatus);
      return { ok: true, data: result.data };
    }
    finish("timeout", "stale");
    const cached = getCachedSection<AdminSchedulersSection>("schedulers");
    return {
      ok: false,
      error: result.error,
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  } catch (err) {
    finish("error");
    const cached = getCachedSection<AdminSchedulersSection>("schedulers");
    return {
      ok: false,
      error: safeError(err, "Failed to load scheduler status"),
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  }
}

// ── Sprint 34 + Sprint 42 — admin storage section ────────────────────────────

export async function getAdminStorageSectionAction(
  forceRefresh = false,
): Promise<GetStorageSectionResult> {
  const finish = startSectionTimer("storage");
  try {
    await requireAdmin();
    const result = await withTimeout<AdminStorageSection>(
      runAdminStorageSection(forceRefresh),
      SECTION_TIMEOUT_MS,
      "Backup storage",
    );
    if (result.ok) {
      finish("success", result.data.cacheStatus);
      return { ok: true, data: result.data };
    }
    finish("timeout", "stale");
    const cached = getCachedSection<AdminStorageSection>("storage");
    return {
      ok: false,
      error: result.error,
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  } catch (err) {
    finish("error");
    const cached = getCachedSection<AdminStorageSection>("storage");
    return {
      ok: false,
      error: safeError(err, "Failed to load storage summary"),
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  }
}

// ── Sprint 35 + Sprint 42 — admin jobs section ───────────────────────────────

export async function getAdminJobsSectionAction(
  forceRefresh = false,
): Promise<GetJobsSectionResult> {
  const finish = startSectionTimer("jobs");
  try {
    await requireAdmin();
    const result = await withTimeout<AdminJobsSection>(
      runAdminJobsSection(forceRefresh),
      SECTION_TIMEOUT_MS,
      "Jobs summary",
    );
    if (result.ok) {
      finish("success", result.data.cacheStatus);
      return { ok: true, data: result.data };
    }
    finish("timeout", "stale");
    const cached = getCachedSection<AdminJobsSection>("jobs");
    return {
      ok: false,
      error: result.error,
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  } catch (err) {
    finish("error");
    const cached = getCachedSection<AdminJobsSection>("jobs");
    return {
      ok: false,
      error: safeError(err, "Failed to load jobs summary"),
      staleData:        cached?.value ?? null,
      staleGeneratedAt: cached?.value?.generatedAt,
    };
  }
}

// ── Sprint 33 + Sprint 42 — full async refresh ───────────────────────────────
// Now tolerates partial failures: each section is independent, global refresh
// returns all results even if some fail.

export async function refreshAllAdminSectionsAction(): Promise<{
  fast:       GetFastSummaryResult;
  pm2:        GetPm2SectionResult;
  disk:       GetDiskSectionResult;
  schedulers: GetSchedulersSectionResult;
  storage:    GetStorageSectionResult;
  jobs:       GetJobsSectionResult;
}> {
  await requireAdmin();
  // Run all sections in parallel; each is independently timeout-guarded.
  // Failures in one section do not block others.
  const [fast, pm2, disk, schedulers, storage, jobs] = await Promise.all([
    runAdminFastSummary(true)
      .then((s): GetFastSummaryResult  => ({ ok: true, summary: s }))
      .catch((e): GetFastSummaryResult => ({ ok: false, error: safeError(e, "Fast summary failed") })),

    getAdminPm2SectionAction(true),
    getAdminDiskSectionAction(true),
    getAdminSchedulersSectionAction(true),
    getAdminStorageSectionAction(true),
    getAdminJobsSectionAction(true),
  ]);
  return { fast, pm2, disk, schedulers, storage, jobs };
}
