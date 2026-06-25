"use server";

/**
 * app/actions/production-execution.ts
 *
 * Sprint 65: Server actions for the Production Cutover Execution Guard.
 *
 * Safety rules:
 *  - no secrets returned
 *  - no automatic production mutation
 *  - no nginx writes or reload
 *  - no DNS changes
 *  - no DB migrations
 *  - no PM2 restarts
 *  - no provider mutation
 *  - applyProductionCutoverAction is a guarded execution-record only (dry-run safe)
 *  - Doorsteps/LocalShop untouched
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateProductionExecutionPlan }    from "@/lib/cutover/production-execution-planner";
import { generateProductionRouteApplyPreview } from "@/lib/cutover/production-route-apply-preview";
import { runProductionExecutionSmokeChecks }  from "@/lib/cutover/production-smoke-check-runner";
import { exportProductionExecutionPlan }      from "@/lib/cutover/production-execution-export";
import type {
  ProductionExecutionPlan,
  ProductionRouteApplyPreview,
  ProductionExecutionSmokeReport,
} from "@/lib/cutover/production-execution-types";

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

async function requireDeploy(projectId: string) {
  return requireProjectPermission(projectId, "deploy.trigger");
}

async function requireDeployOrEdit(projectId: string) {
  const primary = await requireProjectPermission(projectId, "deploy.trigger");
  if (primary.ok) return primary;
  return requireProjectPermission(projectId, "project.edit");
}

// ── 1. Generate production execution plan ──────────────────────────────────────

export async function generateProductionExecutionPlanAction(input: {
  projectId: string;
}): Promise<ActionResult<ProductionExecutionPlan>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const plan = await generateProductionExecutionPlan({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:   "production_execution.plan_generated",
      category: "publishing",
      result:   "success",
      summary:  `Execution plan generated: status=${plan.status}, blockers=${plan.blockers.length}`,
      metadata: { status: plan.status, blockers: plan.blockers.length, warnings: plan.warnings.length },
      ...ctx,
    });

    return { ok: true, data: plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to generate execution plan: ${msg}` };
  }
}

// ── 2. Generate route apply preview ────────────────────────────────────────────

export async function generateProductionRouteApplyPreviewAction(input: {
  projectId: string;
}): Promise<ActionResult<ProductionRouteApplyPreview>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const preview = await generateProductionRouteApplyPreview({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:   "production_execution.route_preview_generated",
      category: "publishing",
      result:   "success",
      summary:  `Route preview generated for ${preview.domain}: ${preview.routes.length} routes`,
      metadata: { domain: preview.domain, routeCount: preview.routes.length, status: preview.status },
      ...ctx,
    });

    return { ok: true, data: preview };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to generate route preview: ${msg}` };
  }
}

// ── 3. Run production smoke checks ─────────────────────────────────────────────

export async function runProductionSmokeChecksAction(input: {
  projectId:    string;
  confirmation: "RUN PRODUCTION SMOKE CHECKS";
}): Promise<ActionResult<ProductionExecutionSmokeReport>> {
  const { projectId, confirmation } = input;

  if (confirmation !== "RUN PRODUCTION SMOKE CHECKS") {
    return { ok: false, error: "Type RUN PRODUCTION SMOKE CHECKS to confirm smoke checks." };
  }

  const auth = await requireDeployOrEdit(projectId);
  if (!auth.ok) return { ok: false, error: "You do not have permission to run production smoke checks.", code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    action:   "production_execution.smoke_checks_started",
    category: "publishing",
    result:   "success",
    summary:  "Production smoke checks started",
    ...ctx,
  });

  try {
    const report = await runProductionExecutionSmokeChecks({ projectId });

    const resultAudit = report.status === "passed" ? "success" : "failed";
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:   report.status === "passed"
        ? "production_execution.smoke_checks_passed"
        : "production_execution.smoke_checks_failed",
      category: "publishing",
      result:   resultAudit,
      summary:  `Production smoke checks ${report.status}: ${report.results.length} checks`,
      metadata: { status: report.status, checkCount: report.results.length },
      ...ctx,
    });

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:   "production_execution.smoke_checks_failed",
      category: "publishing",
      result:   "failed",
      summary:  "Production smoke checks failed with error",
      metadata: { error: msg.slice(0, 200) },
      ...ctx,
    });
    return { ok: false, error: `Smoke checks failed: ${msg}` };
  }
}

// ── 4. Apply production cutover (guarded dry-run / execution-record) ──────────

export async function applyProductionCutoverAction(input: {
  projectId:    string;
  confirmation: "APPLY PRODUCTION CUTOVER";
}): Promise<ActionResult<{ message: string; readyForManualApply: true; executionId: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation !== "APPLY PRODUCTION CUTOVER") {
    return { ok: false, error: "Type APPLY PRODUCTION CUTOVER to confirm production cutover." };
  }

  const auth = await requireDeploy(projectId);
  if (!auth.ok) {
    return { ok: false, error: "You do not have permission to request production cutover.", code: auth.code };
  }

  const ctx = await getAuditRequestContext();
  const executionId = `exec-${projectId.slice(0, 8)}-${Date.now()}`;

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    action:   "production_execution.cutover_apply_requested",
    category: "publishing",
    result:   "success",
    summary:  `Production cutover apply requested (guarded dry-run): ${executionId}`,
    metadata: { executionId, note: "guarded dry-run — operator must apply nginx routes manually" },
    ...ctx,
  });

  return {
    ok:   true,
    data: {
      executionId,
      readyForManualApply: true,
      message:
        "Production cutover request recorded. This action does NOT apply nginx routes automatically. " +
        "A deployment operator must review the route preview and apply nginx config manually. " +
        "Run: sudo nginx -t && sudo nginx -s reload ONLY after manual review. " +
        `Execution ID: ${executionId}`,
    },
  };
}

// ── 5. Execute production rollback (guarded dry-run / execution-record) ────────

export async function executeProductionRollbackAction(input: {
  projectId:    string;
  confirmation: "EXECUTE PRODUCTION ROLLBACK";
}): Promise<ActionResult<{ message: string; rollbackId: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation !== "EXECUTE PRODUCTION ROLLBACK") {
    return { ok: false, error: "Type EXECUTE PRODUCTION ROLLBACK to confirm production rollback." };
  }

  const auth = await requireDeploy(projectId);
  if (!auth.ok) {
    return { ok: false, error: "You do not have permission to request production rollback.", code: auth.code };
  }

  const ctx = await getAuditRequestContext();
  const rollbackId = `rollback-${projectId.slice(0, 8)}-${Date.now()}`;

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    action:   "production_execution.rollback_requested",
    category: "publishing",
    result:   "success",
    summary:  `Production rollback requested (guarded dry-run): ${rollbackId}`,
    metadata: { rollbackId, note: "guarded dry-run — operator must restore nginx and PM2 manually" },
    ...ctx,
  });

  return {
    ok:   true,
    data: {
      rollbackId,
      message:
        "Production rollback request recorded. This action does NOT restart PM2 or restore nginx automatically. " +
        "Operator must: (1) Restore nginx backup — sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project> " +
        "(2) Validate — sudo nginx -t " +
        "(3) Reload — sudo nginx -s reload " +
        "(4) Restart previous PM2 release if needed. " +
        "DB rollback is NOT automatic — restore from pg_dump if required. " +
        `Rollback ID: ${rollbackId}`,
    },
  };
}

// ── 6. Export execution plan ────────────────────────────────────────────────────

export async function exportProductionExecutionPlanAction(input: {
  projectId: string;
}): Promise<ActionResult<{ content: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [plan, projectName] = await Promise.all([
      generateProductionExecutionPlan({ projectId }),
      getProjectName(projectId),
    ]);

    const content  = exportProductionExecutionPlan(plan, projectName);
    const filename = `PRODUCTION_CUTOVER_EXECUTION_PLAN_${new Date().toISOString().slice(0, 10)}.md`;

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:   "production_execution.plan_exported",
      category: "publishing",
      result:   "success",
      summary:  `Production execution plan exported: ${filename}`,
      metadata: { filename },
      ...ctx,
    });

    return { ok: true, data: { content, filename } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Export failed: ${msg}` };
  }
}
