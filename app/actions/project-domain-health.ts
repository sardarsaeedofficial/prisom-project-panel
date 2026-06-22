"use server";

/**
 * app/actions/project-domain-health.ts
 *
 * Sprint 29: Server actions for the Domain + SSL Health Center.
 *
 * Safety guarantees:
 *  - Every action verifies project ownership (IDOR prevention)
 *  - No secrets or env values are returned
 *  - DNS/HTTP/SSL checks use controlled timeouts and crash guards
 *  - Nginx checks are read-only and return summaries only (no raw config)
 *  - No shell commands are executed
 */

import { db }                       from "@/lib/db";
import { requireProjectPermission }  from "@/lib/auth/project-membership";
import { runDomainHealthReport }     from "@/lib/domains/domain-health-runner";
import type { GetDomainHealthResult } from "@/lib/domains/domain-health-types";

// ── Ownership guard ────────────────────────────────────────────────────────────

async function verifyDomainAccess(projectId: string): Promise<void> {
  await requireProjectPermission(projectId, "project.view");
}

// ── Action: get full domain health report ─────────────────────────────────────

export async function getDomainHealthReportAction(
  projectId: string,
): Promise<GetDomainHealthResult> {
  try {
    await verifyDomainAccess(projectId);

    const domains = await db.domain.findMany({
      where:  { projectId },
      select: { id: true, hostname: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    if (domains.length === 0) {
      return {
        ok: true,
        report: { projectId, domains: [], generatedAt: new Date().toISOString() },
      };
    }

    const report = await runDomainHealthReport(projectId, domains);
    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Domain health check failed: ${msg}` };
  }
}
