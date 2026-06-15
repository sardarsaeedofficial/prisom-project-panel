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
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { LogLevel, LogSource } from "@prisma/client";
import {
  getLocalGitStatus,
  initLocalRepo,
  addRemoteOrigin,
  pushToRemote,
  removeRemoteOrigin,
  isValidGitHubUrl,
  isValidBranchName,
  isBlockedRepoUrl,
  BLOCKED_REPO_SLUG,
} from "@/lib/projects/storage-git";

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
  const workspaceId = await getCurrentWorkspaceId();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      slug: true,
      workspaceId: true,
      githubRepository: { select: { id: true } },
    },
  });
  if (!project || project.workspaceId !== workspaceId) return null;
  return project;
}

// ── Shared blocklist message ──────────────────────────────────────────────────

const BLOCKED_REPO_MESSAGE =
  "You cannot connect an uploaded project to the Project Panel repository. " +
  "Create or choose a separate GitHub repo for this project.";

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
 *   - Upserts a GitHubRepository row (placeholder githubRepoId = Date.now())
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

  try {
    await db.gitHubRepository.upsert({
      where: { projectId },
      create: {
        projectId,
        githubRepoId: Date.now(),
        fullName,
        name: repoName,
        htmlUrl,
        url: `https://api.github.com/repos/${fullName}`,
        cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
        defaultBranch: cleanBranch,
      },
      update: {
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
    return { ok: false, output: remoteResult.output, error: `Database error: ${msg}` };
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
