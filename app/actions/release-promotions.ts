"use server";

/**
 * app/actions/release-promotions.ts
 *
 * Sprint 39: Server actions for the release promotion workflow.
 *
 * Safety rules:
 *  - all actions require project admin/owner permission
 *  - no secret values returned to client
 *  - confirmation string validated server-side
 *  - operation locking enforced in the promotion service
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  createPromotionCandidate,
  runPromotionPreflight,
  approveAndPromote,
  cancelPromotion,
  listProjectPromotions,
}                                   from "@/lib/releases/release-promotion-service";
import { runReleasePreflight }       from "@/lib/releases/release-preflight-runner";
import { db }                        from "@/lib/db";
import type { ReleasePromotionDTO, PreflightActionResult, PromotionActionResult } from "@/lib/releases/release-types";

// ── Permission helper ─────────────────────────────────────────────────────────

async function requirePromotionPermission(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "deploy.trigger");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

// ── Get latest promotable deployment ─────────────────────────────────────────

export async function getLatestPromotableDeploymentAction(
  projectId: string,
): Promise<{
  ok: true;
  deployment: {
    id: string;
    deploymentRef: string;
    sourceRef: string | null;
    createdAt: string;
    isActive: boolean;
  } | null;
} | { ok: false; error: string }> {
  try {
    await requirePromotionPermission(projectId);

    const dep = await db.deployment.findFirst({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, metadata: true, createdAt: true, isActive: true },
    });

    if (!dep) return { ok: true, deployment: null };

    const meta = dep.metadata as Record<string, unknown> | null;
    return {
      ok: true,
      deployment: {
        id:            dep.id,
        deploymentRef: (meta?.deploymentRef as string) ?? dep.id,
        sourceRef:     (meta?.sourceRef     as string) ?? null,
        createdAt:     dep.createdAt.toISOString(),
        isActive:      dep.isActive,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to fetch deployment." };
  }
}

// ── Get active promotion ──────────────────────────────────────────────────────

export async function getActivePromotionAction(
  projectId: string,
): Promise<{ ok: true; promotion: ReleasePromotionDTO | null } | { ok: false; error: string }> {
  try {
    await requirePromotionPermission(projectId);
    const promotions = await listProjectPromotions(projectId, 1);
    const active = promotions.find((p) => ["pending", "approved", "promoting"].includes(p.status));
    return { ok: true, promotion: active ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to fetch promotion." };
  }
}

// ── Run preflight only (standalone) ──────────────────────────────────────────

export async function runPreflightAction(
  projectId:    string,
  deploymentId: string,
): Promise<PreflightActionResult> {
  try {
    await requirePromotionPermission(projectId);
    const report = await runReleasePreflight(projectId, deploymentId);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preflight failed." };
  }
}

// ── Create promotion candidate ────────────────────────────────────────────────

export async function createPromotionAction(
  projectId:    string,
  deploymentId: string,
): Promise<PromotionActionResult> {
  try {
    const ctx = await requirePromotionPermission(projectId);
    const user = await db.user.findUnique({
      where:  { id: ctx.userId },
      select: { email: true },
    });
    return createPromotionCandidate(projectId, deploymentId, {
      userId: ctx.userId,
      email:  user?.email ?? ctx.userId,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create promotion." };
  }
}

// ── Run preflight for an existing promotion ───────────────────────────────────

export async function runPromotionPreflightAction(
  projectId:   string,
  promotionId: string,
): Promise<PromotionActionResult> {
  try {
    await requirePromotionPermission(projectId);
    return runPromotionPreflight(projectId, promotionId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preflight failed." };
  }
}

// ── Approve and promote ───────────────────────────────────────────────────────

export async function approveAndPromoteAction(
  projectId:    string,
  promotionId:  string,
  confirmation: string,
): Promise<PromotionActionResult> {
  try {
    const ctx = await requirePromotionPermission(projectId);
    const user = await db.user.findUnique({
      where:  { id: ctx.userId },
      select: { email: true },
    });
    return approveAndPromote(projectId, promotionId, {
      userId: ctx.userId,
      email:  user?.email ?? ctx.userId,
    }, confirmation);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Promotion failed." };
  }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelPromotionAction(
  projectId:   string,
  promotionId: string,
): Promise<PromotionActionResult> {
  try {
    const ctx = await requirePromotionPermission(projectId);
    const user = await db.user.findUnique({
      where:  { id: ctx.userId },
      select: { email: true },
    });
    return cancelPromotion(projectId, promotionId, {
      userId: ctx.userId,
      email:  user?.email ?? ctx.userId,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancel failed." };
  }
}

// ── List promotions ───────────────────────────────────────────────────────────

export async function listPromotionsAction(
  projectId: string,
  limit = 10,
): Promise<{ ok: true; promotions: ReleasePromotionDTO[] } | { ok: false; error: string }> {
  try {
    await requirePromotionPermission(projectId);
    const promotions = await listProjectPromotions(projectId, limit);
    return { ok: true, promotions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to list promotions." };
  }
}
