/**
 * Lightweight aggregate queries powering the GitHub connection health panel
 * on /integrations/github.
 *
 * Kept separate from lib/data/github.ts to avoid that file growing further.
 */
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { isGitHubAppConfigured } from "@/lib/github/config";

export type GitHubHealthData = {
  appConfigured: boolean;
  webhookSecretSet: boolean;
  installationIds: number[];
  detectedCount: number;
  importedCount: number;
  ignoredCount: number;
  lastDetectedAt: Date | null;
  lastSyncRun: { status: string; source: string; startedAt: Date } | null;
};

export async function getGitHubHealthData(): Promise<GitHubHealthData> {
  const workspaceId = await getCurrentWorkspaceId();

  const [
    detectedCount,
    importedCount,
    ignoredCount,
    detectedInstallIds,
    linkedInstallIds,
    lastDetected,
    lastSyncRun,
  ] = await Promise.all([
    db.detectedRepository.count({ where: { workspaceId } }),
    db.gitHubRepository.count({ where: { project: { workspaceId } } }),
    db.ignoredRepository.count({ where: { workspaceId } }),
    // Distinct installation IDs seen in detected repos
    db.detectedRepository.findMany({
      where: { workspaceId, installationId: { not: null } },
      select: { installationId: true },
      distinct: ["installationId"],
    }),
    // Distinct installation IDs from linked repos
    db.gitHubRepository.findMany({
      where: { project: { workspaceId }, installationId: { not: null } },
      select: { installationId: true },
      distinct: ["installationId"],
    }),
    db.detectedRepository.findFirst({
      where: { workspaceId },
      orderBy: { detectedAt: "desc" },
      select: { detectedAt: true },
    }),
    db.gitSyncRun.findFirst({
      where: { project: { workspaceId } },
      orderBy: { startedAt: "desc" },
      select: { status: true, source: true, startedAt: true },
    }),
  ]);

  const ids = new Set([
    ...detectedInstallIds.map((r) => r.installationId!),
    ...linkedInstallIds.map((r) => r.installationId!),
  ]);

  return {
    appConfigured: isGitHubAppConfigured(),
    webhookSecretSet: !!process.env.GITHUB_WEBHOOK_SECRET,
    installationIds: [...ids],
    detectedCount,
    importedCount,
    ignoredCount,
    lastDetectedAt: lastDetected?.detectedAt ?? null,
    lastSyncRun: lastSyncRun
      ? {
          status: lastSyncRun.status,
          source: lastSyncRun.source,
          startedAt: lastSyncRun.startedAt,
        }
      : null,
  };
}

/**
 * Returns projects in the current workspace that have no GitHub repository
 * linked. Used to populate the "Link to existing project" select on the
 * integrations page.
 */
export async function getProjectsWithoutGitHubRepo() {
  const workspaceId = await getCurrentWorkspaceId();
  return db.project.findMany({
    where: { workspaceId, githubRepository: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ── Webhook delivery history ──────────────────────────────────────────────────

export type WebhookDeliveryRow = {
  id: string;
  deliveryId: string | null;
  event: string;
  action: string | null;
  repositoryFullName: string | null;
  installationId: number | null;
  status: string;
  message: string | null;
  receivedAt: Date;
  processedAt: Date | null;
};

/**
 * Returns the N most recent webhook deliveries for the current workspace
 * (including records with null workspaceId that arrived before workspace
 * resolution was possible, or during testing).
 */
export async function getRecentGitHubWebhookDeliveries(
  limit = 20
): Promise<WebhookDeliveryRow[]> {
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);

  return db.gitHubWebhookDelivery.findMany({
    where: workspaceId
      ? { OR: [{ workspaceId }, { workspaceId: null }] }
      : { workspaceId: null },
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      id: true,
      deliveryId: true,
      event: true,
      action: true,
      repositoryFullName: true,
      installationId: true,
      status: true,
      message: true,
      receivedAt: true,
      processedAt: true,
    },
  });
}
