"use server";

/**
 * app/actions/admin-health.ts
 *
 * Sprint 31: Full report actions (kept for backward compat).
 * Sprint 33: Fast summary + per-section async actions with caching.
 *
 * All actions require OWNER or ADMIN role via requireAdmin().
 * No secret values are returned — only aggregated counts and status labels.
 */

import { requireAdmin }              from "@/lib/auth/require-admin";
import {
  runAdminHealthReport,
  runAdminFastSummary,
  runAdminPm2Section,
  runAdminDiskSection,
  runAdminSchedulersSection,
}                                    from "@/lib/admin/admin-health-runner";
import type {
  GetAdminHealthResult,
  GetFastSummaryResult,
  GetPm2SectionResult,
  GetDiskSectionResult,
  GetSchedulersSectionResult,
}                                    from "@/lib/admin/admin-health-types";

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

// ── Sprint 33 — async section actions (called client-side after mount) ────────

export async function getAdminPm2SectionAction(
  forceRefresh = false,
): Promise<GetPm2SectionResult> {
  try {
    await requireAdmin();
    const data = await runAdminPm2Section(forceRefresh);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load PM2 status";
    return { ok: false, error: msg };
  }
}

export async function getAdminDiskSectionAction(
  forceRefresh = false,
): Promise<GetDiskSectionResult> {
  try {
    await requireAdmin();
    const data = await runAdminDiskSection(forceRefresh);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load disk usage";
    return { ok: false, error: msg };
  }
}

export async function getAdminSchedulersSectionAction(
  forceRefresh = false,
): Promise<GetSchedulersSectionResult> {
  try {
    await requireAdmin();
    const data = await runAdminSchedulersSection(forceRefresh);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load scheduler status";
    return { ok: false, error: msg };
  }
}

// ── Sprint 33 — full async refresh (all sections, force = true) ───────────────

export async function refreshAllAdminSectionsAction(): Promise<{
  fast:       GetFastSummaryResult;
  pm2:        GetPm2SectionResult;
  disk:       GetDiskSectionResult;
  schedulers: GetSchedulersSectionResult;
}> {
  await requireAdmin();
  const [fast, pm2, disk, schedulers] = await Promise.all([
    runAdminFastSummary(true).then((s): GetFastSummaryResult        => ({ ok: true, summary: s }))
      .catch((e): GetFastSummaryResult        => ({ ok: false, error: String(e) })),
    runAdminPm2Section(true).then((d): GetPm2SectionResult          => ({ ok: true, data: d }))
      .catch((e): GetPm2SectionResult          => ({ ok: false, error: String(e) })),
    runAdminDiskSection(true).then((d): GetDiskSectionResult        => ({ ok: true, data: d }))
      .catch((e): GetDiskSectionResult        => ({ ok: false, error: String(e) })),
    runAdminSchedulersSection(true).then((d): GetSchedulersSectionResult => ({ ok: true, data: d }))
      .catch((e): GetSchedulersSectionResult => ({ ok: false, error: String(e) })),
  ]);
  return { fast, pm2, disk, schedulers };
}
