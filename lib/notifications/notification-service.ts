/**
 * lib/notifications/notification-service.ts
 *
 * Sprint 37: Core notification service.
 *
 * Safety rules:
 *  - notification title/body are plain text — no HTML injected
 *  - href must be an internal relative URL only (starts with "/" — no external URLs)
 *  - metadata sanitized before storage — no secrets
 *  - users can only read/dismiss their own notifications
 *  - notifyAdmins queries User.role — never reads env vars or tokens
 */

import { db }   from "@/lib/db";
import type {
  CreateNotificationInput,
  ListNotificationsFilter,
  ListNotificationsOutput,
  UserNotificationDTO,
} from "./notification-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCKED_META_KEYS = new Set([
  "password", "secret", "token", "key", "credential",
  "apiKey", "api_key", "privateKey", "private_key", "env", "hash",
]);

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (BLOCKED_META_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    }
  }
  return out;
}

function isInternalHref(href: string | undefined): boolean {
  if (!href) return true;
  return href.startsWith("/") && !href.startsWith("//");
}

function toDTO(
  row: {
    id:          string;
    userId:      string;
    projectId:   string | null;
    project?:    { name: string } | null;
    title:       string;
    body:        string | null;
    severity:    string;
    category:    string;
    sourceType:  string | null;
    sourceId:    string | null;
    href:        string | null;
    readAt:      Date | null;
    dismissedAt: Date | null;
    createdAt:   Date;
  },
): UserNotificationDTO {
  return {
    id:          row.id,
    userId:      row.userId,
    projectId:   row.projectId,
    projectName: row.project?.name ?? null,
    title:       row.title,
    body:        row.body,
    severity:    row.severity as UserNotificationDTO["severity"],
    category:    row.category as UserNotificationDTO["category"],
    sourceType:  row.sourceType,
    sourceId:    row.sourceId,
    href:        row.href,
    readAt:      row.readAt?.toISOString()      ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt:   row.createdAt.toISOString(),
  };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: string } | null> {
  try {
    const safeHref = isInternalHref(input.href) ? (input.href ?? null) : null;
    const safeMeta = input.metadata ? sanitizeMetadata(input.metadata) : undefined;

    const row = await db.userNotification.create({
      data: {
        userId:      input.userId,
        projectId:   input.projectId ?? null,
        title:       input.title.slice(0, 255),
        body:        input.body?.slice(0, 1000) ?? null,
        severity:    input.severity ?? "info",
        category:    input.category,
        sourceType:  input.sourceType ?? null,
        sourceId:    input.sourceId   ?? null,
        href:        safeHref,
        metadataJson: safeMeta as object | undefined,
      },
      select: { id: true },
    });
    return { id: row.id };
  } catch {
    return null;
  }
}

// ── Notify project admins ─────────────────────────────────────────────────────

export async function notifyProjectAdmins(
  projectId: string,
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  try {
    const members = await db.projectMember.findMany({
      where:  { projectId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
    });
    await Promise.all(
      members.map((m) => createNotification({ ...input, userId: m.userId, projectId })),
    );
  } catch {
    // Non-fatal
  }
}

// ── Notify all global admins/owners ──────────────────────────────────────────

export async function notifyAdmins(
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where:  { role: { in: ["OWNER", "ADMIN"] }, disabledAt: null },
      select: { id: true },
    });
    await Promise.all(
      admins.map((u) => createNotification({ ...input, userId: u.id })),
    );
  } catch {
    // Non-fatal
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listUserNotifications(
  userId: string,
  filters: ListNotificationsFilter = {},
): Promise<ListNotificationsOutput> {
  const {
    unreadOnly   = false,
    dismissed    = false,
    category,
    projectId,
    page         = 1,
    pageSize     = 20,
  } = filters;

  const where: Record<string, unknown> = { userId };

  if (unreadOnly)                   where.readAt      = null;
  if (!dismissed)                   where.dismissedAt = null;
  if (category)                     where.category    = category;
  if (projectId)                    where.projectId   = projectId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaWhere = where as any;

  const [rows, total, unreadCount] = await Promise.all([
    db.userNotification.findMany({
      where:   prismaWhere,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      include: { project: { select: { name: true } } },
    }),
    db.userNotification.count({ where: prismaWhere }),
    db.userNotification.count({ where: { userId, readAt: null, dismissedAt: null } }),
  ]);

  return {
    notifications: rows.map(toDTO),
    total,
    unreadCount,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── Unread count ──────────────────────────────────────────────────────────────

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    return await db.userNotification.count({
      where: { userId, readAt: null, dismissedAt: null },
    });
  } catch {
    return 0;
  }
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markNotificationRead(
  id: string,
  userId: string,
): Promise<boolean> {
  try {
    const result = await db.userNotification.updateMany({
      where: { id, userId, readAt: null },
      data:  { readAt: new Date() },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

// ── Mark all read ─────────────────────────────────────────────────────────────

export async function markAllNotificationsRead(userId: string): Promise<number> {
  try {
    const result = await db.userNotification.updateMany({
      where: { userId, readAt: null, dismissedAt: null },
      data:  { readAt: new Date() },
    });
    return result.count;
  } catch {
    return 0;
  }
}

// ── Dismiss ───────────────────────────────────────────────────────────────────

export async function dismissNotification(
  id: string,
  userId: string,
): Promise<boolean> {
  try {
    const result = await db.userNotification.updateMany({
      where: { id, userId, dismissedAt: null },
      data:  { readAt: new Date(), dismissedAt: new Date() },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}
