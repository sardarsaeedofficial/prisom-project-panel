/**
 * lib/projects/sql-safety.ts
 *
 * Sprint 12: Read-only SQL safety validator.
 *
 * Rules enforced:
 *  - Max 10 000 chars
 *  - Exactly one statement (no semicolons mid-query)
 *  - Only SELECT or WITH … SELECT
 *  - Blocked DML/DDL keywords
 *  - Blocked dangerous functions / system tables
 *  - LIMIT injection: if no LIMIT present, wrap in subquery with maxLimit
 *  - LIMIT reduction: if LIMIT > maxLimit, reduce to maxLimit
 *  - Default maxLimit = 100, absolute max = 500
 *
 * This validator never executes SQL — it only inspects the string.
 */

export type SqlSafetyResult =
  | { ok: true;  normalizedQuery: string; injectedLimit: boolean }
  | { ok: false; error: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SQL_LENGTH   = 10_000;
const DEFAULT_LIMIT    = 100;
const ABSOLUTE_MAX     = 500;

// ── Blocked keywords (whole-word match, case-insensitive) ──────────────────────

const BLOCKED_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
  "GRANT", "REVOKE", "MERGE", "CALL", "DO", "EXECUTE", "COPY", "VACUUM",
  "ANALYZE", "REINDEX", "REFRESH", "LISTEN", "NOTIFY", "SET", "RESET",
  "SHOW", "LOAD", "SECURITY", "EXTENSION",
];

// ── Blocked function names (case-insensitive identifier match) ─────────────────

const BLOCKED_FUNCTIONS = [
  "pg_sleep", "dblink", "lo_import", "lo_export",
  "pg_read_file", "pg_ls_dir", "pg_stat_file",
];

// ── Blocked system tables ──────────────────────────────────────────────────────

const BLOCKED_TABLES = ["pg_authid", "pg_shadow"];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip line comments (--) and block comments from a SQL string (for keyword scanning only). */
function stripComments(sql: string): string {
  // Remove /* ... */ block comments
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove -- line comments
  result = result.replace(/--[^\n]*/g, " ");
  return result;
}

/** Build a whole-word regex for a keyword. */
function kwRegex(word: string): RegExp {
  return new RegExp(`(?<![a-zA-Z0-9_$])${word}(?![a-zA-Z0-9_$])`, "i");
}

// ── Main validator ────────────────────────────────────────────────────────────

