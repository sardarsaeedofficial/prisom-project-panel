/**
 * lib/projects/database-explorer.ts
 *
 * Sprint 12: Safe per-project database explorer helpers.
 *
 * Safety rules:
 *  - DATABASE_URL is decrypted server-side, never logged or returned
 *  - Only PostgreSQL is supported in this sprint
 *  - Every query runs through validateReadOnlySql
 *  - Schema/table identifiers validated with /^[a-zA-Z_][a-zA-Z0-9_$]*$/
 *  - Connections use short timeouts (connect + statement + idle)
 *  - Clients are always released/closed after each action
 *  - Cell values truncated at 10 KB
 *  - Returns at most 500 rows
 */

import { Pool, PoolClient } from "pg";
import { db }               from "@/lib/db";
import { decryptEnvValue }  from "@/lib/projects/env-manager";
import { validateReadOnlySql } from "@/lib/projects/sql-safety";

// ── ActionResult ─────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Exported types ────────────────────────────────────────────────────────────

export type DbExplorerConnectionInfo = {
  provider:      "postgresql";
  databaseName?: string;
  host?:         string;
  ssl?:          boolean;
  connected:     boolean;
  latencyMs?:    number;
  error?:        string;
};

export type DbSchemaInfo = {
  schema: string;
  tables: DbTableInfo[];
};

export type DbTableInfo = {
  schema:        string;
  name:          string;
  type:          "table" | "view" | "materialized_view" | "unknown";
  estimatedRows?: number | null;
};

export type DbColumnInfo = {
  name:          string;
  dataType:      string;
  isNullable:    boolean;
  defaultValue?: string | null;
  maxLength?:    number | null;
  isPrimaryKey?: boolean;
};

export type DbIndexInfo = {
  name:      string;
  columns:   string[];
  isUnique:  boolean;
  isPrimary: boolean;
};

export type DbTableDetail = {
  schema:        string;
  name:          string;
  columns:       DbColumnInfo[];
  indexes:       DbIndexInfo[];
  estimatedRows?: number | null;
};

export type DbQueryResult = {
  columns:    string[];
  rows:       Array<Record<string, unknown>>;
  rowCount:   number;
  durationMs: number;
  truncated:  boolean;
  query:      string;
};

// ── Internal constants ────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS  = 8_000;
const STATEMENT_TIMEOUT_S = 8;
const IDLE_TIMEOUT_MS     = 1_000;
const MAX_ROWS            = 500;
const CELL_MAX_BYTES      = 10 * 1024; // 10 KB
const DB_URL_KEYS         = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"] as const;

/** Identifier regex: letters/underscore start, then alphanumeric/_/$ */
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

function isSafeIdentifier(s: string): boolean {
  return IDENTIFIER_RE.test(s);
}

/** Quote a PostgreSQL identifier safely. */
function quoteIdent(s: string): string {
  // Double any existing double-quotes to escape them
  return '"' + s.replace(/"/g, '""') + '"';
}

// ── Fetch decrypted DATABASE_URL from project env vars ────────────────────────

export async function getProjectDatabaseUrl(
  projectId:   string,
  environment: string = "production",
): Promise<ActionResult<string>> {
  const env = environment.toLowerCase().trim();

  for (const key of DB_URL_KEYS) {
    const row = await db.projectEnvVar.findFirst({
      where:  { projectId, name: key, environment: env, isEnabled: true },
      select: { value: true },
    });
    if (!row) continue;

    try {
      const url = decryptEnvValue(row.value);
      if (url && url.trim()) {
        return { ok: true, data: url.trim() };
      }
    } catch (e) {
      return {
        ok:    false,
        error: `Failed to decrypt ${key}: ${e instanceof Error ? e.message : String(e)}`,
        code:  "DECRYPT_FAILED",
      };
    }
  }

  return {
    ok:    false,
    error: `No PostgreSQL DATABASE_URL found for environment "${env}". Add DATABASE_URL to the project's env vars.`,
    code:  "NO_DATABASE_URL",
  };
}

// ── Parse safe connection metadata from URL (no secrets exposed) ───────────────

function parseUrlMeta(url: string): { host?: string; databaseName?: string; ssl?: boolean } {
  try {
    const u    = new URL(url);
    const host = u.hostname || undefined;
    const db_  = u.pathname.replace(/^\//, "") || undefined;
    const ssl  = u.searchParams.get("sslmode") !== "disable";
    return { host, databaseName: db_, ssl };
  } catch {
    return {};
  }
}

// ── Create a short-lived Pool ─────────────────────────────────────────────────

function makePool(url: string): Pool {
  return new Pool({
    connectionString:  url,
    max:               2,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis:       IDLE_TIMEOUT_MS,
    ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
  });
}

async function withClient<T>(
  pool:    Pool,
  fn:      (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // Set statement_timeout for every query on this connection
    await client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_S}s'`);
    return await fn(client);
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// ── Sanitize a cell value for safe display ────────────────────────────────────

function sanitizeCell(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === "bigint")  return val.toString();
  if (val instanceof Date)      return val.toISOString();
  if (Buffer.isBuffer(val))     return `<binary ${val.length} bytes>`;

  if (typeof val === "object") {
    try {
      const s = JSON.stringify(val);
      if (s.length > CELL_MAX_BYTES) return s.slice(0, CELL_MAX_BYTES) + "…[truncated]";
      return s;
    } catch {
      return String(val);
    }
  }

  if (typeof val === "string") {
    if (Buffer.byteLength(val, "utf8") > CELL_MAX_BYTES) {
      // Slice safely
      let end = 0;
      let bytes = 0;
      for (const char of val) {
        bytes += Buffer.byteLength(char, "utf8");
        if (bytes > CELL_MAX_BYTES) break;
        end++;
      }
      return val.slice(0, end) + "…[truncated]";
    }
    return val;
  }

  return val;
}

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCell(v);
  }
  return out;
}

