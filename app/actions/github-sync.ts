"use server";

/**
 * app/actions/github-sync.ts
 *
 * Sprint 40: Server actions for GitHub auto-sync settings and manual git ops.
 *
 * Safety rules:
 *  - All actions require project.view or deploy.trigger permission
 *  - Never auto-push without explicit `confirmed: true` gate
 *  - Never return token values, secrets, or env var values
 *  - Never run git operations on a dirty worktree without user awareness
 *  - Commit/push requires explicit per-call confirmation
 */

import path from "path";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  getOrCreateSyncSettings,
  updateSyncSettings,
  runLocalGitSync,
} from "@/lib/github/github-sync-service";
import {
  getProjectGitStatus,
  stageProjectFiles,
  commitProjectChanges,
  pushProjectRepo,
} from "@/lib/projects/git-manager";
import { createBackgroundJob } from "@/lib/jobs/background-job-service";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { db } from "@/lib/db";
import type { SyncSettingsResult, UpdateSyncSettingsInput, GitHubSyncSettings } from "@/lib/github/github-sync-types";
import type { GitRepoStatus } from "@/lib/projects/git-manager";

// ── Helpers ───────────────────────────────────────────────────────────────────

function projectSourceRoot(slug: string): string {
  return path.resolve(process.cwd(), "storage", "projects", slug);
}

async function requireView(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "project.view");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

async function requireDeploy(projectId: string) {
  const ctx = await requireProjectPermission(projectId, "deploy.trigger");
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx;
}

// ── Get sync settings ─────────────────────────────────────────────────────────

export async function getSyncSettingsAction(
  projectId: string,
): Promise<SyncSettingsResult> {
  try {
    await requireView(projectId);
    const settings = await getOrCreateSyncSettings(projectId);
    return { ok: true, settings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load sync settings." };
  }
}

// ── Update sync settings ──────────────────────────────────────────────────────

export async function updateSyncSettingsAction(
  projectId: string,
  input:     UpdateSyncSettingsInput,
): Promise<SyncSettingsResult> {
  try {
    const ctx = await requireDeploy(projectId);
    const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
    const settings = await updateSyncSettings(projectId, input);

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      actorEmail:  user?.email ?? ctx.userId,
      category:    "git",
      action:      "project.github.sync_settings_updated",
      summary:     `GitHub sync settings updated`,
      result:      "success",
      metadata:    input as Record<string, unknown>,
    });

    return { ok: true, settings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update sync settings." };
  }
}

// ── Get local git status ──────────────────────────────────────────────────────

export async function getLocalGitStatusAction(
  projectId: string,
): Promise<{ ok: true; status: GitRepoStatus } | { ok: false; error: string }> {
  try {
    await requireView(projectId);
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true },
    });
    if (!project) return { ok: false, error: "Project not found." };

    const result = await getProjectGitStatus(projectSourceRoot(project.slug));
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, status: result.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to read git status." };
  }
}

// ── Trigger manual sync (queued background job) ───────────────────────────────

export async function triggerManualSyncAction(
  projectId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  try {
    await requireDeploy(projectId);
    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true },
    });
    if (!project) return { ok: false, error: "Project not found." };

    const jobId = await createBackgroundJob({
      jobType:     "github_sync",
      scopeType:   "project",
      projectId,
      title:       "Manual GitHub Sync",
      description: "Manually triggered git fetch + pull",
      metadata:    { projectId, triggeredBy: "manual" },
      maxAttempts: 1,
      priority:    7,
    });

    return { ok: true, jobId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to queue sync job." };
  }
}

// ── Trigger manual sync inline (immediate, no job queue) ──────────────────────

export async function triggerInlineSyncAction(
  projectId: string,
): Promise<
  | { ok: true; status: GitHubSyncSettings["lastSyncStatus"]; message: string }
  | { ok: false; error: string }
> {
  try {
    await requireDeploy(projectId);
    const settings = await getOrCreateSyncSettings(projectId);
    const result = await runLocalGitSync(projectId, { autoPull: settings.autoPullEnabled });
    if (result.ok) return { ok: true,  status: result.status, message: result.message };
    return            { ok: false, error: result.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed." };
  }
}

// ── Stage + commit ────────────────────────────────────────────────────────────

export async function stageAndCommitAction(
  projectId: string,
  files:     string[],
  message:   string,
): Promise<{ ok: true; hash: string; output: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireDeploy(projectId);
    const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });

    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true },
    });
    if (!project) return { ok: false, error: "Project not found." };

    const root = projectSourceRoot(project.slug);

    const staged = await stageProjectFiles(root, files);
    if (!staged.ok) return { ok: false, error: staged.error };

    const committed = await commitProjectChanges(root, message);
    if (!committed.ok) return { ok: false, error: committed.error };

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      actorEmail:  user?.email ?? ctx.userId,
      category:    "git",
      action:      "project.github.local_commit",
      summary:     `Committed ${staged.data.staged} file(s): ${message.slice(0, 60)}`,
      result:      "success",
      metadata:    { hash: committed.data.hash, fileCount: staged.data.staged },
    });

    return { ok: true, hash: committed.data.hash, output: committed.data.output };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Commit failed." };
  }
}

// ── Push to remote ────────────────────────────────────────────────────────────

export async function pushToRemoteAction(
  projectId: string,
  branch:    string,
  confirmed: boolean,
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  if (!confirmed) {
    return { ok: false, error: "Push requires explicit confirmation." };
  }

  try {
    const ctx = await requireDeploy(projectId);
    const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });

    const project = await db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true },
    });
    if (!project) return { ok: false, error: "Project not found." };

    const root   = projectSourceRoot(project.slug);
    const result = await pushProjectRepo(root, branch, true);

    if (!result.ok) return { ok: false, error: result.error };

    await writeProjectAuditEvent({
      projectId,
      actorUserId: ctx.userId,
      actorEmail:  user?.email ?? ctx.userId,
      category:    "git",
      action:      "project.github.local_push",
      summary:     `Pushed branch ${branch} to remote`,
      result:      "success",
      metadata:    { branch },
    });

    return { ok: true, output: result.data.output };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Push failed." };
  }
}