export function validateReadOnlySql(
  rawQuery: string,
  maxLimit: number = DEFAULT_LIMIT,
): SqlSafetyResult {
  // ── Clamp maxLimit ─────────────────────────────────────────────────────────
  const limit = Math.min(Math.max(1, maxLimit), ABSOLUTE_MAX);

  // ── Basic hygiene ──────────────────────────────────────────────────────────
  const query = rawQuery.trim();

  if (!query) {
    return { ok: false, error: "Query is empty." };
  }

  if (query.length > MAX_SQL_LENGTH) {
    return { ok: false, error: `Query is too long (${query.length} chars, max ${MAX_SQL_LENGTH}).` };
  }

  // ── Semicolon check ────────────────────────────────────────────────────────
  // Allow at most one semicolon, and only at the very end.
  const semiStripped = query.replace(/;$/, "");
  if (semiStripped.includes(";")) {
    return { ok: false, error: "Multiple SQL statements are not allowed." };
  }

  // Normalised query without trailing semicolon
  const normalized = semiStripped.trim();

  // ── Strip comments for keyword scanning ───────────────────────────────────
  const stripped = stripComments(normalized);

  // ── Must start with SELECT or WITH ────────────────────────────────────────
  const firstToken = stripped.trimStart().slice(0, 10).toUpperCase();
  if (!firstToken.startsWith("SELECT") && !firstToken.startsWith("WITH")) {
    return { ok: false, error: "Only SELECT (or WITH … SELECT) queries are allowed." };
  }

  // ── For WITH queries: the final SELECT keyword must exist, and WITH must
  //    not contain DML CTEs ──────────────────────────────────────────────────
  // We check this implicitly via the blocked-keyword scan below (DELETE FROM, etc.)

  // ── Blocked keywords ───────────────────────────────────────────────────────
  for (const kw of BLOCKED_KEYWORDS) {
    if (kwRegex(kw).test(stripped)) {
      return { ok: false, error: `Query contains blocked keyword: ${kw}.` };
    }
  }

  // ── Blocked functions ──────────────────────────────────────────────────────
  for (const fn of BLOCKED_FUNCTIONS) {
    // match as identifier (may be followed by whitespace or `(`)
    if (new RegExp(`(?<![a-zA-Z0-9_$])${fn}\\s*\\(`, "i").test(stripped)) {
      return { ok: false, error: `Query calls blocked function: ${fn}.` };
    }
  }

  // ── Blocked system tables ──────────────────────────────────────────────────
  for (const tbl of BLOCKED_TABLES) {
    if (kwRegex(tbl).test(stripped)) {
      return { ok: false, error: `Query accesses blocked system table: ${tbl}.` };
    }
  }

  // ── LIMIT check ───────────────────────────────────────────────────────────
  // Regex to find LIMIT <N> at the end of a simple query or subquery
  const limitMatch = /\blimit\s+(\d+)\b/i.exec(stripped);

  if (!limitMatch) {
    // Inject LIMIT via subquery wrapper
    const wrapped = `SELECT * FROM (${normalized}) AS prisom_safe_query LIMIT ${limit}`;
    return { ok: true, normalizedQuery: wrapped, injectedLimit: true };
  }

  const existingLimit = parseInt(limitMatch[1], 10);
  if (existingLimit > limit) {
    // Reduce limit: replace just the number in the original LIMIT clause
    const reduced = normalized.replace(
      /\blimit\s+\d+\b/i,
      `LIMIT ${limit}`,
    );
    return { ok: true, normalizedQuery: reduced, injectedLimit: false };
  }

  return { ok: true, normalizedQuery: normalized, injectedLimit: false };
}

// ── Built-in test suite (run in development with: ts-node lib/projects/sql-safety.ts) ──

if (process.env.SQL_SAFETY_TEST === "1") {
  const mustBlock = [
    "DROP TABLE users",
    "DELETE FROM users",
    "UPDATE users SET role='admin'",
    "INSERT INTO users VALUES (1)",
    "ALTER TABLE users ADD COLUMN test text",
    "CREATE TABLE test(id int)",
    "TRUNCATE users",
    "COPY users TO '/tmp/users.csv'",
    "SELECT pg_sleep(10)",
    "SELECT * FROM pg_authid",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT * FROM users; DROP TABLE users;",
    "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
    "SELECT 1; SELECT 2",
  ];
  const mustPass = [
    "SELECT 1",
    "SELECT * FROM users LIMIT 50",
    "SELECT COUNT(*) FROM users",
    "WITH recent AS (SELECT * FROM users LIMIT 10) SELECT * FROM recent",
    'SELECT * FROM "User" LIMIT 50',
  ];

  let allOk = true;

  for (const sql of mustBlock) {
    const r = validateReadOnlySql(sql);
    if (r.ok) {
      console.error(`[FAIL] Should have been BLOCKED: ${sql}`);
      allOk = false;
    } else {
      console.log(`[PASS] Blocked: ${sql.slice(0, 60)} → ${r.error}`);
    }
  }

  for (const sql of mustPass) {
    const r = validateReadOnlySql(sql);
    if (!r.ok) {
      console.error(`[FAIL] Should have PASSED: ${sql} → ${r.error}`);
      allOk = false;
    } else {
      console.log(`[PASS] Allowed: ${sql.slice(0, 60)} (injected=${r.injectedLimit})`);
    }
  }

  console.log(allOk ? "\n✅ All sql-safety tests passed." : "\n❌ Some tests failed.");
}
