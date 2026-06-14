import { db } from "@/lib/db";
import {
  FileType,
  GitSyncStatus,
  GitSyncSource,
  LogLevel,
  LogSource,
  ProjectType,
  ProjectStatus,
  Visibility,
  EnvironmentName,
  EnvironmentStatus,
  IntegrationType,
} from "@prisma/client";
import { getCurrentWorkspaceId, getCurrentUser } from "@/lib/current-workspace";
import { isGitHubAppConfigured, getGitHubWebhookUrl } from "@/lib/github/config";
import {
  listInstallationRepositories,
  getRepositoryCommits,
  getRepositoryTree,
  detectFrameworkFromPaths,
} from "@/lib/github/app-client";
import { slugify } from "@/lib/utils";

// ── Integration status ────────────────────────────────────────────────────────

export async function getGitHubIntegrationStatus() {
  const workspaceId = await getCurrentWorkspaceId();
  const [detectedCount, ignoredCount, importedCount] = await Promise.all([
    db.detectedRepository.count({ where: { workspaceId } }),
    db.ignoredRepository.count({ where: { workspaceId } }),
    db.gitHubRepository.count({ where: { project: { workspaceId } } }),
  ]);
  return {
    isConfigured: isGitHubAppConfigured(),
    webhookUrl: getGitHubWebhookUrl(),
    detectedCount,
    ignoredCount,
    importedCount,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getDetectedRepositories() {
  const workspaceId = await getCurrentWorkspaceId();
  return db.detectedRepository.findMany({
    where: { workspaceId },
    orderBy: { detectedAt: "desc" },
  });
}

export async function getIgnoredRepositories() {
  const workspaceId = await getCurrentWorkspaceId();
  return db.ignoredRepository.findMany({
    where: { workspaceId },
    orderBy: { ignoredAt: "desc" },
  });
}

export async function getImportedGitHubRepositories() {
  const workspaceId = await getCurrentWorkspaceId();
  return db.gitHubRepository.findMany({
    where: { project: { workspaceId } },
    include: {
      project: { select: { id: true, name: true, status: true } },
    },
    orderBy: { syncedAt: "desc" },
  });
}

// ── Webhook upsert ────────────────────────────────────────────────────────────

export type DetectedRepoInput = {
  githubRepoId: number;
  fullName: string;
  name: string;
  description?: string | null;
  private: boolean;
  language?: string | null;
  defaultBranch: string;
  url: string; // HTML (browser) URL — e.g. https://github.com/owner/repo
  installationId?: number | null; // GitHub App installation ID (from webhook payloads)
};

/**
 * Creates or updates a DetectedRepository from a webhook payload.
 * Caller is responsible for passing the workspaceId (already resolved before calling).
 */
export async function upsertDetectedRepositoryFromWebhook(
  workspaceId: string,
  input: DetectedRepoInput
) {
  return db.detectedRepository.upsert({
    where: {
      workspaceId_githubRepoId: { workspaceId, githubRepoId: input.githubRepoId },
    },
    create: {
      workspaceId,
      githubRepoId: input.githubRepoId,
      fullName: input.fullName,
      name: input.name,
      description: input.description ?? null,
      private: input.private,
      language: input.language ?? null,
      defaultBranch: input.defaultBranch,
      url: input.url,
      installationId: input.installationId ?? null,
    },
    update: {
      fullName: input.fullName,
      name: input.name,
      description: input.description ?? null,
      language: input.language ?? null,
      defaultBranch: input.defaultBranch,
      url: input.url,
      ...(input.installationId != null && { installationId: input.installationId }),
    },
  });
}

// ── Ignore / restore ──────────────────────────────────────────────────────────

export async function ignoreDetectedRepository(repositoryId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const detected = await db.detectedRepository.findUnique({
    where: { id: repositoryId },
  });
  if (!detected || detected.workspaceId !== workspaceId) {
    throw new Error("Repository not found.");
  }

  await db.ignoredRepository.upsert({
    where: {
      workspaceId_githubRepoId: {
        workspaceId,
        githubRepoId: detected.githubRepoId,
      },
    },
    create: { workspaceId, githubRepoId: detected.githubRepoId, fullName: detected.fullName },
    update: {},
  });

  await db.detectedRepository.delete({ where: { id: repositoryId } });
}

export async function restoreIgnoredRepository(repositoryId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const ignored = await db.ignoredRepository.findUnique({
    where: { id: repositoryId },
  });
  if (!ignored || ignored.workspaceId !== workspaceId) {
    throw new Error("Repository not found.");
  }

  const name = ignored.fullName.split("/")[1] ?? ignored.fullName;

  await db.detectedRepository.upsert({
    where: {
      workspaceId_githubRepoId: {
        workspaceId,
        githubRepoId: ignored.githubRepoId,
      },
    },
    create: {
      workspaceId,
      githubRepoId: ignored.githubRepoId,
      fullName: ignored.fullName,
      name,
      url: `https://github.com/${ignored.fullName}`,
      defaultBranch: "main",
    },
    update: {},
  });

  await db.ignoredRepository.delete({ where: { id: repositoryId } });
}

// ── Import as project ─────────────────────────────────────────────────────────

export async function importDetectedRepositoryAsProject(repositoryId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const user = await getCurrentUser();

  const detected = await db.detectedRepository.findUnique({
    where: { id: repositoryId },
  });
  if (!detected || detected.workspaceId !== workspaceId) {
    throw new Error("Repository not found.");
  }

  const alreadyImported = await db.gitHubRepository.findUnique({
    where: { githubRepoId: detected.githubRepoId },
  });
  if (alreadyImported) {
    throw new Error("This repository is already linked to a project.");
  }

  const slug = await buildUniqueSlug(workspaceId, slugify(detected.name));

  const project = await db.project.create({
    data: {
      workspaceId,
      ownerId: user.id,
      name: detected.name,
      slug,
      description: detected.description ?? null,
      type: ProjectType.OTHER,
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PRIVATE,
      language: detected.language ?? null,
      githubRepository: {
        create: {
          githubRepoId: detected.githubRepoId,
          fullName: detected.fullName,
          name: detected.name,
          description: detected.description ?? null,
          private: detected.private,
          defaultBranch: detected.defaultBranch,
          language: detected.language ?? null,
          htmlUrl: detected.url,
          url: `https://api.github.com/repos/${detected.fullName}`,
          cloneUrl: `https://github.com/${detected.fullName}.git`,
          installationId: detected.installationId ?? null,
        },
      },
    },
  });

  await db.environment.createMany({
    data: [
      {
        projectId: project.id,
        name: EnvironmentName.DEVELOPMENT,
        status: EnvironmentStatus.ACTIVE,
      },
      {
        projectId: project.id,
        name: EnvironmentName.PRODUCTION,
        status: EnvironmentStatus.ACTIVE,
      },
    ],
  });

  await db.detectedRepository.delete({ where: { id: repositoryId } });

  return project;
}

// ── Push event processing ─────────────────────────────────────────────────────

export type GitCommitInput = {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: string; // ISO 8601
  added: string[];
  modified: string[];
  removed: string[];
};

export type RecordPushEventInput = {
  projectId: string;
  gitHubRepositoryId: string;
  branch: string;
  beforeSha: string;
  afterSha: string;
  commits: GitCommitInput[];
};

export async function recordGitHubPushEvent(input: RecordPushEventInput) {
  const syncRun = await createGitSyncRun({
    projectId: input.projectId,
    source: GitSyncSource.WEBHOOK,
    branch: input.branch,
    beforeSha: input.beforeSha,
    afterSha: input.afterSha,
  });

  let syncedCommits = 0;
  for (const commit of input.commits) {
    try {
      const ts = new Date(commit.timestamp);
      await db.gitCommit.upsert({
        where: { projectId_sha: { projectId: input.projectId, sha: commit.sha } },
        create: {
          projectId: input.projectId,
          sha: commit.sha,
          message: commit.message,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authoredAt: ts,
          committedAt: ts,
          changedFiles:
            commit.added.length + commit.modified.length + commit.removed.length,
        },
        update: {},
      });
      syncedCommits++;
    } catch {
      // Swallow duplicate / invalid commit errors — sync run still succeeds
    }
  }

  const totalChanged = input.commits.reduce(
    (acc, c) => acc + c.added.length + c.modified.length + c.removed.length,
    0
  );

  await db.gitHubRepository.update({
    where: { id: input.gitHubRepositoryId },
    data: { pushedAt: new Date(), syncedAt: new Date() },
  });

  await db.projectLog.create({
    data: {
      projectId: input.projectId,
      level: LogLevel.INFO,
      source: LogSource.GITHUB,
      message: `Push to ${input.branch}: ${syncedCommits} commit(s), ${totalChanged} file change(s)`,
      metadata: {
        ref: `refs/heads/${input.branch}`,
        before: input.beforeSha,
        after: input.afterSha,
        commitCount: syncedCommits,
      },
    },
  });

  await completeGitSyncRun({
    id: syncRun.id,
    status: GitSyncStatus.SUCCESS,
    changedFiles: totalChanged,
  });

  return { syncedCommits, totalChanged };
}

// ── Sync run helpers ──────────────────────────────────────────────────────────

export type CreateGitSyncRunInput = {
  projectId: string;
  source: GitSyncSource;
  branch: string;
  beforeSha?: string;
  afterSha?: string;
};

export async function createGitSyncRun(input: CreateGitSyncRunInput) {
  return db.gitSyncRun.create({
    data: {
      projectId: input.projectId,
      status: GitSyncStatus.RUNNING,
      source: input.source,
      branch: input.branch,
      beforeSha: input.beforeSha ?? null,
      afterSha: input.afterSha ?? null,
      startedAt: new Date(),
    },
  });
}

export type CompleteGitSyncRunInput = {
  id: string;
  status: GitSyncStatus;
  changedFiles?: number;
  errorMessage?: string;
  afterSha?: string;
};

export async function completeGitSyncRun(input: CompleteGitSyncRunInput) {
  return db.gitSyncRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      changedFiles: input.changedFiles ?? 0,
      errorMessage: input.errorMessage ?? null,
      finishedAt: new Date(),
      ...(input.afterSha ? { afterSha: input.afterSha } : {}),
    },
  });
}

