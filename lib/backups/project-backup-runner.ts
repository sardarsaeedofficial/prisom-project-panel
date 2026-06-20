/**
 * lib/backups/project-backup-runner.ts
 *
 * Sprint 21: Core backup creation engine.
 *
 * Uses adm-zip (already in project lockfile) to create ZIP archives.
 * Archives are stored at:
 *   storage/backups/<slug>/<backupRef>/backup.zip
 *   storage/backups/<slug>/<backupRef>/manifest.json
 *
 * Environment handling:
 *   - Redacted mode: includes env var KEY names only, values replaced with "[REDACTED]"
 *   - Config-only mode: no env data at all
 *
 * Safety: all paths are resolved through project-backup-safety helpers.
 * No user input is ever passed directly to shell commands.
 */

import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { db } from "@/lib/db";
import {
  MAX_BACKUP_FILE_COUNT,
  MAX_BACKUP_SOURCE_BYTES,
  BACKUP_ARCHIVE_NAME,
  BACKUP_MANIFEST_NAME,
  type BackupManifest,
  type BackupType,
} from "./project-backup-types";
import {
  resolveProjectSource,
  resolveBackupDir,
  walkDirectory,
  isSafeSlug,
} from "./project-backup-safety";

// ── Backup reference generator ────────────────────────────────────────────────

function generateBackupRef(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  return `bkp_${date}_${time}_${rand}`;
}

// ── SHA-256 file hash ─────────────────────────────────────────────────────────

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── Input types ───────────────────────────────────────────────────────────────

export type CreateBackupInput = {
  projectId: string;
  projectSlug: string;
  projectName: string;
  label?: string;
  backupType?: BackupType;
  includeEnvKeys?: boolean;  // false = config-only, true = include redacted keys
  createdByUserId?: string | null;
};

export type CreateBackupResult =
  | { ok: true; backupId: string; backupRef: string; fileCount: number; sizeBytes: number }
  | { ok: false; error: string };

// ── Main backup function ──────────────────────────────────────────────────────

