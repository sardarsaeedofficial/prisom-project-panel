"use server";

/**
 * app/actions/github-readiness.ts
 *
 * Sprint 48: Server actions for GitHub auto-sync readiness.
 *
 * Safety rules:
 *  - No webhook secret value returned (ever)
 *  - No GitHub tokens in responses
 *  - generateGitHubWebhookSecretAction returns the secret ONCE — caller must copy it
 *  - Secret is never logged, audited, or stored by this panel
 *  - All actions verify project ownership
 */

import { randomBytes }                      from "crypto";
import { db }                               from "@/lib/db";
import { requireProjectPermission }         from "@/lib/auth/project-membership";
import { generateGitHubReadinessReport }    from "@/lib/github/github-readiness-service";
import { getGitHubWebhookUrl }             from "@/lib/github/github-webhook-url";
import { getWebhookSecretStatus }           from "@/lib/github/github-webhook-secret-status";
import { isGitHubAppConfigured }            from "@/lib/github/config";
import type {
  GitHubReadinessResult,
  GitHubWebhookTestActionResult,
  GitHubWebhookSecretResult,
  WebhookTestCheck,
} from "@/lib/github/github-readiness-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function verifyAccess(projectId: string): Promise<void> {
  await requireProjectPermission(projectId, "project.view");
}

async function verifyManage(projectId: string): Promise<void> {
  await requireProjectPermission(projectId, "deploy.trigger");
}

// ── Action 1: Full readiness report ──────────────────────────────────────────

export async function generateGitHubReadinessReportAction(
  projectId: string,
): Promise<GitHubReadinessResult> {
  try {
    await verifyAccess(projectId);
    const report = await generateGitHubReadinessReport(projectId);
    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `GitHub readiness check failed: ${msg}` };
  }
}

// ── Action 2: Webhook setup test (Option A — readiness-only) ─────────────────

export async function testGitHubWebhookSetupAction(
  projectId: string,
): Promise<GitHubWebhookTestActionResult> {
  try {
    await verifyAccess(projectId);

    const checks: WebhookTestCheck[] = [];
    const testedAt = new Date().toISOString();

    // Check 1: GitHub App configured
    const appConfigured = isGitHubAppConfigured();
    checks.push({
      id:      "github_app",
      label:   "GitHub App configured",
      status:  appConfigured ? "pass" : "warning",
      message: appConfigured
        ? "All GitHub App environment variables are set."
        : "GitHub App env vars are not fully configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, etc.).",
    });

    // Check 2: Repository connected
    const repo = await db.gitHubRepository.findFirst({
      where:  { projectId },
      select: { fullName: true, defaultBranch: true },
    }).catch(() => null);
    const repoOk = !!repo?.fullName;
    checks.push({
      id:      "repo_connected",
      label:   "Repository connected",
      status:  repoOk ? "pass" : "fail",
      message: repoOk
        ? `Connected to ${repo!.fullName}.`
        : "No GitHub repository connected. Use the GitHub page to connect a repo.",
    });

    // Check 3: Branch configured
    const branchOk = !!repo?.defaultBranch;
    checks.push({
      id:      "branch_configured",
      label:   "Branch configured",
      status:  branchOk ? "pass" : (repoOk ? "warning" : "fail"),
      message: branchOk
        ? `Default branch: ${repo!.defaultBranch}.`
        : "Branch not set for the connected repository.",
    });

    // Check 4: Webhook URL available
    const webhookUrl = getGitHubWebhookUrl();
    checks.push({
      id:      "webhook_url",
      label:   "Webhook URL available",
      status:  "pass",
      message: `Webhook URL: ${webhookUrl}`,
    });

    // Check 5: Webhook secret configured
    const secretStatus = getWebhookSecretStatus();
    checks.push({
      id:      "webhook_secret",
      label:   "Webhook secret configured",
      status:  secretStatus.configured ? "pass" : "fail",
      message: secretStatus.message,
    });

    // Check 6: Webhook deliveries received
    const lastDelivery = repo?.fullName
      ? await db.gitHubWebhookDelivery.findFirst({
          where:   { repositoryFullName: repo.fullName },
          orderBy: { receivedAt: "desc" },
          select:  { deliveryId: true, event: true, status: true, receivedAt: true },
        }).catch(() => null)
      : null;

    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentDelivery = lastDelivery && lastDelivery.receivedAt > since7Days;
    checks.push({
      id:      "webhook_deliveries",
      label:   "Recent webhook delivery received",
      status:  recentDelivery ? "pass" : (lastDelivery ? "warning" : "warning"),
      message: lastDelivery
        ? `Last delivery: ${lastDelivery.event} (${lastDelivery.status}) at ${lastDelivery.receivedAt.toISOString()}.`
        : "No webhook deliveries received yet. Push a commit to verify the webhook is working.",
    });

    // Overall pass
    const overallPass = checks.every((c) => c.status !== "fail");

    return {
      ok: true,
      result: { projectId, testedAt, overallPass, checks },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Webhook setup test failed: ${msg}` };
  }
}

// ── Action 3: Generate webhook secret (show once) ─────────────────────────────

export async function generateGitHubWebhookSecretAction(
  projectId: string,
): Promise<GitHubWebhookSecretResult> {
  try {
    await verifyManage(projectId);

    // Generate a cryptographically secure random hex secret (64 characters = 256 bits)
    // This is returned once — never stored, never logged, never audited with its value
    const secret = randomBytes(32).toString("hex");

    return {
      ok:      true,
      secret,
      warning: "Copy this secret immediately — it will not be shown again. " +
               "Add it as GITHUB_WEBHOOK_SECRET in your server .env file and as the " +
               "webhook secret in your GitHub repository or App settings.",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return { ok: false, error: "Access denied." };
    }
    return { ok: false, error: `Could not generate webhook secret: ${msg}` };
  }
}
