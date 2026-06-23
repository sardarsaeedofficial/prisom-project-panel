import { type NextRequest, NextResponse } from "next/server";
import { verifyGitHubWebhookSignature } from "@/lib/github/webhook";
import {
  upsertDetectedRepositoryFromWebhook,
  recordGitHubPushEvent,
  type DetectedRepoInput,
} from "@/lib/data/github";
import { db }                    from "@/lib/db";
import { createBackgroundJob }   from "@/lib/jobs/background-job-service";
import { recordWebhookReceived } from "@/lib/github/github-sync-service";

// Always render on-demand — never cache a webhook endpoint
export const dynamic = "force-dynamic";

// ── Minimal webhook payload types ─────────────────────────────────────────────
// We only declare fields we actually use — unknown fields are silently ignored.

type GitHubRepoPayload = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
};

type PingPayload = {
  zen?: string;
  hook_id?: number;
};

type InstallationPayload = {
  action: string;
  installation?: { id: number };
  repositories?: GitHubRepoPayload[];
  repositories_added?: GitHubRepoPayload[];
  repositories_removed?: GitHubRepoPayload[];
  repository?: GitHubRepoPayload;
};

type PushPayload = {
  ref: string;
  before: string;
  after: string;
  installation?: { id: number };
  repository: GitHubRepoPayload;
  commits?: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: { name: string; email: string };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
};

// ── Delivery record helper ────────────────────────────────────────────────────

type DeliveryStatus = "ok" | "warning" | "error" | "ignored";

/**
 * Persists a summary of each verified webhook delivery.
 * Never throws — delivery record failures must not affect the webhook response.
 */
