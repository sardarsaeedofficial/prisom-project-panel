"use server";

/**
 * app/actions/sardar-migration-runbook.ts
 *
 * Sprint 50: Server actions for the Sardar ecommerce migration runbook.
 *
 * Safety:
 *  - no secret values exposed
 *  - no database commands executed
 *  - no DNS changes
 *  - no automatic production cutover
 *  - no auto-enable of Stripe webhooks
 */

import { requireProjectPermission }          from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }            from "@/lib/audit/project-audit";
import { generateSardarMigrationRunbook }    from "@/lib/migration/sardar-migration-runbook";
import { exportSardarRunbookAsMarkdown }     from "@/lib/migration/sardar-runbook-export";
import type { SardarMigrationRunbook }       from "@/lib/migration/sardar-migration-types";

// ── Permission helper ─────────────────────────────────────────────────────────

async function requireView(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "project.view");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

// ── Action 1: Generate runbook ────────────────────────────────────────────────

export async function generateSardarMigrationRunbookAction(
  projectId: string,
): Promise<
  | { ok: true;  runbook: SardarMigrationRunbook }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireView(projectId);

    const runbook = await generateSardarMigrationRunbook(projectId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "sardar.runbook_generated",
      summary:     `Sardar migration runbook generated — status: ${runbook.overallStatus}`,
      result:      "success",
      metadata:    {
        overallStatus: runbook.overallStatus,
        blockers:      runbook.blockers.length,
        warnings:      runbook.warnings.length,
      },
    }).catch(() => null);

    return { ok: true, runbook };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Failed to generate runbook: ${msg}` };
  }
}

// ── Action 2: Export runbook as Markdown ──────────────────────────────────────

export async function exportSardarMigrationRunbookAction(
  projectId: string,
): Promise<
  | { ok: true;  markdown: string; filename: string }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireView(projectId);

    const runbook  = await generateSardarMigrationRunbook(projectId);
    const markdown = exportSardarRunbookAsMarkdown(runbook);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "sardar.runbook_exported",
      summary:     "Sardar migration runbook exported as Markdown",
      result:      "success",
    }).catch(() => null);

    return { ok: true, markdown, filename: "SARDAR_MIGRATION_RUNBOOK.md" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Failed to export runbook: ${msg}` };
  }
}
