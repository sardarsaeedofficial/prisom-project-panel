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
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  // Sprint 17: database explorer requires database.view permission
  const auth = await requireProjectPermission(projectId, "database.view");
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, projectId };
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

  return testProjectDbExplorerConnection(projectId, environment);
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

  return runProjectReadOnlyQuery(input);
}
