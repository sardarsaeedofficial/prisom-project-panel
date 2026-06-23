"use server";

/**
 * app/actions/project-env-readiness.ts
 *
 * Sprint 46: Server actions for Env/Secrets Readiness.
 *
 * Safety rules:
 *  - No raw secret values returned or logged
 *  - Audit events record key names only — never values
 *  - Placeholder creation uses empty encrypted value + isEnabled: false
 *  - createMissing requires secrets.manage permission
 *  - generateReport requires secrets.view permission
 */

import { db }                             from "@/lib/db";
import { requireProjectPermission }       from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }         from "@/lib/audit/project-audit";
import { getAuditRequestContext }         from "@/lib/audit/request-context";
import { encryptEnvValue }                from "@/lib/projects/env-manager";
import { generateEnvReadinessReport }     from "@/lib/env/env-readiness-detector";
import type { EnvReadinessReport }        from "@/lib/env/env-readiness-types";

// ── 1. Generate readiness report ──────────────────────────────────────────────

export async function generateEnvReadinessReportAction(
  projectId: string,
): Promise<{ ok: boolean; report?: EnvReadinessReport; error?: string }> {
  const auth = await requireProjectPermission(projectId, "secrets.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const report = await generateEnvReadinessReport(projectId);
    if (!report) return { ok: false, error: "Project not found." };

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "env.readiness_generated",
      category:    "env",
      result:      "success",
      summary:     `Env readiness report generated — ${report.status}, ${report.summary.requiredBlocked} required blocked`,
      metadata:    {
        status:          report.status,
        total:           report.summary.total,
        configured:      report.summary.configured,
        missing:         report.summary.missing,
        placeholders:    report.summary.placeholders,
        requiredBlocked: report.summary.requiredBlocked,
      },
      ...ctx,
    }).catch(() => null);

    return { ok: true, report };
  } catch (e) {
    return {
      ok:    false,
      error: e instanceof Error ? e.message : "Failed to generate report.",
    };
  }
}

// ── 2. Create missing env placeholders ───────────────────────────────────────

export async function createMissingEnvPlaceholdersAction(input: {
  projectId: string;
  envNames:  string[];
}): Promise<{ ok: boolean; created: string[]; skipped: string[]; error?: string }> {
  const { projectId, envNames } = input;

  const auth = await requireProjectPermission(projectId, "secrets.manage");
  if (!auth.ok) return { ok: false, created: [], skipped: [], error: auth.error };

  if (!envNames.length) return { ok: true, created: [], skipped: [] };

  // Limit to 50 placeholders per call
  const names = envNames.slice(0, 50);

  const created:  string[] = [];
  const skipped:  string[] = [];

  const existingRows = await db.projectEnvVar.findMany({
    where:  { projectId, name: { in: names }, environment: "production" },
    select: { name: true },
  });
  const existingNames = new Set(existingRows.map((r) => r.name));

  for (const name of names) {
    if (existingNames.has(name)) {
      skipped.push(name);
      continue;
    }

    try {
      await db.projectEnvVar.create({
        data: {
          projectId,
          name,
          value:       encryptEnvValue(""),
          isSecret:    true,
          isEnabled:   false,   // marks it as a placeholder — not yet filled in
          environment: "production",
          required:    true,
          source:      "template",
          description: `Placeholder created by env readiness check — replace with production value.`,
        },
      });
      created.push(name);
    } catch {
      skipped.push(name);
    }
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "env.placeholders_created",
    category:    "env",
    result:      created.length > 0 ? "success" : "failed",
    summary:     `Created ${created.length} env placeholder(s): ${created.slice(0, 10).join(", ")}`,
    metadata:    { created, skipped },
    ...ctx,
  }).catch(() => null);

  return { ok: true, created, skipped };
}

// ── 3. Mark env var as verified ───────────────────────────────────────────────

export async function markEnvVerifiedAction(input: {
  projectId: string;
  envName:   string;
}): Promise<{ ok: boolean; error?: string }> {
  const { projectId, envName } = input;

  const auth = await requireProjectPermission(projectId, "secrets.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "env.verified",
    category:    "env",
    result:      "success",
    summary:     `Env var marked as verified: ${envName}`,
    metadata:    { envName },
    ...ctx,
  }).catch(() => null);

  return { ok: true };
}
