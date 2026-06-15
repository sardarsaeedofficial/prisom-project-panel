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
  isValidGitHubUrl,
  isValidBranchName,
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

  // Log to DB regardless of outcome
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
 * Step 2 — Connect an existing GitHub repo to the local git repo.
 *
 * Validates the URL and branch, then:
 *   - Runs `git remote add origin <url>` (or set-url if one already exists)
 *   - Upserts a GitHubRepository row (placeholder githubRepoId = Date.now())
 *
 * Does NOT push. Does NOT pull.
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
      error: "Invalid GitHub repository URL. Use https://github.com/owner/repo or git@github.com:owner/repo",
    };
  }

  // ── Blocklist: prevent connecting to the Project Panel repo itself ─────────
  // Normalise the URL to a canonical "owner/repo" slug for comparison so
  // both HTTPS and SSH forms are caught, with or without a trailing .git.
  const urlSlug = repoUrl
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");

  if (urlSlug === "sardarsaeedofficial/prisom-project-panel") {
    return {
      ok: false,
      output: "",
      error:
        "You cannot connect an uploaded project to the Project Panel repository. " +
        "Create or choose a separate GitHub repo for this project.",
    };
  }

  const cleanBranch = branch.trim();
  if (!cleanBranch || !isValidBranchName(cleanBranch)) {
    return {
      ok: false,
      output: "",
      error: "Invalid branch name. Use only letters, numbers, hyphens, underscores, dots, or slashes.",
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

  // ── Derive display fields from URL ────────────────────────────────────────

  // e.g. "https://github.com/owner/repo.git" → "owner/repo"
  const fullName = repoUrl
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");

  const repoName = fullName.split("/").pop() ?? fullName;

  // Normalise to HTTPS browser URL for display
  const htmlUrl = repoUrl.startsWith("git@")
    ? `https://github.com/${fullName}`
    : repoUrl.replace(/\.git$/, "");

  // ── Upsert GitHubRepository row ───────────────────────────────────────────
  // githubRepoId is the GitHub API numeric ID — we don't have it yet, so we
  // use the same Date.now() placeholder pattern as createProject().
  // The real ID will be captured the next time a webhook fires or the user
  // triggers a sync via the GitHub App.

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

  // ── Log success ───────────────────────────────────────────────────────────

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

// ── Action: pushToGitHubAction ────────────────────────────────────────────────

/**
 * Step 3 — Push the local commits to GitHub.
 *
 * Runs `git push -u origin <branch>`.
 * Returns sanitised stdout/stderr and an `isAuthError` flag for targeted UI messaging.
 */
export async function pushToGitHubAction(
  projectId: string
): Promise<GitActionResult> {
  const project = await verifyProjectOwnership(projectId);
  if (!project) {
    return { ok: false, output: "", error: "Project not found or access denied.", isAuthError: false };
  }

  // Need both a local repo and a connected GitHub repo
  if (!project.githubRepository) {
    return {
      ok: false,
      output: "",
      error: "Connect a GitHub repository first (Step 2).",
      isAuthError: false,
    };
  }

  // Resolve current branch from git status
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

  // Use the branch from git status; fall back to the stored default branch
  const branch =
    gitStatus.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : (await db.gitHubRepository.findUnique({
          where: { projectId },
          select: { defaultBranch: true },
        }))?.defaultBranch ?? "main";

  const pushResult = await pushToRemote(project.slug, branch);

  // Log outcome
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