// ── GitHub API: known installation IDs ───────────────────────────────────────

/**
 * Finds all distinct GitHub App installation IDs for the current workspace,
 * checking four sources in priority order:
 *   1. Integration.installationId  (manually recorded via the UI)
 *   2. GitHubRepository.installationId  (linked repos)
 *   3. DetectedRepository.installationId  (repos seen from webhooks)
 *   4. GitHubWebhookDelivery.installationId  (raw webhook history)
 *
 * The demo installation ID (987654) is automatically filtered out when any
 * real (non-demo) IDs are present, so a fresh real test is never confused by
 * leftover seed data.
 */
export async function getKnownInstallationIds(): Promise<number[]> {
  const DEMO_ID = 987654;
  const workspaceId = await getCurrentWorkspaceId();

  const [integrations, linked, detected, deliveries] = await Promise.all([
    // 1. Integration record — highest priority (manually entered real ID)
    db.integration.findMany({
      where: { workspaceId, type: IntegrationType.GITHUB, installationId: { not: null } },
      select: { installationId: true },
    }),
    // 2. Linked GitHub repositories
    db.gitHubRepository.findMany({
      where: { installationId: { not: null }, project: { workspaceId } },
      select: { installationId: true },
    }),
    // 3. Detected repositories (from webhook upserts)
    db.detectedRepository.findMany({
      where: { installationId: { not: null }, workspaceId },
      select: { installationId: true },
    }),
    // 4. Webhook delivery history
    db.gitHubWebhookDelivery.findMany({
      where: {
        installationId: { not: null },
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      select: { installationId: true },
      distinct: ["installationId"],
    }),
  ]);

  const ids = new Set([
    ...integrations.map((r) => r.installationId!),
    ...linked.map((r) => r.installationId!),
    ...detected.map((r) => r.installationId!),
    ...deliveries.map((r) => r.installationId!),
  ]);

  // If any real (non-demo) installation ID is known, strip the demo one so
  // the Refresh button never wastes an API call on fake seed data.
  const hasRealIds = [...ids].some((id) => id !== DEMO_ID);
  if (hasRealIds) {
    ids.delete(DEMO_ID);
  }

  return [...ids];
}

// ── GitHub API: manual refresh ────────────────────────────────────────────────

export type ManualRefreshResult = {
  success: boolean;
  error?: string;
  upserted?: number;
  /** Per-installation API errors collected during a multi-installation refresh. */
  installationErrors?: Array<{ installationId: number; error: string }>;
};

/**
 * Calls the GitHub API to list installation repos and upserts new ones into
 * DetectedRepository (skipping already-imported or user-ignored repos).
 *
 * Checks four sources for installation IDs (Integration record, linked repos,
 * detected repos, webhook deliveries) and skips the demo ID 987654 when any
 * real ID is known. Returns a descriptive error when the API call fails so the
 * UI can surface the exact problem (wrong App ID, missing private key, etc.).
 */
export async function refreshInstallationRepositories(): Promise<ManualRefreshResult> {
  if (!isGitHubAppConfigured()) {
    return { success: false, error: "GitHub App credentials are not configured." };
  }

  const installationIds = await getKnownInstallationIds();
  if (installationIds.length === 0) {
    return {
      success: false,
      error:
        "No GitHub App installation ID found. " +
        "Record your installation ID using the panel on /integrations/github " +
        "(or install the GitHub App and push a commit to receive the installation webhook).",
    };
  }

  const workspaceId = await getCurrentWorkspaceId();
  let totalUpserted = 0;
  const installationErrors: Array<{ installationId: number; error: string }> = [];

  for (const installationId of installationIds) {
    try {
      const repos = await listInstallationRepositories(installationId);

      for (const repo of repos) {
        // Skip already-imported repos
        const imported = await db.gitHubRepository.findUnique({
          where: { githubRepoId: repo.id },
          select: { id: true },
        });
        if (imported) continue;

        // Skip user-ignored repos
        const ignored = await db.ignoredRepository.findFirst({
          where: { workspaceId, githubRepoId: repo.id },
          select: { id: true },
        });
        if (ignored) continue;

        await upsertDetectedRepositoryFromWebhook(workspaceId, {
          githubRepoId: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          description: repo.description,
          private: repo.private,
          language: repo.language,
          defaultBranch: repo.default_branch,
          url: repo.html_url,
          installationId,
        });
        totalUpserted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[GitHub] Error refreshing installation ${installationId}: ${msg}`);
      installationErrors.push({ installationId, error: msg });
    }
  }

  // If every installation failed and nothing was upserted, report as failure
  if (installationErrors.length > 0 && totalUpserted === 0 && installationErrors.length === installationIds.length) {
    const first = installationErrors[0];
    return {
      success: false,
      error: `GitHub API error for installation ${first.installationId}: ${first.error}`,
      installationErrors,
      upserted: 0,
    };
  }

  return {
    success: true,
    upserted: totalUpserted,
    ...(installationErrors.length > 0 && { installationErrors }),
  };
}

// ── GitHub API: project sync ──────────────────────────────────────────────────

export type SyncResult = {
  success: boolean;
  error?: string;
  commits?: number;
  files?: number;
  framework?: string;
};

const CHUNK = 500; // rows per createMany batch

/**
 * Syncs a project from GitHub: fetches commits, replaces the full file tree,
 * detects framework/language from file paths, updates project fields if blank.
 */
export async function syncProjectFromGitHub(projectId: string): Promise<SyncResult> {
  if (!isGitHubAppConfigured()) {
    return { success: false, error: "GitHub App credentials are not configured." };
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { githubRepository: true },
  });

  if (!project) return { success: false, error: "Project not found." };
  if (!project.githubRepository) {
    return { success: false, error: "No GitHub repository is linked to this project." };
  }

  const repo = project.githubRepository;

  // ── Resolve installation ID (attempt backfill before giving up) ────────────
  let installationId = repo.installationId;

  if (!installationId) {
    await backfillGitHubRepositoryInstallationIds({ repoId: repo.id });
    const refreshed = await db.gitHubRepository.findUnique({
      where: { id: repo.id },
      select: { installationId: true },
    });
    installationId = refreshed?.installationId ?? null;

    if (!installationId) {
      return {
        success: false,
        error:
          "GitHub App installation ID is missing. Install the GitHub App on this repository, then push a commit or use the 'Repair installation ID' button to recover it automatically.",
      };
    }
  }

  const parts = repo.fullName.split("/");
  const owner = parts[0];
  const repoName = parts[1];
  if (!owner || !repoName) {
    return { success: false, error: `Invalid repository name: "${repo.fullName}"` };
  }

  const syncRun = await createGitSyncRun({
    projectId,
    source: GitSyncSource.MANUAL,
    branch: repo.defaultBranch,
  });

  try {
    // 1. Commits ─────────────────────────────────────────────────────────────
    const commits = await getRepositoryCommits({
      owner,
      repo: repoName,
      installationId,
      branch: repo.defaultBranch,
    });

    for (const c of commits) {
      try {
        await db.gitCommit.upsert({
          where: { projectId_sha: { projectId, sha: c.sha } },
          create: {
            projectId,
            sha: c.sha,
            message: c.commit.message.split("\n")[0], // first line only
            authorName: c.commit.author?.name ?? "Unknown",
            authorEmail: c.commit.author?.email ?? "",
            authoredAt: new Date(c.commit.author?.date ?? Date.now()),
            committedAt: new Date(c.commit.committer?.date ?? Date.now()),
            url: c.html_url,
          },
          update: {},
        });
      } catch {
        // skip duplicates or validation errors
      }
    }

    // 2. File tree ────────────────────────────────────────────────────────────
    const treeData = await getRepositoryTree({
      owner,
      repo: repoName,
      installationId,
      treeSha: repo.defaultBranch,
    });

    const filePaths = treeData.tree
      .filter((i) => i.type === "blob" && i.path)
      .map((i) => i.path!);
    const detection = detectFrameworkFromPaths(filePaths);

    // Replace all project files with the fresh tree
    await db.projectFile.deleteMany({ where: { projectId } });

    const fileRows = treeData.tree
      .filter((item) => item.path && (item.type === "blob" || item.type === "tree"))
      .map((item) => ({
        projectId,
        path: item.path!,
        name: item.path!.split("/").pop()!,
        type: item.type === "blob" ? FileType.FILE : FileType.DIRECTORY,
        size: item.size ?? null,
        sha: item.sha ?? null,
      }));

    for (let i = 0; i < fileRows.length; i += CHUNK) {
      await db.projectFile.createMany({
        data: fileRows.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
    }

    // 3. Update GitHubRepository ──────────────────────────────────────────────
    const latestSha = commits[0]?.sha ?? null;
    await db.gitHubRepository.update({
      where: { id: repo.id },
      data: {
        latestCommitSha: latestSha,
        syncedAt: new Date(),
        ...(latestSha ? { pushedAt: new Date() } : {}),
      },
    });

    // 4. Back-fill project fields only when they're currently blank ───────────
    const projectPatch: Record<string, string | null> = {};
    if (detection.framework && !project.framework)
      projectPatch.framework = detection.framework;
    if (detection.language && !project.language)
      projectPatch.language = detection.language;
    if (detection.buildCommand && !project.buildCommand)
      projectPatch.buildCommand = detection.buildCommand;
    if (detection.startCommand && !project.startCommand)
      projectPatch.startCommand = detection.startCommand;
    if (detection.installCommand && !project.installCommand)
      projectPatch.installCommand = detection.installCommand;

    if (Object.keys(projectPatch).length > 0) {
      await db.project.update({ where: { id: projectId }, data: projectPatch });
    }

    // 5. Project log ──────────────────────────────────────────────────────────
    const fileCount = fileRows.filter((f) => f.type === FileType.FILE).length;
    await db.projectLog.create({
      data: {
        projectId,
        level: LogLevel.INFO,
        source: LogSource.GITHUB,
        message: `Manual sync: ${commits.length} commit(s), ${fileCount} file(s) from ${repo.fullName}`,
        metadata: {
          branch: repo.defaultBranch,
          latestSha,
          framework: detection.framework,
          truncated: treeData.truncated,
        },
      },
    });

    // 6. Complete sync run ────────────────────────────────────────────────────
    await completeGitSyncRun({
      id: syncRun.id,
      status: GitSyncStatus.SUCCESS,
      afterSha: latestSha ?? undefined,
      changedFiles: fileCount,
    });

    return {
      success: true,
      commits: commits.length,
      files: fileCount,
      framework: detection.framework ?? undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await completeGitSyncRun({
      id: syncRun.id,
      status: GitSyncStatus.FAILED,
      errorMessage: msg,
    });
    return { success: false, error: `Sync failed: ${msg}` };
  }
}

// ── Link / unlink ─────────────────────────────────────────────────────────────

/**
 * Links a DetectedRepository to an existing project by creating a
 * GitHubRepository record on that project, then removes the detected entry.
 */
export async function linkDetectedRepositoryToProject(
  detectedRepoId: string,
  projectId: string
) {
  const workspaceId = await getCurrentWorkspaceId();

  const detected = await db.detectedRepository.findUnique({
    where: { id: detectedRepoId },
  });
  if (!detected || detected.workspaceId !== workspaceId) {
    throw new Error("Detected repository not found.");
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { githubRepository: { select: { id: true } } },
  });
  if (!project || project.workspaceId !== workspaceId) {
    throw new Error("Project not found.");
  }
  if (project.githubRepository) {
    throw new Error(`"${project.name}" already has a GitHub repository linked.`);
  }

  // Guard: repo is not already linked to another project
  const existingLink = await db.gitHubRepository.findUnique({
    where: { githubRepoId: detected.githubRepoId },
    select: { id: true },
  });
  if (existingLink) {
    throw new Error(
      "This GitHub repository is already linked to another project."
    );
  }

  await db.gitHubRepository.create({
    data: {
      projectId,
      githubRepoId: detected.githubRepoId,
      fullName: detected.fullName,
      name: detected.name,
      description: detected.description ?? null,
      private: detected.private,
      defaultBranch: detected.defaultBranch,
      language: detected.language ?? null,
      htmlUrl: detected.url,
      url: `https://api.github.com/repos/${detected.fullName}`,
      cloneUrl: `https://github.com/${detected.fullName}.git`,
      installationId: detected.installationId ?? null,
    },
  });

  await db.detectedRepository.delete({ where: { id: detectedRepoId } });

  await db.projectLog.create({
    data: {
      projectId,
      level: LogLevel.INFO,
      source: LogSource.GITHUB,
      message: `GitHub repository ${detected.fullName} linked to project`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: { githubRepoId: detected.githubRepoId, fullName: detected.fullName } as any,
    },
  });

  return { projectId };
}

/**
 * Removes the GitHubRepository link from a project.
 * GitCommit and ProjectFile history is intentionally kept.
 */
export async function unlinkGitHubRepository(projectId: string) {
  const workspaceId = await getCurrentWorkspaceId();

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      githubRepository: {
        select: { id: true, fullName: true, githubRepoId: true },
      },
    },
  });
  if (!project || project.workspaceId !== workspaceId) {
    throw new Error("Project not found.");
  }
  if (!project.githubRepository) {
    throw new Error("No GitHub repository is linked to this project.");
  }

  const { id: repoId, fullName } = project.githubRepository;

  await db.gitHubRepository.delete({ where: { id: repoId } });

  await db.projectLog.create({
    data: {
      projectId,
      level: LogLevel.INFO,
      source: LogSource.GITHUB,
      message: `GitHub repository ${fullName} unlinked from project (commit and file history retained)`,
    },
  });

  return { projectId };
}

