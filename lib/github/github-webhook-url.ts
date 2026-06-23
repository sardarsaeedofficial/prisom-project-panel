/**
 * lib/github/github-webhook-url.ts
 *
 * Sprint 48: Webhook URL helpers.
 * Returns the webhook URLs and setup instructions for GitHub configuration.
 *
 * Safety rules:
 *  - No secret values — only URL strings safe to display in UI
 */

/** Global webhook URL that handles all GitHub App deliveries. */
export function getGitHubWebhookUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://projects.doorstepmanchester.uk")
    .replace(/\/$/, "");
  return `${base}/api/webhooks/github`;
}

/**
 * Returns a project-scoped webhook URL with a projectId query param.
 * Useful if you want to route a specific webhook to a specific project,
 * but the current implementation resolves the project from the repo payload.
 */
export function getGitHubWebhookUrlForProject(projectId: string): string {
  return `${getGitHubWebhookUrl()}?projectId=${encodeURIComponent(projectId)}`;
}

export type WebhookSetupInstructions = {
  payloadUrl:    string;
  contentType:   string;
  events:        string;
  secretNote:    string;
  activeNote:    string;
};

/**
 * Returns copyable GitHub webhook setup instructions.
 * No secret value included — the user is instructed to use their configured secret.
 */
export function getWebhookSetupInstructions(): WebhookSetupInstructions {
  return {
    payloadUrl:  getGitHubWebhookUrl(),
    contentType: "application/json",
    events:      "Just the push event",
    secretNote:  "Enter the value from your GITHUB_WEBHOOK_SECRET server environment variable.",
    activeNote:  "Enabled",
  };
}
