"use server";

/**
 * app/actions/staging-import.ts
 *
 * Sprint 51: Server actions for the staging import executor.
 *
 * Safety:
 *  - never copies real secrets
 *  - never applies routes
 *  - never deploys automatically
 *  - never mutates live project settings
 *  - project.view for read-only actions
 *  - project.edit for write actions
 */

import { requireProjectPermission }     from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }       from "@/lib/audit/project-audit";
import {
  generateStagingImportPlan,
  runStagingSmokeChecks,
}                                       from "@/lib/migration/staging-import-planner";
import {
  exportStagingImportReport,
}                                       from "@/lib/migration/staging-import-export";
import type {
  StagingImportPlan,
  StagingSmokeReport,
}                                       from "@/lib/migration/staging-import-types";
import { STAGING_SLUG, STAGING_DOMAIN } from "@/lib/migration/staging-import-types";

// ── Permission helpers ────────────────────────────────────────────────────────

async function requireView(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "project.view");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

async function requireEdit(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "project.edit");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

// ── Action 1: Generate staging import plan ────────────────────────────────────

export async function generateStagingImportPlanAction(
  projectId: string,
): Promise<
  | { ok: true;  plan: StagingImportPlan }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireView(projectId);

    const plan = await generateStagingImportPlan(projectId);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "staging.plan_generated",
      summary:     `Staging import plan generated — status: ${plan.status}`,
      result:      "success",
      metadata:    { status: plan.status, blockers: plan.blockers.length },
    }).catch(() => null);

    return { ok: true, plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Plan generation failed: ${msg}` };
  }
}

// ── Action 2: Prepare staging checklist ──────────────────────────────────────
//
// Generates a checklist for setting up a staging project.
// Does NOT create a project, apply routes, or copy secrets.

export async function prepareStagingChecklistAction(input: {
  projectId:     string;
  stagingSlug?:  string;
  stagingDomain?: string;
}): Promise<
  | { ok: true;  plan: StagingImportPlan; stagingSlug: string; stagingDomain: string }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireEdit(input.projectId);

    const stagingDomain = input.stagingDomain ?? STAGING_DOMAIN;
    const stagingSlug   = input.stagingSlug   ?? STAGING_SLUG;

    const plan = await generateStagingImportPlan(input.projectId, stagingDomain);

    await writeProjectAuditEvent({
      projectId:   input.projectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "staging.checklist_prepared",
      summary:     `Staging checklist prepared — slug: ${stagingSlug}, domain: ${stagingDomain}`,
      result:      "success",
      metadata:    { stagingSlug, stagingDomain },
    }).catch(() => null);

    return { ok: true, plan, stagingSlug, stagingDomain };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Checklist generation failed: ${msg}` };
  }
}

// ── Action 3: Run staging smoke checks ───────────────────────────────────────

export async function runStagingSmokeChecksAction(input: {
  sourceProjectId:  string;
  stagingProjectId?: string;
  stagingDomain?:   string;
}): Promise<
  | { ok: true;  report: StagingSmokeReport }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireView(input.sourceProjectId);

    const stagingDomain = input.stagingDomain ?? STAGING_DOMAIN;

    await writeProjectAuditEvent({
      projectId:   input.sourceProjectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "staging.smoke_checks_started",
      summary:     `Staging smoke checks started on domain: ${stagingDomain}`,
      result:      "success",
      metadata:    { stagingDomain },
    }).catch(() => null);

    const report = await runStagingSmokeChecks(stagingDomain);

    await writeProjectAuditEvent({
      projectId:   input.sourceProjectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      report.overallPass ? "staging.smoke_checks_passed" : "staging.smoke_checks_failed",
      summary:     `Staging smoke checks ${report.overallPass ? "passed" : "failed"} on ${stagingDomain}`,
      result:      report.overallPass ? "success" : "failed",
      metadata:    {
        stagingDomain,
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

// ── Action 4: Export staging import report ────────────────────────────────────

export async function exportStagingImportReportAction(input: {
  sourceProjectId:   string;
  stagingProjectId?: string;
  stagingDomain?:    string;
}): Promise<
  | { ok: true;  markdown: string; filename: string }
  | { ok: false; error: string }
> {
  try {
    const ctx = await requireView(input.sourceProjectId);

    const plan = await generateStagingImportPlan(
      input.sourceProjectId,
      input.stagingDomain,
    );

    const markdown = exportStagingImportReport(plan, null);

    await writeProjectAuditEvent({
      projectId:   input.sourceProjectId,
      actorUserId: ctx.userId,
      category:    "publishing",
      action:      "staging.report_exported",
      summary:     "Staging import report exported as Markdown",
      result:      "success",
    }).catch(() => null);

    return { ok: true, markdown, filename: "STAGING_IMPORT_REPORT.md" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated") || msg.includes("permission")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Export failed: ${msg}` };
  }
}
