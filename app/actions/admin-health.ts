"use server";

/**
 * app/actions/admin-health.ts
 *
 * Sprint 31: Server actions for the Admin Console.
 *
 * All actions require OWNER or ADMIN role via requireAdmin().
 * No secret values are returned — only aggregated counts and status labels.
 */

import { requireAdmin }         from "@/lib/auth/require-admin";
import { runAdminHealthReport } from "@/lib/admin/admin-health-runner";
import type { GetAdminHealthResult } from "@/lib/admin/admin-health-types";

export async function getAdminHealthReportAction(): Promise<GetAdminHealthResult> {
  try {
    await requireAdmin();
    const report = await runAdminHealthReport();
    return { ok: true, report };
  } catch (err) {
    // requireAdmin redirects on auth failure, so this only catches runner errors
    const msg = err instanceof Error ? err.message : "Failed to load admin health report";
    return { ok: false, error: msg };
  }
}

export async function refreshAdminHealthAction(): Promise<GetAdminHealthResult> {
  return getAdminHealthReportAction();
}
