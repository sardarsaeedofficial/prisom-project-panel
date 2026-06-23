/**
 * lib/github/github-readiness-types.ts
 *
 * Sprint 48: Types for GitHub auto-sync and webhook readiness checks.
 * Pure data — safe to import from client or server.
 *
 * Safety rules:
 *  - No webhook secret values
 *  - No GitHub tokens or private keys
 *  - All sensitive fields shown as "configured" / "missing" only
 */

// ── Overall status ────────────────────────────────────────────────────────────

export type GitHubReadinessStatus = "ready" | "warning" | "blocked";

// ── Webhook status ────────────────────────────────────────────────────────────

export type GitHubWebhookStatus = {
  webhookUrl:              string;
  secretConfigured:        boolean;
  lastEventAt?:            string | null;
  lastEventType?:          string | null;
  lastDeliveryId?:         string | null;
  /** "valid" = signature verified (delivery stored). "missing" = no deliveries yet. */
  lastSignatureStatus?:    "valid" | "invalid" | "missing" | "unknown";
  lastResult?:             "accepted" | "ignored" | "failed" | "unknown";
  message:                 string;
};

// ── Full readiness report ─────────────────────────────────────────────────────

export type GitHubSyncReadinessReport = {
  projectId:            string;
  generatedAt:          string;
  status:               GitHubReadinessStatus;
  repositoryConfigured: boolean;
  repositoryFullName?:  string | null;
  branchConfigured:     boolean;
  branch?:              string | null;
  webhook:              GitHubWebhookStatus;
  autoPullEnabled:      boolean;
  autoDeployEnabled:    boolean;
  dirtyWorktree:        boolean;
  behindRemote?:        boolean;
  blockers:             string[];
  warnings:             string[];
  nextSteps:            string[];
};

// ── Webhook test result ───────────────────────────────────────────────────────

export type WebhookTestCheck = {
  id:      string;
  label:   string;
  status:  "pass" | "warning" | "fail";
  message: string;
};

export type GitHubWebhookTestResult = {
  projectId:   string;
  testedAt:    string;
  overallPass: boolean;
  checks:      WebhookTestCheck[];
};

// ── Server action results ─────────────────────────────────────────────────────

export type GitHubReadinessResult =
  | { ok: true;  report: GitHubSyncReadinessReport }
  | { ok: false; error: string };

export type GitHubWebhookTestActionResult =
  | { ok: true;  result: GitHubWebhookTestResult }
  | { ok: false; error: string };

export type GitHubWebhookSecretResult =
  | { ok: true;  secret: string; warning: string }
  | { ok: false; error: string };
