"use server";

/**
 * app/actions/qa-verification.ts
 *
 * Sprint 69: Server actions for Live QA Verification.
 *
 * Safety:
 *  - no secrets returned
 *  - no production mutation
 *  - live smoke checks are GET/HEAD only
 *  - Doorsteps/LocalShop untouched
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateQaVerificationReport } from "@/lib/qa/qa-verification-service";
import { runLiveSmokeChecks }           from "@/lib/qa/live-smoke-checks";
import { exportQaVerificationReport }   from "@/lib/qa/qa-verification-export";
import type { QaVerificationReport }    from "@/lib/qa/qa-verification-types";
import type { LiveSmokeReport }         from "@/lib/qa/qa-verification-types";

// ── Result type ───────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireDeployOrEdit(projectId: string) {
  const primary = await requireProjectPermission(projectId, "deploy.trigger");
  if (primary.ok) return primary;
  return requireProjectPermission(projectId, "project.edit");
}

// ── 1. Generate QA report ─────────────────────────────────────────────────────

export async function generateQaVerificationReportAction(input: {
  projectId: string;
}): Promise<ActionResult<QaVerificationReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report = await generateQaVerificationReport({ projectId }).catch(
    (e: unknown) => { throw new Error(`QA report failed: ${e instanceof Error ? e.message : String(e)}`); },
  );

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "qa_verification.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `QA verification report generated — score ${report.score}%, status: ${report.status}`,
      metadata:    { ...ctx, score: report.score, status: report.status },
    });
  } catch { /* audit is best-effort */ }

  return { ok: true, data: report };
}

// ── 2. Run live smoke checks ──────────────────────────────────────────────────

export async function runLiveQaSmokeChecksAction(input: {
  projectId:    string;
  confirmation: string;
}): Promise<ActionResult<LiveSmokeReport>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== "RUN LIVE QA SMOKE CHECKS") {
    return { ok: false, error: 'Type exactly "RUN LIVE QA SMOKE CHECKS" to proceed.', code: "CONFIRMATION_REQUIRED" };
  }

  const auth = await requireDeployOrEdit(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "qa_verification.live_smoke_checks_started",
      category:    "publishing",
      result:      "success",
      summary:     "Live QA smoke checks started",
      metadata:    { ...ctx },
    });
  } catch { /* audit is best-effort */ }

  const smokeReport = await runLiveSmokeChecks({ projectId }).catch(
    (e: unknown) => { throw new Error(`Live smoke checks failed: ${e instanceof Error ? e.message : String(e)}`); },
  );

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      smokeReport.status === "failed"
        ? "qa_verification.live_smoke_checks_failed"
        : "qa_verification.live_smoke_checks_passed",
      category:    "publishing",
      result:      smokeReport.status === "failed" ? "failed" : "success",
      summary:     `Live QA smoke checks ${smokeReport.status}`,
      metadata:    { ...ctx, status: smokeReport.status },
    });
  } catch { /* audit is best-effort */ }

  return { ok: true, data: smokeReport };
}

// ── 3. Export QA report ───────────────────────────────────────────────────────

export async function exportQaVerificationReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ content: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report  = await generateQaVerificationReport({ projectId });
  const content = exportQaVerificationReport(report);

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "qa_verification.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     "QA_VERIFICATION_REPORT.md exported",
      metadata:    { ...ctx },
    });
  } catch { /* audit is best-effort */ }

  return { ok: true, data: { content, filename: "QA_VERIFICATION_REPORT.md" } };
}
