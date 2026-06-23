/**
 * lib/github/github-sync-service.ts
 *
 * Sprint 40: Safe GitHub auto-sync service.
 *
 * Safety rules (matches Sprint 40 spec):
 *  - Never auto-pull on a dirty worktree — returns "dirty" status
 *  - Only runs git fetch + ff-only pull (no force, no rebase, no reset)
 *  - Uses git-manager.ts which enforces GIT_CEILING_DIRECTORIES isolation
 *  - Auto-deploy only after a confirmed successful pull + autoDeployEnabled
 *  - Never exposes tokens or secrets in output
 *  - Never touches unrelated projects
 *  - All destructive operations require operation locking (via the deploy runner)
 */

import path   from "path";
import { db } from "@/lib/db";
import {
  fetchProjectRepo,
  getProjectGitStatus,
  pullProjectRepo,
}             from "@/lib/projects/git-manager";
import type {
  GitHubSyncSettings,
  GitHubSyncResult,
  UpdateSyncSettingsInput,
} from "./github-sync-types";

// ── Project source root ───────────────────────────────────────────────────────

function projectSourceRoot(slug: string): string {
  return path.resolve(process.cwd(), "storage", "projects", slug);
}

// ── DB row → DTO ──────────────────────────────────────────────────────────────

function toSettingsDTO(row: {
  id:               string;
  projectId:        string;
  autoPullEnabled:  boolean;
  autoDeployEnabled: boolean;
  lastLocalSha:     string | null;
  lastRemoteSha:    string | null;
  lastSyncStatus:   string | null;
  lastSyncMessage:  string | null;
  lastSyncedAt:     Date | null;
  lastWebhookAt:    Date | null;
  createdAt:        Date;
  updatedAt:        Date;
}): GitHubSyncSettings {
  return {
    id:               row.id,
    projectId:        row.projectId,
    autoPullEnabled:  row.autoPullEnabled,
    autoDeployEnabled: row.autoDeployEnabled,
    lastLocalSha:     row.lastLocalSha,
    lastRemoteSha:    row.lastRemoteSha,
    lastSyncStatus:   (row.lastSyncStatus as GitHubSyncSettings["lastSyncStatus"]) ?? null,
    lastSyncMessage:  row.lastSyncMessage,
    lastSyncedAt:     row.lastSyncedAt?.toISOString() ?? null,
    lastWebhookAt:    row.lastWebhookAt?.toISOString() ?? null,
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
  };
}

const SETTINGS_SELECT = {
  id:               true,
  projectId:        true,
  autoPullEnabled:  true,
  autoDeployEnabled: true,
  lastLocalSha:     true,
  lastRemoteSha:    true,
  lastSyncStatus:   true,
  lastSyncMessage:  true,
  lastSyncedAt:     true,
  lastWebhookAt:    true,
  createdAt:        true,
  updatedAt:        true,
} as const;

// ── Get or create settings ────────────────────────────────────────────────────

export async function getOrCreateSyncSettings(
  projectId: string,
): Promise<GitHubSyncSettings> {
  const existing = await db.projectGitHubSyncSettings.findUnique({
    where:  { projectId },
    select: SETTINGS_SELECT,
  });
  if (existing) return toSettingsDTO(existing);

  const created = await db.projectGitHubSyncSettings.create({
    data:   { projectId },
    select: SETTINGS_SELECT,
  });
  return toSettingsDTO(created);
}

// ── Update settings ───────────────────────────────────────────────────────────

export async function updateSyncSettings(
  projectId: string,
  input:     UpdateSyncSettingsInput,
): Promise<GitHubSyncSettings> {
  const row = await db.projectGitHubSyncSettings.upsert({
    where:  { projectId },
    create: { projectId, ...input },
    update: input,
    select: SETTINGS_SELECT,
  });
  return toSettingsDTO(row);
}

// ── Run local git sync ────────────────────────────────────────────────────────

/**
 * Core sync logic:
 *  1. Resolve project slug → local source path
 *  2. git fetch (always — updates remote tracking refs)
 *  3. git status (checks dirty + ahead/behind)
 *  4. If dirty → mark "dirty", update settings, return early
 *  5. If behind and autoPullEnabled → git pull --ff-only
 *  6. Update settings with new status + SHAs
 *  7. Return result (callers queue auto-deploy if needed)
 */
