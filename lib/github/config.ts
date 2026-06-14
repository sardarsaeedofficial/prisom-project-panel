// GitHub App configuration helpers.
// All reads are from process.env — no imports from DB or other modules with side effects.

const REQUIRED_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;

export type RequiredVar = (typeof REQUIRED_VARS)[number];

export type EnvVarStatus = {
  key: RequiredVar;
  configured: boolean;
};

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
};

/** Returns the configured/missing status for each required env var. Safe to call anytime. */
export function getEnvVarStatuses(): EnvVarStatus[] {
  return REQUIRED_VARS.map((key) => ({
    key,
    configured: !!process.env[key],
  }));
}

/** Returns true only if ALL required GitHub App env vars are set. */
export function isGitHubAppConfigured(): boolean {
  return REQUIRED_VARS.every((key) => !!process.env[key]);
}

/**
 * Returns the validated GitHub App config.
 * Throws a descriptive error listing any missing env vars — never silently misconfigured.
 */
export function getGitHubAppConfig(): GitHubAppConfig {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `GitHub App not fully configured. Missing: ${missing.join(", ")}`
    );
  }
  return {
    appId: process.env.GITHUB_APP_ID!,
    // Private key is a PEM string — never log it
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  };
}

/** The full URL GitHub should send webhooks to. */
export function getGitHubWebhookUrl(): string {
  const base =
    (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/webhooks/github`;
}