export async function createProjectBackup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  const {
    projectId,
    projectSlug,
    projectName,
    label,
    backupType = "manual",
    includeEnvKeys = true,
    createdByUserId,
  } = input;

  // ── 1. Validate slug ──────────────────────────────────────────────────────
  if (!isSafeSlug(projectSlug)) {
    return { ok: false, error: "Invalid project slug." };
  }

  // ── 2. Verify source directory ────────────────────────────────────────────
  const sourceDir = resolveProjectSource(projectSlug);
  if (!sourceDir) {
    return { ok: false, error: "Invalid project source path." };
  }

  let sourceStat: import("fs").Stats;
  try {
    sourceStat = await fs.stat(sourceDir);
  } catch {
    return { ok: false, error: "Backup source directory does not exist." };
  }
  if (!sourceStat.isDirectory()) {
    return { ok: false, error: "Backup source path is not a directory." };
  }

  // ── 3. Generate backup ref and create DB record ───────────────────────────
  const backupRef = generateBackupRef();
  const backupDir = resolveBackupDir(projectSlug, backupRef);
  if (!backupDir) {
    return { ok: false, error: "Could not resolve backup storage path." };
  }

  const storagePath = path.join("storage", "backups", projectSlug, backupRef);

  const dbRecord = await db.projectBackup.create({
    data: {
      projectId,
      backupRef,
      label: label ?? null,
      status: "creating",
      backupType,
      storagePath,
      archiveName: BACKUP_ARCHIVE_NAME,
      includesSource: true,
      includesConfig: true,
      includesEnvKeys: includeEnvKeys,
      includesSecrets: false,
      createdByUserId: createdByUserId ?? null,
    },
  });

  // ── 4. Collect source files ───────────────────────────────────────────────
  let walkResult: { entries: { absPath: string; relPath: string; sizeBytes: number }[]; skipped: number; totalBytes: number };
  try {
    walkResult = await walkDirectory(sourceDir, MAX_BACKUP_FILE_COUNT, MAX_BACKUP_SOURCE_BYTES);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await db.projectBackup.update({
      where: { id: dbRecord.id },
      data: { status: "failed", lastError: `Failed to scan source: ${msg}` },
    });
    return { ok: false, error: `Backup failed while scanning project files: ${msg}` };
  }

  if (walkResult.entries.length === 0) {
    await db.projectBackup.update({
      where: { id: dbRecord.id },
      data: { status: "failed", lastError: "No files found to back up." },
    });
    return { ok: false, error: "Backup source directory contains no backed-up files." };
  }

  // ── 5. Collect project config data ────────────────────────────────────────
  const [deployConfig, alertRules, alertSettings, envVars] = await Promise.all([
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
    db.projectAlertRule.findMany({ where: { projectId }, select: {
      id: true, name: true, type: true, severity: true, enabled: true, config: true,
    }}),
    db.projectAlertSettings.findUnique({ where: { projectId }, select: {
      schedulerEnabled: true, intervalMinutes: true, deliveryMode: true,
      notifyOnRecovery: true, repeatCooldownMinutes: true,
      // notificationEmail is excluded — it is PII/sensitive
    }}),
    includeEnvKeys
      ? db.projectEnvVar.findMany({ where: { projectId }, select: { name: true } })
      : Promise.resolve([]),
  ]);

  // ── 6. Build config JSON (no secrets) ────────────────────────────────────
  const configData: Record<string, unknown> = {};

  if (deployConfig) {
    configData.deploymentConfig = {
      port: deployConfig.port,
      pm2Name: deployConfig.pm2Name,
      installCommand: deployConfig.installCommand,
      buildCommand: deployConfig.buildCommand,
      startCommand: deployConfig.startCommand,
      rootDirectory: deployConfig.rootDirectory,
      healthPath: deployConfig.healthPath,
      nodeEnv: deployConfig.nodeEnv,
      // envVars are excluded — they contain encrypted secrets
    };
  }

  if (alertRules.length > 0) {
    configData.alertRules = alertRules;
  }

  if (alertSettings) {
    configData.alertSettings = alertSettings;
  }

  if (includeEnvKeys && envVars.length > 0) {
    // Key names only — values are NEVER included
    configData.envVarKeys = envVars.map((v) => ({
      key: v.name,
      value: "[REDACTED]",
    }));
  }

  // ── 7. Create backup directory ────────────────────────────────────────────
  try {
    await fs.mkdir(backupDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await db.projectBackup.update({
      where: { id: dbRecord.id },
      data: { status: "failed", lastError: `Could not create backup directory: ${msg}` },
    });
    return { ok: false, error: "Could not create backup storage directory." };
  }

  // ── 8. Build zip archive ──────────────────────────────────────────────────
  const archivePath = path.join(backupDir, BACKUP_ARCHIVE_NAME);

  try {
    const zip = new AdmZip();

    // Add source files under "source/" prefix
    for (const entry of walkResult.entries) {
      const zipEntry = `source/${entry.relPath}`;
      const content = await fs.readFile(entry.absPath);
      zip.addFile(zipEntry.replace(/\\/g, "/"), content);
    }

    // Add config JSON
    const configJson = JSON.stringify(configData, null, 2);
    zip.addFile("config/project-config.json", Buffer.from(configJson, "utf8"));

    // Write archive synchronously (adm-zip API)
    zip.writeZip(archivePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Clean up partial files
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => null);
    await db.projectBackup.update({
      where: { id: dbRecord.id },
      data: { status: "failed", lastError: `Archive creation failed: ${msg}` },
    });
    return { ok: false, error: "Failed to create backup archive." };
  }

  // ── 9. Compute checksum and size ──────────────────────────────────────────
  let checksumSha256: string;
  let archiveStat: import("fs").Stats;
  try {
    [checksumSha256, archiveStat] = await Promise.all([
      sha256File(archivePath),
      fs.stat(archivePath),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await db.projectBackup.update({
      where: { id: dbRecord.id },
      data: { status: "failed", lastError: `Checksum failed: ${msg}` },
    });
    return { ok: false, error: "Failed to verify backup archive." };
  }

  const sizeBytes = archiveStat.size;

  // ── 10. Write manifest.json ───────────────────────────────────────────────
  const manifest: BackupManifest = {
    backupRef,
    projectId,
    projectSlug,
    projectName,
    createdAt: new Date().toISOString(),
    backupType,
    fileCount: walkResult.entries.length,
    sizeBytes,
    checksumSha256,
    includesSecrets: false,
    includesEnvKeys: includeEnvKeys,
    includesSource: true,
    includesConfig: true,
    excluded: [
      "node_modules", ".next", ".git", ".env", ".env.*",
      "build", "dist", "out", "coverage", ".turbo", ".cache",
      "private keys", "secret files",
    ],
    sourceRoot: "source/",
    config: {
      deployment: !!deployConfig,
      alertRules: alertRules.length > 0,
      alertSettings: !!alertSettings,
      envKeys: includeEnvKeys && envVars.length > 0,
    },
    projectMeta: {
      projectId,
      projectSlug,
      projectName,
    },
  };

  const manifestPath = path.join(backupDir, BACKUP_MANIFEST_NAME);
  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  } catch {
    // Non-fatal — manifest write failure doesn't invalidate the archive
    console.warn("[backup] Failed to write manifest.json for", backupRef);
  }

  // ── 11. Update DB record to ready ─────────────────────────────────────────
  await db.projectBackup.update({
    where: { id: dbRecord.id },
    data: {
      status: "ready",
      sizeBytes,
      fileCount: walkResult.entries.length,
      checksumSha256,
      completedAt: new Date(),
      metadataJson: {
        sourceFilesFound: walkResult.entries.length,
        sourceFilesSkipped: walkResult.skipped,
        totalUncompressedBytes: walkResult.totalBytes,
        configSections: Object.keys(configData),
      },
    },
  });

  return {
    ok: true,
    backupId: dbRecord.id,
    backupRef,
    fileCount: walkResult.entries.length,
    sizeBytes,
  };
}
