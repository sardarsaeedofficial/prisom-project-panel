/**
 * lib/logs/project-log-types.ts
 *
 * Sprint 28: Shared types for the Logs Center.
 *
 * LogSourceKind enumerates every category of log the panel can display.
 * LogSource is a discovered source descriptor returned by listLogSources.
 * LogLine is a single parsed, redacted line for display in the viewer.
 */

// ── Source kinds ──────────────────────────────────────────────────────────────

export type LogSourceKind =
  | "pm2_app"      // PM2 stdout/stderr for the main project process
  | "pm2_service"  // PM2 stdout/stderr for a named multi-service process
  | "db_logs"      // ProjectLog table rows (structured, level+source)
  | "operation"    // Operation log lines stored in ProjectOperation.meta.log
  | "deployment";  // Deployment-level metadata / output log

// ── Source descriptor ─────────────────────────────────────────────────────────

export type LogSource = {
  /** Stable unique key used to request the source; never sent as a raw path. */
  id: string;
  kind: LogSourceKind;
  /** Human-readable label shown in the sidebar. */
  label: string;
  /** Secondary context line (e.g. pm2 process name, operation type+date). */
  subLabel?: string;
  /** When false the source exists but currently cannot be read (no PM2 process, etc.). */
  available: boolean;

  // Kind-specific metadata (used server-side only; safe to pass to client)
  pm2Name?: string;
  operationId?: string;
  deploymentId?: string;
  serviceId?: string;
  serviceSlug?: string;
};

// ── Individual log line ───────────────────────────────────────────────────────

export type LogLine = {
  /** ISO string or raw PM2 timestamp prefix — may be undefined for unstructured output. */
  ts?: string;
  /** Log level tag for colour-coding ("INFO", "WARN", "ERROR", "DEBUG", "FATAL"). */
  level?: string;
  /** Source label (e.g. "APP", "BUILD", "pm2", operation type). */
  source?: string;
  /** The display text — always redacted before leaving the server. */
  text: string;
};

// ── Action return shapes ──────────────────────────────────────────────────────

export type ListLogSourcesResult =
  | { ok: true;  sources: LogSource[] }
  | { ok: false; error: string };

export type ReadLogSourceResult =
  | { ok: true;  lines: LogLine[]; truncated: boolean; totalBytes: number }
  | { ok: false; error: string };

export type SearchLogsResult =
  | { ok: true;  lines: LogLine[] }
  | { ok: false; error: string };
