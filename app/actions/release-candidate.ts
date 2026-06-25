"use server";

/**
 * app/actions/release-candidate.ts
 *
 * Sprint 68: Server actions for Release Candidate hardening report.
 *
 * Safety:
 *  - no secrets returned
 *  - no production mutation
 *  - read-only DB queries only
 *  - Doorsteps/LocalShop untouched
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateReleaseCandidateReport } from "@/lib/release-candidate/release-candidate-audit";
import { exportReleaseCandidateReport }   from "@/lib/release-candidate/release-candidate-export";
import type { ReleaseCandidateReport }    from "@/lib/release-candidate/release-candidate-types";

// ── Result type ───────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Generate RC report ─────────────────────────────────────────────────────

export async function generateReleaseCandidateReportAction(input: {
  projectId: string;
}): Promise<ActionResult<ReleaseCandidateReport>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report = await generateReleaseCandidateReport({ projectId }).catch(
    (e: unknown) => { throw new Error(`RC report failed: ${e instanceof Error ? e.message : String(e)}`); },
  );

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "release_candidate.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Release candidate report generated — score ${report.score}%, status: ${report.status}`,
      metadata:    { ...ctx, score: report.score, status: report.status },
    });
  } catch { /* audit is best-effort */ }

  return { ok: true, data: report };
}

// ── 2. Export RC report ───────────────────────────────────────────────────────

export async function exportReleaseCandidateReportAction(input: {
  projectId: string;
}): Promise<ActionResult<{ content: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report  = await generateReleaseCandidateReport({ projectId });
  const content = exportReleaseCandidateReport(report);

  try {
    const ctx = await getAuditRequestContext();
    await writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      action:      "release_candidate.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     "RELEASE_CANDIDATE_REPORT.md exported",
      metadata:    { ...ctx },
    });
  } catch { /* audit is best-effort */ }

  return { ok: true, data: { content, filename: "RELEASE_CANDIDATE_REPORT.md" } };
}
