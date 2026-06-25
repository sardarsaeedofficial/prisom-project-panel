"use server";

/**
 * app/actions/trial-migration.ts
 *
 * Sprint 61: Server actions for the staging trial migration workflow.
 *
 * Safety rules:
 *  - project.view required for report/export (read-only).
 *  - project.edit or deploy.trigger required for smoke checks / mark complete.
 *  - Never expose secrets.
 *  - Never mutate live production.
 *  - Never apply production routes.
 *  - Never run DB migrations.
 *  - Never restart PM2.
 *  - HTTP checks only for smoke checks.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateTrialMigrationRun } from "@/lib/migration/trial-migration-planner";
import { runStagingSmokeChecks }     from "@/lib/migration/trial-migration-smoke-checks";
import { exportTrialMigrationReport } from "@/lib/migration/trial-migration-export";
import type { TrialMigrationRun, StagingSmokeCheckReport } from "@/lib/migration/trial-migration-types";

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

// ── 1. Generate trial migration plan ──────────────────────────────────────────

export async function generateTrialMigrationRunAction(
  projectId: string,
): Promise<ActionResult<TrialMigrationRun>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const run = await generateTrialMigrationRun({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "trial_migration.plan_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Trial migration plan generated — status: ${run.status}, stages: ${run.stages.length}, blockers: ${run.blockers.length}`,
      metadata:    {
        status:      run.status,
        stageCount:  run.stages.length,
        blockerCount: run.blockers.length,
        warningCount: run.warnings.length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: run };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate trial migration plan.";
    return { ok: false, error: msg };
  }
}

// ── 2. Run staging smoke checks ───────────────────────────────────────────────

export async function runTrialMigrationSmokeChecksAction(input: {
  projectId:     string;
  stagingDomain?: string;
  confirmation:  "RUN STAGING CHECKS";
}): Promise<ActionResult<StagingSmokeCheckReport>> {
  const { projectId, stagingDomain, confirmation } = input;

  if (confirmation.trim() !== "RUN STAGING CHECKS") {
    return { ok: false, error: 'Confirmation phrase "RUN STAGING CHECKS" is required.' };
  }

  // Requires project.edit or deploy.trigger
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  const effectiveAuth = auth.ok
    ? auth
    : await requireProjectPermission(projectId, "project.edit");

  if (!effectiveAuth.ok) {
    return {
      ok:    false,
      error: "You need deploy.trigger or project.edit permission to run staging smoke checks.",
      code:  "PERMISSION_DENIED",
    };
  }

  try {
    const ctx = await getAuditRequestContext();

    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      "trial_migration.smoke_checks_started",
      category:    "publishing",
      result:      "success",
      summary:     `Staging smoke checks started — domain: ${stagingDomain ?? "default"}`,
      metadata:    { stagingDomain: stagingDomain ?? null },
      ...ctx,
    }).catch(() => null);

    const report = await runStagingSmokeChecks(stagingDomain);

    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      report.overall === "pass"
        ? "trial_migration.smoke_checks_passed"
        : "trial_migration.smoke_checks_failed",
      category: "publishing",
      result:   report.overall === "pass" ? "success" : "failed",
      summary:  `Staging smoke checks ${report.overall} — domain: ${report.domain}`,
      metadata: {
        domain:  report.domain,
        overall: report.overall,
        results: report.results.map((r) => ({ url: r.url, status: r.status, httpStatus: r.httpStatus })),
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to run smoke checks.";
    return { ok: false, error: msg };
  }
}

// ── 3. Mark trial migration step (audit only — display state is client-side) ─

export async function markTrialMigrationStepAction(input: {
  projectId: string;
  stepId:    string;
  status:    "done" | "todo";
}): Promise<ActionResult<{ stepId: string; status: string }>> {
  const { projectId, stepId, status } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "trial_migration.step_marked",
      category:    "publishing",
      result:      "success",
      summary:     `Trial migration step marked ${status}: ${stepId}`,
      metadata:    { stepId, status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { stepId, status } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to mark step.";
    return { ok: false, error: msg };
  }
}

// ── 4. Mark trial migration complete ──────────────────────────────────────────

export async function markTrialMigrationCompleteAction(input: {
  projectId:    string;
  confirmation: "MARK TRIAL COMPLETE";
}): Promise<ActionResult<{ completedAt: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== "MARK TRIAL COMPLETE") {
    return { ok: false, error: 'Confirmation phrase "MARK TRIAL COMPLETE" is required.' };
  }

  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  const effectiveAuth = auth.ok
    ? auth
    : await requireProjectPermission(projectId, "project.edit");

  if (!effectiveAuth.ok) {
    return {
      ok:    false,
      error: "You need deploy.trigger or project.edit permission to mark the trial complete.",
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
      action:      "trial_migration.completed",
      category:    "publishing",
      result:      "success",
      summary:     "Staging trial migration marked complete.",
      metadata:    { completedAt },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { completedAt } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to mark trial complete.";
    return { ok: false, error: msg };
  }
}

// ── 5. Export trial migration report ─────────────────────────────────────────

export async function exportTrialMigrationReportAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [run, projectName] = await Promise.all([
      generateTrialMigrationRun({ projectId }),
      getProjectName(projectId),
    ]);

    const markdown = exportTrialMigrationReport(run, projectName, null);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "trial_migration.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Trial migration report exported — status: ${run.status}`,
      metadata:    { status: run.status },
      ...ctx,
    }).catch(() => null);

    return {
      ok:   true,
      data: { markdown, filename: "TRIAL_MIGRATION_REPORT.md" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export trial migration report.";
    return { ok: false, error: msg };
  }
}
