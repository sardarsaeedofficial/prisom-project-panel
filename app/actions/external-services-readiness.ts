"use server";

/**
 * app/actions/external-services-readiness.ts
 *
 * Sprint 54: Server actions for the External Services Readiness workflow.
 *
 * Safety rules:
 *  - project.view required for report/export
 *  - never return secret values
 *  - never mutate provider settings
 *  - never create real charges or send real emails
 *  - never create Stripe webhooks automatically
 */

import { requireProjectPermission }            from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }              from "@/lib/audit/project-audit";
import { getAuditRequestContext }              from "@/lib/audit/request-context";
import { generateExternalServicesReadiness }   from "@/lib/external-services/external-services-readiness";
import { exportExternalServicesReadiness }     from "@/lib/external-services/external-services-export";
import { db }                                  from "@/lib/db";
import type { ExternalServiceReadinessReport } from "@/lib/external-services/external-services-types";

// ── Shared types ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── 1. Generate readiness report ──────────────────────────────────────────────

export async function generateExternalServicesReadinessAction(
  projectId: string,
): Promise<ActionResult<ExternalServiceReadinessReport>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const report = await generateExternalServicesReadiness(projectId);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "external_services.readiness_generated",
    category:    "publishing",
    result:      report.status === "blocked" ? "failed" : "success",
    summary:     `External services readiness generated — status: ${report.status}, blockers: ${report.blockers.length}`,
    metadata:    { status: report.status, blockerCount: report.blockers.length },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: report };
}

// ── 2. Export readiness report ────────────────────────────────────────────────

export async function exportExternalServicesReadinessAction(
  projectId: string,
): Promise<ActionResult<{ markdown: string }>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  const report   = await generateExternalServicesReadiness(projectId);
  const markdown = exportExternalServicesReadiness(report, project.name);

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "external_services.report_exported",
    category:    "publishing",
    result:      "success",
    summary:     `External services readiness report exported — status: ${report.status}`,
    metadata:    { status: report.status },
    ...ctx,
  }).catch(() => null);

  return { ok: true, data: { markdown } };
}
