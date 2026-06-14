"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ignoreDetectedRepository,
  restoreIgnoredRepository,
  importDetectedRepositoryAsProject,
  refreshInstallationRepositories,
  syncProjectFromGitHub,
  linkDetectedRepositoryToProject,
  unlinkGitHubRepository,
  permanentlyDeleteIgnoredRepository,
  backfillGitHubRepositoryInstallationIds,
  type SyncResult,
  type BackfillResult,
} from "@/lib/data/github";
import { db } from "@/lib/db";
import { IntegrationType, IntegrationStatus } from "@prisma/client";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";

export async function ignoreDetectedRepositoryAction(
  repositoryId: string
): Promise<void> {
  await ignoreDetectedRepository(repositoryId);
  revalidatePath("/integrations/github");
}

export async function restoreIgnoredRepositoryAction(
  repositoryId: string
): Promise<void> {
  await restoreIgnoredRepository(repositoryId);
  revalidatePath("/integrations/github");
}

export async function importDetectedRepositoryAction(
  repositoryId: string
): Promise<void> {
  const project = await importDetectedRepositoryAsProject(repositoryId);
  revalidatePath("/integrations/github");
  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

/**
 * Calls the GitHub API to list installation repos and upserts new ones into
 * DetectedRepository. Returns a structured result for client components.
 */
export async function manualRefreshGitHubStatusAction(): Promise<{
  ok: boolean;
  message: string;
  count?: number;
}> {
  try {
    const result = await refreshInstallationRepositories();
    revalidatePath("/integrations/github");

    if (result.success) {
      const n = result.upserted ?? 0;
      let message =
        n === 0
          ? "Up to date — no new repositories found."
          : `Found ${n} new repositor${n === 1 ? "y" : "ies"}.`;

      // Surface per-installation API errors as a note even when some succeeded
      if (result.installationErrors && result.installationErrors.length > 0) {
        message += ` (${result.installationErrors.length} installation(s) had API errors — check server logs)`;
      }

      return { ok: true, message, count: n };
    }
    return { ok: false, message: result.error ?? "Refresh failed." };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Syncs commits and file tree for a project from GitHub.
 * Returns a result object so client components can display success/error.
 */
export async function syncGitHubProjectAction(
  projectId: string
): Promise<SyncResult> {
  const result = await syncProjectFromGitHub(projectId);

  if (result.success) {
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/github`);
    revalidatePath(`/projects/${projectId}/files`);
  }

  return result;
}

/**
 * Links a detected repository to an existing project.
 * Returns null on success or an error object for the client to display.
 */
export async function linkDetectedRepositoryToProjectAction(
  detectedRepositoryId: string,
  projectId: string
): Promise<{ error: string } | null> {
  try {
    await linkDetectedRepositoryToProject(detectedRepositoryId, projectId);
    revalidatePath("/integrations/github");
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/github`);
    return null;
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to link repository.",
    };
  }
}

/**
 * Removes the GitHub repository link from a project.
 * Commit and file history is intentionally preserved.
 */
export async function unlinkGitHubRepositoryAction(
  projectId: string
): Promise<void> {
  await unlinkGitHubRepository(projectId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/github`);
  revalidatePath("/integrations/github");
}

/**
 * Permanently deletes an ignored repository from the workspace list.
 */
export async function permanentlyDeleteIgnoredRepositoryAction(
  repositoryId: string
): Promise<void> {
  await permanentlyDeleteIgnoredRepository(repositoryId);
  revalidatePath("/integrations/github");
}

/**
 * Attempts to fill in missing installationId values for GitHubRepository
 * records by matching against DetectedRepository and webhook delivery history.
 *
 * Pass `projectId` to repair a single project's repo; omit to repair all
 * repos in the current workspace.
 */
export async function backfillGitHubInstallationIdsAction(
  projectId?: string
): Promise<BackfillResult & { error?: string }> {
  try {
    let repoId: string | undefined;

    if (projectId) {
      const repo = await db.gitHubRepository.findFirst({
        where: { projectId },
        select: { id: true },
      });
      repoId = repo?.id;
    }

    const result = await backfillGitHubRepositoryInstallationIds(
      repoId ? { repoId } : undefined
    );

    // Revalidate affected pages
    revalidatePath("/integrations/github");
    revalidatePath("/projects");
    if (projectId) {
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}/github`);
    }

    return result;
  } catch (err) {
    return {
      updated: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}

/**
 * Manually records a GitHub App installation ID.
 *
 * Stores it in the GITHUB Integration record's dedicated `installationId` field
 * (upserts the record if none exists). After saving, the "Refresh Repositories"
 * button can use this ID to call the GitHub API and populate detected repos.
 *
 * How to find your installation ID:
 *   GitHub.com → Settings → Applications → Installed GitHub Apps → Configure
 *   The URL will contain: /installations/<installationId>
 */
export async function recordInstallationIdAction(
  installationId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      return { success: false, error: "Installation ID must be a positive integer." };
    }

    const workspaceId = await getCurrentWorkspaceId();

    // Upsert the GITHUB Integration row — the unique constraint is (workspaceId, type)
    await db.integration.upsert({
      where: { workspaceId_type: { workspaceId, type: IntegrationType.GITHUB } },
      create: {
        workspaceId,
        type: IntegrationType.GITHUB,
        status: IntegrationStatus.PENDING,
        installationId,
      },
      update: {
        installationId,
        // Preserve CONNECTED status if the integration was already connected
        // (only upgrade PENDING → PENDING; never downgrade from CONNECTED)
      },
    });

    revalidatePath("/integrations/github");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save installation ID.",
    };
  }
}
