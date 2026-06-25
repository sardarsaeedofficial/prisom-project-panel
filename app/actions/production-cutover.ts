"use server";

/**
 * app/actions/production-cutover.ts
 *
 * Sprint 55: Server actions for the production cutover assistant.
 *
 * Safety rules:
 *  - project.view required for plan/export
 *  - project.edit or deploy.trigger required for smoke checks and marking steps
 *  - never expose secrets
 *  - never mutate nginx
 *  - never restart PM2
 *  - never run DB migrations
 *  - smoke checks perform HTTP GET/HEAD only
 */

import { requireProjectPermission }      from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }        from "@/lib/audit/project-audit";
import { getAuditRequestContext }        from "@/lib/audit/request-context";
import { generateProductionCutoverPlan } from "@/lib/cutover/production-cutover-planner";
import { runProductionSmokeChecks }      from "@/lib/cutover/production-smoke-checks";
import { exportProductionCutoverPlan }   from "@/lib/cutover/production-cutover-export";
import { db }                            from "@/lib/db";
import type {
  ProductionCutoverPlan,
  ProductionCutoverSmokeReport,
} from "@/lib/cutover/production-cutover-types";

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

const SMOKE_CONFIRMATION     = "RUN SMOKE CHECKS" as const;
const COMPLETE_CONFIRMATION  = "MARK CUTOVER COMPLETE" as const;

// ── 1. Generate cutover plan ──────────────────────────────────────────────────

export async function generateProductionCutoverPlanAction(
  projectId: string,
): Promise<ActionResult<ProductionCutoverPlan>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const plan = await generateProductionCutoverPlan(projectId);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "production_cutover.plan_generated",
    category:    "publishing",
    result:      plan.status === "blocked" ? "failed" : "success",
    summary:     `Production cutover plan generated — status: ${plan.status}, blockers: ${plan.blockers.length}`,
    metadata:    { status: plan.status, blockerCount: plan.blockers.length, stageCount: plan.stages.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: plan };
}

// ── 2. Run smoke checks ───────────────────────────────────────────────────────

export async function runProductionCutoverSmokeChecksAction(input: {
  projectId:    string;
  confirmation: typeof SMOKE_CONFIRMATION;
}): Promise<ActionResult<ProductionCutoverSmokeReport>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== SMOKE_CONFIRMATION) {
    return {
      ok:    false,
      error: `Type "${SMOKE_CONFIRMATION}" to confirm running smoke checks.`,
    };
  }

  const auth = await requireProjectPermission(projectId, "deploy.trigger").then(
    (r) => (r.ok ? r : requireProjectPermission(projectId, "project.edit")),
  );
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "production_cutover.smoke_checks_started",
    category:    "publishing",
    result:      "success",
    summary:     "Production cutover smoke checks started",
    ...ctx,
  }).catch(() => null);

  const report = await runProductionSmokeChecks(projectId);

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      report.overallPass
      ? "production_cutover.smoke_checks_passed"
      : "production_cutover.smoke_checks_failed",
    category: "publishing",
    result:   report.overallPass ? "success" : "failed",
    summary:  `Production cutover smoke checks ${report.overallPass ? "passed" : "failed"} — ${report.results.length} check(s)`,
    metadata: { overallPass: report.overallPass, checkCount: report.results.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: report };
}

// ── 3. Export cutover plan ────────────────────────────────────────────────────

export async function exportProductionCutoverPlanAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const plan     = await generateProductionCutoverPlan(projectId);
  const markdown = exportProductionCutoverPlan(plan, project.name);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "production_cutover.plan_exported",
    category:    "publishing",
    result:      "success",
    summary:     `Production cutover plan exported — status: ${plan.status}`,
    metadata:    { status: plan.status, blockerCount: plan.blockers.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { markdown } };
}

// ── 4. Mark cutover step ──────────────────────────────────────────────────────

export async function markProductionCutoverStepAction(input: {
  projectId: string;
  stepId:    string;
  status:    "done" | "todo";
}): Promise<ActionResult> {
  const { projectId, stepId, status } = input;

  const auth = await requireProjectPermission(projectId, "deploy.trigger").then(
    (r) => (r.ok ? r : requireProjectPermission(projectId, "project.edit")),
  );
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "production_cutover.step_marked",
    category:    "publishing",
    result:      "success",
    summary:     `Cutover step ${stepId} marked as ${status}`,
    metadata:    { stepId, status },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}

// ── 5. Mark cutover complete ──────────────────────────────────────────────────

export async function markProductionCutoverCompleteAction(input: {
  projectId:    string;
  confirmation: typeof COMPLETE_CONFIRMATION;
}): Promise<ActionResult> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== COMPLETE_CONFIRMATION) {
    return {
      ok:    false,
      error: `Type "${COMPLETE_CONFIRMATION}" to confirm marking cutover complete.`,
    };
  }

  const auth = await requireProjectPermission(projectId, "deploy.trigger").then(
    (r) => (r.ok ? r : requireProjectPermission(projectId, "project.edit")),
  );
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "production_cutover.completed",
    category:    "publishing",
    result:      "success",
    summary:     "Production cutover marked as complete",
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: undefined };
}
