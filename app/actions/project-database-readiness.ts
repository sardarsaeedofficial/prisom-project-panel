"use server";

/**
 * app/actions/project-database-readiness.ts
 *
 * Sprint 45: Server actions for the Database Migration Readiness panel.
 *
 * Safety rules:
 *  - DATABASE_URL is never returned or logged
 *  - Connection test returns host/latencyMs only
 *  - Blocked commands (migrate reset, DROP, TRUNCATE) are rejected
 *  - Every action enforces project.view permission
 *  - Audit events logged for generate, connection test, and copy
 */

import { Pool }                             from "pg";
import { db }                               from "@/lib/db";
import { requireProjectPermission }         from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }           from "@/lib/audit/project-audit";
import { getAuditRequestContext }           from "@/lib/audit/request-context";
import { generateReadinessReport, isBlockedCommand } from "@/lib/database/db-readiness-detector";
import { getDecryptedDbUrl }                from "@/lib/database/db-env-safety";
import type { DatabaseReadinessReport }     from "@/lib/database/db-readiness-types";

// ── 1. Generate readiness report ──────────────────────────────────────────────

export async function generateDatabaseReadinessReportAction(
  projectId: string,
): Promise<{ ok: boolean; report?: DatabaseReadinessReport; error?: string }> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const report = await generateReadinessReport(projectId);
    if (!report) return { ok: false, error: "Project not found." };

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      "database.readiness_generated",
      category:    "database",
      result:      "success",
      summary:     `DB readiness report generated — score ${report.readinessScore}/100, ${report.blockers.length} blocker(s)`,
      metadata:    {
        tool:     report.tool?.tool    ?? "unknown",
        provider: report.provider?.provider ?? "unknown",
        score:    report.readinessScore,
        blockers: report.blockers.length,
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

// ── 2. Test database connection ───────────────────────────────────────────────

type ConnectionTestResult = {
  ok:        boolean;
  latencyMs?: number;
  host?:     string;
  provider?: string;
  error?:    string;
};

export async function testProjectDatabaseConnectionAction(
  projectId: string,
): Promise<{ ok: boolean; result?: ConnectionTestResult; error?: string }> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  // DATABASE_URL is decrypted server-side and never returned
  const rawUrl = await getDecryptedDbUrl(projectId);
  if (!rawUrl) {
    return {
      ok: false,
      error: "DATABASE_URL not configured. Add it to the Secrets Vault first.",
    };
  }

  // Extract host/db name for the result (no credentials)
  let host:         string | undefined;
  let databaseName: string | undefined;
  let provider      = "postgresql";
  try {
    const parsed = new URL(rawUrl);
    host         = parsed.hostname || undefined;
    databaseName = parsed.pathname.replace(/^\//, "") || undefined;
    if (rawUrl.toLowerCase().startsWith("mongodb")) provider = "mongodb";
    else if (host?.includes("supabase"))             provider = "supabase";
    else if (host?.includes("neon.tech"))            provider = "neon";
  } catch {
    // continue without host info
  }

  const start = Date.now();

  try {
    const pool = new Pool({
      connectionString:   rawUrl,
      connectionTimeoutMillis: 8_000,
      statement_timeout:  5_000,
      max:                1,
      idleTimeoutMillis:  1_000,
      ssl: rawUrl.includes("neon.tech") || rawUrl.includes("supabase")
        ? { rejectUnauthorized: false }
        : undefined,
    });

    let ok    = false;
    let error: string | undefined;
    let client;
    try {
      client = await pool.connect();
      await client.query("SELECT 1");
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : "Connection failed.";
    } finally {
      client?.release();
      await pool.end().catch(() => null);
    }

    const latencyMs = Date.now() - start;

    // Cache result in deployment config
    try {
      await db.projectDeploymentConfig.updateMany({
        where: { projectId },
        data:  {
          dbConnLastCheckedAt: new Date(),
          dbConnStatus:        ok ? "ok" : "failed",
          dbConnErrorMessage:  ok ? null : (error ?? null),
          dbConnEnvironment:   "production",
        },
      });
    } catch {
      // Non-fatal — table may not exist
    }

    const ctx = await getAuditRequestContext();
    void writeProjectAuditEvent({
      projectId,
      actorUserId: auth.userId,
      actorRole:   auth.role,
      action:      ok ? "database.connection_test_passed" : "database.connection_test_failed",
      category:    "database",
      result:      ok ? "success" : "failed",
      summary:     ok
        ? `DB connection test passed (${latencyMs}ms) — ${host ?? "unknown host"}`
        : `DB connection test failed — ${error?.slice(0, 200)}`,
      metadata: { latencyMs, host, provider },
      ...ctx,
    }).catch(() => null);

    return {
      ok: true,
      result: {
        ok,
        latencyMs,
        host,
        provider,
        error: ok ? undefined : error,
      },
    };
  } catch (e) {
    return {
      ok:    false,
      error: e instanceof Error ? e.message : "Unexpected error during connection test.",
    };
  }
}

// ── 3. Copy a database command ────────────────────────────────────────────────

export async function copyDatabaseCommandAction(
  projectId: string,
  commandId: string,
): Promise<{ ok: boolean; command?: string; error?: string }> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  const report = await generateReadinessReport(projectId);
  if (!report) return { ok: false, error: "Project not found." };

  const cmd = report.commands.find((c) => c.id === commandId);
  if (!cmd) return { ok: false, error: "Command not found." };

  if (cmd.safety === "blocked" || isBlockedCommand(cmd.command)) {
    return { ok: false, error: "This command is blocked for production safety." };
  }

  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole:   auth.role,
    action:      "database.command_copied",
    category:    "database",
    result:      "success",
    summary:     `DB command copied: ${cmd.label}`,
    metadata:    { commandId, label: cmd.label, safety: cmd.safety },
    ...ctx,
  }).catch(() => null);

  return { ok: true, command: cmd.command };
}
