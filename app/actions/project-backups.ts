"use server";

/**
 * app/actions/project-backups.ts
 *
 * Sprint 21: Server actions for the project backup / disaster-recovery panel.
 *
 * Security:
 *  - All actions enforce backup.* permissions via requireProjectPermission.
 *  - No secret values, env values, or raw DB rows are ever returned to the client.
 *  - Checksum, backupRef, storagePath are safe non-secret identifiers.
 *  - Restore requires confirmationText === "RESTORE" — enforced both here and in
 *    the restore service.
 *  - Never auto-deploys after restore.
 *
 * NOTE: Only server action functions are exported from this file.
 * DTO types must be imported directly from @/lib/backups/project-backup-types.
 */

import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { createProjectBackup } from "@/lib/backups/project-backup-runner";
import {
  restoreProjectBackup,
  deleteProjectBackup,
  readBackupManifest,
} from "@/lib/backups/project-backup-restore";
import type { ProjectBackupDTO } from "@/lib/backups/project-backup-types";

// ── Shared result type ────────────────────────────────────────────────────────

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ── Helper: project slug/name lookup ─────────────────────────────────────────

async function getProjectMeta(
  projectId: string,
): Promise<{ slug: string; name: string } | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) return null;
  return { slug: project.slug, name: project.name };
}

// ── Helper: DB row → DTO ──────────────────────────────────────────────────────

function toBackupDTO(
  row: {
    id: string;
    backupRef: string;
    label: string | null;
    status: string;
    backupType: string;
    sizeBytes: number | null;
    fileCount: number | null;
    checksumSha256: string | null;
    includesSource: boolean;
    includesConfig: boolean;
    includesEnvKeys: boolean;
    includesSecrets: boolean;
    createdAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    restoreCount: number;
    lastRestoredAt: Date | null;
    createdBy?: { name: string | null; email: string | null } | null;
  },
  manifest: import("@/lib/backups/project-backup-types").BackupManifest | null = null,
): ProjectBackupDTO {
  const createdByUser = row.createdBy ?? null;
  const createdByName =
    createdByUser?.name ?? createdByUser?.email ?? null;

  return {
    id: row.id,
    backupRef: row.backupRef,
    label: row.label,
    status: row.status as ProjectBackupDTO["status"],
    backupType: row.backupType as ProjectBackupDTO["backupType"],
    sizeBytes: row.sizeBytes,
    fileCount: row.fileCount,
    checksumShort: row.checksumSha256 ? row.checksumSha256.slice(0, 8) : null,
    includesSource: row.includesSource,
    includesConfig: row.includesConfig,
    includesEnvKeys: row.includesEnvKeys,
    includesSecrets: row.includesSecrets,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    lastError: row.lastError,
    restoreCount: row.restoreCount,
    lastRestoredAt: row.lastRestoredAt?.toISOString() ?? null,
    manifest,
  };
}

// ── Create backup ─────────────────────────────────────────────────────────────

type CreateBackupInput = {
  projectId: string;
  label?: string;
  includeEnvKeys?: boolean;
};

export async function createProjectBackupAction(
  input: CreateBackupInput,
): Promise<ActionResult<{ backupId: string; backupRef: string }>> {
  const { projectId, label, includeEnvKeys = true } = input;

  const auth = await requireProjectPermission(projectId, "backup.create");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const meta = await getProjectMeta(projectId);
  if (!meta) return { ok: false, error: "Project not found." };

  const result = await createProjectBackup({
    projectId,
    projectSlug: meta.slug,
    projectName: meta.name,
    label,
    backupType: "manual",
    includeEnvKeys,
    createdByUserId: auth.userId,
  });

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "backup.create",
    category: "system",
    result: result.ok ? "success" : "failed",
    targetType: "backup",
    targetId: result.ok ? result.backupRef : undefined,
    targetLabel: label ?? "manual backup",
    summary: result.ok
      ? `Created backup ${result.backupRef} (${result.fileCount} files, ${Math.round((result.sizeBytes ?? 0) / 1024)} KB)`
      : `Backup creation failed: ${result.error}`,
    metadata: result.ok
      ? { backupRef: result.backupRef, fileCount: result.fileCount }
      : { error: result.error },
  }).catch(() => null);

  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, data: { backupId: result.backupId, backupRef: result.backupRef } };
}

// ── List backups ──────────────────────────────────────────────────────────────

type ListBackupsInput = {
  projectId: string;
  page?: number;
  pageSize?: number;
};

type ListBackupsOutput = {
  backups: ProjectBackupDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The current user's role — used client-side for permission-gate UI only. */
  role: import("@/lib/auth/project-permissions").ProjectRole;
};

