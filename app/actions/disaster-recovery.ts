"use server";

/**
 * app/actions/disaster-recovery.ts
 *
 * Sprint 60: Server actions for the disaster recovery drill workflow.
 *
 * Safety rules:
 *  - project.view required for report/plan/export (read-only).
 *  - project.edit or backup.create required for integrity check / mark complete.
 *  - Never expose secrets.
 *  - Never restore over live project.
 *  - Never mutate DB, apply routes, or restart PM2.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateBackupReadinessReport } from "@/lib/backups/backup-readiness-service";
import { generateRestoreDrillPlan }      from "@/lib/backups/restore-drill-planner";
import { checkBackupIntegrity }          from "@/lib/backups/backup-integrity-checker";
import { exportDisasterRecoveryReport }  from "@/lib/backups/disaster-recovery-export";
import type { DisasterRecoveryReport, RestoreDrillPlan, BackupIntegrityResult } from "@/lib/backups/disaster-recovery-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Helper ────────────────────────────────────────────────────────────────────

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

// ── 1. Generate DR report ─────────────────────────────────────────────────────

export async function generateDisasterRecoveryReportAction(
  projectId: string,
): Promise<ActionResult<DisasterRecoveryReport>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateBackupReadinessReport(projectId);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "disaster_recovery.report_generated",
      category:    "backups",
      result:      "success",
      summary:     `Disaster recovery report generated — status: ${report.status}, blockers: ${report.blockers.length}, warnings: ${report.warnings.length}`,
      metadata:    {
        status:        report.status,
        blockerCount:  report.blockers.length,
        warningCount:  report.warnings.length,
        checkCount:    report.summary.total,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate disaster recovery report.";
    return { ok: false, error: msg };
  }
}

// ── 2. Generate restore drill plan ────────────────────────────────────────────

export async function generateRestoreDrillPlanAction(input: {
  projectId: string;
  backupId?: string;
}): Promise<ActionResult<RestoreDrillPlan>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const plan = await generateRestoreDrillPlan({
      projectId,
      backupId: input.backupId,
    });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "disaster_recovery.restore_drill_plan_generated",
      category:    "backups",
      result:      "success",
      summary:     `Restore drill plan generated — target: ${plan.recommendedTargetSlug}, status: ${plan.status}`,
      metadata:    {
        targetSlug:   plan.recommendedTargetSlug,
        status:       plan.status,
        backupRef:    plan.sourceBackupRef,
        blockerCount: plan.blockers.length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate restore drill plan.";
    return { ok: false, error: msg };
  }
}

// ── 3. Verify backup integrity ────────────────────────────────────────────────

export async function verifyBackupIntegrityAction(input: {
  projectId:    string;
  backupId:     string;
  confirmation: "VERIFY BACKUP";
}): Promise<ActionResult<BackupIntegrityResult>> {
  const { projectId, backupId, confirmation } = input;

  if (confirmation.trim() !== "VERIFY BACKUP") {
    return { ok: false, error: 'Confirmation phrase "VERIFY BACKUP" is required.' };
  }

  // Requires backup.create or project.edit
  const auth = await requireProjectPermission(projectId, "backup.create");
  if (!auth.ok) {
    const fallback = await requireProjectPermission(projectId, "project.edit");
    if (!fallback.ok) return { ok: false, error: "You need backup.create or project.edit permission to verify backups.", code: "PERMISSION_DENIED" };
  }

  const effectiveAuth = auth.ok ? auth : await requireProjectPermission(projectId, "project.edit");
  if (!effectiveAuth.ok) return { ok: false, error: "Permission denied.", code: "PERMISSION_DENIED" };

  try {
    const result = await checkBackupIntegrity({ projectId, backupId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      "disaster_recovery.backup_integrity_checked",
      category:    "backups",
      result:      result.status === "failed" ? "failed" : "success",
      summary:     `Backup integrity checked — ${result.backupRef}: ${result.status}. ${result.summary}`,
      metadata:    {
        backupId,
        backupRef: result.backupRef,
        status:    result.status,
        checkCount: result.checks.length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to verify backup integrity.";
    return { ok: false, error: msg };
  }
}

// ── 4. Export DR report ───────────────────────────────────────────────────────

export async function exportDisasterRecoveryReportAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [report, drillPlan, projectName] = await Promise.all([
      generateBackupReadinessReport(projectId),
      generateRestoreDrillPlan({ projectId }),
      getProjectName(projectId),
    ]);

    const markdown = exportDisasterRecoveryReport(report, projectName, drillPlan);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "disaster_recovery.report_exported",
      category:    "backups",
      result:      "success",
      summary:     `Disaster recovery report exported — status: ${report.status}`,
      metadata:    { status: report.status },
      ...ctx,
    }).catch(() => null);

    return {
      ok:   true,
      data: { markdown, filename: "DISASTER_RECOVERY_REPORT.md" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export disaster recovery report.";
    return { ok: false, error: msg };
  }
}

// ── 5. Mark restore drill complete ────────────────────────────────────────────

export async function markRestoreDrillCompleteAction(input: {
  projectId:    string;
  confirmation: "MARK DRILL COMPLETE";
}): Promise<ActionResult<{ completedAt: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== "MARK DRILL COMPLETE") {
    return { ok: false, error: 'Confirmation phrase "MARK DRILL COMPLETE" is required.' };
  }

  // Requires backup.create or project.edit
  const auth = await requireProjectPermission(projectId, "backup.create");
  const effectiveAuth = auth.ok
    ? auth
    : await requireProjectPermission(projectId, "project.edit");

  if (!effectiveAuth.ok) {
    return {
      ok:    false,
      error: "You need backup.create or project.edit permission to mark a drill complete.",
      code:  "PERMISSION_DENIED",
    };
  }

  try {
    const completedAt = new Date().toISOString();

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      "disaster_recovery.drill_completed",
      category:    "backups",
      result:      "success",
      summary:     "Restore drill marked complete.",
      metadata:    { completedAt },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { completedAt } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to mark drill complete.";
    return { ok: false, error: msg };
  }
}