/**
 * Permanently removes an ignored repository from the workspace list.
 */
export async function permanentlyDeleteIgnoredRepository(repositoryId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const ignored = await db.ignoredRepository.findUnique({
    where: { id: repositoryId },
  });
  if (!ignored || ignored.workspaceId !== workspaceId) {
    throw new Error("Repository not found.");
  }
  return db.ignoredRepository.delete({ where: { id: repositoryId } });
}

// ── Data loaders for pages ────────────────────────────────────────────────────

/** Loads all data needed for the /projects/[id]/github page. */
export async function getProjectGitHubData(projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    include: {
      githubRepository: true,
      commits: {
        orderBy: { committedAt: "desc" },
        take: 25,
      },
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 5,
      },
      _count: {
        select: { commits: true, files: true },
      },
      logs: {
        where: { source: { in: [LogSource.GITHUB, LogSource.SYSTEM] } },
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { id: true, message: true, timestamp: true, level: true },
      },
    },
  });
}

/** Loads all ProjectFile records for the /projects/[id]/files page. */
export async function getProjectFiles(projectId: string) {
  return db.projectFile.findMany({
    where: { projectId },
    orderBy: [{ path: "asc" }],
  });
}

// ── Installation ID backfill ──────────────────────────────────────────────────

export type BackfillResult = {
  updated: number;
  skipped: number;
};

