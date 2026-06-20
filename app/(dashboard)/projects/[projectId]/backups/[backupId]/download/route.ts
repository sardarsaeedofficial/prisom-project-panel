/**
 * GET /projects/[projectId]/backups/[backupId]/download
 *
 * Sprint 21: Stream a backup archive to the authenticated browser as a
 * file download. Protected by backup.download permission.
 *
 * Security:
 *  - Session required — 401 if not authenticated
 *  - Project membership required — 403 if user is not a member
 *  - backup.download permission required
 *  - Archive path is resolved through resolveBackupDir (path-traversal safe)
 *  - backupRef is validated via isSafeRef before filesystem access
 *  - Content-Disposition forces "attachment" — never inline
 *  - No secrets are transmitted; the archive itself never contains .env values
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import {
  resolveBackupDir,
  isSafeRef,
  isSafeSlug,
} from "@/lib/backups/project-backup-safety";
import { BACKUP_ARCHIVE_NAME } from "@/lib/backups/project-backup-types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; backupId: string }> },
): Promise<NextResponse> {
  const { projectId, backupId } = await params;

  // ── 1. Auth + permission ──────────────────────────────────────────────────
  const auth = await requireProjectPermission(projectId, "backup.download");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }

  // ── 2. Load backup record ─────────────────────────────────────────────────
  const backup = await db.projectBackup.findFirst({
    where: { id: backupId, projectId, deletedAt: null },
    select: {
      backupRef: true,
      status: true,
      label: true,
      archiveName: true,
    },
  });

  if (!backup) {
    return NextResponse.json({ error: "Backup not found." }, { status: 404 });
  }

  if (backup.status !== "ready" && backup.status !== "restored") {
    return NextResponse.json(
      { error: `Backup is not available for download (status: ${backup.status}).` },
      { status: 409 },
    );
  }

  // ── 3. Resolve project slug ───────────────────────────────────────────────
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { slug: true, name: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (!isSafeSlug(project.slug) || !isSafeRef(backup.backupRef)) {
    return NextResponse.json(
      { error: "Internal configuration error." },
      { status: 500 },
    );
  }

  // ── 4. Resolve archive path ───────────────────────────────────────────────
  const backupDir = resolveBackupDir(project.slug, backup.backupRef);
  if (!backupDir) {
    return NextResponse.json(
      { error: "Internal configuration error." },
      { status: 500 },
    );
  }

  const archivePath = path.join(backupDir, backup.archiveName ?? BACKUP_ARCHIVE_NAME);

  // ── 5. Verify file exists ─────────────────────────────────────────────────
  let archiveStat: import("fs").Stats;
  try {
    archiveStat = await fs.stat(archivePath);
  } catch {
    return NextResponse.json(
      { error: "Backup archive file not found on server." },
      { status: 404 },
    );
  }

  // ── 6. Read archive and stream ────────────────────────────────────────────
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(archivePath);
  } catch {
    return NextResponse.json(
      { error: "Could not read backup archive." },
      { status: 500 },
    );
  }

  // Build a safe filename for Content-Disposition
  const safeProjectName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const filename = `backup_${safeProjectName}_${backup.backupRef}.zip`;

  // ── 7. Audit download event (fire-and-forget) ─────────────────────────────
  void writeProjectAuditEvent({
    projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "backup.download",
    category: "system",
    result: "success",
    targetType: "backup",
    targetId: backup.backupRef,
    targetLabel: backup.label ?? backup.backupRef,
    summary: `Downloaded backup archive ${backup.backupRef} (${Math.round(archiveStat.size / 1024)} KB)`,
    metadata: {
      backupRef: backup.backupRef,
      archiveSizeBytes: archiveStat.size,
      filename,
    },
  }).catch(() => null);

  // ── 8. Return the archive ─────────────────────────────────────────────────
  // Convert Buffer to Uint8Array for NextResponse compatibility
  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(archiveStat.size),
      // Prevent caching of backup archives (they contain project source code)
      "Cache-Control": "no-store",
    },
  });
}
