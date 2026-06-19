/**
 * lib/audit/project-audit.ts
 *
 * Sprint 18: Core audit log library.
 *
 * Key design decisions:
 *  - writeProjectAuditEvent NEVER throws — failures are console-warned and swallowed.
 *  - writeProjectAuditEvent does NOT call requireProjectPermission (avoids recursion).
 *  - listProjectAuditEvents / getProjectAuditEventDetail are read-only helpers;
 *    permission enforcement happens in the server action layer.
 *  - Metadata is always sanitised through sanitizeAuditMetadata before storage.
 *  - Raw env values, tokens, DB rows, and terminal output are never stored.
 */

import { db } from "@/lib/db";
import { sanitizeAuditMetadata } from "@/lib/audit/audit-sanitize";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectAuditCategory =
  | "auth"
  | "team"
  | "permissions"
  | "files"
  | "terminal"
  | "git"
  | "packages"
  | "ai"
  | "preview"
  | "publishing"
  | "rollback"
  | "domains"
  | "env"
  | "database"
  | "logs"
  | "monitoring"
  | "alerts"
  | "settings"
  | "system";

export type ProjectAuditResult = "success" | "failed" | "denied" | "skipped";

export type WriteProjectAuditEventInput = {
  projectId: string;

  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  actorRole?: string | null;

  action: string;
  category: ProjectAuditCategory;
  result?: ProjectAuditResult;

  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;

  summary: string;
  metadata?: Record<string, unknown>;

  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ProjectAuditEventDTO = {
  id: string;
  projectId: string;

  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;

  action: string;
  category: string;
  result: string;

  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;

  summary: string;
  metadata: Record<string, unknown> | null;

  ipAddress: string | null;
  userAgent: string | null;

  createdAt: string; // ISO
};

// ── Write (fire-and-forget safe) ──────────────────────────────────────────────

/**
 * Write a single audit event.
 *
 * NEVER throws — errors are logged to console and swallowed so that a failed
 * audit write never interrupts the primary user action.
 */
export async function writeProjectAuditEvent(
  input: WriteProjectAuditEventInput,
): Promise<void> {
  try {
    const sanitizedMetadata = input.metadata
      ? sanitizeAuditMetadata(input.metadata)
      : undefined;

    await db.projectAuditEvent.create({
      data: {
        projectId: input.projectId,
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorName: input.actorName ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action.slice(0, 100),
        category: input.category.slice(0, 50),
        result: (input.result ?? "success").slice(0, 20),
        targetType: input.targetType?.slice(0, 50) ?? null,
        targetId: input.targetId?.slice(0, 100) ?? null,
        targetLabel: input.targetLabel?.slice(0, 200) ?? null,
        summary: input.summary.slice(0, 500),
        metadata: (sanitizedMetadata as object) ?? undefined,
        ipAddress: input.ipAddress?.slice(0, 45) ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (error) {
    // Non-fatal — log and continue
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("[audit] Failed to write ProjectAuditEvent:", msg);
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

export type ListAuditEventsInput = {
  projectId: string;
  page?: number;
  pageSize?: number;
  category?: string;
  result?: string;
  actorUserId?: string;
  query?: string;
  from?: Date;
  to?: Date;
};

export type ListAuditEventsOutput = {
  events: ProjectAuditEventDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const VALID_CATEGORIES: ProjectAuditCategory[] = [
  "auth", "team", "permissions", "files", "terminal", "git",
  "packages", "ai", "preview", "publishing", "rollback", "domains",
  "env", "database", "logs", "monitoring", "alerts", "settings", "system",
];

const VALID_RESULTS: ProjectAuditResult[] = [
  "success", "failed", "denied", "skipped",
];

export async function listProjectAuditEvents(
  input: ListAuditEventsInput,
): Promise<ListAuditEventsOutput> {
  const {
    projectId,
    page = 1,
    pageSize = 25,
    category,
    result,
    actorUserId,
    query,
    from,
    to,
  } = input;

  // Sanitise pagination
  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const safePage     = Math.max(page, 1);
  const skip         = (safePage - 1) * safePageSize;

  // Build where clause
  type WhereClause = {
    projectId: string;
    category?: string;
    result?: string;
    actorUserId?: string;
    createdAt?: { gte?: Date; lte?: Date };
    OR?: Array<{ action?: { contains: string; mode: "insensitive" }; summary?: { contains: string; mode: "insensitive" }; actorName?: { contains: string; mode: "insensitive" } }>;
  };

  const where: WhereClause = { projectId };

  if (category && VALID_CATEGORIES.includes(category as ProjectAuditCategory)) {
    where.category = category;
  }
  if (result && VALID_RESULTS.includes(result as ProjectAuditResult)) {
    where.result = result;
  }
  if (actorUserId) {
    where.actorUserId = actorUserId;
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to)   where.createdAt.lte = to;
  }
  if (query && query.trim().length > 0) {
    const q = query.trim().slice(0, 100);
    where.OR = [
      { action:    { contains: q, mode: "insensitive" } },
      { summary:   { contains: q, mode: "insensitive" } },
      { actorName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [events, total] = await Promise.all([
    db.projectAuditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safePageSize,
    }),
    db.projectAuditEvent.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / safePageSize));

  return {
    events: events.map(rowToDTO),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getProjectAuditEventDetail(input: {
  projectId: string;
  eventId: string;
}): Promise<ProjectAuditEventDTO | null> {
  const row = await db.projectAuditEvent.findUnique({
    where: { id: input.eventId },
  });
  if (!row || row.projectId !== input.projectId) return null;
  return rowToDTO(row);
}

// ── DTO mapper ────────────────────────────────────────────────────────────────

function rowToDTO(row: {
  id: string;
  projectId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  category: string;
  result: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}): ProjectAuditEventDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    category: row.category,
    result: row.result,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    summary: row.summary,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Convenience: list unique actors for a project ─────────────────────────────

export type AuditActor = {
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

export async function listProjectAuditActors(
  projectId: string,
): Promise<AuditActor[]> {
  const rows = await db.projectAuditEvent.findMany({
    where: { projectId, actorUserId: { not: null } },
    select: { actorUserId: true, actorName: true, actorEmail: true },
    distinct: ["actorUserId"],
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
  }));
}
