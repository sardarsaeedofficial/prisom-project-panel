"use server";

/**
 * app/actions/staging-deployment.ts
 *
 * Sprint 64: Server actions for the Staging Deployment workflow.
 *
 * Safety: no secrets returned, no production mutation, no PM2, no nginx,
 * no DB migration. Dangerous actions require elevated permissions.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateStagingDeploymentPlan } from "@/lib/staging/staging-deployment-planner";
import { prepareStagingSourcePlan }      from "@/lib/staging/staging-source-preparer";
import { runStagingDeploymentSmokeChecks } from "@/lib/staging/staging-deployment-smoke-checks";
import { exportStagingDeploymentProof }  from "@/lib/staging/staging-deployment-export";
import {
  DEFAULT_STAGING_SLUG,
  DEFAULT_STAGING_DOMAIN,
} from "@/lib/staging/staging-target-guard";
import type {
  StagingDeploymentPlan,
  StagingDeploymentProof,
} from "@/lib/staging/staging-deployment-types";
import type { StagingSourcePlan } from "@/lib/staging/staging-source-preparer";

// Re-export StagingSourcePlan so the client can use the type
export type { StagingSourcePlan };

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

async function requireElevated(projectId: string) {
  const primary = await requireProjectPermission(projectId, "deploy.trigger");
  if (primary.ok) return primary;
  return requireProjectPermission(projectId, "project.edit");
}

// ── 1. Generate staging deployment plan ────────────────────────────────────────

export async function generateStagingDeploymentPlanAction(input: {
  projectId:      string;
  stagingSlug?:   string;
  stagingDomain?: string;
}): Promise<ActionResult<StagingDeploymentPlan>> {
  const {
    projectId,
    stagingSlug  = DEFAULT_STAGING_SLUG,
    stagingDomain = DEFAULT_STAGING_DOMAIN,
  } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const plan = await generateStagingDeploymentPlan({ projectId, stagingSlug, stagingDomain });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "staging_deployment.plan_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Staging deployment plan generated — status: ${plan.status}, target: ${stagingSlug}`,
      metadata:    { status: plan.status, stagingSlug, stagingDomain, blockerCount: plan.blockers.length },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate staging plan.";
    return { ok: false, error: msg };
  }
}

// ── 2. Prepare staging source (plan-only) ─────────────────────────────────────

export async function prepareStagingSourceAction(input: {
  projectId:    string;
  stagingSlug?: string;
  confirmation: "PREPARE STAGING SOURCE";
}): Promise<ActionResult<{ plan: Awaited<ReturnType<typeof prepareStagingSourcePlan>> }>> {
  const { projectId, stagingSlug = DEFAULT_STAGING_SLUG, confirmation } = input;

  if (confirmation.trim() !== "PREPARE STAGING SOURCE") {
    return { ok: false, error: 'Confirmation must be "PREPARE STAGING SOURCE".' };
  }

  const auth = await requireElevated(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const plan = await prepareStagingSourcePlan({ projectId, stagingSlug });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "staging_deployment.source_prepared",
      category:    "publishing",
      result:      plan.ok ? "success" : "failed",
      summary:     plan.ok
        ? `Staging source preparation plan generated for ${stagingSlug}`
        : `Staging source preparation failed: ${plan.error}`,
      metadata:    { stagingSlug, planOk: plan.ok },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { plan } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to prepare staging source.";
    return { ok: false, error: msg };
  }
}

// ── 3. Run staging deployment dry run ─────────────────────────────────────────

export async function runStagingDeploymentDryRunAction(input: {
  projectId:      string;
  stagingSlug?:   string;
  stagingDomain?: string;
  confirmation:   "RUN STAGING DRY RUN";
}): Promise<ActionResult<{ plan: StagingDeploymentPlan; smokeReport: Awaited<ReturnType<typeof runStagingDeploymentSmokeChecks>> }>> {
  const {
    projectId,
    stagingSlug  = DEFAULT_STAGING_SLUG,
    stagingDomain = DEFAULT_STAGING_DOMAIN,
    confirmation,
  } = input;

  if (confirmation.trim() !== "RUN STAGING DRY RUN") {
    return { ok: false, error: 'Confirmation must be "RUN STAGING DRY RUN".' };
  }

  const auth = await requireElevated(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [plan, smokeReport] = await Promise.all([
      generateStagingDeploymentPlan({ projectId, stagingSlug, stagingDomain }),
      runStagingDeploymentSmokeChecks({ projectId, stagingSlug, stagingDomain }),
    ]);

    const ctx = await getAuditRequestContext();
    const passed = smokeReport.status === "passed";
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      passed ? "staging_deployment.dry_run_passed" : "staging_deployment.dry_run_failed",
      category:    "publishing",
      result:      passed ? "success" : "failed",
      summary:     `Staging dry run ${smokeReport.status} — ${stagingSlug} / ${stagingDomain}`,
      metadata:    { stagingSlug, stagingDomain, smokeStatus: smokeReport.status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { plan, smokeReport } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Staging dry run failed.";
    return { ok: false, error: msg };
  }
}

// ── 4. Export staging deployment proof ────────────────────────────────────────

export async function exportStagingDeploymentProofAction(input: {
  projectId:      string;
  stagingSlug?:   string;
  stagingDomain?: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const {
    projectId,
    stagingSlug  = DEFAULT_STAGING_SLUG,
    stagingDomain = DEFAULT_STAGING_DOMAIN,
  } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [plan, projectName] = await Promise.all([
      generateStagingDeploymentPlan({ projectId, stagingSlug, stagingDomain }),
      getProjectName(projectId),
    ]);

    const proof: StagingDeploymentProof = {
      projectId,
      generatedAt:  new Date().toISOString(),
      status:       plan.status === "ready" ? "passed" : plan.status,
      stagingSlug,
      stagingDomain,
      plan,
      blockers:     plan.blockers,
      warnings:     plan.warnings,
      nextSteps:    plan.nextSteps,
    };

    const markdown = exportStagingDeploymentProof(proof, projectName);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "staging_deployment.proof_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Staging deployment proof exported — ${stagingSlug}`,
      metadata:    { stagingSlug, stagingDomain },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "STAGING_DEPLOYMENT_PROOF.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export staging proof.";
    return { ok: false, error: msg };
  }
}

// ── 5. Mark staging ready ─────────────────────────────────────────────────────

export async function markStagingReadyAction(input: {
  projectId:    string;
  confirmation: "MARK STAGING READY";
}): Promise<ActionResult<{ markedAt: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== "MARK STAGING READY") {
    return { ok: false, error: 'Confirmation must be "MARK STAGING READY".' };
  }

  const auth = await requireElevated(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const markedAt = new Date().toISOString();

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "staging_deployment.marked_ready",
    category:    "publishing",
    result:      "success",
    summary:     "Staging deployment marked ready by owner",
    metadata:    { markedAt },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { markedAt } };
}
