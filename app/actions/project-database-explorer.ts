"use server";

/**
 * app/actions/project-database-explorer.ts
 *
 * Sprint 12: Server actions for the safe read-only database explorer.
 *
 * Safety:
 *  - Ownership verified on every call
 *  - DATABASE_URL never returned to client
 *  - All SQL goes through validateReadOnlySql
 *  - Identifiers validated with /^[a-zA-Z_][a-zA-Z0-9_$]*$/
 *  - Short connection + statement timeouts
 *  - Cell values truncated at 10 KB
 *  - Maximum 500 rows per query
 */

import { db }                       from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent }   from "@/lib/audit/project-audit";
import { getAuditRequestContext }   from "@/lib/audit/request-context";
import { safeQueryPreview }         from "@/lib/audit/audit-sanitize";

import {
  testProjectDbExplorerConnection,
  listProjectDbSchemas,
  getProjectDbTableDetail,
  getProjectDbTableRows,
  runProjectReadOnlyQuery,
  type DbExplorerConnectionInfo,
  type DbSchemaInfo,
  type DbTableDetail,
  type DbQueryResult,
} from "@/lib/projects/database-explorer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// Re-export explorer types so client components can import from actions file
export type {
  DbExplorerConnectionInfo,
  DbSchemaInfo,
  DbTableDetail,
  DbQueryResult,
} from "@/lib/projects/database-explorer";

export type { DbTableInfo, DbColumnInfo, DbIndexInfo } from "@/lib/projects/database-explorer";

// ── Ownership guard ───────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; projectId: string; userId: string; role: string } | { ok: false; error: string }> {
  // Sprint 17: database explorer requires database.view permission
  const auth = await requireProjectPermission(projectId, "database.view");
  if (!auth.ok) return { ok: false, error: auth.error };
  // Sprint 18: include auth data for audit
  return { ok: true, projectId, userId: auth.userId, role: auth.role };
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Test the project's PostgreSQL connection.
 * Returns safe metadata (host, dbname, ssl, latency) — never the URL.
 */
export async function getProjectDbConnectionAction(
  projectId:   string,
  environment: string = "production",
): Promise<ActionResult<DbExplorerConnectionInfo>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await testProjectDbExplorerConnection(projectId, environment);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "database.connection_tested",
    category: "database",
    result: result.ok ? "success" : "failed",
    summary: result.ok
      ? `Database connection tested OK (${environment})`
      : `Database connection test failed (${environment})`,
    metadata: { environment },
    ...ctx,
  });

  return result;
}

/**
 * List all schemas and their tables/views.
 */
export async function listProjectDbSchemasAction(
  projectId:   string,
  environment: string = "production",
): Promise<ActionResult<DbSchemaInfo[]>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return listProjectDbSchemas(projectId, environment);
}

/**
 * Get column and index details for a specific table.
 */
export async function getProjectDbTableDetailAction(input: {
  projectId:   string;
  environment?: string;
  schema:       string;
  table:        string;
}): Promise<ActionResult<DbTableDetail>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return getProjectDbTableDetail(input);
}

/**
 * Fetch sample rows from a table with pagination.
 */
export async function getProjectDbTableRowsAction(input: {
  projectId:   string;
  environment?: string;
  schema:       string;
  table:        string;
  limit?:       number;
  offset?:      number;
}): Promise<ActionResult<DbQueryResult>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  return getProjectDbTableRows(input);
}

/**
 * Run a user-provided SQL query.
 * The query must pass validateReadOnlySql before execution.
 */
export async function runProjectReadOnlyQueryAction(input: {
  projectId:   string;
  environment?: string;
  query:        string;
  limit?:       number;
}): Promise<ActionResult<DbQueryResult>> {
  const auth = await verifyOwnership(input.projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const result = await runProjectReadOnlyQuery(input);

  // Sprint 18: audit — query preview only, no row data
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: result.ok ? "database.query.executed" : "database.query.blocked",
    category: "database",
    result: result.ok ? "success" : "failed",
    summary: result.ok
      ? `Read-only query executed (${input.environment ?? "production"})`
      : `Query blocked/failed (${input.environment ?? "production"})`,
    // queryPreview and rowCount only — no row data
    metadata: {
      queryPreview: safeQueryPreview(input.query),
      environment: input.environment ?? "production",
      rowCount: result.ok ? (result.data as { rows?: unknown[] }).rows?.length ?? null : null,
      durationMs: result.ok ? (result.data as { durationMs?: number }).durationMs ?? null : null,
    },
    ...ctx,
  });

  return result;
}