async function saveDeliveryRecord(input: {
  deliveryId: string;
  event: string;
  action?: string | null;
  repositoryFullName?: string | null;
  installationId?: number | null;
  workspaceId?: string | null;
  status: DeliveryStatus;
  message?: string | null;
  payloadSummary?: Record<string, string | number | boolean | null> | null;
}): Promise<void> {
  try {
    await db.gitHubWebhookDelivery.create({
      data: {
        deliveryId: input.deliveryId !== "unknown" ? input.deliveryId : null,
        event: input.event,
        action: input.action ?? null,
        repositoryFullName: input.repositoryFullName ?? null,
        installationId: input.installationId ?? null,
        workspaceId: input.workspaceId ?? null,
        status: input.status,
        message: input.message ?? null,
        processedAt: new Date(),
        ...(input.payloadSummary
          ? { payloadSummary: input.payloadSummary }
          : {}),
      },
    });
  } catch {
    // Swallow — delivery tracking must never break the webhook response
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body BEFORE any JSON parsing — the signature covers the raw bytes
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event") ?? "";
  const delivery = request.headers.get("x-github-delivery") ?? "unknown";

  // ── Signature verification ────────────────────────────────────────────────
  if (!verifyGitHubWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid GitHub signature." }, { status: 401 });
  }

  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Missing x-github-event header." },
      { status: 400 }
    );
  }

  // ── JSON parsing ──────────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event,
      status: "error",
      message: "Invalid JSON payload",
    });
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // ── Event routing ─────────────────────────────────────────────────────────
  // Catch all errors and return 200 so GitHub doesn't retry on our bugs.
  try {
    switch (event) {
      case "ping":
        return await handlePing(payload as PingPayload, delivery);

      case "installation":
      case "installation_repositories":
        return await handleInstallation(
          payload as InstallationPayload,
          event,
          delivery
        );

      case "repository":
        return await handleRepository(
          payload as InstallationPayload,
          delivery
        );

      case "push":
        return await handlePush(payload as PushPayload, delivery);

      default: {
        // Event is valid but we don't handle it — accept and ignore (202)
        await saveDeliveryRecord({
          deliveryId: delivery,
          event,
          action:
            typeof payload === "object" &&
            payload !== null &&
            "action" in payload
              ? String((payload as Record<string, unknown>).action ?? "")
              : null,
          status: "ignored",
          message: `Event type "${event}" is not handled`,
        });
        return NextResponse.json(
          { ok: true, accepted: false, event, delivery, reason: `Event type "${event}" is not handled.` },
          { status: 202 }
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[GitHub Webhook] Error processing ${event} (${delivery}):`,
      message
    );
    await saveDeliveryRecord({
      deliveryId: delivery,
      event,
      status: "error",
      message: `Processing error: ${message}`,
    });
    // Return 200 so GitHub does not retry — we already logged the error
    return NextResponse.json(
      { ok: true, accepted: false, event, delivery, reason: "Processing error — check server logs." },
      { status: 200 }
    );
  }
}

// ── ping ──────────────────────────────────────────────────────────────────────

async function handlePing(payload: PingPayload, delivery: string) {
  const zen = payload.zen ?? "connected";
  console.log(`[GitHub Webhook] ping (${delivery}): "${zen}"`);

  await saveDeliveryRecord({
    deliveryId: delivery,
    event: "ping",
    status: "ok",
    message: `Ping received: "${zen}"`,
    payloadSummary: {
      zen,
      hookId: payload.hook_id ?? null,
    },
  });

  return NextResponse.json({ received: true, event: "ping", delivery, zen });
}

// ── installation / installation_repositories ──────────────────────────────────

async function handleInstallation(
  payload: InstallationPayload,
  event: string,
  delivery: string
) {
  // Collect all repos from any of the possible payload fields
  const repos: GitHubRepoPayload[] = [
    ...(payload.repositories ?? []),
    ...(payload.repositories_added ?? []),
    ...(payload.repository ? [payload.repository] : []),
  ];

  const installationId = payload.installation?.id ?? null;

  if (repos.length === 0) {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event,
      action: payload.action ?? null,
      installationId,
      status: "ok",
      message: `${event} / ${payload.action ?? "unknown"} — no repositories in payload`,
    });
    return NextResponse.json({ received: true, event, delivery, upserted: 0 });
  }

  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event,
      action: payload.action ?? null,
      installationId,
      status: "warning",
      message: "No workspace found — run db:seed first",
    });
    return NextResponse.json({
      received: true,
      event,
      delivery,
      warning: "No workspace found — run db:seed first",
    });
  }

  let upserted = 0;
  for (const repo of repos) {
    await upsertDetectedRepositoryFromWebhook(workspaceId, {
      ...toDetectedRepoInput(repo),
      installationId,
    });
    upserted++;
  }

  await saveDeliveryRecord({
    deliveryId: delivery,
    event,
    action: payload.action ?? null,
    installationId,
    workspaceId,
    status: "ok",
    message: `${event} / ${payload.action ?? "unknown"} — ${upserted} repo(s) upserted`,
    payloadSummary: {
      action: payload.action ?? null,
      repoCount: upserted,
      installationId: installationId ?? null,
    },
  });

  return NextResponse.json({ received: true, event, delivery, upserted });
}

// ── repository ────────────────────────────────────────────────────────────────

async function handleRepository(payload: InstallationPayload, delivery: string) {
  const action = payload.action ?? "unknown";

  if (action === "deleted" || action === "privatized") {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "repository",
      action,
      repositoryFullName: payload.repository?.full_name ?? null,
      installationId: payload.installation?.id ?? null,
      status: "ok",
      message: `repository / ${action} — cleanup not yet implemented`,
    });
    return NextResponse.json({
      received: true,
      event: "repository",
      delivery,
      action,
      note: "cleanup_not_yet_implemented",
    });
  }

  const repo = payload.repository;
  if (!repo) {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "repository",
      action,
      status: "warning",
      message: "repository event with no repository payload",
    });
    return NextResponse.json({
      received: true,
      event: "repository",
      delivery,
      upserted: 0,
    });
  }

  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "repository",
      action,
      repositoryFullName: repo.full_name,
      installationId: payload.installation?.id ?? null,
      status: "warning",
      message: "No workspace found",
    });
    return NextResponse.json({
      received: true,
      event: "repository",
      delivery,
      warning: "no workspace",
    });
  }

  await upsertDetectedRepositoryFromWebhook(workspaceId, {
    ...toDetectedRepoInput(repo),
    installationId: payload.installation?.id,
  });

  await saveDeliveryRecord({
    deliveryId: delivery,
    event: "repository",
    action,
    repositoryFullName: repo.full_name,
    installationId: payload.installation?.id ?? null,
    workspaceId,
    status: "ok",
    message: `repository / ${action} — ${repo.full_name} upserted`,
    payloadSummary: { action, fullName: repo.full_name },
  });

  return NextResponse.json({
    received: true,
    event: "repository",
    delivery,
    action,
  });
}

// ── push ──────────────────────────────────────────────────────────────────────

async function handlePush(payload: PushPayload, delivery: string) {
  const fullName = payload.repository?.full_name ?? null;

  if (!fullName) {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "push",
      status: "warning",
      message: "push event with no repository",
    });
    return NextResponse.json({
      received: true,
      event: "push",
      delivery,
      warning: "no repository",
    });
  }

  // Branch deletion: after SHA is all zeros
  if (payload.after === "0000000000000000000000000000000000000000") {
    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "push",
      action: "branch_deleted",
      repositoryFullName: fullName,
      installationId: payload.installation?.id ?? null,
      status: "ok",
      message: `Branch deleted in ${fullName}`,
    });
    return NextResponse.json({
      received: true,
      event: "push",
      delivery,
      action: "branch_deleted",
    });
  }

  const branch = payload.ref.replace(/^refs\/heads\//, "");
  const installationId = payload.installation?.id ?? null;

  // Find a project already linked to this repo
  const linkedRepo = await db.gitHubRepository.findFirst({
    where: { fullName },
    select: { id: true, projectId: true, installationId: true },
  });

  if (!linkedRepo) {
    // Not linked — record as detected (unless ignored)
    const workspaceId = await resolveWorkspaceId();
    if (workspaceId) {
      const isIgnored = await db.ignoredRepository.findFirst({
        where: { workspaceId, githubRepoId: payload.repository.id },
        select: { id: true },
      });
      if (!isIgnored) {
        await upsertDetectedRepositoryFromWebhook(workspaceId, {
          ...toDetectedRepoInput(payload.repository),
          installationId,
        });
      }
    }

    await saveDeliveryRecord({
      deliveryId: delivery,
      event: "push",
      action: "detected",
      repositoryFullName: fullName,
      installationId,
      workspaceId: (await resolveWorkspaceId()) ?? null,
      status: "ok",
      message: `push to ${fullName}@${branch} — repo detected, not yet imported`,
      payloadSummary: {
        branch,
        after: payload.after.slice(0, 7),
        commitCount: payload.commits?.length ?? 0,
      },
    });
    return NextResponse.json({
      received: true,
      event: "push",
      delivery,
      action: "detected",
    });
  }

  // Store installation ID if newly seen
  if (installationId && !linkedRepo.installationId) {
    await db.gitHubRepository.update({
      where: { id: linkedRepo.id },
      data: { installationId },
    });
  }

  const commits = (payload.commits ?? []).map((c) => ({
    sha: c.id,
    message: c.message,
    authorName: c.author.name,
    authorEmail: c.author.email,
    timestamp: c.timestamp,
    added: c.added ?? [],
    modified: c.modified ?? [],
    removed: c.removed ?? [],
  }));

  const result = await recordGitHubPushEvent({
    projectId: linkedRepo.projectId,
    gitHubRepositoryId: linkedRepo.id,
    branch,
    beforeSha: payload.before,
    afterSha: payload.after,
    commits,
  });

  await saveDeliveryRecord({
    deliveryId: delivery,
    event: "push",
    action: "synced",
    repositoryFullName: fullName,
    installationId,
    status: "ok",
    message: `push to ${fullName}@${branch} — ${result.syncedCommits} commit(s), ${result.totalChanged} file change(s) synced`,
    payloadSummary: {
      branch,
      before: payload.before.slice(0, 7),
      after: payload.after.slice(0, 7),
      commits: result.syncedCommits,
      filesChanged: result.totalChanged,
    },
  });

  // Sprint 40: If the project has auto-sync settings, record webhook receipt and
  // queue a github_sync job. The job handler checks auto-pull/auto-deploy flags
  // and never touches a dirty worktree.
  void (async () => {
    try {
      const syncSettings = await db.projectGitHubSyncSettings.findUnique({
        where:  { projectId: linkedRepo.projectId },
        select: { id: true, autoPullEnabled: true, autoDeployEnabled: true },
      });
      if (syncSettings) {
        await recordWebhookReceived(linkedRepo.projectId);
        // Only queue if auto-pull or auto-deploy is enabled
        if (syncSettings.autoPullEnabled || syncSettings.autoDeployEnabled) {
          await createBackgroundJob({
            jobType:     "github_sync",
            scopeType:   "project",
            projectId:   linkedRepo.projectId,
            title:       `GitHub sync — ${fullName}@${branch}`,
            description: `Triggered by push webhook: ${payload.after.slice(0, 7)}`,
            metadata:    {
              projectId: linkedRepo.projectId,
              branch,
              commitSha: payload.after,
              fullName,
              delivery,
            },
            maxAttempts: 2,
            priority:    6,
          });
        }
      }
    } catch {
      // Non-fatal — sync job queuing must never affect webhook response
    }
  })();

  return NextResponse.json({
    received: true,
    event: "push",
    delivery,
    action: "synced",
    branch,
    commits: result.syncedCommits,
    filesChanged: result.totalChanged,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Look up the single workspace without requiring a user session. */
async function resolveWorkspaceId(): Promise<string | null> {
  try {
    const ws = await db.workspace.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return ws?.id ?? null;
  } catch {
    return null;
  }
}

function toDetectedRepoInput(repo: GitHubRepoPayload): DetectedRepoInput {
  return {
    githubRepoId: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    description: repo.description,
    private: repo.private,
    language: repo.language,
    defaultBranch: repo.default_branch,
    url: repo.html_url, // store browser URL in DetectedRepository.url
  };
}
