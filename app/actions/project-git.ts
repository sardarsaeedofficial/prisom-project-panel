"use server";

/**
 * app/actions/project-git.ts
 *
 * Server actions for local git workflow (init → connect GitHub → push).
 *
 * Every action:
 *  1. Verifies the project belongs to the current workspace (IDOR prevention)
 *  2. Validates all external inputs before passing them to git helpers
 *  3. Logs the operation to ProjectLog for auditability
 *  4. Returns a { ok, output, error } shape — never throws to the client
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import { LogLevel, LogSource } from "@prisma/client";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { getAuditRequestContext } from "@/lib/audit/request-context";
import {
  getLocalGitStatus,
  initLocalRepo,
  addRemoteOrigin,
  pushToRemote,
  removeRemoteOrigin,
  isValidGitHubUrl,
  isValidBranchName,
  isBlockedRepoUrl,
  stableGitHubRepoPlaceholderId,
  resolveStoragePath,
  BLOCKED_REPO_SLUG,
  type LocalGitStatus,
} from "@/lib/projects/storage-git";
import {
  getProjectGitStatus,
  getProjectGitDiff,
  stageProjectFiles,
  unstageProjectFiles,
  commitProjectChanges,
  fetchProjectRepo,
  pullProjectRepo,
  pushProjectRepo,
} from "@/lib/projects/git-manager";
// Import Sprint 8 types under aliases to avoid collision with the existing
// non-generic `GitActionResult` type that the older actions in this file use.
import type {
  GitActionResult as GitOpResult,
  GitRepoStatus,
} from "@/lib/projects/git-manager";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GitActionResult = {
  ok: boolean;
  output: string;
  error: string;
  isAuthError?: boolean;
};

// ── Ownership guard ───────────────────────────────────────────────────────────

/**
 * Returns the project if it belongs to the current workspace.
 * Returns null if not found or ownership mismatch.
 */
async function verifyProjectOwnership(projectId: string) {
  // Sprint 17: git operations require github.view permission
  const auth = await requireProjectPermission(projectId, "github.view");
  if (!auth.ok) return null;
  return db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      slug: true,
      workspaceId: true,
      githubRepository: { select: { id: true } },
    },
  });
}

// ── Shared blocklist message ──────────────────────────────────────────────────

const BLOCKED_REPO_MESSAGE =
  "You cannot connect an uploaded project to the Project Panel repository. " +
  "Create or choose a separate GitHub repo for this project.";

// ── Types (extended) ─────────────────────────────────────────────────────────

export type RefreshStatusResult = {
  ok: boolean;
  gitStatus?: LocalGitStatus;
  error: string;
};

// ── Action: refreshGitStatusAction ────────────────────────────────────────────

/**
 * Re-reads the local git status from disk.
 * Detects upstream tracking ref so the UI can recognise a push that happened
 * outside the panel (e.g. manually from the VPS).
 */
export async function refreshGitStatusAction(
  projectId: string
): Promise<RefreshStatusResult> {
  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return { ok: false, error: "Project not found or access denied." };
  }

  const status = await getLocalGitStatus(project.slug);
  return { ok: true, gitStatus: status, error: "" };
}

// ── Action: initLocalGitRepoAction ────────────────────────────────────────────

/**
 * Step 1 — Initialize a local git repository for an uploaded/blank project.
 *
 * Runs: git init → write .gitignore → git add -A → git commit
 *
 * Does NOT touch the GitHub API or push anything.
 */
export async function initLocalGitRepoAction(
  projectId: string
): Promise<GitActionResult> {
  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return { ok: false, output: "", error: "Project not found or access denied." };
  }

  const result = await initLocalRepo(project.slug);

  await db.projectLog.create({
    data: {
      projectId,
      level: result.ok ? LogLevel.INFO : LogLevel.ERROR,
      source: LogSource.SYSTEM,
      message: result.ok
        ? "Local git repository initialized"
        : `Failed to initialize local git repo: ${result.error}`,
      metadata: { output: result.output } as object,
    },
  });

  if (result.ok) {
    revalidatePath(`/projects/${projectId}/github`);
  }

  return result;
}

