/**
 * lib/backups/restore-drill-planner.ts
 *
 * Sprint 60: Restore drill plan generator for safe staging restore validation.
 *
 * Generates a step-by-step restore drill plan targeting the staging restore
 * drill environment (not the live Sardar production project).
 *
 * Recommended staging target:
 *   slug:   sardar-security-restore-drill
 *   domain: restore-sardar-security-project.doorstepmanchester.uk
 *
 * SAFETY: Does NOT perform any restore automatically.
 *         All confirmation phrases must be typed by the user before any step.
 *
 * Server-only.
 */

import { db } from "@/lib/db";
import type {
  DisasterRecoveryCheck,
  DisasterRecoveryStatus,
  RestoreDrillPlan,
} from "./disaster-recovery-types";

export const RESTORE_DRILL_TARGET_SLUG   = "sardar-security-restore-drill";
export const RESTORE_DRILL_TARGET_DOMAIN = "restore-sardar-security-project.doorstepmanchester.uk";

export async function generateRestoreDrillPlan(input: {
  projectId: string;
  backupId?: string;
}): Promise<RestoreDrillPlan> {
  const { projectId, backupId } = input;

  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  // ── Find latest ready backup (or specific one) ────────────────────────────

  const backup = backupId
    ? await db.projectBackup.findFirst({
        where:  { id: backupId, projectId, status: "ready" },
        select: { id: true, backupRef: true, createdAt: true, sizeBytes: true, fileCount: true },
      })
    : await db.projectBackup.findFirst({
        where:   { projectId, status: "ready" },
        orderBy: { createdAt: "desc" },
        select:  { id: true, backupRef: true, createdAt: true, sizeBytes: true, fileCount: true },
      });

  if (!backup) {
    blockers.push("No ready backup found. Create a backup before running a restore drill.");
  }

  // ── Build drill steps ─────────────────────────────────────────────────────

  const steps: DisasterRecoveryCheck[] = [
    {
      id:       "step-1-select-backup",
      category: "backup",
      label:    "Step 1 — Select latest backup",
      status:   backup ? "pass" : "fail",
      required: true,
      message:  backup
        ? `Latest ready backup: ${backup.backupRef} — ${backup.createdAt.toISOString().slice(0, 10)} (${backup.fileCount ?? "?"} files, ${backup.sizeBytes != null ? `${(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "size unknown"})`
        : "No ready backup found. Create a backup first.",
      linkHref: backup ? undefined : `/projects/${projectId}/backups`,
    },
    {
      id:       "step-2-verify-metadata",
      category: "integrity",
      label:    "Step 2 — Verify backup metadata",
      status:   backup ? "pending" : "pending",
      required: true,
      message:  "Use the Verify Backup Integrity button to confirm the archive is intact before restoring.",
      confirmationRequired: "VERIFY BACKUP",
      linkHref: `/projects/${projectId}/backups`,
    },
    {
      id:       "step-3-create-drill-project",
      category: "staging",
      label:    "Step 3 — Create or select the restore drill project",
      status:   "manual",
      required: true,
      message:  `Target slug: ${RESTORE_DRILL_TARGET_SLUG} — domain: ${RESTORE_DRILL_TARGET_DOMAIN}. Create this project in Prisom if it doesn't exist. Do NOT use the live Sardar project as the restore target.`,
      warning:  "The restore drill project must be separate from the live production project.",
    },
    {
      id:       "step-4-restore-source",
      category: "restore",
      label:    "Step 4 — Restore source files into restore drill project",
      status:   "manual",
      required: true,
      message:  `On the Backups page, select the backup and restore into the drill project (${RESTORE_DRILL_TARGET_SLUG}), not the live project. Confirm with "RESTORE TO STAGING".`,
      confirmationRequired: "RESTORE TO STAGING",
      warning:  "Do NOT restore into the live Sardar Security production project or the Prisom panel.",
    },
    {
      id:       "step-5-env-values",
      category: "staging",
      label:    "Step 5 — Add staging/test environment values manually",
      status:   "manual",
      required: true,
      message:  "After restore, add test env values to the drill project. Do NOT copy production secrets into staging. Use safe test/sandbox values.",
      warning:  "Never copy production database credentials or payment keys into staging.",
    },
    {
      id:       "step-6-deployment-dry-run",
      category: "staging",
      label:    "Step 6 — Run deployment dry run on drill project",
      status:   "pending",
      required: true,
      message:  "Run a deployment dry run on the restore drill project to confirm source is valid and build commands work.",
      linkHref: `/projects/${projectId}/releases`,
    },
    {
      id:       "step-7-build-dry-run",
      category: "staging",
      label:    "Step 7 — Run build dry run on drill project",
      status:   "pending",
      required: true,
      message:  "Run the build command on the drill project to confirm the restored source builds successfully. No PM2 restart — build validation only.",
      command:  "pnpm run build (in the drill project source directory)",
    },
    {
      id:       "step-8-staging-route",
      category: "route_rollback",
      label:    "Step 8 — Configure staging route (preview only)",
      status:   "manual",
      required: false,
      message:  `Configure a preview-only route for ${RESTORE_DRILL_TARGET_DOMAIN} if needed. Do NOT apply production routes. No nginx reload on live domains.`,
      warning:  "Staging route only — never apply drill project routes to production nginx.",
    },
    {
      id:       "step-9-smoke-checks",
      category: "monitoring",
      label:    "Step 9 — Run smoke checks against drill domain",
      status:   "pending",
      required: true,
      message:  `Run smoke checks against the drill domain (${RESTORE_DRILL_TARGET_DOMAIN}) to confirm the restored app is serving correctly.`,
      command:  `curl -I https://${RESTORE_DRILL_TARGET_DOMAIN}/`,
    },
    {
      id:       "step-10-compare",
      category: "staging",
      label:    "Step 10 — Compare restore output with source project",
      status:   "manual",
      required: false,
      message:  "Compare key pages / endpoints between the drill project and the live project. Note any discrepancies — investigate before live restore.",
    },
    {
      id:       "step-11-mark-complete",
      category: "staging",
      label:    "Step 11 — Mark drill complete",
      status:   "pending",
      required: true,
      message:  "Once the drill passes, confirm completion with the phrase below. This records that a restore drill was completed successfully.",
      confirmationRequired: "MARK DRILL COMPLETE",
    },
  ];

  nextSteps.push("Create a backup if none exists, then run this drill plan.");
  nextSteps.push(`Use slug "${RESTORE_DRILL_TARGET_SLUG}" as the restore target — not the live project.`);
  nextSteps.push("Complete all 11 steps before production cutover.");
  nextSteps.push("Record the drill completion date in your go-live checklist.");

  if (!backup) {
    warnings.push("No ready backup — drill steps 1–4 are blocked until a backup is created.");
  }

  const status: DisasterRecoveryStatus = blockers.length > 0 ? "blocked" : "ready";

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    recommendedTargetSlug:   RESTORE_DRILL_TARGET_SLUG,
    recommendedTargetDomain: RESTORE_DRILL_TARGET_DOMAIN,
    sourceBackupId:          backup?.id ?? null,
    sourceBackupRef:         backup?.backupRef ?? null,
    sourceBackupCreatedAt:   backup?.createdAt.toISOString() ?? null,
    steps,
    blockers,
    warnings,
    nextSteps,
  };
}