export async function listProjectBackupsAction(
  input: ListBackupsInput,
): Promise<ActionResult<ListBackupsOutput>> {
  const { projectId } = input;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));

  const auth = await requireProjectPermission(projectId, "backup.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const [rows, total] = await Promise.all([
    db.projectBackup.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    db.projectBackup.count({ where: { projectId, deletedAt: null } }),
  ]);

  return {
    ok: true,
    data: {
      backups: rows.map((r) => toBackupDTO(r)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      role: auth.role,
    },
  };
}

// ── Get backup detail ─────────────────────────────────────────────────────────

type GetBackupDetailInput = {
  projectId: string;
  backupId: string;
};

export async function getProjectBackupDetailAction(
  input: GetBackupDetailInput,
): Promise<ActionResult<ProjectBackupDTO>> {
  const { projectId, backupId } = input;

  const auth = await requireProjectPermission(projectId, "backup.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const row = await db.projectBackup.findFirst({
    where: { id: backupId, projectId, deletedAt: null },
    include: { createdBy: { select: { name: true, email: true } } },
  });

  if (!row) return { ok: false, error: "Backup not found." };

  const meta = await getProjectMeta(projectId);
  const manifest = meta
    ? await readBackupManifest(meta.slug, row.backupRef)
    : null;

  return { ok: true, data: toBackupDTO(row, manifest) };
}

// ── Restore backup ────────────────────────────────────────────────────────────

type RestoreBackupInput = {
  projectId: string;
  backupId: string;
  confirmationText: string;
};

type RestoreBackupOutput = {
  preRestoreBackupRef: string | null;
};

export async function restoreProjectBackupAction(
  input: RestoreBackupInput,
): Promise<ActionResult<RestoreBackupOutput>> {
  const { projectId, backupId, confirmationText } = input;

  const auth = await requireProjectPermission(projectId, "backup.restore");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (confirmationText !== "RESTORE") {
    return { ok: false, error: 'Type "RESTORE" to confirm the restore operation.' };
  }

  const meta = await getProjectMeta(projectId);
  if (!meta) return { ok: false, error: "Project not found." };

  const backup = await db.projectBackup.findFirst({
    where: { id: backupId, projectId, deletedAt: null },
    select: { backupRef: true, label: true },
  });
  if (!backup) return { ok: false, error: "Backup not found." };

  const result = await restoreProjectBackup({
    backupId,
    projectId,
    projectSlug: meta.slug,
    projectName: meta.name,
    confirmationText,
    restoredByUserId: auth.userId,
  });

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "backup.restore",
    category: "system",
    result: result.ok ? "success" : "failed",
    targetType: "backup",
    targetId: backup.backupRef,
    targetLabel: backup.label ?? backup.backupRef,
    summary: result.ok
      ? `Restored project from backup ${backup.backupRef}. Pre-restore snapshot: ${result.preRestoreBackupRef ?? "none"}.`
      : `Restore failed for backup ${backup.backupRef}: ${result.error}`,
    metadata: result.ok
      ? { backupRef: backup.backupRef, preRestoreRef: result.preRestoreBackupRef }
      : { backupRef: backup.backupRef, error: result.error },
  }).catch(() => null);

  if (!result.ok) return { ok: false, error: result.error };

  // CRITICAL: never auto-deploy. User must trigger deployment manually.
  return { ok: true, data: { preRestoreBackupRef: result.preRestoreBackupRef } };
}

// ── Delete backup ─────────────────────────────────────────────────────────────

type DeleteBackupInput = {
  projectId: string;
  backupId: string;
};

export async function deleteProjectBackupAction(
  input: DeleteBackupInput,
): Promise<ActionResult<void>> {
  const { projectId, backupId } = input;

  const auth = await requireProjectPermission(projectId, "backup.delete");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const meta = await getProjectMeta(projectId);
  if (!meta) return { ok: false, error: "Project not found." };

  const backup = await db.projectBackup.findFirst({
    where: { id: backupId, projectId, deletedAt: null },
    select: { backupRef: true, label: true, backupType: true },
  });
  if (!backup) return { ok: false, error: "Backup not found." };

  const result = await deleteProjectBackup(backupId, projectId, meta.slug);

  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "backup.delete",
    category: "system",
    result: result.ok ? "success" : "failed",
    targetType: "backup",
    targetId: backup.backupRef,
    targetLabel: backup.label ?? backup.backupRef,
    summary: result.ok
      ? `Deleted backup ${backup.backupRef} (type: ${backup.backupType})`
      : `Delete failed for backup ${backup.backupRef}: ${result.error}`,
    metadata: { backupRef: backup.backupRef, backupType: backup.backupType },
  }).catch(() => null);

  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, data: undefined };
}
