"use server";

/**
 * app/actions/project-logs.ts
 *
 * Sprint 28: Server actions for the Logs Center.
 *
 * Safety guarantees:
 *  - Every action verifies project ownership (IDOR prevention)
 *  - Source IDs are validated inside readLogSource (never passed as raw paths)
 *  - PM2 process names are validated against project slug pattern before any
 *    shell command is run (see lib/logs/project-log-reader.ts)
 *  - All log text is redacted before leaving the server
 *  - Limit of 500 lines / 256 KB enforced in the reader
 *  - Search is DB-only (no file system grep)
 */

import { db }                      from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { discoverLogSources }       from "@/lib/logs/project-log-sources";
import { readLogSource }            from "@/lib/logs/project-log-reader";
import { redactLogText }            from "@/lib/logs/project-log-redaction";
import type {
  ListLogSourcesResult,
  ReadLogSourceResult,
  SearchLogsResult,
  LogLine,
}                                   from "@/lib/logs/project-log-types";

// ── Ownership guard ───────────────────────────────────────────────────────────

/** Returns { id, slug } or null if user lacks access. */
async function verifyLogsAccess(projectId: string) {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return null;
  return db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
}

// ── listLogSourcesAction ──────────────────────────────────────────────────────

/**
 * Discovers all available log sources for the project and returns them as a
 * stable list of descriptors for the sidebar.
 */
export async function listLogSourcesAction(
  projectId: string,
): Promise<ListLogSourcesResult> {
  const project = await verifyLogsAccess(projectId);
  if (!project) return { ok: false, error: "Access denied." };

  try {
    const sources = await discoverLogSources(projectId);
    return { ok: true, sources };
  } catch (err) {
    console.error("[listLogSourcesAction]", err);
    return { ok: false, error: "Failed to discover log sources." };
  }
}

// ── readLogSourceAction ───────────────────────────────────────────────────────

/**
 * Reads log content for a given source ID.
 *
 * The `sourceId` is an opaque token (e.g. "pm2_app", "operation:cuid",
 * "deployment:cuid") validated server-side.  The client never supplies raw
 * paths or PM2 process names.
 */
export async function readLogSourceAction(
  projectId: string,
  sourceId:  string,
): Promise<ReadLogSourceResult> {
  const project = await verifyLogsAccess(projectId);
  if (!project) return { ok: false, error: "Access denied." };

  // Basic sanity: sourceId must be a non-empty string without path separators
  if (!sourceId || /[/\\]/.test(sourceId)) {
    return { ok: false, error: "Invalid source ID." };
  }

  try {
    return await readLogSource(project.id, project.slug, sourceId);
  } catch (err) {
    console.error("[readLogSourceAction]", err);
    return { ok: false, error: "Failed to read log source." };
  }
}

// ── searchLogsAction ──────────────────────────────────────────────────────────

/**
 * Full-text search across the ProjectLog table for the given project.
 *
 * The search is DB-only (uses `contains`); no file-system grep is involved.
 * Results are capped at 200 rows and all text is redacted.
 */
export async function searchLogsAction(
  projectId: string,
  query:     string,
): Promise<SearchLogsResult> {
  const project = await verifyLogsAccess(projectId);
  if (!project) return { ok: false, error: "Access denied." };

  const trimmed = query.trim();
  if (!trimmed) return { ok: true, lines: [] };
  if (trimmed.length < 2)  return { ok: false, error: "Search query too short." };
  if (trimmed.length > 200) return { ok: false, error: "Search query too long." };

  try {
    const rows = await db.projectLog.findMany({
      where: {
        projectId,
        message: { contains: trimmed, mode: "insensitive" },
      },
      orderBy: { timestamp: "desc" },
      take:    200,
      select:  { timestamp: true, level: true, source: true, message: true },
    });

    const lines: LogLine[] = rows.map((row) => ({
      ts:     row.timestamp.toISOString(),
      level:  row.level as string,
      source: row.source as string,
      text:   redactLogText(row.message),
    }));

    return { ok: true, lines };
  } catch (err) {
    console.error("[searchLogsAction]", err);
    return { ok: false, error: "Search failed." };
  }
}

// ── getRawLogsForDownload ─────────────────────────────────────────────────────

/**
 * Server-side helper called by the download route handler.
 * Returns a plain-text string (already redacted) for the given source.
 *
 * Not exported as a server action — used only by the route handler which runs
 * on the server and can import this directly.
 */
export async function getRawLogsForDownload(
  projectId: string,
  sourceId:  string,
): Promise<{ ok: true; text: string; filename: string } | { ok: false; error: string }> {
  const project = await verifyLogsAccess(projectId);
  if (!project) return { ok: false, error: "Access denied." };

  if (!sourceId || /[/\\]/.test(sourceId)) {
    return { ok: false, error: "Invalid source ID." };
  }

  const result = await readLogSource(project.id, project.slug, sourceId);
  if (!result.ok) return result;

  const text = result.lines
    .map((l) => {
      const parts: string[] = [];
      if (l.ts)     parts.push(l.ts);
      if (l.level)  parts.push(`[${l.level}]`);
      if (l.source) parts.push(`[${l.source}]`);
      parts.push(l.text);
      return parts.join(" ");
    })
    .join("\n");

  // Build a safe filename from the sourceId
  const safeSource = sourceId.replace(/[^a-z0-9_:-]/gi, "_").slice(0, 60);
  const filename   = `logs-${project.slug}-${safeSource}-${Date.now()}.txt`;

  return { ok: true, text, filename };
}
