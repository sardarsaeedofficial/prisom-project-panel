/**
 * lib/jobs/background-job-retention.ts
 *
 * Sprint 35: Prune old background job rows.
 *
 * Retention policy:
 *  - success:   7 days
 *  - failed:   30 days
 *  - cancelled: 14 days
 *  - stale:     30 days
 *
 * Running/queued/retrying jobs are never pruned.
 */

import { db } from "@/lib/db";

const RETAIN_SUCCESS_DAYS   = 7;
const RETAIN_FAILED_DAYS    = 30;
const RETAIN_CANCELLED_DAYS = 14;
const RETAIN_STALE_DAYS     = 30;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export async function pruneOldBackgroundJobs(): Promise<{ pruned: number }> {
  const results = await Promise.all([
    db.backgroundJob.deleteMany({
      where: {
        status:      "success",
        completedAt: { lt: daysAgo(RETAIN_SUCCESS_DAYS) },
      },
    }),
    db.backgroundJob.deleteMany({
      where: {
        status:      "failed",
        completedAt: { lt: daysAgo(RETAIN_FAILED_DAYS) },
      },
    }),
    db.backgroundJob.deleteMany({
      where: {
        status:      "cancelled",
        completedAt: { lt: daysAgo(RETAIN_CANCELLED_DAYS) },
      },
    }),
    db.backgroundJob.deleteMany({
      where: {
        status:      "stale",
        completedAt: { lt: daysAgo(RETAIN_STALE_DAYS) },
      },
    }),
  ]);

  const pruned = results.reduce((s: number, r: { count: number }) => s + r.count, 0);
  return { pruned };
}
