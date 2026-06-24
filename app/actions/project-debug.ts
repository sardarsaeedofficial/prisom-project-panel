"use server";

/**
 * app/actions/project-debug.ts
 *
 * Sprint 58: Server actions for the debug summary system.
 *
 * Safety rules:
 *  - project.view required for all actions.
 *  - All log text is sanitized before leaving the server.
 *  - No secrets in output.
 *  - Read-only — no deployments, no nginx writes, no DB migrations, no PM2.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { generateDebugSummary }     from "@/lib/debug/debug-summary-service";
import { exportDebugBundle }        from "@/lib/debug/debug-bundle-export";
import { db }                       from "@/lib/db";
import type { DebugSummary }        from "@/lib/debug/debug-types";

// ── Shared result type ────────────────────────────────────────────────────────

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

// ── 1. Generate debug summary ─────────────────────────────────────────────────

export async function generateDebugSummaryAction(input: {
  projectId:    string;
  source?:      DebugSummary["source"];
  logText?:     string;
  operationId?: string;
  jobId?:       string;
}): Promise<ActionResult<DebugSummary>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const summary = await generateDebugSummary({
      projectId,
      source:      input.source,
      logText:     input.logText,
      operationId: input.operationId,
      jobId:       input.jobId,
    });

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "debug.summary_generated",
      category:    "publishing",
      result:      "success",
      summary:     `Debug summary generated — source: ${summary.source}, status: ${summary.status}, findings: ${summary.findings.length}`,
      metadata:    {
        source:        summary.source,
        status:        summary.status,
        findingCount:  summary.findings.length,
        hasLogText:    !!input.logText,
        hasOperationId: !!input.operationId,
        hasJobId:      !!input.jobId,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to generate debug summary.";
    return { ok: false, error: msg };
  }
}

// ── 2. Export debug bundle ─────────────────────────────────────────────────────

export async function exportDebugBundleAction(input: {
  projectId:    string;
  source?:      DebugSummary["source"];
  logText?:     string;
  operationId?: string;
  jobId?:       string;
}): Promise<ActionResult<{ markdown: string; filename: string }>> {
  const { projectId } = input;

  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  try {
    const [summary, projectName] = await Promise.all([
      generateDebugSummary({
        projectId,
        source:      input.source,
        logText:     input.logText,
        operationId: input.operationId,
        jobId:       input.jobId,
      }),
      getProjectName(projectId),
    ]);

    const markdown = exportDebugBundle(summary, projectName);

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "debug.bundle_exported",
      category:    "publishing",
      result:      "success",
      summary:     `Debug bundle exported — source: ${summary.source}, status: ${summary.status}`,
      metadata:    { source: summary.source, status: summary.status },
      ...ctx,
    }).catch(() => null);

    return { ok: true, data: { markdown, filename: "DEBUG_BUNDLE.md" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Failed to export debug bundle.";
    return { ok: false, error: msg };
  }
}
