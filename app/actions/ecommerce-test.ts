"use server";

/**
 * app/actions/ecommerce-test.ts
 *
 * Sprint 62: Server actions for the ecommerce test harness.
 *
 * Safety rules:
 *  - project.view for report/export (read-only)
 *  - project.edit or deploy.trigger for smoke checks / mark complete
 *  - Never expose secrets
 *  - Never mutate live production
 *  - Never create real orders
 *  - Never charge real cards
 *  - HTTP GET checks only
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { db }                       from "@/lib/db";
import { generateEcommerceTestReport } from "@/lib/ecommerce/ecommerce-test-planner";
import { runSafeEcommerceSmokeChecks } from "@/lib/ecommerce/ecommerce-smoke-checks";
import { exportEcommerceTestReport }   from "@/lib/ecommerce/ecommerce-test-export";
import type {
  EcommerceTestReport,
  EcommerceSmokeReport,
} from "@/lib/ecommerce/ecommerce-test-types";

// ── Shared result type ────────────────────────────────────────────────────────

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

// ── 1. Generate ecommerce test report ─────────────────────────────────────────

export async function generateEcommerceTestReportAction(input: {
  projectId:     string;
  targetDomain?: string;
  confirmation?: "GENERATE ECOMMERCE TEST PLAN";
}): Promise<ActionResult<EcommerceTestReport>> {
  const { projectId, targetDomain, confirmation } = input;

  if (confirmation !== undefined && confirmation.trim() !== "GENERATE ECOMMERCE TEST PLAN") {
    return { ok: false, error: 'Confirmation phrase must be "GENERATE ECOMMERCE TEST PLAN".' };
  }

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const report = await generateEcommerceTestReport({ projectId, targetDomain });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ecommerce_test.report_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Ecommerce test plan generated — status: ${report.status}, blockers: ${report.blockers.length}`,
      metadata:    {
        status:       report.status,
        targetDomain: report.targetDomain,
        blockerCount: report.blockers.length,
        warningCount: report.warnings.length,
        summary:      report.summary,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate ecommerce test plan.";
    return { ok: false, error: msg };
  }
}

// ── 2. Run safe ecommerce smoke checks ────────────────────────────────────────

export async function runSafeEcommerceSmokeChecksAction(input: {
  projectId:     string;
  targetDomain?: string;
  confirmation:  "RUN SAFE ECOMMERCE CHECKS";
}): Promise<ActionResult<EcommerceSmokeReport>> {
  const { projectId, targetDomain, confirmation } = input;

  if (confirmation.trim() !== "RUN SAFE ECOMMERCE CHECKS") {
    return { ok: false, error: 'Confirmation phrase "RUN SAFE ECOMMERCE CHECKS" is required.' };
  }

  // Requires project.edit or deploy.trigger
  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  const effectiveAuth = auth.ok
    ? auth
    : await requireProjectPermission(projectId, "project.edit");

  if (!effectiveAuth.ok) {
    return {
      ok:    false,
      error: "You need deploy.trigger or project.edit permission to run ecommerce smoke checks.",
      code:  "PERMISSION_DENIED",
    };
  }

  try {
    const ctx = await getAuditRequestContext();

    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      "ecommerce_test.safe_checks_started",
      category:    "publishing",
      result:      "success",
      summary:     `Safe ecommerce smoke checks started — domain: ${targetDomain ?? "default"}`,
      metadata:    { targetDomain: targetDomain ?? null },
      ...ctx,
    }).catch(() => null);

    const report = await runSafeEcommerceSmokeChecks({ projectId, targetDomain });

    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      report.status === "passed"
        ? "ecommerce_test.safe_checks_passed"
        : "ecommerce_test.safe_checks_failed",
      category: "publishing",
      result:   report.status === "passed" ? "success" : "failed",
      summary:  `Safe ecommerce smoke checks ${report.status} — domain: ${report.targetDomain}`,
      metadata: {
        domain:      report.targetDomain,
        status:      report.status,
        resultCount: report.results.length,
        passCount:   report.results.filter((r) => r.status === "pass").length,
        warnCount:   report.results.filter((r) => r.status === "warning").length,
        failCount:   report.results.filter((r) => r.status === "fail").length,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: report };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to run ecommerce smoke checks.";
    return { ok: false, error: msg };
  }
}

// ── 3. Export ecommerce test report ───────────────────────────────────────────

export async function exportEcommerceTestReportAction(input: {
  projectId:     string;
  targetDomain?: string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId, targetDomain } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [report, projectName] = await Promise.all([
      generateEcommerceTestReport({ projectId, targetDomain }),
      getProjectName(projectId),
    ]);

    const markdown = exportEcommerceTestReport(report, projectName, null);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "ecommerce_test.report_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Ecommerce test report exported — status: ${report.status}`,
      metadata:    { status: report.status, targetDomain: report.targetDomain },
      ...ctx,
    }).catch(() => null);

    return {
      ok:   true,
      data: { markdown, filename: "ECOMMERCE_TEST_REPORT.md" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export ecommerce test report.";
    return { ok: false, error: msg };
  }
}

// ── 4. Mark ecommerce proof complete ──────────────────────────────────────────

export async function markEcommerceProofCompleteAction(input: {
  projectId:    string;
  confirmation: "MARK ECOMMERCE PROOF COMPLETE";
}): Promise<ActionResult<{ completedAt: string }>> {
  const { projectId, confirmation } = input;

  if (confirmation.trim() !== "MARK ECOMMERCE PROOF COMPLETE") {
    return { ok: false, error: 'Confirmation phrase "MARK ECOMMERCE PROOF COMPLETE" is required.' };
  }

  const auth = await requireProjectPermission(projectId, "deploy.trigger");
  const effectiveAuth = auth.ok
    ? auth
    : await requireProjectPermission(projectId, "project.edit");

  if (!effectiveAuth.ok) {
    return {
      ok:    false,
      error: "You need deploy.trigger or project.edit permission to mark ecommerce proof complete.",
      code:  "PERMISSION_DENIED",
    };
  }

  try {
    const completedAt = new Date().toISOString();

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: effectiveAuth.userId,
      actorRole:   effectiveAuth.role,
      action:      "ecommerce_test.proof_completed",
      category:    "publishing",
      result:      "success",
      summary:     "Ecommerce test proof marked complete.",
      metadata:    { completedAt },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { completedAt } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to mark ecommerce proof complete.";
    return { ok: false, error: msg };
  }
}
