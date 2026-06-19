"use server";

/**
 * app/actions/project-audit.ts
 *
 * Sprint 18: Server actions for the project audit log center.
 *
 * Security:
 *  - All actions enforce audit.view permission via requireProjectPermission.
 *  - Never returns secret values, raw tokens, env values, or DB rows.
 *  - Metadata stored in the DB is already sanitised at write time.
 *  - Page size is capped at 100 per request.
 *
 * Sprint 18 Hotfix:
 *  - NO type re-exports from this file. Client components must import
 *    DTO types directly from @/lib/audit/project-audit-types.
 *  - Only server action functions are exported from here.
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  listProjectAuditEvents,
  getProjectAuditEventDetail,
  listProjectAuditActors,
} from "@/lib/audit/project-audit";
import type {
  ProjectAuditEventDTO,
  AuditActor,
} from "@/lib/audit/project-audit-types";

// Allowed filter values — validated server-side before passing to the DB query
const VALID_CATEGORIES = [
  "auth", "team", "permissions", "files", "terminal", "git",
  "packages", "ai", "preview", "publishing", "rollback", "domains",
  "env", "database", "logs", "monitoring", "alerts", "settings", "system",
] as const;

const VALID_RESULTS = ["success", "failed", "denied", "skipped"] as const;

// ── Shared result type ─────────────────────────────────────────────────────────
// NOTE: ActionResult is defined here (not re-exported from a lib) so it is
// always a plain TypeScript type that never leaks into the runtime proxy.

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ── List audit events ──────────────────────────────────────────────────────────

type GetAuditEventsInput = {
  projectId: string;
  page?: number;
  pageSize?: number;
  category?: string;
  result?: string;
  actorUserId?: string;
  query?: string;
  from?: string; // ISO date string
  to?: string;   // ISO date string
};

type GetAuditEventsOutput = {
  events: ProjectAuditEventDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  actors: AuditActor[];
};

export async function getProjectAuditEventsAction(
  input: GetAuditEventsInput,
): Promise<ActionResult<GetAuditEventsOutput>> {
  const { projectId } = input;

  // Enforce audit.view permission
  const auth = await requireProjectPermission(projectId, "audit.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // Validate page/pageSize
  const page     = Math.max(1, Number(input.page)     || 1);
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 25));

  // Validate category
  const category =
    input.category && VALID_CATEGORIES.includes(input.category as never)
      ? input.category
      : undefined;

  // Validate result
  const result =
    input.result && VALID_RESULTS.includes(input.result as never)
      ? input.result
      : undefined;

  // Parse optional date range (ISO strings → Date objects)
  let from: Date | undefined;
  let to: Date | undefined;
  if (input.from) {
    const d = new Date(input.from);
    if (!isNaN(d.getTime())) from = d;
  }
  if (input.to) {
    const d = new Date(input.to);
    if (!isNaN(d.getTime())) to = d;
  }

  // Validate query length
  const query =
    input.query && input.query.trim().length > 0
      ? input.query.trim().slice(0, 100)
      : undefined;

  const [eventsResult, actors] = await Promise.all([
    listProjectAuditEvents({
      projectId,
      page,
      pageSize,
      category,
      result,
      actorUserId: input.actorUserId || undefined,
      query,
      from,
      to,
    }),
    listProjectAuditActors(projectId),
  ]);

  return {
    ok: true,
    data: {
      ...eventsResult,
      actors,
    },
  };
}

// ── Get event detail ───────────────────────────────────────────────────────────

export async function getProjectAuditEventDetailAction(input: {
  projectId: string;
  eventId: string;
}): Promise<ActionResult<ProjectAuditEventDTO>> {
  const { projectId, eventId } = input;

  const auth = await requireProjectPermission(projectId, "audit.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (!eventId || typeof eventId !== "string") {
    return { ok: false, error: "Invalid event ID.", code: "VALIDATION" };
  }

  const event = await getProjectAuditEventDetail({ projectId, eventId });
  if (!event) {
    return { ok: false, error: "Audit event not found.", code: "NOT_FOUND" };
  }

  return { ok: true, data: event };
}