// ── Detect provider from URL ───────────────────────────────────────────────────

function detectProvider(url: string): "postgresql" | null {
  const lower = url.toLowerCase();
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) {
    return "postgresql";
  }
  return null;
}

// ── Test connection ───────────────────────────────────────────────────────────

export async function testProjectDbExplorerConnection(
  projectId:   string,
  environment: string = "production",
): Promise<ActionResult<DbExplorerConnectionInfo>> {
  const urlResult = await getProjectDatabaseUrl(projectId, environment);
  if (!urlResult.ok) {
    return {
      ok:   true,
      data: {
        provider:  "postgresql",
        connected: false,
        error:     urlResult.error,
      },
    };
  }

  const url      = urlResult.data;
  const provider = detectProvider(url);
  if (provider !== "postgresql") {
    return {
      ok:   true,
      data: {
        provider:  "postgresql",
        connected: false,
        error:     "Database explorer currently supports PostgreSQL DATABASE_URL values.",
      },
    };
  }

  const meta = parseUrlMeta(url);
  const pool = makePool(url);
  const t0   = Date.now();

  try {
    await withClient(pool, async (client) => {
      await client.query("SELECT 1");
    });
    return {
      ok:   true,
      data: {
        provider:    "postgresql",
        ...meta,
        connected:  true,
        latencyMs:  Date.now() - t0,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok:   true,
      data: {
        provider:  "postgresql",
        ...meta,
        connected: false,
        error:     msg.slice(0, 300),
      },
    };
  }
}

// ── List schemas + tables ─────────────────────────────────────────────────────

export async function listProjectDbSchemas(
  projectId:   string,
  environment: string = "production",
): Promise<ActionResult<DbSchemaInfo[]>> {
  const urlResult = await getProjectDatabaseUrl(projectId, environment);
  if (!urlResult.ok) return { ok: false, error: urlResult.error, code: urlResult.code };

  const url = urlResult.data;
  if (detectProvider(url) !== "postgresql") {
    return { ok: false, error: "Database explorer currently supports PostgreSQL DATABASE_URL values." };
  }

  const pool = makePool(url);

  try {
    const result = await withClient(pool, async (client) => {
      // List tables + views in non-system schemas
      const { rows } = await client.query<{
        table_schema:    string;
        table_name:      string;
        table_type:      string;
        reltuples:       string | null;
      }>(`
        SELECT
          t.table_schema,
          t.table_name,
          t.table_type,
          c.reltuples::bigint AS reltuples
        FROM information_schema.tables t
        LEFT JOIN pg_class c
          ON c.relname = t.table_name
          AND c.relnamespace = (
            SELECT oid FROM pg_namespace WHERE nspname = t.table_schema
          )
        WHERE
          t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND t.table_schema NOT LIKE 'pg_%'
        ORDER BY t.table_schema, t.table_name
      `);

      // Group by schema
      const map = new Map<string, DbTableInfo[]>();
      for (const row of rows) {
        const schema = row.table_schema;
        const type: DbTableInfo["type"] =
          row.table_type === "BASE TABLE"        ? "table"            :
          row.table_type === "VIEW"              ? "view"             :
          row.table_type === "MATERIALIZED VIEW" ? "materialized_view" :
          "unknown";

        const est = row.reltuples !== null ? parseInt(row.reltuples, 10) : null;

        if (!map.has(schema)) map.set(schema, []);
        map.get(schema)!.push({
          schema,
          name:          row.table_name,
          type,
          estimatedRows: est !== null && est >= 0 ? est : null,
        });
      }

      return Array.from(map.entries()).map(([schema, tables]) => ({ schema, tables }));
    });

    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[database-explorer] listProjectDbSchemas error:", msg);
    return { ok: false, error: msg.slice(0, 300), code: "QUERY_FAILED" };
  }
}

// ── Table detail (columns + indexes) ─────────────────────────────────────────

export async function getProjectDbTableDetail(input: {
  projectId:   string;
  environment?: string;
  schema:       string;
  table:        string;
}): Promise<ActionResult<DbTableDetail>> {
  const { projectId, environment = "production", schema, table } = input;

  if (!isSafeIdentifier(schema)) return { ok: false, error: `Invalid schema name "${schema}".` };
  if (!isSafeIdentifier(table))  return { ok: false, error: `Invalid table name "${table}".` };

  const urlResult = await getProjectDatabaseUrl(projectId, environment);
  if (!urlResult.ok) return { ok: false, error: urlResult.error, code: urlResult.code };

  const url = urlResult.data;
  if (detectProvider(url) !== "postgresql") {
    return { ok: false, error: "Database explorer currently supports PostgreSQL DATABASE_URL values." };
  }

  const pool = makePool(url);

  try {
    const detail = await withClient(pool, async (client) => {
      // ── Columns ────────────────────────────────────────────────────────────
      const { rows: colRows } = await client.query<{
        column_name:      string;
        udt_name:         string;
        is_nullable:      string;
        column_default:   string | null;
        character_maximum_length: string | null;
        is_pk:            string;
      }>(`
        SELECT
          c.column_name,
          c.udt_name,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          CASE
            WHEN kcu.column_name IS NOT NULL THEN 'YES'
            ELSE 'NO'
          END AS is_pk
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu
          ON kcu.table_schema = c.table_schema
          AND kcu.table_name  = c.table_name
          AND kcu.column_name = c.column_name
          AND EXISTS (
            SELECT 1
            FROM information_schema.table_constraints tc
            WHERE tc.constraint_schema = kcu.constraint_schema
              AND tc.constraint_name   = kcu.constraint_name
              AND tc.constraint_type   = 'PRIMARY KEY'
          )
        WHERE c.table_schema = $1
          AND c.table_name   = $2
        ORDER BY c.ordinal_position
      `, [schema, table]);

      const columns: DbColumnInfo[] = colRows.map((r) => ({
        name:         r.column_name,
        dataType:     r.udt_name,
        isNullable:   r.is_nullable === "YES",
        defaultValue: r.column_default,
        maxLength:    r.character_maximum_length !== null
          ? parseInt(r.character_maximum_length, 10)
          : null,
        isPrimaryKey: r.is_pk === "YES",
      }));

      // ── Indexes ────────────────────────────────────────────────────────────
      const { rows: idxRows } = await client.query<{
        indexname: string;
        indexdef:  string;
        indisunique: boolean;
        indisprimary: boolean;
      }>(`
        SELECT
          i.relname AS indexname,
          pg_get_indexdef(ix.indexrelid) AS indexdef,
          ix.indisunique,
          ix.indisprimary
        FROM pg_index ix
        JOIN pg_class i   ON i.oid    = ix.indexrelid
        JOIN pg_class t   ON t.oid    = ix.indrelid
        JOIN pg_namespace n ON n.oid  = t.relnamespace
        WHERE t.relname = $2
          AND n.nspname = $1
        ORDER BY i.relname
      `, [schema, table]);

      const indexes: DbIndexInfo[] = idxRows.map((r) => {
        // Parse column names from index definition (best-effort)
        const defMatch = r.indexdef.match(/\(([^)]+)\)/);
        const cols = defMatch
          ? defMatch[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
          : [];
        return {
          name:      r.indexname,
          columns:   cols,
          isUnique:  r.indisunique,
          isPrimary: r.indisprimary,
        };
      });

      // ── Estimated row count ────────────────────────────────────────────────
      const { rows: cntRows } = await client.query<{ reltuples: string }>(
        `SELECT reltuples::bigint AS reltuples FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema, table],
      );
      const estimatedRows = cntRows[0]
        ? parseInt(cntRows[0].reltuples, 10)
        : null;

      return {
        schema,
        name:    table,
        columns,
        indexes,
        estimatedRows: estimatedRows !== null && estimatedRows >= 0 ? estimatedRows : null,
      } satisfies DbTableDetail;
    });

    return { ok: true, data: detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[database-explorer] getProjectDbTableDetail error:", msg);
    return { ok: false, error: msg.slice(0, 300), code: "QUERY_FAILED" };
  }
}

// ── Sample rows ───────────────────────────────────────────────────────────────

export async function getProjectDbTableRows(input: {
  projectId:   string;
  environment?: string;
  schema:       string;
  table:        string;
  limit?:       number;
  offset?:      number;
}): Promise<ActionResult<DbQueryResult>> {
  const { projectId, environment = "production", schema, table, limit = 50, offset = 0 } = input;

  if (!isSafeIdentifier(schema)) return { ok: false, error: `Invalid schema name "${schema}".` };
  if (!isSafeIdentifier(table))  return { ok: false, error: `Invalid table name "${table}".` };

  const safeLimit  = Math.min(Math.max(1, limit),  MAX_ROWS);
  const safeOffset = Math.max(0, offset);

  const urlResult = await getProjectDatabaseUrl(projectId, environment);
  if (!urlResult.ok) return { ok: false, error: urlResult.error, code: urlResult.code };

  const url = urlResult.data;
  if (detectProvider(url) !== "postgresql") {
    return { ok: false, error: "Database explorer currently supports PostgreSQL DATABASE_URL values." };
  }

  const pool = makePool(url);
  const t0   = Date.now();

  try {
    const result = await withClient(pool, async (client) => {
      const q = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT $1 OFFSET $2`;
      const { rows, fields } = await client.query(q, [safeLimit, safeOffset]);

      const columns  = fields.map((f) => f.name);
      const safeRows = rows.map(sanitizeRow);

      return {
        columns,
        rows:       safeRows,
        rowCount:   rows.length,
        durationMs: Date.now() - t0,
        truncated:  rows.length >= safeLimit,
        query:      q,
      } satisfies DbQueryResult;
    });

    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[database-explorer] getProjectDbTableRows error:", msg);
    return { ok: false, error: msg.slice(0, 300), code: "QUERY_FAILED" };
  }
}

// ── Run read-only query ───────────────────────────────────────────────────────

export async function runProjectReadOnlyQuery(input: {
  projectId:   string;
  environment?: string;
  query:        string;
  limit?:       number;
}): Promise<ActionResult<DbQueryResult>> {
  const { projectId, environment = "production", query: rawQuery, limit = DEFAULT_LIMIT } = input;

  // ── SQL safety ─────────────────────────────────────────────────────────────
  const safety = validateReadOnlySql(rawQuery, limit);
  if (!safety.ok) {
    return { ok: false, error: safety.error, code: "SQL_BLOCKED" };
  }

  const safeQuery = safety.normalizedQuery;

  const urlResult = await getProjectDatabaseUrl(projectId, environment);
  if (!urlResult.ok) return { ok: false, error: urlResult.error, code: urlResult.code };

  const url = urlResult.data;
  if (detectProvider(url) !== "postgresql") {
    return { ok: false, error: "Database explorer currently supports PostgreSQL DATABASE_URL values." };
  }

  const pool = makePool(url);
  const t0   = Date.now();

  try {
    const result = await withClient(pool, async (client) => {
      const { rows, fields } = await client.query(safeQuery);

      const columns  = fields.map((f) => f.name);
      // Cap at MAX_ROWS even if the user sneaked a higher LIMIT past our validator
      const capped   = rows.slice(0, MAX_ROWS);
      const safeRows = capped.map(sanitizeRow);

      return {
        columns,
        rows:       safeRows,
        rowCount:   capped.length,
        durationMs: Date.now() - t0,
        truncated:  rows.length >= MAX_ROWS,
        query:      safeQuery,
      } satisfies DbQueryResult;
    });

    // Log action summary only — no rows, no secrets
    console.info(
      `[database-explorer] read-only query for project ${projectId} (env=${environment}): ` +
      `${result.rowCount} rows, ${result.durationMs}ms`,
    );

    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[database-explorer] runProjectReadOnlyQuery error:", msg);
    return { ok: false, error: msg.slice(0, 300), code: "QUERY_FAILED" };
  }
}

// Re-export for actions
export const DEFAULT_LIMIT = 100;
