/**
 * lib/releases/release-promotion-service.ts
 *
 * Sprint 39: Release promotion workflow — create, preflight, approve, cancel.
 *
 * Safety rules:
 *  - cannot promote failed or non-SUCCESS deployments
 *  - requires exact "PROMOTE" confirmation string
 *  - acquires release_promotion operation lock before changing state
 *  - always records rollback target before marking promoted
 *  - writes audit event + notification on completion/failure
 *  - no secret values in any output or metadata
 */

import { db }                          from "@/lib/db";
import { runReleasePreflight }         from "./release-preflight-runner";
import {
  startProjectOperation,
  completeProjectOperation,
  failProjectOperation,
}                                      from "@/lib/operations/project-operation-service";
import { writeProjectAuditEvent }      from "@/lib/audit/project-audit";
import type {
  ReleasePromotionDTO,
  ReleaseReadinessCheck,
}                                      from "./release-types";

const REQUIRED_CONFIRMATION = "PROMOTE";

// ── DB row → DTO ──────────────────────────────────────────────────────────────

function toDTO(row: {
  id:                    string;
  projectId:             string;
  deploymentId:          string | null;
  deploymentRef:         string;
  sourceRef:             string | null;
  status:                string;
  preflightStatus:       string;
  preflightJson:         import("@prisma/client").Prisma.JsonValue;
  approvedByEmail:       string | null;
  approvedAt:            Date | null;
  promotedAt:            Date | null;
  failedAt:              Date | null;
  failureReason:         string | null;
  rollbackDeploymentRef: string | null;
  rollbackDeploymentId:  string | null;
  rollbackReady:         boolean;
  createdAt:             Date;
  updatedAt:             Date;
}): ReleasePromotionDTO {
  const checks = Array.isArray(row.preflightJson)
    ? (row.preflightJson as ReleaseReadinessCheck[])
    : null;
  return {
    id:            row.id,
    projectId:     row.projectId,
    deploymentId:  row.deploymentId,
    deploymentRef: row.deploymentRef,
    sourceRef:     row.sourceRef,
    status:                row.status        as ReleasePromotionDTO["status"],
    preflightStatus:       row.preflightStatus as ReleasePromotionDTO["preflightStatus"],
    preflightChecks:       checks,
    approvedByEmail:       row.approvedByEmail,
    approvedAt:            row.approvedAt?.toISOString()  ?? null,
    promotedAt:            row.promotedAt?.toISOString()  ?? null,
    failedAt:              row.failedAt?.toISOString()    ?? null,
    failureReason:         row.failureReason,
    rollbackDeploymentRef: row.rollbackDeploymentRef,
    rollbackDeploymentId:  row.rollbackDeploymentId,
    rollbackReady:         row.rollbackReady,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  };
}

