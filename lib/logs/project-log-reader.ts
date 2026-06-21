/**
 * lib/logs/project-log-reader.ts
 *
 * Sprint 28: Reads log content for a given project + source ID.
 *
 * SAFETY INVARIANTS (must never be violated):
 *  - PM2 process names are validated against an allowlist: must start with
 *    "project-<slug>" exactly, match [a-z0-9-]+ only, and not be a reserved
 *    system process (prisom-manager, prisom-backend, etc.).
 *  - Source IDs are parsed and validated before any DB or shell access.
 *  - All returned text is passed through redactLogText() before leaving.
 *  - Maximum 500 lines / 256 KB per source to cap memory usage.
 *  - No path input from client — source IDs reference opaque tokens only.
 */

import { db }                                from "@/lib/db";
import { getPm2AppLogs }                     from "@/lib/projects/project-deploy-runner";
import { redactLogText }                     from "./project-log-redaction";
import type { LogLine, ReadLogSourceResult } from "./project-log-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LINES    = 500;
const MAX_BYTES    = 256 * 1024; // 256 KB

/** PM2 process names that are NEVER allowed, regardless of prefix. */
const BLOCKED_PM2_NAMES = new Set([
  "prisom-projects",
  "prisom-manager",
  "prisom-backend",
  "prisom-panel",
]);

// ── PM2 name safety guard ─────────────────────────────────────────────────────

/**
 * Returns true iff `pm2Name` is a valid process name belonging to `projectSlug`.
 *
 * Allowed forms:
 *   project-<slug>           (main app)
 *   project-<slug>-<suffix>  (service sub-process)
 *
 * The slug and suffix must match [a-z0-9][a-z0-9-]* (no upper case, no dots,
 * no slashes, no spaces).
 */
function validatePm2Name(pm2Name: string, projectSlug: string): boolean {
  // Hard block system processes regardless
  if (BLOCKED_PM2_NAMES.has(pm2Name)) return false;
  for (const blocked of BLOCKED_PM2_NAMES) {
    if (pm2Name.startsWith(`${blocked}-`)) return false;
  }

  // Must conform to the safe character set
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pm2Name)) return false;

  // Must be exactly "project-<slug>" or start with "project-<slug>-"
  const prefix = `project-${projectSlug}`;
  if (pm2Name !== prefix && !pm2Name.startsWith(`${prefix}-`)) return false;

  return true;
}

// ── Line parsing helpers ──────────────────────────────────────────────────────

/** Parse a single raw PM2 log line into a LogLine. */
function parsePm2Line(raw: string): LogLine {
  // PM2 prefixes lines with e.g.: "project-myapp  | 2024-01-01T12:00:00.000Z: message"
  // or timestamp only: "2024-01-01T12:00:00.000Z: message"
  // We strip the PM2 process prefix and keep the rest.
  const withoutPrefix = raw.replace(/^[^\|]+\|\s*/, "").trimStart();

  // Try to pull out an ISO-ish timestamp from the front
  const tsMatch = withoutPrefix.match(/^(\d{4}-\d{2}-\d{2}T[\d:.Z+\-]+):\s*/);
  if (tsMatch) {
    return {
      ts:   tsMatch[1],
      text: withoutPrefix.slice(tsMatch[0].length),
    };
  }

  return { text: withoutPrefix || raw };
}

/** Detect a rough log level keyword in a text line. */
function inferLevel(text: string): string | undefined {
  const u = text.toUpperCase();
  if (u.includes("FATAL"))                return "FATAL";
  if (u.includes("ERROR") || u.includes("ERR ") || u.includes(" ERR:")) return "ERROR";
  if (u.includes("WARN"))                 return "WARN";
  if (u.includes("DEBUG"))               return "DEBUG";
  if (u.includes("INFO"))                return "INFO";
  return undefined;
}

// ── PM2 source reader ─────────────────────────────────────────────────────────

async function readPm2Source(
  pm2Name: string,
  projectSlug: string,
  sourceLabel: string,
): Promise<ReadLogSourceResult> {
  if (!validatePm2Name(pm2Name, projectSlug)) {
    return { ok: false, error: "Invalid or unauthorized PM2 process name." };
  }

  let raw: string;
  try {
    raw = await getPm2AppLogs(pm2Name, MAX_LINES);
  } catch {
    // PM2 process doesn't exist or pm2 not available — not a crash
    return { ok: true, lines: [], truncated: false, totalBytes: 0 };
  }

  const totalBytes = Buffer.byteLength(raw, "utf8");
  const truncated  = totalBytes >= MAX_BYTES;
  const text       = truncated ? raw.slice(0, MAX_BYTES) : raw;
  // redactLogText is already applied inside getPm2AppLogs (via sanitizeOutput),
  // but we apply it again here to cover the extra patterns in project-log-redaction.
  const redacted   = redactLogText(text);

  const lines: LogLine[] = redacted
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const parsed = parsePm2Line(l);
      return {
        ...parsed,
        source: sourceLabel,
        level:  inferLevel(parsed.text),
      };
    });

  return { ok: true, lines, truncated, totalBytes };
}

// ── DB log source reader ──────────────────────────────────────────────────────

async function readDbLogSource(projectId: string): Promise<ReadLogSourceResult> {
  const rows = await db.projectLog.findMany({
    where:   { projectId },
    orderBy: { timestamp: "desc" },
    take:    MAX_LINES,
  });

  // Reverse so oldest is first (chronological display)
  rows.reverse();

  const lines: LogLine[] = rows.map((row) => ({
    ts:     row.timestamp.toISOString(),
    level:  row.level as string,
    source: row.source as string,
    text:   redactLogText(row.message),
  }));

  return { ok: true, lines, truncated: rows.length === MAX_LINES, totalBytes: 0 };
}

