/**
 * lib/admin/admin-storage-summary.ts
 *
 * Sprint 34: Admin Console storage section — DB-only backup size aggregation.
 *
 * This does NOT scan the filesystem. It uses `ProjectBackup.sizeBytes` from the
 * DB to aggregate totals, making it fast enough to run as a cached async section.
 *
 * Cache key: "storage" — TTL 60s (same as disk section).
 */

import { db }                  from "@/lib/db";
import {
  getCachedSection,
  setCachedSection,
}                              from "./admin-health-cache";
import type {
  AdminStorageSection,
  AdminSystemWarning,
} from "./admin-health-types";

const CACHE_KEY = "storage" as const;

// ── Extend the cache key union ────────────────────────────────────────────────
// The cache module uses a typed CacheKey — "storage" must be added there.
// See lib/admin/admin-health-cache.ts for the CACHE_TTL_MS record.

export async function runAdminStorageSection(
  forceRefresh = false,
): Promise<AdminStorageSection> {
  if (!forceRefresh) {
    const cached = getCachedSection<AdminStorageSection>(CACHE_KEY);
    if (cached) return { ...cached.value, cacheStatus: "fresh" };
  }

  const now = new Date().toISOString();

  // Aggregate backup sizes per project (only ready, not deleted)
  const backups = await db.projectBackup.findMany({
    where: {
      status:    "ready",
      deletedAt: null,
    },
    select: {
      projectId:  true,
      sizeBytes:  true,
      backupType: true,
      project: {
        select: {
          name:          true,
          slug:          true,
          backupSchedule: {
            select: { enabled: true },
          },
          storagePolicy: {
            select: { keepScheduledBackups: true },
          },
        },
      },
    },
  });

  // Group by project
  type ProjectAgg = {
    projectId:        string;
    projectName:      string;
    projectSlug:      string;
    totalBackupBytes: number;
    backupCount:      number;
    scheduledCount:   number;
    keepScheduled:    number;
    scheduledEnabled: boolean;
  };

  const byProject = new Map<string, ProjectAgg>();

  for (const b of backups) {
    const key = b.projectId;
    if (!byProject.has(key)) {
      byProject.set(key, {
        projectId:        b.projectId,
        projectName:      b.project.name,
        projectSlug:      b.project.slug,
        totalBackupBytes: 0,
        backupCount:      0,
        scheduledCount:   0,
        keepScheduled:    b.project.storagePolicy?.keepScheduledBackups ?? 7,
        scheduledEnabled: b.project.backupSchedule?.enabled ?? false,
      });
    }
    const agg = byProject.get(key)!;
    agg.totalBackupBytes += b.sizeBytes ?? 0;
    agg.backupCount++;
    if (b.backupType === "scheduled") agg.scheduledCount++;
  }

  const rows = [...byProject.values()];

  // Platform totals
  const totalBackupBytes = rows.reduce((s, r) => s + r.totalBackupBytes, 0);

  // How many projects have more scheduled backups than their keep limit
  const projectsOverRetention = rows.filter(
    (r) => r.scheduledCount > r.keepScheduled,
  ).length;

  // Top 10 by backup size
  const topProjects = rows
    .sort((a, b) => b.totalBackupBytes - a.totalBackupBytes)
    .slice(0, 10)
    .map((r) => ({
      projectId:        r.projectId,
      projectName:      r.projectName,
      projectSlug:      r.projectSlug,
      totalBackupBytes: r.totalBackupBytes,
      backupCount:      r.backupCount,
      scheduledEnabled: r.scheduledEnabled,
    }));

  // Warnings
  const warnings: AdminSystemWarning[] = [];

  if (projectsOverRetention > 0) {
    warnings.push({
      severity:    "warning",
      title:       "Backups exceeding retention",
      description: `${projectsOverRetention} project(s) have scheduled backups beyond their configured retention limit.`,
    });
  }

  const result: AdminStorageSection = {
    generatedAt:           now,
    cacheStatus:           "miss",
    totalBackupBytes,
    topProjects,
    projectsOverRetention,
    warnings,
  };

  setCachedSection(CACHE_KEY, result);
  return { ...result, cacheStatus: "miss" };
}
