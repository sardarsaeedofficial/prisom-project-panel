"use server";

/**
 * app/actions/project-go-live.ts
 *
 * Sprint 26: Server actions for the Go-Live Readiness workflow.
 *
 * Safety:
 *   - All data is computed on demand (no schema change)
 *   - Env var values are NEVER returned — only key names + presence
 *   - No Stripe/DNS/email provider changes
 *   - No automatic deploys or destructive DB commands
 *   - All actions require project permissions
 *   - All actions produce audit events with sanitized metadata
 */

import { db }                       from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { runGoLiveChecks }          from "@/lib/migration/go-live-runner";
import type { GoLiveReadinessReport } from "@/lib/migration/go-live-types";

// ── Shared ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Check readiness ────────────────────────────────────────────────────────

export async function checkGoLiveReadinessAction(
  projectId: string,
): Promise<ActionResult<GoLiveReadinessReport>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  let report: GoLiveReadinessReport;
  try {
    report = await runGoLiveChecks(projectId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId, actorUserId: auth.userId, actorRole: auth.role,
      action:   "project.go_live.readiness_checked",
      category: "publishing", result: "failed",
      summary:  `Go-live readiness check failed: ${msg}`,
      metadata: { error: msg },
      ...ctx,
    }).catch(() => null);
    return { ok: false, error: `Readiness check failed: ${msg}` };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId, actorUserId: auth.userId, actorRole: auth.role,
    action:   "project.go_live.readiness_checked",
    category: "publishing", result: "success",
    summary:  `Go-live readiness: ${report.overallStatus} (${report.failCount} fail, ${report.warningCount} warn, ${report.passCount} pass)`,
    metadata: {
      overallStatus:     report.overallStatus,
      failCount:         report.failCount,
      warningCount:      report.warningCount,
      passCount:         report.passCount,
      serviceCount:      report.services.length,
      externalTaskCount: report.externalTasks.length,
    },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: report };
}

// ── 2. Record report copied ───────────────────────────────────────────────────

export async function recordGoLiveReportCopiedAction(
  projectId:     string,
  overallStatus: string,
): Promise<ActionResult<void>> {
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId, actorUserId: auth.userId, actorRole: auth.role,
    action:   "project.go_live.report_copied",
    category: "publishing", result: "success",
    summary:  `Go-live report copied (status: ${overallStatus})`,
    metadata: { overallStatus },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}