// ── Action: connectGitHubRepoAction ──────────────────────────────────────────

/**
 * Step 2 — Connect (or change) the GitHub repo linked to the local git repo.
 *
 * Validates the URL and branch, then:
 *   - Blocks if the URL is the Project Panel repo itself
 *   - Runs `git remote add origin <url>` (or set-url if one already exists)
 *   - Upserts a GitHubRepository row (placeholder githubRepoId = FNV-1a hash, INT4-safe)
 *
 * Does NOT push. Does NOT pull.
 * Safe to call again to change an existing remote — just re-runs set-url + upsert.
 */
export async function connectGitHubRepoAction(
  projectId: string,
  repoUrl: string,
  branch: string
): Promise<GitActionResult> {
  // ── Input validation ──────────────────────────────────────────────────────

  if (!repoUrl || !isValidGitHubUrl(repoUrl)) {
    return {
      ok: false,
      output: "",
      error:
        "Invalid GitHub repository URL. Use https://github.com/owner/repo or git@github.com:owner/repo",
    };
  }

  // ── Blocklist ─────────────────────────────────────────────────────────────

  if (isBlockedRepoUrl(repoUrl)) {
    return { ok: false, output: "", error: BLOCKED_REPO_MESSAGE };
  }

  const cleanBranch = branch.trim();
  if (!cleanBranch || !isValidBranchName(cleanBranch)) {
    return {
      ok: false,
      output: "",
      error:
        "Invalid branch name. Use only letters, numbers, hyphens, underscores, dots, or slashes.",
    };
  }

  // ── Ownership check ───────────────────────────────────────────────────────

  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return { ok: false, output: "", error: "Project not found or access denied." };
  }

  // ── Must have a local git repo first ─────────────────────────────────────

  const gitStatus = await getLocalGitStatus(project.slug);
  if (!gitStatus.initialized) {
    return {
      ok: false,
      output: "",
      error: "Initialize a local git repository first (Step 1).",
    };
  }

  // ── Add/update remote ─────────────────────────────────────────────────────

  const remoteResult = await addRemoteOrigin(project.slug, repoUrl, cleanBranch);
  if (!remoteResult.ok) {
    await db.projectLog.create({
      data: {
        projectId,
        level: LogLevel.ERROR,
        source: LogSource.GITHUB,
        message: `Failed to add remote origin: ${remoteResult.error}`,
        metadata: { repoUrl, branch: cleanBranch, output: remoteResult.output } as object,
      },
    });
    return remoteResult;
  }

  // ── Derive display fields from URL (case-preserved) ───────────────────────

  const fullName = repoUrl
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");

  const repoName = fullName.split("/").pop() ?? fullName;

  const htmlUrl = repoUrl.startsWith("git@")
    ? `https://github.com/${fullName}`
    : repoUrl.replace(/\.git$/, "");

  // ── Upsert GitHubRepository row ───────────────────────────────────────────

  // Stable INT4-safe placeholder — salted with projectId to avoid githubRepoId
  // unique-constraint collisions when two projects connect to the same remote.
  // Never uses Date.now() (overflows INT4 since ~year 2001).
  const placeholderId = stableGitHubRepoPlaceholderId(repoUrl, projectId);

  try {
    await db.gitHubRepository.upsert({
      where: { projectId },
      create: {
        projectId,
        githubRepoId: placeholderId,
        fullName,
        name: repoName,
        htmlUrl,
        url: `https://api.github.com/repos/${fullName}`,
        cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
        defaultBranch: cleanBranch,
      },
      update: {
        // githubRepoId intentionally NOT updated — preserves the original
        // placeholder (or real ID if a sync/webhook has already set it)
        fullName,
        name: repoName,
        htmlUrl,
        url: `https://api.github.com/repos/${fullName}`,
        cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
        defaultBranch: cleanBranch,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    await db.projectLog.create({
      data: {
        projectId,
        level: LogLevel.ERROR,
        source: LogSource.GITHUB,
        message: `Failed to save GitHub repository record: ${msg}`,
      },
    });
    // The git remote was already updated (set-url is idempotent), so retrying
    // the Connect step is safe — addRemoteOrigin will re-run set-url and the
    // DB write will be attempted again with the same deterministic placeholder.
    return {
      ok: false,
      output: remoteResult.output,
      error:
        "Git remote was updated, but database save failed. Please retry — the remote is already set.",
    };
  }

  await db.projectLog.create({
    data: {
      projectId,
      level: LogLevel.INFO,
      source: LogSource.GITHUB,
      message: `Connected to GitHub repo: ${fullName} (branch: ${cleanBranch})`,
      metadata: { repoUrl, branch: cleanBranch, output: remoteResult.output } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/github`);

  return remoteResult;
}

// ── Action: disconnectGitHubRepoAction ───────────────────────────────────────

/**
 * Removes the git remote origin from the storage directory and deletes the
 * GitHubRepository DB row.  Idempotent — safe to call even if no remote exists.
 */
export async function disconnectGitHubRepoAction(
  projectId: string
): Promise<GitActionResult> {
  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return { ok: false, output: "", error: "Project not found or access denied." };
  }

  // Remove git remote (idempotent)
  const removeResult = await removeRemoteOrigin(project.slug);
  // Continue even if the git remove failed (the repo dir may not exist yet)

  // Delete DB row
  try {
    await db.gitHubRepository.deleteMany({ where: { projectId } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB error";
    await db.projectLog.create({
      data: {
        projectId,
        level: LogLevel.ERROR,
        source: LogSource.GITHUB,
        message: `Failed to delete GitHub repository record: ${msg}`,
        metadata: { output: removeResult.output } as object,
      },
    });
    return { ok: false, output: removeResult.output, error: `Database error: ${msg}` };
  }

  await db.projectLog.create({
    data: {
      projectId,
      level: LogLevel.INFO,
      source: LogSource.GITHUB,
      message: "GitHub repository disconnected",
      metadata: { output: removeResult.output } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/github`);

  return { ok: true, output: removeResult.output, error: "" };
}

// ── Action: pushToGitHubAction ────────────────────────────────────────────────

/**
 * Step 3 — Push the local commits to GitHub.
 *
 * Runs `git push -u origin <branch>`.
 * Blocks if the current remote is the blocked Project Panel repo.
 * Returns sanitised stdout/stderr and an `isAuthError` flag for targeted UI messaging.
 */
export async function pushToGitHubAction(
  projectId: string
): Promise<GitActionResult> {
  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return {
      ok: false,
      output: "",
      error: "Project not found or access denied.",
      isAuthError: false,
    };
  }

  if (!project.githubRepository) {
    return {
      ok: false,
      output: "",
      error: "Connect a GitHub repository first (Step 2).",
      isAuthError: false,
    };
  }

  const gitStatus = await getLocalGitStatus(project.slug);
  if (!gitStatus.initialized) {
    return {
      ok: false,
      output: "",
      error: "Local git repository not initialised (run Step 1 first).",
      isAuthError: false,
    };
  }
  if (!gitStatus.hasRemote) {
    return {
      ok: false,
      output: "",
      error: "No remote origin configured (run Step 2 first).",
      isAuthError: false,
    };
  }

  // ── Blocklist check on the actual configured remote ───────────────────────

  const remoteUrl = gitStatus.remoteUrl ?? "";
  if (remoteUrl && isBlockedRepoUrl(remoteUrl)) {
    return {
      ok: false,
      output: "",
      error:
        `The configured remote (${BLOCKED_REPO_SLUG}) is the Project Panel repository. ` +
        "Disconnect it and connect a separate repository before pushing.",
      isAuthError: false,
    };
  }

  // Resolve branch: prefer git status, fall back to stored default
  const branch =
    gitStatus.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : (
          await db.gitHubRepository.findUnique({
            where: { projectId },
            select: { defaultBranch: true },
          })
        )?.defaultBranch ?? "main";

  const pushResult = await pushToRemote(project.slug, branch);

  await db.projectLog.create({
    data: {
      projectId,
      level: pushResult.ok ? LogLevel.INFO : LogLevel.ERROR,
      source: LogSource.GITHUB,
      message: pushResult.ok
        ? `Pushed to GitHub: origin/${branch}`
        : `Push to GitHub failed${pushResult.isAuthError ? " (auth error)" : ""}: ${pushResult.error}`,
      metadata: { branch, output: pushResult.output } as object,
    },
  });

  if (pushResult.ok) {
    revalidatePath(`/projects/${projectId}/github`);
  }

  return pushResult;
}

// ── Sprint 8: Git Operations Panel ───────────────────────────────────────────
//
// These actions power the ProjectGitPanel component.
// Every action verifies project ownership before touching the filesystem.
// Remote URLs are redacted inside git-manager before being returned here.
//
// Re-exported types (import type only — not values, to avoid Turbopack errors):
// GitRepoStatus, GitChangedFile, GitRemote, GitCommitSummary, GitActionResult
// are all importable directly from "@/lib/projects/git-manager".

/** Resolves the storage root for a project, throws on invalid slug. */
function getStorageRoot(slug: string): string {
  return resolveStoragePath(slug);
}

// ── Ownership helper (Sprint 8 version — returns slug too) ───────────────────

async function verifyOwnershipWithSlug(projectId: string) {
  // Sprint 17: git operations require github.view permission
  const auth = await requireProjectPermission(projectId, "github.view");
  if (!auth.ok) return null;
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true, workspaceId: true },
  });
  if (!project) return null;
  // Sprint 18: include auth data for audit
  return { ...project, _userId: auth.userId, _role: auth.role };
}

