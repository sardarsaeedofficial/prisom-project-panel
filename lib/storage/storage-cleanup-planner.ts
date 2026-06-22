/**
 * lib/storage/storage-cleanup-planner.ts
 *
 * Sprint 34: Generates a cleanup plan — what is eligible, what is protected.
 *
 * No filesystem writes happen here. The plan is a read-only report.
 *
 * Protection rules:
 *  Releases:
 *   - Newest N directories are always protected (recency = most likely in use)
 *   - Directories younger than 2 hours are always protected
 *
 *  Backups:
 *   - backupType = "manual"      — always protected
 *   - backupType = "pre_restore" — always protected
 *   - backupType = "system"      — always protected
 *   - status ≠ "ready"           — protected (incomplete, may be in use)
 *   - Newest N scheduled backups — protected per keepScheduledBackups
 *   - All others                 — cleanup-eligible
 */

import { db } from "@/lib/db";
import {
  scanReleaseDirectories,
} from "./project-storage-scanner";
import type {
  StorageItem,
  StorageCleanupPlan,
  ProjectStoragePolicyDTO,
} from "./storage-types";
import { DEFAULT_STORAGE_POLICY } from "./storage-types";

// ── Release items ──────────────────────────────────────────────────────────────

const RECENT_GUARD_MS = 2 * 60 * 60 * 1000; // 2 hours

function buildReleaseItems(
  dirs:   import("./project-storage-scanner").ScannedReleaseDir[],
  policy: ProjectStoragePolicyDTO,
): StorageItem[] {
  const now      = Date.now();
  const keepCount = policy.keepSuccessfulReleases; // keep newest N

  return dirs.map((d, idx): StorageItem => {
    const isRecent  = now - d.mtimeMs < RECENT_GUARD_MS;
    const isInTopN  = idx < keepCount;

    const prot = isRecent || isInTopN;
    const reasonProtected = isRecent
      ? "Recently deployed (< 2 h ago)"
      : isInTopN
      ? `Kept by retention policy (newest ${keepCount})`
      : undefined;

    return {
      id:            d.name,
      label:         `Release: ${d.name}`,
      kind:          "release",
      pathLabel:     `releases/<slug>/${d.name}`,
      sizeBytes:     d.sizeBytes,
      createdAt:     new Date(d.mtimeMs).toISOString(),
      protected:     prot,
      reasonProtected,
      cleanupEligible: !prot,
      cleanupReason:   prot ? undefined : `Older than the ${keepCount}-release retention window`,
    };
  });
}

// ── Backup items ───────────────────────────────────────────────────────────────

type BackupRow = {
  id:          string;
  backupRef:   string;
  label:       string | null;
  status:      string;
  backupType:  string;
  sizeBytes:   number | null;
  createdAt:   Date;
  completedAt: Date | null;
};

function buildBackupItems(
  rows:   BackupRow[],
  policy: ProjectStoragePolicyDTO,
): StorageItem[] {
  // Sort newest first
  const sorted = [...rows].sort(
    (a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime(),
  );

  // Count how many scheduled backups we've seen so far (for retention)
  let scheduledKeptCount = 0;

  return sorted.map((r): StorageItem => {
    const isNonScheduled = r.backupType !== "scheduled";
    const isNotReady     = r.status !== "ready";

    let prot          = false;
    let reasonProtected: string | undefined;

    if (r.backupType === "manual") {
      prot = true;
      reasonProtected = "Manual backups are always protected";
    } else if (r.backupType === "pre_restore") {
      prot = true;
      reasonProtected = "Pre-restore backups are always protected";
    } else if (r.backupType === "system") {
      prot = true;
      reasonProtected = "System backups are always protected";
    } else if (isNotReady) {
      prot = true;
      reasonProtected = `Backup status is "${r.status}" — only ready backups can be cleaned up`;
    } else if (isNonScheduled) {
      prot = true;
      reasonProtected = `Backup type "${r.backupType}" is not auto-eligible for cleanup`;
    } else {
      // Scheduled + ready — apply retention
      scheduledKeptCount++;
      if (scheduledKeptCount <= policy.keepScheduledBackups) {
        prot = true;
        reasonProtected = `Kept by retention policy (newest ${policy.keepScheduledBackups} scheduled backups)`;
      }
    }

    const ts = (r.completedAt ?? r.createdAt).toISOString();

    return {
      id:              r.id,
      label:           r.label ? `Backup: ${r.label}` : `Backup: ${r.backupRef}`,
      kind:            "backup",
      pathLabel:       `backups/<slug>/${r.backupRef}`,
      sizeBytes:       r.sizeBytes ?? 0,
      createdAt:       ts,
      status:          r.status,
      protected:       prot,
      reasonProtected,
      cleanupEligible: !prot,
      cleanupReason:   prot ? undefined : `Exceeds scheduled backup retention (keep ${policy.keepScheduledBackups})`,
    };
  });
}

// ── Warnings ───────────────────────────────────────────────────────────────────

function buildPlanWarnings(releases: StorageItem[], backups: StorageItem[]): string[] {
  const warnings: string[] = [];

  const totalDirs = releases.length;
  const eligible  = releases.filter((r) => r.cleanupEligible).length;
  if (totalDirs === 0) {
    warnings.push("No release directories found under storage/releases/<slug>/.");
  }
  if (eligible === 0 && backups.filter((b) => b.cleanupEligible).length === 0) {
    warnings.push("Nothing is eligible for cleanup. The project is already within its retention policy.");
  }

  return warnings;
}

// ── Main planner ───────────────────────────────────────────────────────────────

export async function buildStorageCleanupPlan(
  projectId: string,
): Promise<StorageCleanupPlan> {
  const now = new Date().toISOString();

  // Load project + policy
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      slug:          true,
      storagePolicy: true,
    },
  });

  if (!project) throw new Error("Project not found");

  const policy: ProjectStoragePolicyDTO = project.storagePolicy
    ? {
        keepSuccessfulReleases: project.storagePolicy.keepSuccessfulReleases,
        keepFailedReleases:     project.storagePolicy.keepFailedReleases,
        keepScheduledBackups:   project.storagePolicy.keepScheduledBackups,
        autoCleanupEnabled:     project.storagePolicy.autoCleanupEnabled,
        maxStorageBytes:
          project.storagePolicy.maxStorageBytes !== null
            ? Number(project.storagePolicy.maxStorageBytes)
            : null,
      }
    : { ...DEFAULT_STORAGE_POLICY };

  // Load backup records
  const backupRows = await db.projectBackup.findMany({
    where:   { projectId, deletedAt: null },
    select: {
      id:          true,
      backupRef:   true,
      label:       true,
      status:      true,
      backupType:  true,
      sizeBytes:   true,
      createdAt:   true,
      completedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Scan release directories
  const releaseDirs = await scanReleaseDirectories(project.slug);

  // Build items
  const releaseItems = buildReleaseItems(releaseDirs, policy);
  const backupItems  = buildBackupItems(backupRows, policy);

  const allItems      = [...releaseItems, ...backupItems];
  const eligibleItems = allItems.filter((i) => i.cleanupEligible);
  const protectedItems = allItems.filter((i) => i.protected);
  const totalBytesToFree = eligibleItems.reduce((s, i) => s + i.sizeBytes, 0);
  const warnings = buildPlanWarnings(releaseItems, backupItems);

  return {
    projectId,
    generatedAt:     now,
    eligibleItems,
    protectedItems,
    totalBytesToFree,
    warnings,
  };
}
