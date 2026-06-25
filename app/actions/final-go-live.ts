"use server";

/**
 * app/actions/final-go-live.ts
 *
 * Sprint 63: Server actions for the Final Go-Live Control Room.
 *
 * Safety: read-only, no secrets, no production mutations.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateFinalGoLiveGateReport } from "@/lib/go-live/final-go-live-gate";
import { exportFinalGoLivePack }         from "@/lib/go-live/final-go-live-export";
import type { FinalGoLiveGateReport }    from "@/lib/go-live/final-go-live-types";

// ── Result type ───────────────────────────────────────────────────────────────

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

// ── 1. Generate final go-live gate report ─────────────────────────────────────

export async function generateFinalGoLiveGateReportAction(input: {
  projectId:     string;
  confirmation?: "GENERATE FINAL GO LIVE GATE";
}): Promise<ActionResult<FinalGoLiveGateReport>> {
  const { projectId, confirmation } = input;

  if (confirmation !== undefined && confirmation.trim() !== "GENERATE FINAL GO LIVE GATE") {
    return { ok: false, error: 'Confirmation phrase must be "GENERATE FINAL GO LIVE GATE".' };
  }

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateFinalGoLiveGateReport({ projectId });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_go_live.gate_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Final go-live gate generated — status: ${report.status}, score: ${report.readinessScore}%, blockers: ${report.blockers.length}`,
      metadata:    {
        status:         report.status,
        readinessScore: report.readinessScore,
        blockerCount:   report.blockers.length,
        warningCount:   report.warnings.length,
        summary:        report.summary,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate final go-live gate report.";
    return { ok: false, error: msg };
  }
}

// ── 2. Export final go-live pack ──────────────────────────────────────────────

export async function exportFinalGoLivePackAction(input: {
  projectId:     string;
  confirmation?: "EXPORT FINAL GO LIVE PACK";
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation !== undefined && confirmation.trim() !== "EXPORT FINAL GO LIVE PACK") {
    return { ok: false, error: 'Confirmation phrase must be "EXPORT FINAL GO LIVE PACK".' };
  }

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [report, projectName] = await Promise.all([
      generateFinalGoLiveGateReport({ projectId }),
      getProjectName(projectId),
    ]);

    const markdown = exportFinalGoLivePack(report, projectName);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_go_live.pack_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Final go-live pack exported — status: ${report.status}, score: ${report.readinessScore}%`,
      metadata:    { status: report.status, readinessScore: report.readinessScore },
      ...ctx,
    }).catch(() => null);

    return {
      ok:   true,
      data: { markdown, filename: "FINAL_GO_LIVE_PACK.md" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export final go-live pack.";
    return { ok: false, error: msg };
  }
}

// ── 3. Mark evidence reviewed ─────────────────────────────────────────────────

export async function markEvidenceReviewedAction(input: {
  projectId: string;
  itemId:    string;
  status:    "done" | "todo";
}): Promise<ActionResult<{ itemId: string; status: string }>> {
  const { projectId, itemId, status } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "final_go_live.evidence_marked",
      category:    "publishing",
      result:      "success",
      summary:     `Final go-live evidence marked ${status}: ${itemId}`,
      metadata:    { itemId, status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { itemId, status } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to mark evidence.";
    return { ok: false, error: msg };
  }
}