// ── Action: getProjectGitStatusAction ────────────────────────────────────────

export async function getProjectGitStatusAction(
  projectId: string,
): Promise<GitOpResult<GitRepoStatus>> {
  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  return getProjectGitStatus(root);
}

// ── Action: getProjectGitDiffAction ──────────────────────────────────────────

export async function getProjectGitDiffAction(input: {
  projectId: string;
  path:      string | null;
  staged:    boolean;
}): Promise<GitOpResult<{ diff: string; truncated: boolean }>> {
  const { projectId, path: filePath, staged } = input;

  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  return getProjectGitDiff(root, filePath, staged);
}

// ── Action: stageProjectFilesAction ──────────────────────────────────────────

export async function stageProjectFilesAction(input: {
  projectId: string;
  paths:     string[];
}): Promise<GitOpResult<{ staged: number; blocked: string[] }>> {
  const { projectId, paths } = input;

  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  const result = await stageProjectFiles(root, paths);

  if (result.ok) {
    await db.projectLog.create({
      data: {
        projectId,
        level:   LogLevel.INFO,
        source:  LogSource.SYSTEM,
        message: `Staged ${result.data.staged} file(s)`,
      },
    }).catch(() => null);
  }

  return result;
}

// ── Action: unstageProjectFilesAction ────────────────────────────────────────

