"use server";

/**
 * app/actions/deployment-dry-run.ts
 *
 * Sprint 53: Server actions for the deployment dry-run workflow.
 *
 * Safety rules:
 *  - project.view required for plan/export
 *  - deploy.trigger required for build dry run
 *  - build dry run requires RUN BUILD DRY RUN confirmation phrase
 *  - never expose secrets
 *  - never mutate live deployment
 *  - never restart services
 *  - never apply routes or reload nginx
 *  - never run DB migrations
 */

import { requireProjectPermission }         from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }           from "@/lib/audit/project-audit";
import { getAuditRequestContext }           from "@/lib/audit/request-context";
import { generateDeploymentDryRunPlan }     from "@/lib/deploy/dry-run-planner";
import { runBuildDryRun, BUILD_CONFIRMATION_PHRASE } from "@/lib/deploy/dry-run-runner";
import { exportDeploymentDryRunReport }     from "@/lib/deploy/dry-run-export";
import { db }                               from "@/lib/db";
import type {
  DeploymentDryRunPlan,
  DeploymentDryRunReport,
  DeploymentDryRunBuildResult,
}                                           from "@/lib/deploy/dry-run-types";
import { buildDeploymentDryRunReport }      from "@/lib/deploy/dry-run-export";

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Generate dry-run plan ──────────────────────────────────────────────────

export async function generateDeploymentDryRunPlanAction(
  projectId: string,
): Promise<ActionResult<DeploymentDryRunPlan>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const plan = await generateDeploymentDryRunPlan(projectId);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "deployment_dry_run.plan_generated",
    category:    "publishing",
    result:      plan.status === "blocked" ? "failed" : "success",
    summary:     `Deployment dry-run plan generated — status: ${plan.status}, blockers: ${plan.blockers.length}`,
    metadata:    { status: plan.status, blockerCount: plan.blockers.length, checkCount: plan.checks.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: plan };
}

// ── 2. Run build dry run ──────────────────────────────────────────────────────

export async function runDeploymentBuildDryRunAction(input: {
  projectId:     string;
  serviceId?:    string;
  confirmation?: string;
}): Promise<ActionResult<DeploymentDryRunBuildResult>> {
  const { projectId, serviceId, confirmation } = input;

  // Use deploy.trigger if available, fall back to project.edit
  const auth = await requireProjectPermission(projectId, "deploy.trigger").then(
    (r) => (r.ok ? r : requireProjectPermission(projectId, "project.edit")),
  );
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (confirmation !== BUILD_CONFIRMATION_PHRASE) {
    return {
      ok:    false,
      error: `Type "${BUILD_CONFIRMATION_PHRASE}" to confirm running the build dry run.`,
    };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "deployment_dry_run.build_requested",
    category:    "publishing",
    result:      "success",
    summary:     `Build dry run requested${serviceId ? ` for service ${serviceId}` : ""}`,
    metadata:    { serviceId },
    ...ctx,
  }).catch(() => null);

  const result = await runBuildDryRun({ projectId, serviceId, confirmation });

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      result.success
      ? "deployment_dry_run.build_succeeded"
      : "deployment_dry_run.build_failed",
    category: "publishing",
    result:   result.success ? "success" : "failed",
    summary:  result.success
      ? `Build dry run succeeded in ${result.durationMs}ms${result.serviceName ? ` (${result.serviceName})` : ""}`
      : `Build dry run failed: ${result.error?.slice(0, 200)}`,
    metadata: { serviceId, durationMs: result.durationMs, success: result.success },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: result };
}

// ── 3. Export dry-run report ──────────────────────────────────────────────────

export async function exportDeploymentDryRunReportAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string; report: DeploymentDryRunReport }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const plan     = await generateDeploymentDryRunPlan(projectId);
  const markdown = exportDeploymentDryRunReport(plan, project.name);
  const report   = buildDeploymentDryRunReport(plan);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "deployment_dry_run.report_exported",
    category:    "publishing",
    result:      "success",
    summary:     `Deployment dry-run report exported — status: ${plan.status}`,
    metadata:    { status: plan.status, blockerCount: plan.blockers.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { markdown, report } };
}
