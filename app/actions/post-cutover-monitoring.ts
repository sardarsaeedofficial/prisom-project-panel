"use server";

/**
 * app/actions/post-cutover-monitoring.ts
 *
 * Sprint 66: Server actions for Post-Cutover Monitoring + Incident Response.
 *
 * Safety:
 *  - no secrets returned
 *  - no production mutation
 *  - no nginx writes or reload
 *  - no DNS changes
 *  - no DB migrations
 *  - no PM2 restarts
 *  - no provider mutation
 *  - HTTP checks are GET-only
 *  - Doorsteps/LocalShop untouched
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generatePostCutoverMonitoringReport } from "@/lib/monitoring/post-cutover-monitoring-service";
import { runProductionHealthChecks }           from "@/lib/monitoring/production-health-check-runner";
import { exportPostCutoverMonitoringReport }   from "@/lib/monitoring/post-cutover-monitoring-export";
import type { PostCutoverMonitoringReport }    from "@/lib/monitoring/post-cutover-monitoring-types";

// ── Result type ───────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getProjectName(projectId: string): Promise<string> {
  try {
    const p = await db.project.findUnique({
      where:  { id: projectId },
      select: { name: true },
    });
    return p?.name ?? projectId;
  } catch {
    return projectId;
  }
}

async function requireDeployOrEdit(projectId: string) {
  const primary = await requireProjectPermission(projectId, "deploy.trigger");
  if (primary.ok) return primary;
  return requireProjectPermission(projectId, "project.edit");
}

// ── 1. Generate monitoring report ──────────────────────────────────────────────

export async function generatePostCutoverMonitoringReportAction(input: {
  projectId: string;
}): Promise<ActionResult<PostCutoverMonitoringReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generatePostCutoverMonitoringReport({ projectId, includeLiveChecks: false });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "post_cutover.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Monitoring report generated: status=${report.status}, severity=${report.incidentSeverity}`,
      metadata:    { status: report.status, severity: report.incidentSeverity },
      ...ctx,
    });

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to generate monitoring report: ${msg}` };
  }
}

// ── 2. Run production health checks ────────────────────────────────────────────

export async function runProductionHealthChecksAction(input: {
  projectId:    string;
  confirmation: "RUN PRODUCTION HEALTH CHECKS";
}): Promise<ActionResult<PostCutoverMonitoringReport>> {
  const { projectId, confirmation } = input;

  if (confirmation !== "RUN PRODUCTION HEALTH CHECKS") {
    return { ok: false, error: "Type RUN PRODUCTION HEALTH CHECKS to confirm." };
  }

  const auth = await requireDeployOrEdit(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    action:      "post_cutover.health_checks_started",
    category:    "publishing",
    result:      "success",
    summary:     "Production health checks started",
    ...ctx,
  });

  try {
    const report = await generatePostCutoverMonitoringReport({ projectId, includeLiveChecks: true });

    const passed = report.summary.failed === 0;
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      passed ? "post_cutover.health_checks_passed" : "post_cutover.health_checks_failed",
      category:    "publishing",
      result:      passed ? "success" : "failed",
      summary:     `Health checks ${passed ? "passed" : "failed"}: ${report.summary.failed} failures`,
      metadata:    { status: report.status, failed: report.summary.failed },
      ...ctx,
    });

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "post_cutover.health_checks_failed",
      category:    "publishing",
      result:      "failed",
      summary:     "Health checks failed with error",
      metadata:    { error: msg.slice(0, 200) },
      ...ctx,
    });
    return { ok: false, error: `Health checks failed: ${msg}` };
  }
}

// ── 3. Export monitoring report ────────────────────────────────────────────────

export async function exportPostCutoverMonitoringReportAction(input: {
  projectId:     string;
  confirmation?: "EXPORT MONITORING REPORT";
}): Promise<ActionResult<{ content: string; filename: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation && confirmation !== "EXPORT MONITORING REPORT") {
    return { ok: false, error: "Type EXPORT MONITORING REPORT to confirm." };
  }

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [report, projectName] = await Promise.all([
      generatePostCutoverMonitoringReport({ projectId }),
      getProjectName(projectId),
    ]);

    const content  = exportPostCutoverMonitoringReport(report, projectName);
    const filename = `POST_CUTOVER_MONITORING_REPORT_${new Date().toISOString().slice(0, 10)}.md`;

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "post_cutover.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Monitoring report exported: ${filename}`,
      metadata:    { filename },
      ...ctx,
    });

    return { ok: true, data: { content, filename } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Export failed: ${msg}` };
  }
}

// ── 4. Mark incident reviewed ─────────────────────────────────────────────────

export async function markIncidentReviewedAction(input: {
  projectId:    string;
  confirmation: "MARK INCIDENT REVIEWED";
}): Promise<ActionResult<{ reviewedAt: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation !== "MARK INCIDENT REVIEWED") {
    return { ok: false, error: "Type MARK INCIDENT REVIEWED to confirm." };
  }

  const auth = await requireDeployOrEdit(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const reviewedAt = new Date().toISOString();
  const ctx        = await getAuditRequestContext();

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    action:      "post_cutover.incident_reviewed",
    category:    "publishing",
    result:      "success",
    summary:     `Post-cutover incident marked reviewed at ${reviewedAt}`,
    metadata:    { reviewedAt },
    ...ctx,
  });

  return { ok: true, data: { reviewedAt } };
}
