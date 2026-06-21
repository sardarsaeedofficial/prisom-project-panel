/**
 * lib/operations/project-operation-locks.ts
 *
 * Sprint 27: Locking compatibility matrix and stale thresholds.
 *
 * Rules:
 *  - An operation is BLOCKED if any running operation it conflicts with is active.
 *  - "deploys" and "restores" are mutually exclusive with everything that
 *    touches source code or the running process.
 *  - Backups are safe to run in parallel with each other (create only).
 *  - Patch apply blocks deploy and other patches.
 */

import type { OperationType } from "./project-operation-types";

// ── Stale thresholds (ms) ─────────────────────────────────────────────────────
// An "running" operation older than this is considered stale (timed out).

export const STALE_THRESHOLD_MS: Record<OperationType, number> = {
  deploy:               60 * 60 * 1000,   // 60 min  — deploys can be slow
  multi_service_deploy: 60 * 60 * 1000,   // 60 min
  backup_create:        30 * 60 * 1000,   // 30 min
  backup_restore:       30 * 60 * 1000,   // 30 min
  backup_delete:        10 * 60 * 1000,   // 10 min
  patch_apply:          10 * 60 * 1000,   // 10 min
};

// ── Compatibility matrix ──────────────────────────────────────────────────────
//
// BLOCKS_IF_RUNNING[proposed] = set of operationTypes that, if currently
// running, will BLOCK the proposed operation.
//
// Reasoning:
//   deploy       — blocked by any deploy, restore, or patch (all touch source/process)
//   multi_deploy — same as deploy
//   backup_create  — blocked by restores (file state may be mid-change)
//   backup_restore — blocked by everything (restores must be exclusive)
//   backup_delete  — only blocked by restores touching same backup (we block broadly)
//   patch_apply  — blocked by deploys and restores (they change code in place)

export const BLOCKS_IF_RUNNING: Record<OperationType, Set<OperationType>> = {
  deploy: new Set<OperationType>([
    "deploy",
    "multi_service_deploy",
    "backup_restore",
    "patch_apply",
  ]),
  multi_service_deploy: new Set<OperationType>([
    "deploy",
    "multi_service_deploy",
    "backup_restore",
    "patch_apply",
  ]),
  backup_create: new Set<OperationType>([
    "backup_restore",
  ]),
  backup_restore: new Set<OperationType>([
    "deploy",
    "multi_service_deploy",
    "backup_create",
    "backup_restore",
    "backup_delete",
    "patch_apply",
  ]),
  backup_delete: new Set<OperationType>([
    "backup_restore",
  ]),
  patch_apply: new Set<OperationType>([
    "deploy",
    "multi_service_deploy",
    "backup_restore",
    "patch_apply",
  ]),
};

/**
 * Returns a human-readable reason why `proposed` is blocked by `running`.
 */
export function getBlockingReason(
  proposed:  OperationType,
  running:   OperationType,
  runningTitle: string,
): string {
  if (running === "backup_restore") {
    return `A backup restore is in progress. Wait for it to complete before starting a new operation.`;
  }
  if (proposed === "backup_restore") {
    return `Cannot restore while "${runningTitle}" is running. Wait for all operations to finish first.`;
  }
  return `"${runningTitle}" is already running. Wait for it to finish before starting a new operation.`;
}
