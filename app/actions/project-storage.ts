"use server";

/**
 * app/actions/project-storage.ts
 *
 * Sprint 34: Server actions for the project Storage Center.
 *
 * All actions:
 *  - Authenticate and authorize via requireProjectPermission
 *  - storage.view required for reports/plans
 *  - storage.cleanup required for running cleanup and saving policy
 *  - Never accept raw filesystem paths from the client
 *  - Return typed discriminated-union results (ok/error)
 */

import { requireProjectPermission } from "@/lib/auth/project-membership";
import { db }                        from "@/lib/db";
import {
  getProjectSourceSizeBytes,
  getTotalReleasesSize,
} from "@/lib/storage/project-storage-scanner";
import { buildStorageCleanupPlan }   from "@/lib/storage/storage-cleanup-planner";
import { runStorageCleanup }         from "@/lib/storage/storage-cleanup-runner";
import { DEFAULT_STORAGE_POLICY }    from "@/lib/storage/storage-types";
import type {
  ProjectStorageReport,
  ProjectStoragePolicyDTO,
  StorageItem,
  GetStorageReportResult,
  GetCleanupPlanResult,
  RunCleanupResult,
  SaveStoragePolicyResult,
} from "@/lib/storage/storage-types";

// ── Storage report ────────────────────────────────────────────────────────────

export async function getProjectStorageReportAction(
  projectId: string,
): Promise<GetStorageReportResult> {
  const auth = await requireProjectPermission(projectId, "storage.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true },
    });
    if (!project) return { ok: false, error: "Project not found" };

    const policyRow = await db.projectStoragePolicy.findUnique({
      where: { projectId },
    });

    const policy: ProjectStoragePolicyDTO = policyRow
      ? {
          keepSuccessfulReleases: policyRow.keepSuccessfulReleases,
          keepFailedReleases:     policyRow.keepFailedReleases,
          keepScheduledBackups:   policyRow.keepScheduledBackups,
          autoCleanupEnabled:     policyRow.autoCleanupEnabled,
          maxStorageBytes:
            policyRow.maxStorageBytes !== null
              ? Number(policyRow.maxStorageBytes)
              : null,
        }
      : { ...DEFAULT_STORAGE_POLICY };

    const [sourceBytes, releasesBytes, backupRows] = await Promise.all([
      getProjectSourceSizeBytes(project.slug),
      getTotalReleasesSize(project.slug),
      db.projectBackup.findMany({
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
      }),
    ]);

    const backupsBytes = backupRows.reduce((s, b) => s + (b.sizeBytes ?? 0), 0);

    // Classify backup items
    const KEEP_SCHEDULED = policy.keepScheduledBackups;
    const sorted = [...backupRows].sort(
      (a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime(),
    );
    let scheduledCount = 0;

    const backupItems: StorageItem[] = sorted.map((r): StorageItem => {
      let prot = false;
      let reasonProtected: string | undefined;

      if (r.backupType === "manual") {
        prot = true; reasonProtected = "Manual backups are always protected";
      } else if (r.backupType === "pre_restore") {
        prot = true; reasonProtected = "Pre-restore backups are always protected";
      } else if (r.backupType === "system") {
        prot = true; reasonProtected = "System backups are always protected";
      } else if (r.status !== "ready") {
        prot = true; reasonProtected = `Status: ${r.status}`;
      } else if (r.backupType !== "scheduled") {
        prot = true; reasonProtected = `Type "${r.backupType}" is not auto-eligible`;
      } else {
        scheduledCount++;
        if (scheduledCount <= KEEP_SCHEDULED) {
          prot = true;
          reasonProtected = `Kept by retention (newest ${KEEP_SCHEDULED})`;
        }
      }

      return {
        id:              r.id,
        label:           r.label ? `Backup: ${r.label}` : `Backup: ${r.backupRef}`,
        kind:            "backup",
        pathLabel:       `backups/${r.backupRef}`,
        sizeBytes:       r.sizeBytes ?? 0,
        createdAt:       (r.completedAt ?? r.createdAt).toISOString(),
        status:          r.status,
        protected:       prot,
        reasonProtected,
        cleanupEligible: !prot,
      };
    });

    const totalBytes = sourceBytes + releasesBytes + backupsBytes;

    const recommendations: string[] = [];
    const eligibleBackups = backupItems.filter((b) => b.cleanupEligible);
    if (eligibleBackups.length > 0) {
      const mb = eligibleBackups.reduce((s, b) => s + b.sizeBytes, 0) / (1024 * 1024);
      recommendations.push(
        `${eligibleBackups.length} backup(s) are beyond the retention policy (~${mb.toFixed(1)} MB can be freed).`,
      );
    }
    if (policy.maxStorageBytes !== null && totalBytes > policy.maxStorageBytes) {
      recommendations.push("Project is over its storage quota. Run cleanup or increase the limit.");
    }

    const report: ProjectStorageReport = {
      projectId,
      projectSlug:  project.slug,
      projectName:  project.name,
      generatedAt:  new Date().toISOString(),
      totals: { sourceBytes, releasesBytes, backupsBytes, totalBytes },
      releases:        [],
      backups:         backupItems,
      policy,
      recommendations,
    };

    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load storage report";
    return { ok: false, error: msg };
  }
}

