"use server";

/**
 * app/actions/project-go-live.ts
 *
 * Sprint 49: Server actions for unified go-live readiness.
 *
 * Safety rules:
 *  - no secrets exposed
 *  - no auto-promotion
 *  - no destructive commands
 *  - all actions verify project access
 */

import { requireProjectPermission }           from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }             from "@/lib/audit/project-audit";
import {
  generateGoLiveReadinessReport,
  runGoLiveSmokeChecks,
}                                             from "@/lib/go-live/go-live-readiness-service";
import { db }                                 from "@/lib/db";
import type {
  GoLiveReadinessResult,
  GoLiveSmokeResult,
  GoLiveManualCheckResult,
} from "@/lib/go-live/go-live-readiness-types";

// ── Permission helpers ────────────────────────────────────────────────────────

async function requireView(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "project.view");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

async function requireDeploy(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "deploy.trigger");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

// ── Action 1: Generate go-live readiness report ───────────────────────────────

export async function generateGoLiveReadinessAction(
  projectId: string,
): Promise<GoLiveReadinessResult> {
  try {
    const ctx = await requireView(projectId);

    const report = await generateGoLiveReadinessReport(projectId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "go_live.readiness_generated",
      summary:     `Go-live readiness: ${report.status} — ${report.summary.passed}/${report.summary.total} checks passed`,
      result:      "success",
      metadata:    {
        status:   report.status,
        passed:   report.summary.passed,
        total:    report.summary.total,
        failed:   report.summary.failed,
        warnings: report.summary.warnings,
      },
    }).catch(() => null);

    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Go-live readiness check failed: ${msg}` };
  }
}

// ── Action 2: Run smoke checks ────────────────────────────────────────────────

export async function runGoLiveSmokeChecksAction(
  projectId: string,
): Promise<GoLiveSmokeResult> {
  try {
    const ctx = await requireDeploy(projectId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "go_live.smoke_checks_started",
      summary:     "Go-live smoke checks started",
      result:      "success",
    }).catch(() => null);

    const report = await runGoLiveSmokeChecks(projectId);

    const auditAction = report.overallPass
      ? "go_live.smoke_checks_passed"
      : "go_live.smoke_checks_failed";

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      auditAction,
      summary:     `Smoke checks ${report.overallPass ? "passed" : "failed"} (${report.checks.length} checks)`,
      result:      report.overallPass ? "success" : "failed",
      metadata:    {
        overallPass: report.overallPass,
        checkCount:  report.checks.length,
        failCount:   report.checks.filter((c) => c.status === "fail").length,
      },
    }).catch(() => null);

    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Smoke checks failed: ${msg}` };
  }
}

// ── Action 3: Mark manual go-live check (audit-only, marks are client-side) ──

export async function markManualGoLiveCheckAction(input: {
  projectId: string;
  checkId:   string;
  status:    "done" | "todo";
}): Promise<GoLiveManualCheckResult> {
  try {
    const ctx = await requireView(input.projectId);

    await writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "go_live.manual_check_marked",
      summary:     `Manual check "${input.checkId}" marked as ${input.status}`,
      result:      "success",
      metadata:    { checkId: input.checkId, status: input.status },
    }).catch(() => null);

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Could not mark check: ${msg}` };
  }
}

// ── Bonus: Release summary for comparison card ────────────────────────────────

export async function getReleaseSummaryAction(projectId: string): Promise<{
  ok: true;
  currentLive:    { id: string; ref: string; activatedAt?: string; branch?: string; commitSha?: string; commitMessage?: string } | null;
  candidate:      { id: string; ref: string; createdAt: string; branch?: string; commitSha?: string; commitMessage?: string } | null;
  rollbackTarget: { id: string; ref: string; createdAt: string } | null;
  promotionHistory: Array<{ id: string; status: string; promotedAt?: string; preflightStatus: string; deploymentRef: string; rollbackDeploymentRef?: string }>;
} | { ok: false; error: string }> {
  try {
    await requireView(projectId);

    const [currentLive, allSuccess] = await Promise.all([
      db.deployment.findFirst({
        where:   { projectId, isActive: true },
        select:  { id: true, metadata: true, activatedAt: true, branch: true, commitSha: true, commitMessage: true },
      }),
      db.deployment.findMany({
        where:   { projectId, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        take:    10,
        select:  { id: true, metadata: true, createdAt: true, isActive: true, branch: true, commitSha: true, commitMessage: true },
      }),
    ]);

    const promotionRows = await db.projectReleasePromotion.findMany({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      take:    5,
      select:  { id: true, status: true, promotedAt: true, preflightStatus: true, deploymentRef: true, rollbackDeploymentRef: true },
    });

    function toRef(dep: { id: string; metadata: unknown }): string {
      const meta = dep.metadata as Record<string, unknown> | null;
      return (meta?.deploymentRef as string) ?? dep.id;
    }

    const liveDep = currentLive ? {
      id:            currentLive.id,
      ref:           toRef(currentLive),
      activatedAt:   currentLive.activatedAt?.toISOString(),
      branch:        currentLive.branch ?? undefined,
      commitSha:     currentLive.commitSha ?? undefined,
      commitMessage: currentLive.commitMessage ?? undefined,
    } : null;

    const candidateDep = allSuccess.find((d) => !d.isActive) ?? null;
    const candidateDTO = candidateDep ? {
      id:            candidateDep.id,
      ref:           toRef(candidateDep),
      createdAt:     candidateDep.createdAt.toISOString(),
      branch:        candidateDep.branch ?? undefined,
      commitSha:     candidateDep.commitSha ?? undefined,
      commitMessage: candidateDep.commitMessage ?? undefined,
    } : null;

    const rollbackDep = allSuccess.find(
      (d) => !d.isActive && d.id !== candidateDep?.id,
    ) ?? null;
    const rollbackDTO = rollbackDep ? {
      id:        rollbackDep.id,
      ref:       toRef(rollbackDep),
      createdAt: rollbackDep.createdAt.toISOString(),
    } : null;

    return {
      ok:             true,
      currentLive:    liveDep,
      candidate:      candidateDTO,
      rollbackTarget: rollbackDTO,
      promotionHistory: promotionRows.map((p) => ({
        id:                    p.id,
        status:                p.status,
        promotedAt:            p.promotedAt?.toISOString(),
        preflightStatus:       p.preflightStatus,
        deploymentRef:         p.deploymentRef,
        rollbackDeploymentRef: p.rollbackDeploymentRef ?? undefined,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Could not load release summary: ${msg}` };
  }
}

// ── Sprint 26 compatibility shims ─────────────────────────────────────────────
//
// replit-go-live-panel.tsx (Sprint 26) imports these names directly.
// We preserve them here so that component continues to type-check and work
// until it is eventually migrated to the Sprint 49 GoLiveReadinessPanel.

import { runGoLiveChecks }        from "@/lib/migration/go-live-runner";
import type { GoLiveReadinessReport } from "@/lib/migration/go-live-types";

export async function checkGoLiveReadinessAction(
  projectId: string,
): Promise<{ ok: true; data: GoLiveReadinessReport } | { ok: false; error: string }> {
  try {
    const ctx = await requireView(projectId);
    void ctx;
    const report = await runGoLiveChecks(projectId);
    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function recordGoLiveReportCopiedAction(
  projectId: string,
  overallStatus: string,
): Promise<void> {
  try {
    const ctx = await requireView(projectId);
    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "go_live.report_copied",
      summary:     `Go-live report copied — status: ${overallStatus}`,
      result:      "success",
    }).catch(() => null);
  } catch { /* non-fatal */ }
}
