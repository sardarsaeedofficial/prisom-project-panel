"use server";

/**
 * app/actions/notifications.ts
 *
 * Sprint 37: Server actions for the notifications center.
 *
 * Safety rules:
 *  - All actions require an authenticated session (getCurrentUser)
 *  - Users can only read/dismiss their own notifications
 *  - No secrets returned — notifications are sanitized at write time
 */

import { getCurrentUser }           from "@/lib/current-workspace";
import {
  listUserNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
} from "@/lib/notifications/notification-service";
import type {
  ListNotificationsFilter,
  ListNotificationsOutput,
} from "@/lib/notifications/notification-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveUserId(): Promise<string> {
  const user = await getCurrentUser();
  return user.id;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listNotificationsAction(
  filter: ListNotificationsFilter = {},
): Promise<{ ok: true; result: ListNotificationsOutput } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId();
    const result = await listUserNotifications(userId, filter);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load notifications" };
  }
}

// ── Unread count ──────────────────────────────────────────────────────────────

export async function getUnreadCountAction(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    const userId = await resolveUserId();
    const count  = await getUnreadNotificationCount(userId);
    return { ok: true, count };
  } catch {
    return { ok: true, count: 0 };
  }
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markNotificationReadAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId();
    if (!id || typeof id !== "string") return { ok: false, error: "Invalid notification ID" };
    await markNotificationRead(id, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to mark as read" };
  }
}

// ── Mark all read ─────────────────────────────────────────────────────────────

export async function markAllReadAction(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    const userId = await resolveUserId();
    const count  = await markAllNotificationsRead(userId);
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to mark all as read" };
  }
}

// ── Dismiss ───────────────────────────────────────────────────────────────────

export async function dismissNotificationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId();
    if (!id || typeof id !== "string") return { ok: false, error: "Invalid notification ID" };
    await dismissNotification(id, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to dismiss notification" };
  }
}
