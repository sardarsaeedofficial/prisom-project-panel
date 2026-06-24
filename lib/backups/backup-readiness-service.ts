/**
 * lib/backups/backup-readiness-service.ts
 *
 * Sprint 60: Backup readiness report generator.
 *
 * Checks:
 *  - backup feature configured
 *  - at least one backup exists (status "ready")
 *  - recent backup (within RECENT_BACKUP_DAYS)
 *  - backup file exists on disk
 *  - backup size is non-zero
 *  - backup metadata readable
 *  - scheduled backup configured + enabled
 *  - retention policy configured
 *  - rollback target release exists
 *
 * Server-only — uses Prisma and fs.
 */

import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { RECENT_BACKUP_DAYS, BACKUP_ARCHIVE_NAME } from "./project-backup-types";
import type { DisasterRecoveryCheck, DisasterRecoveryReport } from "./disaster-recovery-types";

const APP_ROOT = process.cwd();

function resolveArchivePath(storagePath: string, archiveName: string): string {
  return path.resolve(APP_ROOT, storagePath, archiveName);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fileSizeBytes(p: string): Promise<number | null> {
  try {
    const stat = await fs.stat(p);
    return stat.size;
  } catch {
    return null;
  }
}

export async function generateBackupReadinessReport(
  projectId: string,
): Promise<DisasterRecoveryReport> {
  const checks: DisasterRecoveryCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  // ── 1. Load backups from DB ────────────────────────────────────────────────

  const backups = await db.projectBackup.findMany({
    where:   { projectId, status: { not: "deleted" } },
    orderBy: { createdAt: "desc" },
    take:    20,
    select: {
      id:           true,
      backupRef:    true,
      status:       true,
      sizeBytes:    true,
      fileCount:    true,
      checksumSha256: true,
      storagePath:  true,
      archiveName:  true,
      backupType:   true,
      createdAt:    true,
      completedAt:  true,
      lastError:    true,
    },
  });

  const readyBackups = backups.filter((b) => b.status === "ready");
  const latestReady  = readyBackups[0] ?? null;

  // ── Check 1: backup exists ────────────────────────────────────────────────

  if (readyBackups.length === 0) {
    checks.push({
      id:       "backup-exists",
      category: "backup",
      label:    "At least one ready backup exists",
      status:   "fail",
      required: true,
      message:  "No ready backups found. Create a backup before proceeding to staging or production.",
      linkHref: `/projects/${projectId}/backups`,
    });
    blockers.push("No ready backup exists. Create a backup first.");
  } else {
    checks.push({
      id:       "backup-exists",
      category: "backup",
      label:    "At least one ready backup exists",
      status:   "pass",
      required: true,
      message:  `${readyBackups.length} ready backup(s) found.`,
      evidence: [`Latest: ${latestReady!.backupRef} (${latestReady!.createdAt.toISOString().slice(0, 10)})`],
    });
  }

  // ── Check 2: recent backup ────────────────────────────────────────────────

  if (latestReady) {
    const ageMs      = Date.now() - latestReady.createdAt.getTime();
    const ageDays    = ageMs / (1000 * 60 * 60 * 24);
    const isRecent   = ageDays <= RECENT_BACKUP_DAYS;

    checks.push({
      id:       "recent-backup",
      category: "backup",
      label:    `Backup created within ${RECENT_BACKUP_DAYS} days`,
      status:   isRecent ? "pass" : "warning",
      required: false,
      message:  isRecent
        ? `Latest backup is ${Math.round(ageDays)} day(s) old.`
        : `Latest backup is ${Math.round(ageDays)} day(s) old — create a fresh backup before go-live.`,
    });
    if (!isRecent) {
      warnings.push(`Latest backup is ${Math.round(ageDays)} days old. Create a fresh backup before cutover.`);
    }
  }

  // ── Check 3: backup file on disk ──────────────────────────────────────────

  if (latestReady) {
    const archiveName = latestReady.archiveName || BACKUP_ARCHIVE_NAME;
    const archivePath = resolveArchivePath(latestReady.storagePath, archiveName);
    const exists      = await fileExists(archivePath);
    const size        = exists ? await fileSizeBytes(archivePath) : null;

    if (!exists) {
      checks.push({
        id:       "backup-file-exists",
        category: "backup",
        label:    "Backup archive file present on disk",
        status:   "fail",
        required: true,
        message:  `Backup archive not found at ${latestReady.storagePath}. The backup record exists in the database but the file is missing.`,
      });
      blockers.push("Backup archive file is missing from disk. The latest backup may be corrupt or was deleted externally.");
    } else if (size !== null && size === 0) {
      checks.push({
        id:       "backup-file-exists",
        category: "backup",
        label:    "Backup archive file present on disk",
        status:   "fail",
        required: true,
        message:  "Backup archive exists but has zero bytes. The backup may have failed mid-write.",
      });
      blockers.push("Backup archive file is empty. Create a new backup.");
    } else {
      const sizeMb = size !== null ? `${(size / 1024 / 1024).toFixed(2)} MB` : "unknown size";
      checks.push({
        id:       "backup-file-exists",
        category: "backup",
        label:    "Backup archive file present on disk",
        status:   "pass",
        required: true,
        message:  `Archive found (${sizeMb}).`,
        evidence: [archivePath],
      });
    }
  } else {
    checks.push({
      id:       "backup-file-exists",
      category: "backup",
      label:    "Backup archive file present on disk",
      status:   "pending",
      required: true,
      message:  "No ready backup to check file presence for.",
    });
  }

  // ── Check 4: backup size in DB non-zero ───────────────────────────────────

  if (latestReady) {
    if (latestReady.sizeBytes !== null && latestReady.sizeBytes > 0) {
      checks.push({
        id:       "backup-size-nonzero",
        category: "backup",
        label:    "Backup size recorded (non-zero)",
        status:   "pass",
        required: false,
        message:  `Size in database: ${(latestReady.sizeBytes / 1024 / 1024).toFixed(2)} MB, ${latestReady.fileCount ?? "?"} files.`,
      });
    } else if (latestReady.sizeBytes === 0) {
      checks.push({
        id:       "backup-size-nonzero",
        category: "backup",
        label:    "Backup size recorded (non-zero)",
        status:   "warning",
        required: false,
        message:  "Backup size in database is zero — this may indicate an incomplete backup.",
      });
      warnings.push("Latest backup size is zero. Verify backup integrity before restoring.");
    } else {
      checks.push({
        id:       "backup-size-nonzero",
        category: "backup",
        label:    "Backup size recorded (non-zero)",
        status:   "warning",
        required: false,
        message:  "Backup size not recorded in database. Run a new backup to get fresh size metadata.",
      });
    }
  }

  // ── Check 5: checksum recorded ────────────────────────────────────────────

  if (latestReady) {
    if (latestReady.checksumSha256) {
      checks.push({
        id:       "backup-checksum",
        category: "integrity",
        label:    "Backup checksum (SHA-256) recorded",
        status:   "pass",
        required: false,
        message:  `Checksum: ${latestReady.checksumSha256.slice(0, 16)}…`,
      });
    } else {
      checks.push({
        id:       "backup-checksum",
        category: "integrity",
        label:    "Backup checksum (SHA-256) recorded",
        status:   "warning",
        required: false,
        message:  "No SHA-256 checksum recorded for latest backup. Integrity verification will be partial.",
      });
      warnings.push("No checksum recorded for latest backup. Create a new backup to get checksum verification.");
    }
  }

  // ── Check 6: scheduled backup ─────────────────────────────────────────────

  const schedule = await db.projectBackupSchedule.findUnique({
    where:  { projectId },
    select: {
      enabled:         true,
      frequency:       true,
      retentionCount:  true,
      lastSuccessAt:   true,
      nextRunAt:       true,
    },
  });

  if (!schedule) {
    checks.push({
      id:       "scheduled-backup",
      category: "backup",
      label:    "Scheduled backup configured",
      status:   "warning",
      required: false,
      message:  "No backup schedule found. Configure a scheduled backup to ensure regular snapshots.",
      linkHref: `/projects/${projectId}/backups`,
    });
    warnings.push("No scheduled backup configured. Set up daily or weekly backups before go-live.");
  } else if (!schedule.enabled) {
    checks.push({
      id:       "scheduled-backup",
      category: "backup",
      label:    "Scheduled backup configured and enabled",
      status:   "warning",
      required: false,
      message:  `Backup schedule exists (${schedule.frequency}) but is currently disabled.`,
      linkHref: `/projects/${projectId}/backups`,
    });
    warnings.push("Backup schedule is disabled. Enable it before go-live.");
  } else {
    const nextRun = schedule.nextRunAt
      ? `next run: ${schedule.nextRunAt.toISOString().slice(0, 16)}`
      : "next run not yet scheduled";
    checks.push({
      id:       "scheduled-backup",
      category: "backup",
      label:    "Scheduled backup configured and enabled",
      status:   "pass",
      required: false,
      message:  `${schedule.frequency} backup schedule active — ${nextRun}.`,
    });
  }

  // ── Check 7: retention configured ────────────────────────────────────────

  if (schedule) {
    if (schedule.retentionCount >= 3) {
      checks.push({
        id:       "backup-retention",
        category: "backup",
        label:    "Backup retention policy configured",
        status:   "pass",
        required: false,
        message:  `Retaining ${schedule.retentionCount} scheduled backups.`,
      });
    } else {
      checks.push({
        id:       "backup-retention",
        category: "backup",
        label:    "Backup retention policy configured",
        status:   "warning",
        required: false,
        message:  `Retention set to only ${schedule.retentionCount} backup(s). Consider increasing to at least 3 for safety.`,
      });
    }
  } else {
    checks.push({
      id:       "backup-retention",
      category: "backup",
      label:    "Backup retention policy configured",
      status:   "warning",
      required: false,
      message:  "No schedule configured — retention policy not set.",
    });
  }

  // ── Check 8: rollback target release ─────────────────────────────────────

  const latestDeployment = await db.deployment.findFirst({
    where:   { projectId, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select:  { id: true, createdAt: true, isActive: true },
  });

  if (!latestDeployment) {
    checks.push({
      id:       "rollback-release",
      category: "release_rollback",
      label:    "Rollback target deployment exists",
      status:   "warning",
      required: false,
      message:  "No successful deployment found. Rollback is not available until a deployment exists.",
      linkHref: `/projects/${projectId}/publishing`,
    });
    warnings.push("No rollback target deployment found. Deploy at least once before go-live.");
  } else {
    checks.push({
      id:       "rollback-release",
      category: "release_rollback",
      label:    "Rollback target deployment exists",
      status:   "pass",
      required: false,
      message:  `Latest successful deployment: ${latestDeployment.createdAt.toISOString().slice(0, 10)}${latestDeployment.isActive ? " (active)" : ""}.`,
      linkHref: `/projects/${projectId}/releases`,
    });
  }

  // ── Check 9: release rollback available ───────────────────────────────────

  const deploymentCount = await db.deployment.count({
    where: { projectId, status: "SUCCESS" },
  });

  if (deploymentCount >= 2) {
    checks.push({
      id:       "rollback-available",
      category: "release_rollback",
      label:    "At least 2 deployments exist for rollback",
      status:   "pass",
      required: false,
      message:  `${deploymentCount} successful deployments — rollback to a previous release is possible.`,
    });
  } else {
    checks.push({
      id:       "rollback-available",
      category: "release_rollback",
      label:    "At least 2 deployments exist for rollback",
      status:   "warning",
      required: false,
      message:  deploymentCount === 1
        ? "Only 1 deployment — no prior deployment to roll back to yet."
        : "No deployments — rollback unavailable.",
    });
  }

  // ── Check 10: route backup / nginx config ─────────────────────────────────

  checks.push({
    id:       "route-rollback-plan",
    category: "route_rollback",
    label:    "Nginx route rollback plan documented",
    status:   "manual",
    required: false,
    message:  "Route rollback is a manual step. Confirm that a backup of the nginx config exists before applying new routes.",
    warning:  "Never apply nginx route changes without first saving the current config: `sudo cp /etc/nginx/sites-available/<project> /etc/nginx/sites-available/<project>.bak`",
    command:  "sudo nginx -t && sudo nginx -s reload",
  });

  // ── Check 11: DB rollback warning ─────────────────────────────────────────

  checks.push({
    id:       "db-rollback-warning",
    category: "database",
    label:    "Database rollback — manual plan required",
    status:   "manual",
    required: false,
    message:  "Application rollback does NOT automatically rollback database schema or data. A separate database backup must exist.",
    warning:  "Database changes may be irreversible without a DB-level backup. Always take a DB dump before schema migrations.",
    linkHref: `/projects/${projectId}/database`,
  });

  // ── Check 12: restore drill completed ─────────────────────────────────────

  checks.push({
    id:       "restore-drill-completed",
    category: "staging",
    label:    "Restore drill completed on staging",
    status:   "pending",
    required: false,
    message:  "Generate a Restore Drill Plan and complete a staging restore drill before live cutover.",
    confirmationRequired: "MARK DRILL COMPLETE",
    linkHref: `/projects/${projectId}/backups`,
  });

  nextSteps.push("Create a backup now if one doesn't exist or is out of date.");
  nextSteps.push("Enable the scheduled backup for ongoing protection.");
  nextSteps.push("Run the Restore Drill Plan to validate recovery before go-live.");
  nextSteps.push("Verify nginx backup config exists before applying route changes.");
  nextSteps.push("Ensure a separate database dump exists before any schema migration.");

  // ── Build summary ─────────────────────────────────────────────────────────

  const summary = {
    total:    checks.length,
    passed:   checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    failed:   checks.filter((c) => c.status === "fail").length,
    manual:   checks.filter((c) => c.status === "manual").length,
    pending:  checks.filter((c) => c.status === "pending").length,
  };

  const overallStatus: DisasterRecoveryReport["status"] =
    blockers.length > 0
      ? "blocked"
      : summary.failed > 0
      ? "failed"
      : warnings.length > 0
      ? "warning"
      : summary.manual > 0
      ? "warning"
      : "ready";

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status: overallStatus,
    checks,
    blockers,
    warnings,
    nextSteps,
    summary,
  };
}