export async function runLocalGitSync(
  projectId: string,
  opts: { autoPull: boolean } = { autoPull: false },
): Promise<GitHubSyncResult> {
  // Resolve slug
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true },
  });
  if (!project) {
    return { ok: false, status: "failed", message: "Project not found." };
  }

  const root = projectSourceRoot(project.slug);

  // ── Step 1: fetch ─────────────────────────────────────────────────────────
  const fetchResult = await fetchProjectRepo(root);
  if (!fetchResult.ok) {
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "failed", lastSyncMessage: fetchResult.error, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "failed", lastSyncMessage: fetchResult.error, lastSyncedAt: new Date() },
    });
    return { ok: false, status: "failed", message: fetchResult.error };
  }

  // ── Step 2: status ────────────────────────────────────────────────────────
  const statusResult = await getProjectGitStatus(root);
  if (!statusResult.ok || !statusResult.data.isRepo) {
    const msg = !statusResult.ok ? statusResult.error : "Not a git repository.";
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "failed", lastSyncMessage: msg, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "failed", lastSyncMessage: msg, lastSyncedAt: new Date() },
    });
    return { ok: false, status: "failed", message: msg };
  }

  const { clean, behind, ahead, recentCommits } = statusResult.data;
  const localSha = recentCommits[0]?.hash ?? null;

  // ── Step 3: dirty worktree guard ──────────────────────────────────────────
  if (!clean) {
    const msg = "Worktree has uncommitted changes — auto-pull skipped.";
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "dirty", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "dirty", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
    });
    return { ok: true, status: "dirty", message: msg };
  }

  // ── Step 4: up-to-date? ───────────────────────────────────────────────────
  if (behind === 0) {
    const msg = ahead > 0
      ? `Local is ${ahead} commit(s) ahead of remote — no pull needed.`
      : "Already up to date.";
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "synced", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "synced", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
    });
    return { ok: true, status: "synced", message: msg };
  }

  // ── Step 5: behind remote ─────────────────────────────────────────────────
  if (!opts.autoPull) {
    const msg = `${behind} commit(s) behind remote. Enable auto-pull to update automatically.`;
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "behind", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "behind", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
    });
    return { ok: true, status: "behind", message: msg };
  }

  // ── Step 6: pull ──────────────────────────────────────────────────────────
  const pullResult = await pullProjectRepo(root, true);
  if (!pullResult.ok) {
    const msg = pullResult.error;
    await db.projectGitHubSyncSettings.upsert({
      where:  { projectId },
      create: { projectId, lastSyncStatus: "failed", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
      update: { lastSyncStatus: "failed", lastSyncMessage: msg, lastLocalSha: localSha, lastSyncedAt: new Date() },
    });
    return { ok: false, status: "failed", message: msg };
  }

  // Re-read status after pull to get the new HEAD SHA
  const afterStatus = await getProjectGitStatus(root);
  const newLocalSha = afterStatus.ok && afterStatus.data.isRepo
    ? afterStatus.data.recentCommits[0]?.hash ?? localSha
    : localSha;

  const msg = `Pulled ${behind} commit(s) from remote.`;
  await db.projectGitHubSyncSettings.upsert({
    where:  { projectId },
    create: { projectId, lastSyncStatus: "synced", lastSyncMessage: msg, lastLocalSha: newLocalSha, lastSyncedAt: new Date() },
    update: { lastSyncStatus: "synced", lastSyncMessage: msg, lastLocalSha: newLocalSha, lastSyncedAt: new Date() },
  });

  return { ok: true, status: "synced", message: msg, pulledCommits: behind };
}

// ── Record webhook received ───────────────────────────────────────────────────

export async function recordWebhookReceived(projectId: string): Promise<void> {
  await db.projectGitHubSyncSettings.upsert({
    where:  { projectId },
    create: { projectId, lastWebhookAt: new Date() },
    update: { lastWebhookAt: new Date() },
  }).catch(() => null);
}
