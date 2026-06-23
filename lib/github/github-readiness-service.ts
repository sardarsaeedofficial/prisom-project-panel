/**
 * lib/github/github-readiness-service.ts
 *
 * Sprint 48: GitHub auto-sync + webhook readiness report.
 *
 * Safety rules:
 *  - No webhook secret exposed
 *  - No tokens or credentials returned
 *  - All sensitive fields are status flags only
 *  - Non-fatal: errors in any sub-check don't crash the report
 */

import { db }                         from "@/lib/db";
import { getGitHubWebhookUrl }        from "./github-webhook-url";
import { getWebhookSecretStatus }     from "./github-webhook-secret-status";
import type {
  GitHubSyncReadinessReport,
  GitHubReadinessStatus,
  GitHubWebhookStatus,
} from "./github-readiness-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStatus(
  blockers: string[],
  warnings: string[],
): GitHubReadinessStatus {
  if (blockers.length > 0) return "blocked";
  if (warnings.length > 0) return "warning";
  return "ready";
}

function toDeliveryResult(status: string): GitHubWebhookStatus["lastResult"] {
  if (status === "ok")      return "accepted";
  if (status === "ignored") return "ignored";
  if (status === "error")   return "failed";
  return "unknown";
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateGitHubReadinessReport(
  projectId: string,
): Promise<GitHubSyncReadinessReport> {
  const generatedAt = new Date().toISOString();
  const blockers:  string[] = [];
  const warnings:  string[] = [];
  const nextSteps: string[] = [];

  // ── 1. GitHub App secret status ──────────────────────────────────────────

  const secretStatus = getWebhookSecretStatus();
  const webhookUrl   = getGitHubWebhookUrl();

  // ── 2. GitHub repository linkage ─────────────────────────────────────────

  const repo = await db.gitHubRepository.findFirst({
    where:  { projectId },
    select: { fullName: true, defaultBranch: true, htmlUrl: true },
  }).catch(() => null);

  const repositoryConfigured = !!repo?.fullName;
  const branchConfigured     = !!(repo?.defaultBranch);

  // ── 3. Sync settings ─────────────────────────────────────────────────────

  const syncSettings = await db.projectGitHubSyncSettings.findUnique({
    where:  { projectId },
    select: {
      autoPullEnabled:   true,
      autoDeployEnabled: true,
      lastSyncStatus:    true,
      lastSyncMessage:   true,
      lastSyncedAt:      true,
      lastWebhookAt:     true,
    },
  }).catch(() => null);

  const autoPullEnabled   = syncSettings?.autoPullEnabled   ?? false;
  const autoDeployEnabled = syncSettings?.autoDeployEnabled ?? false;
  const lastSyncStatus    = syncSettings?.lastSyncStatus    ?? null;
  const dirtyWorktree     = lastSyncStatus === "dirty";
  const behindRemote      = lastSyncStatus === "behind";

  // ── 4. Last webhook delivery for this project's repo ─────────────────────

  let lastDelivery: {
    deliveryId:        string | null;
    event:             string;
    action:            string | null;
    status:            string;
    receivedAt:        Date;
  } | null = null;

  if (repo?.fullName) {
    lastDelivery = await db.gitHubWebhookDelivery.findFirst({
      where:   { repositoryFullName: repo.fullName },
      orderBy: { receivedAt: "desc" },
      select: {
        deliveryId: true,
        event:      true,
        action:     true,
        status:     true,
        receivedAt: true,
      },
    }).catch(() => null);
  }

  // Also check lastWebhookAt from sync settings as a fallback
  const lastEventAt =
    lastDelivery?.receivedAt?.toISOString() ??
    syncSettings?.lastWebhookAt?.toISOString() ??
    null;

  // ── 5. Build webhook status ──────────────────────────────────────────────

  const webhookStatus: GitHubWebhookStatus = {
    webhookUrl,
    secretConfigured:     secretStatus.configured,
    lastEventAt,
    lastEventType:        lastDelivery?.event ?? null,
    lastDeliveryId:       lastDelivery?.deliveryId ?? null,
    lastSignatureStatus:  lastDelivery ? "valid" : "missing",
    lastResult:           lastDelivery ? toDeliveryResult(lastDelivery.status) : undefined,
    message:              secretStatus.configured
      ? lastDelivery
        ? `Last webhook received: ${lastDelivery.event} (${lastDelivery.status})`
        : "Webhook secret configured. No deliveries received yet."
      : secretStatus.message,
  };

  // ── 6. Compute blockers / warnings ──────────────────────────────────────

  if (!repositoryConfigured) {
    blockers.push("No GitHub repository connected to this project.");
    nextSteps.push("Connect a GitHub repository in the GitHub page.");
  }

  if (!branchConfigured && repositoryConfigured) {
    blockers.push("No branch configured for this repository.");
    nextSteps.push("Verify the default branch is set for the connected repository.");
  }

  if (!secretStatus.configured && (autoPullEnabled || autoDeployEnabled)) {
    blockers.push("GITHUB_WEBHOOK_SECRET is not configured — auto-sync cannot verify webhook signatures.");
    nextSteps.push("Generate a webhook secret and add GITHUB_WEBHOOK_SECRET to your server .env file.");
  } else if (!secretStatus.configured) {
    warnings.push("GITHUB_WEBHOOK_SECRET is not configured — webhook signatures will not be verified.");
    nextSteps.push("Add GITHUB_WEBHOOK_SECRET to your server .env and GitHub webhook settings.");
  }

  if (dirtyWorktree && autoPullEnabled) {
    blockers.push("Worktree has uncommitted changes — auto-pull is blocked until the tree is clean.");
    nextSteps.push("Commit or stash local changes before auto-pull can run.");
  } else if (dirtyWorktree) {
    warnings.push("Worktree has uncommitted changes — resolve before enabling auto-pull.");
  }

  if (!lastDelivery && (autoPullEnabled || autoDeployEnabled)) {
    warnings.push("No webhook deliveries received yet — confirm the webhook URL is configured in GitHub.");
    nextSteps.push("Copy the webhook URL and add it to your GitHub repository or App webhook settings.");
  }

  if (autoDeployEnabled) {
    warnings.push("Auto-deploy is enabled — every push to the configured branch will trigger a deploy.");
    nextSteps.push("Confirm all env vars, domain, and database readiness before enabling auto-deploy.");
  }

  if (behindRemote && !autoPullEnabled) {
    warnings.push("Repository is behind remote — pull is available but auto-pull is disabled.");
  }

  if (repositoryConfigured && secretStatus.configured && !lastDelivery) {
    nextSteps.push("Push a commit to your connected repository to verify the webhook is working.");
  }

  if (repositoryConfigured && secretStatus.configured && lastDelivery) {
    nextSteps.push("GitHub auto-sync is active. Webhooks are being received.");
  }

  return {
    projectId,
    generatedAt,
    status: computeStatus(blockers, warnings),
    repositoryConfigured,
    repositoryFullName:  repo?.fullName ?? null,
    branchConfigured,
    branch:              repo?.defaultBranch ?? null,
    webhook:             webhookStatus,
    autoPullEnabled,
    autoDeployEnabled,
    dirtyWorktree,
    behindRemote,
    blockers,
    warnings,
    nextSteps,
  };
}
