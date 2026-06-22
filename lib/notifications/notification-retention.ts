/**
 * lib/notifications/notification-retention.ts
 *
 * Sprint 37: Clean up old notification rows per retention policy.
 *
 * Policy:
 *  - Keep all unread (readAt = null, dismissedAt = null)
 *  - Dismiss read notifications older than 90 days (set dismissedAt if not set)
 *  - Delete dismissed notifications older than 30 days
 */

import { db } from "@/lib/db";

export async function pruneOldNotifications(): Promise<{ pruned: number }> {
  const now = new Date();

  const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [autoDisposed, deleted] = await Promise.all([
    // Mark read notifications older than 90 days as dismissed
    db.userNotification.updateMany({
      where: {
        readAt:      { not: null, lt: d90 },
        dismissedAt: null,
      },
      data: { dismissedAt: now },
    }),
    // Delete dismissed notifications older than 30 days
    db.userNotification.deleteMany({
      where: {
        dismissedAt: { not: null, lt: d30 },
      },
    }),
  ]);

  return { pruned: autoDisposed.count + deleted.count };
}