export async function unstageProjectFilesAction(input: {
  projectId: string;
  paths:     string[];
}): Promise<GitOpResult<{ unstaged: number }>> {
  const { projectId, paths } = input;

  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  return unstageProjectFiles(root, paths);
}

// ── Action: commitProjectChangesAction ───────────────────────────────────────

export async function commitProjectChangesAction(input: {
  projectId: string;
  message:   string;
}): Promise<GitOpResult<{ hash: string; output: string }>> {
  const { projectId, message } = input;

  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  const result = await commitProjectChanges(root, message);

  await db.projectLog.create({
    data: {
      projectId,
      level:   result.ok ? LogLevel.INFO : LogLevel.ERROR,
      source:  LogSource.SYSTEM,
      message: result.ok
        ? `Committed: ${result.data.hash} — ${message.trim().slice(0, 100)}`
        : `Commit failed: ${result.error}`,
    },
  }).catch(() => null);

  if (result.ok) {
    revalidatePath(`/projects/${projectId}/github`);
  }

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: project._userId,
    actorRole: project._role,
    action: "git.commit.created",
    category: "git",
    result: result.ok ? "success" : "failed",
    targetId: result.ok ? result.data.hash : undefined,
    summary: result.ok
      ? `Git commit: ${result.data.hash.slice(0, 8)} — ${message.trim().slice(0, 100)}`
      : `Git commit failed: ${result.error?.slice(0, 200)}`,
    metadata: result.ok
      ? { hash: result.data.hash, messagePreview: message.trim().slice(0, 200) }
      : { error: result.error?.slice(0, 200) },
    ...ctx,
  });

  return result;
}