// ── Cleanup plan ──────────────────────────────────────────────────────────────

export async function getProjectCleanupPlanAction(
  projectId: string,
): Promise<GetCleanupPlanResult> {
  const auth = await requireProjectPermission(projectId, "storage.view");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const plan = await buildStorageCleanupPlan(projectId);
    return { ok: true, plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate cleanup plan";
    return { ok: false, error: msg };
  }
}

// ── Run cleanup ───────────────────────────────────────────────────────────────

export async function runProjectCleanupAction(
  projectId:    string,
  confirmation: string,
): Promise<RunCleanupResult> {
  const auth = await requireProjectPermission(projectId, "storage.cleanup");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const user = await db.user.findUnique({
      where:  { id: auth.userId },
      select: { email: true, name: true },
    });

    const result = await runStorageCleanup({
      projectId,
      actorUserId: auth.userId,
      actorEmail:  user?.email ?? auth.userId,
      actorRole:   auth.role,
      confirmation,
    });

    return { ok: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cleanup failed";
    return { ok: false, error: msg };
  }
}

// ── Save policy ───────────────────────────────────────────────────────────────

export async function saveProjectStoragePolicyAction(
  projectId: string,
  input: {
    keepSuccessfulReleases: number;
    keepFailedReleases:     number;
    keepScheduledBackups:   number;
    autoCleanupEnabled:     boolean;
    maxStorageBytes:        number | null;
  },
): Promise<SaveStoragePolicyResult> {
  const auth = await requireProjectPermission(projectId, "storage.cleanup");
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    if (input.keepSuccessfulReleases < 1 || input.keepSuccessfulReleases > 50) {
      return { ok: false, error: "keepSuccessfulReleases must be 1–50" };
    }
    if (input.keepFailedReleases < 0 || input.keepFailedReleases > 20) {
      return { ok: false, error: "keepFailedReleases must be 0–20" };
    }
    if (input.keepScheduledBackups < 1 || input.keepScheduledBackups > 100) {
      return { ok: false, error: "keepScheduledBackups must be 1–100" };
    }
    if (input.maxStorageBytes !== null && input.maxStorageBytes < 1) {
      return { ok: false, error: "maxStorageBytes must be positive" };
    }

    const maxBytes =
      input.maxStorageBytes !== null ? BigInt(Math.floor(input.maxStorageBytes)) : null;

    await db.projectStoragePolicy.upsert({
      where:  { projectId },
      create: {
        projectId,
        keepSuccessfulReleases: input.keepSuccessfulReleases,
        keepFailedReleases:     input.keepFailedReleases,
        keepScheduledBackups:   input.keepScheduledBackups,
        autoCleanupEnabled:     input.autoCleanupEnabled,
        maxStorageBytes:        maxBytes,
      },
      update: {
        keepSuccessfulReleases: input.keepSuccessfulReleases,
        keepFailedReleases:     input.keepFailedReleases,
        keepScheduledBackups:   input.keepScheduledBackups,
        autoCleanupEnabled:     input.autoCleanupEnabled,
        maxStorageBytes:        maxBytes,
      },
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save policy";
    return { ok: false, error: msg };
  }
}