// ── Operation log reader ──────────────────────────────────────────────────────

async function readOperationSource(
  operationId: string,
  projectId: string,
): Promise<ReadLogSourceResult> {
  const op = await db.projectOperation.findFirst({
    where:  { id: operationId, projectId },
    select: { meta: true, operationType: true, title: true },
  });
  if (!op) return { ok: false, error: "Operation not found." };

  const meta = op.meta as Record<string, unknown> | null;
  if (!meta) {
    return { ok: true, lines: [], truncated: false, totalBytes: 0 };
  }

  // Accept meta.log (string[]), meta.output (string), or meta.lines (string[])
  let rawLines: string[] = [];
  if (Array.isArray(meta.log)) {
    rawLines = (meta.log as unknown[]).filter((l): l is string => typeof l === "string");
  } else if (typeof meta.log === "string") {
    rawLines = meta.log.split("\n");
  } else if (Array.isArray(meta.output)) {
    rawLines = (meta.output as unknown[]).filter((l): l is string => typeof l === "string");
  } else if (typeof meta.output === "string") {
    rawLines = meta.output.split("\n");
  } else if (Array.isArray(meta.lines)) {
    rawLines = (meta.lines as unknown[]).filter((l): l is string => typeof l === "string");
  }

  const truncated = rawLines.length > MAX_LINES;
  const trimmed   = truncated ? rawLines.slice(-MAX_LINES) : rawLines;

  const lines: LogLine[] = trimmed
    .filter((l) => l.trim().length > 0)
    .map((l) => ({
      source: op.operationType,
      level:  inferLevel(l),
      text:   redactLogText(l),
    }));

  return { ok: true, lines, truncated, totalBytes: 0 };
}

// ── Deployment log reader ─────────────────────────────────────────────────────

async function readDeploymentSource(
  deploymentId: string,
  projectId: string,
): Promise<ReadLogSourceResult> {
  const dep = await db.deployment.findFirst({
    where:  { id: deploymentId, projectId },
    select: { metadata: true, status: true },
  });
  if (!dep) return { ok: false, error: "Deployment not found." };

  const meta = dep.metadata as Record<string, unknown> | null;
  if (!meta) {
    return { ok: true, lines: [], truncated: false, totalBytes: 0 };
  }

  let rawLines: string[] = [];
  if (Array.isArray(meta.output)) {
    rawLines = (meta.output as unknown[]).filter((l): l is string => typeof l === "string");
  } else if (typeof meta.output === "string") {
    rawLines = meta.output.split("\n");
  } else if (Array.isArray(meta.log)) {
    rawLines = (meta.log as unknown[]).filter((l): l is string => typeof l === "string");
  } else if (typeof meta.log === "string") {
    rawLines = meta.log.split("\n");
  } else if (Array.isArray(meta.lines)) {
    rawLines = (meta.lines as unknown[]).filter((l): l is string => typeof l === "string");
  }

  const truncated = rawLines.length > MAX_LINES;
  const trimmed   = truncated ? rawLines.slice(-MAX_LINES) : rawLines;

  const lines: LogLine[] = trimmed
    .filter((l) => l.trim().length > 0)
    .map((l) => ({
      source: "DEPLOY",
      level:  inferLevel(l),
      text:   redactLogText(l),
    }));

  return { ok: true, lines, truncated, totalBytes: 0 };
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Reads log content for the given `sourceId` belonging to `projectId`.
 *
 * `projectSlug` is required for PM2 process name validation — it must come from
 * the DB (not from the client) to prevent spoofing.
 */
export async function readLogSource(
  projectId:   string,
  projectSlug: string,
  sourceId:    string,
): Promise<ReadLogSourceResult> {
  // ── pm2_app ────────────────────────────────────────────────────────────────
  if (sourceId === "pm2_app") {
    const cfg = await db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { pm2Name: true },
    });
    if (!cfg?.pm2Name) {
      return { ok: false, error: "No deployment configuration found." };
    }
    return readPm2Source(cfg.pm2Name, projectSlug, "APP");
  }

  // ── pm2_service:<serviceId> ───────────────────────────────────────────────
  if (sourceId.startsWith("pm2_service:")) {
    const serviceId = sourceId.slice("pm2_service:".length);
    if (!serviceId) return { ok: false, error: "Invalid service source ID." };

    const svc = await db.projectService.findFirst({
      where:  { id: serviceId, projectId },
      select: { slug: true, name: true },
    });
    if (!svc) return { ok: false, error: "Service not found." };

    // Build the pm2Name server-side; never trust the client to supply it.
    const { buildServicePm2Name } = await import("@/lib/projects/multi-service-runner");
    const pm2Name = buildServicePm2Name(projectSlug, svc.slug);
    return readPm2Source(pm2Name, projectSlug, svc.name);
  }

  // ── db_logs ────────────────────────────────────────────────────────────────
  if (sourceId === "db_logs") {
    return readDbLogSource(projectId);
  }

  // ── operation:<id> ────────────────────────────────────────────────────────
  if (sourceId.startsWith("operation:")) {
    const operationId = sourceId.slice("operation:".length);
    if (!operationId) return { ok: false, error: "Invalid operation source ID." };
    return readOperationSource(operationId, projectId);
  }

  // ── deployment:<id> ──────────────────────────────────────────────────────
  if (sourceId.startsWith("deployment:")) {
    const deploymentId = sourceId.slice("deployment:".length);
    if (!deploymentId) return { ok: false, error: "Invalid deployment source ID." };
    return readDeploymentSource(deploymentId, projectId);
  }

  return { ok: false, error: "Unknown log source." };
}
