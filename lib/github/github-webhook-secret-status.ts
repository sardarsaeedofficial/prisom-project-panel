/**
 * lib/github/github-webhook-secret-status.ts
 *
 * Sprint 48: Inspect webhook secret status without exposing the value.
 *
 * Safety rules:
 *  - Never returns the secret value
 *  - Never logs the secret value
 *  - Returns only configured/missing/too-short status
 */

const MIN_SECRET_LENGTH = 20;

export type WebhookSecretStatus =
  | "configured"   // secret set and long enough
  | "too_short"    // secret set but suspiciously short
  | "missing";     // secret not set at all

export type WebhookSecretStatusResult = {
  status:      WebhookSecretStatus;
  configured:  boolean;
  message:     string;
};

/**
 * Returns the webhook secret status without exposing the value.
 * The GITHUB_WEBHOOK_SECRET env var is read on the server only.
 */
export function getWebhookSecretStatus(): WebhookSecretStatusResult {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    return {
      status:     "missing",
      configured: false,
      message:    "GITHUB_WEBHOOK_SECRET is not configured. Add it to your .env file on the server.",
    };
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      status:     "too_short",
      configured: false,
      message:    `Webhook secret is configured but may be too short (${secret.length} chars). Use at least ${MIN_SECRET_LENGTH} random characters.`,
    };
  }

  return {
    status:     "configured",
    configured: true,
    message:    `Webhook secret is configured (${secret.length} characters).`,
  };
}