/**
 * Finds GitHubRepository records where installationId is null and attempts
 * to recover the installation ID using a multi-strategy lookup:
 *
 *   1. DetectedRepository match by githubRepoId
 *   2. DetectedRepository match by fullName
 *   3. GitHubWebhookDelivery match by repositoryFullName (most recent delivery)
 *   4. If exactly one installation ID is known across all sources, use it
 *
 * Pass `repoId` to repair a single repository; omit to repair all.
 * Never throws — returns { updated, skipped } for UI feedback.
 */
export async function backfillGitHubRepositoryInstallationIds(opts?: {
  repoId?: string;
  workspaceId?: string;
}): Promise<BackfillResult> {
  const where = opts?.repoId
    ? { id: opts.repoId, installationId: null }
    : opts?.workspaceId
      ? { installationId: null, project: { workspaceId: opts.workspaceId } }
      : { installationId: null };

  const missing = await db.gitHubRepository.findMany({
    where,
    select: { id: true, githubRepoId: true, fullName: true },
  });

  if (missing.length === 0) return { updated: 0, skipped: 0 };

  // Pre-fetch all known installation IDs for the workspace-fallback strategy
  const scopeWorkspaceId =
    opts?.workspaceId ??
    (await getCurrentWorkspaceId().catch(() => null));

  const [detectedWithIds, deliveriesWithIds, linkedWithIds] = await Promise.all([
    db.detectedRepository.findMany({
      where: {
        installationId: { not: null },
        ...(scopeWorkspaceId ? { workspaceId: scopeWorkspaceId } : {}),
      },
      select: { installationId: true, githubRepoId: true, fullName: true },
    }),
    db.gitHubWebhookDelivery.findMany({
      where: { installationId: { not: null } },
      select: { installationId: true, repositoryFullName: true },
      orderBy: { receivedAt: "desc" },
    }),
    db.gitHubRepository.findMany({
      where: { installationId: { not: null } },
      select: { installationId: true },
      distinct: ["installationId"],
    }),
  ]);

  // Build lookup maps
  const detectedByRepoId = new Map<number, number>();
  const detectedByFullName = new Map<string, number>();
  for (const d of detectedWithIds) {
    if (d.installationId) {
      detectedByRepoId.set(d.githubRepoId, d.installationId);
      detectedByFullName.set(d.fullName, d.installationId);
    }
  }

  // For deliveries, keep only the first (most recent) per fullName
  const deliveryByFullName = new Map<string, number>();
  for (const d of deliveriesWithIds) {
    if (d.installationId && d.repositoryFullName && !deliveryByFullName.has(d.repositoryFullName)) {
      deliveryByFullName.set(d.repositoryFullName, d.installationId);
    }
  }

  // Build global set of all known IDs (for the single-ID fallback)
  const allKnownIds = new Set<number>([
    ...detectedWithIds.map((d) => d.installationId!),
    ...deliveriesWithIds.map((d) => d.installationId!),
    ...linkedWithIds.map((d) => d.installationId!),
  ]);
  const singleFallback = allKnownIds.size === 1 ? [...allKnownIds][0] : null;

  let updated = 0;
  let skipped = 0;

  for (const repo of missing) {
    let installationId: number | null = null;

    // Strategy 1: DetectedRepository by githubRepoId
    installationId ??= detectedByRepoId.get(repo.githubRepoId) ?? null;

    // Strategy 2: DetectedRepository by fullName
    installationId ??= detectedByFullName.get(repo.fullName) ?? null;

    // Strategy 3: Most recent webhook delivery for this repo
    installationId ??= deliveryByFullName.get(repo.fullName) ?? null;

    // Strategy 4: Only one known installation ID in the entire system
    installationId ??= singleFallback;

    if (installationId) {
      await db.gitHubRepository.update({
        where: { id: repo.id },
        data: { installationId },
      });
      updated++;
    } else {
      skipped++;
    }
  }

  return { updated, skipped };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function buildUniqueSlug(workspaceId: string, base: string): Promise<string> {
  const existing = await db.project.findMany({
    where: { workspaceId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const slugSet = new Set(existing.map((p) => p.slug));
  if (!slugSet.has(base)) return base;
  let n = 2;
  while (slugSet.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