// ── Action: fetchProjectRepoAction ───────────────────────────────────────────

export async function fetchProjectRepoAction(
  projectId: string,
): Promise<GitOpResult<{ output: string }>> {
  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  const result = await fetchProjectRepo(root);

  await db.projectLog.create({
    data: {
      projectId,
      level:   result.ok ? LogLevel.INFO : LogLevel.WARN,
      source:  LogSource.GITHUB,
      message: result.ok ? "Fetched from origin" : `Fetch failed: ${result.error}`,
    },
  }).catch(() => null);

  return result;
}

// ── Action: pullProjectRepoAction ────────────────────────────────────────────
//
// Sprint 8 rule: "Do not auto-pull if working tree has uncommitted changes."
// We read the current status here and refuse if not clean.

export async function pullProjectRepoAction(
  projectId: string,
): Promise<GitOpResult<{ output: string }>> {
  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  // Check working-tree cleanliness before attempting pull
  const statusResult = await getProjectGitStatus(root);
  if (!statusResult.ok) return { ok: false, error: statusResult.error };
  const clean = statusResult.data.clean;

  const result = await pullProjectRepo(root, clean);

  await db.projectLog.create({
    data: {
      projectId,
      level:   result.ok ? LogLevel.INFO : LogLevel.WARN,
      source:  LogSource.GITHUB,
      message: result.ok
        ? "Pulled from origin (--ff-only)"
        : `Pull failed: ${result.error}`,
    },
  }).catch(() => null);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: project._userId,
    actorRole: project._role,
    action: "git.pull",
    category: "git",
    result: result.ok ? "success" : "failed",
    summary: result.ok ? "Pulled from origin (--ff-only)" : `Pull failed: ${result.error?.slice(0, 200)}`,
    metadata: { clean },
    ...ctx,
  });

  return result;
}

// ── Action: pushProjectRepoAction ────────────────────────────────────────────
//
// Sprint 8 rules: no force-push; confirmed:true required.

export async function pushProjectRepoAction(input: {
  projectId: string;
  confirmed: boolean;
}): Promise<GitOpResult<{ output: string; isAuthError: boolean }>> {
  const { projectId, confirmed } = input;

  if (!confirmed) {
    return { ok: false, error: "Push requires explicit confirmation." };
  }

  const project = await verifyOwnershipWithSlug(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  let root: string;
  try { root = getStorageRoot(project.slug); }
  catch { return { ok: false, error: "Invalid project storage path." }; }

  // Resolve current branch
  const statusResult = await getProjectGitStatus(root);
  if (!statusResult.ok) return { ok: false, error: statusResult.error };
  const branch = statusResult.data.branch;
  if (!branch || branch === "HEAD") {
    return { ok: false, error: "Cannot push: no branch checked out (detached HEAD)." };
  }

  const result = await pushProjectRepo(root, branch, true);

  await db.projectLog.create({
    data: {
      projectId,
      level:   result.ok ? LogLevel.INFO : LogLevel.ERROR,
      source:  LogSource.GITHUB,
      message: result.ok
        ? `Pushed branch "${branch}" to origin`
        : `Push failed: ${result.error}`,
    },
  }).catch(() => null);

  if (result.ok) {
    revalidatePath(`/projects/${projectId}/github`);
  }

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId,
    actorUserId: project._userId,
    actorRole: project._role,
    action: "git.push",
    category: "git",
    result: result.ok ? "success" : "failed",
    summary: result.ok
      ? `Pushed branch "${branch}" to origin`
      : `Push failed: ${result.error?.slice(0, 200)}`,
    metadata: { branch, isAuthError: result.ok ? (result.data.isAuthError ?? false) : false },
    ...ctx,
  });

  return result;
}