const SELECT = {
  id: true,
  projectId: true,
  deploymentId: true,
  deploymentRef: true,
  sourceRef: true,
  status: true,
  preflightStatus: true,
  preflightJson: true,
  approvedByEmail: true,
  approvedAt: true,
  promotedAt: true,
  failedAt: true,
  failureReason: true,
  rollbackDeploymentRef: true,
  rollbackDeploymentId: true,
  rollbackReady: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Create promotion candidate ────────────────────────────────────────────────

export async function createPromotionCandidate(
  projectId:    string,
  deploymentId: string,
  actor: { userId: string; email: string },
): Promise<{ ok: true; promotion: ReleasePromotionDTO } | { ok: false; error: string }> {
  const deployment = await db.deployment.findUnique({
    where:  { id: deploymentId, projectId },
    select: { id: true, status: true, metadata: true },
  });

  if (!deployment)                     return { ok: false, error: "Deployment not found." };
  if (deployment.status !== "SUCCESS") return { ok: false, error: `Cannot promote a deployment with status "${deployment.status}". Only successful deployments can be promoted.` };

  // Cancel any existing pending/approved promotions for this project so there is
  // only one active promotion candidate at a time.
  await db.projectReleasePromotion.updateMany({
    where: { projectId, status: { in: ["pending", "approved"] } },
    data:  { status: "cancelled" },
  });

  const meta          = deployment.metadata as Record<string, unknown> | null;
  const deploymentRef = (meta?.deploymentRef as string) ?? deploymentId;
  const sourceRef     = (meta?.sourceRef     as string) ?? null;

  const row = await db.projectReleasePromotion.create({
    data: {
      projectId,
      deploymentId,
      deploymentRef,
      sourceRef,
      status:         "pending",
      preflightStatus: "not_run",
    },
    select: SELECT,
  });

  await writeProjectAuditEvent({
    projectId,
    actorUserId:  actor.userId,
    actorEmail:   actor.email,
    category:     "publishing",
    action:       "project.release.promotion_created",
    summary:      `Release promotion created for ${deploymentRef.slice(0, 12)}`,
    result:       "success",
    metadata:     { deploymentRef, promotionId: row.id },
  });

  return { ok: true, promotion: toDTO(row) };
}

// ── Run preflight ─────────────────────────────────────────────────────────────

export async function runPromotionPreflight(
  projectId:   string,
  promotionId: string,
): Promise<{ ok: true; promotion: ReleasePromotionDTO } | { ok: false; error: string }> {
  const existing = await db.projectReleasePromotion.findUnique({
    where:  { id: promotionId },
    select: { id: true, deploymentId: true, status: true },
  });
  if (!existing)                                                return { ok: false, error: "Promotion not found." };
  if (!["pending", "approved"].includes(existing.status))      return { ok: false, error: `Cannot run preflight on a promotion with status "${existing.status}".` };
  if (!existing.deploymentId)                                   return { ok: false, error: "Promotion has no associated deployment." };

  // Mark preflight as running
  await db.projectReleasePromotion.update({
    where: { id: promotionId },
    data:  { preflightStatus: "running" },
  });

  try {
    const report = await runReleasePreflight(projectId, existing.deploymentId);

    const preflightStatus =
      report.overallStatus === "blocked"  ? "failed" :
      report.overallStatus === "warning"  ? "warning" :
      "passed";

    const row = await db.projectReleasePromotion.update({
      where: { id: promotionId },
      data: {
        preflightStatus,
        preflightJson:         report.checks as object[],
        rollbackDeploymentRef: report.rollbackTarget?.deploymentRef  ?? null,
        rollbackDeploymentId:  report.rollbackTarget?.deploymentId   ?? null,
        rollbackReady:         !!report.rollbackTarget,
      },
      select: SELECT,
    });

    return { ok: true, promotion: toDTO(row) };
  } catch (e) {
    await db.projectReleasePromotion.update({
      where: { id: promotionId },
      data:  { preflightStatus: "failed" },
    }).catch(() => null);
    return { ok: false, error: e instanceof Error ? e.message : "Preflight runner failed." };
  }
}

// ── Approve and promote ───────────────────────────────────────────────────────

export async function approveAndPromote(
  projectId:    string,
  promotionId:  string,
  actor: { userId: string; email: string },
  confirmation: string,
): Promise<{ ok: true; promotion: ReleasePromotionDTO } | { ok: false; error: string }> {
  if (confirmation.trim() !== REQUIRED_CONFIRMATION) {
    return { ok: false, error: `Type "${REQUIRED_CONFIRMATION}" exactly to confirm promotion.` };
  }

  const promotion = await db.projectReleasePromotion.findUnique({
    where:  { id: promotionId },
    select: {
      id: true,
      projectId: true,
      deploymentId: true,
      deploymentRef: true,
      status: true,
      preflightStatus: true,
    },
  });

  if (!promotion)                          return { ok: false, error: "Promotion not found." };
  if (promotion.projectId !== projectId)   return { ok: false, error: "Promotion does not belong to this project." };
  if (!["pending", "approved"].includes(promotion.status)) {
    return { ok: false, error: `Promotion is already "${promotion.status}".` };
  }
  if (!promotion.deploymentId)             return { ok: false, error: "Promotion has no associated deployment." };

  // Preflight must have run and must not be blocked
  if (promotion.preflightStatus === "not_run" || promotion.preflightStatus === "running") {
    return { ok: false, error: "Run and complete the preflight check before promoting." };
  }
  if (promotion.preflightStatus === "failed") {
    return { ok: false, error: "Preflight checks have blocking failures. Fix the issues and re-run preflight before promoting." };
  }

  // Confirm the deployment is still SUCCESS
  const deployment = await db.deployment.findUnique({
    where:  { id: promotion.deploymentId },
    select: { status: true },
  });
  if (!deployment || deployment.status !== "SUCCESS") {
    return { ok: false, error: "Deployment is no longer in SUCCESS state — cannot promote." };
  }

  // Acquire operation lock
  let opId: string;
  try {
    opId = await startProjectOperation({
      projectId,
      operationType:     "release_promotion",
      title:             `Promote release ${promotion.deploymentRef.slice(0, 12)}`,
      initiatedByUserId: actor.userId,
      meta:              { promotionId, deploymentRef: promotion.deploymentRef },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not acquire operation lock." };
  }

  try {
    const now = new Date();

    await db.projectReleasePromotion.update({
      where: { id: promotionId },
      data:  { status: "promoting" },
    });

    // Mark the deployment as the active production release
    await db.deployment.updateMany({
      where: { projectId, isActive: true },
      data:  { isActive: false },
    });
    await db.deployment.update({
      where: { id: promotion.deploymentId },
      data:  { isActive: true, activatedAt: now },
    });

    const row = await db.projectReleasePromotion.update({
      where: { id: promotionId },
      data:  {
        status:          "promoted",
        approvedByUserId: actor.userId,
        approvedByEmail:  actor.email,
        approvedAt:       now,
        promotedAt:       now,
      },
      select: SELECT,
    });

    await completeProjectOperation(opId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId:  actor.userId,
      actorEmail:   actor.email,
      category:     "publishing",
      action:       "project.release.promotion_completed",
      summary:      `Release ${promotion.deploymentRef.slice(0, 12)} promoted to production`,
      result:       "success",
      metadata: {
        promotionId,
        deploymentRef:        promotion.deploymentRef,
        rollbackDeploymentRef: row.rollbackDeploymentRef ?? undefined,
      },
    });

    // Notify project admins of successful promotion
    try {
      const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
      await notifyProjectAdmins(projectId, {
        title:     `Release promoted to production`,
        body:      `${promotion.deploymentRef.slice(0, 12)} was promoted by ${actor.email}.`,
        severity:  "success",
        category:  "deployment",
        sourceType: "release_promotion",
        sourceId:  promotionId,
        href:      `/projects/${projectId}/publishing`,
      });
    } catch {
      // Non-fatal
    }

    return { ok: true, promotion: toDTO(row) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Promotion failed.";
    await failProjectOperation(opId, reason);

    await db.projectReleasePromotion.update({
      where: { id: promotionId },
      data:  { status: "failed", failedAt: new Date(), failureReason: reason },
    }).catch(() => null);

    await writeProjectAuditEvent({
      projectId,
      actorUserId:  actor.userId,
      actorEmail:   actor.email,
      category:     "publishing",
      action:       "project.release.promotion_failed",
      summary:      `Release promotion failed: ${reason.slice(0, 80)}`,
      result:       "failed",
      metadata:     { promotionId, reason },
    }).catch(() => null);

    try {
      const { notifyProjectAdmins } = await import("@/lib/notifications/notification-service");
      await notifyProjectAdmins(projectId, {
        title:     `Release promotion failed`,
        body:      reason.slice(0, 200),
        severity:  "error",
        category:  "deployment",
        sourceType: "release_promotion",
        sourceId:  promotionId,
        href:      `/projects/${projectId}/publishing`,
      });
    } catch {
      // Non-fatal
    }

    return { ok: false, error: reason };
  }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelPromotion(
  projectId:   string,
  promotionId: string,
  actor: { userId: string; email: string },
): Promise<{ ok: true; promotion: ReleasePromotionDTO } | { ok: false; error: string }> {
  const existing = await db.projectReleasePromotion.findUnique({
    where:  { id: promotionId },
    select: { projectId: true, status: true, deploymentRef: true },
  });
  if (!existing)                                                   return { ok: false, error: "Promotion not found." };
  if (existing.projectId !== projectId)                            return { ok: false, error: "Promotion does not belong to this project." };
  if (!["pending", "approved"].includes(existing.status))         return { ok: false, error: `Cannot cancel a promotion with status "${existing.status}".` };

  const row = await db.projectReleasePromotion.update({
    where: { id: promotionId },
    data:  { status: "cancelled" },
    select: SELECT,
  });

  await writeProjectAuditEvent({
    projectId,
    actorUserId:  actor.userId,
    actorEmail:   actor.email,
    category:     "publishing",
    action:       "project.release.promotion_cancelled",
    summary:      `Release promotion cancelled for ${existing.deploymentRef.slice(0, 12)}`,
    result:       "success",
    metadata:     { promotionId, deploymentRef: existing.deploymentRef },
  });

  return { ok: true, promotion: toDTO(row) };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listProjectPromotions(
  projectId: string,
  limit = 10,
): Promise<ReleasePromotionDTO[]> {
  const rows = await db.projectReleasePromotion.findMany({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
    take:    limit,
    select:  SELECT,
  });
  return rows.map(toDTO);
}
