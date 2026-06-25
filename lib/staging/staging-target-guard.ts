/**
 * lib/staging/staging-target-guard.ts
 *
 * Sprint 64: Guard that ensures a staging target is safe and isolated
 * from production.
 *
 * Safety: throws if target looks like a production resource.
 */

// ── Blocked values ────────────────────────────────────────────────────────────

const LIVE_SARDAR_SLUGS = [
  "sardar-security-project",
  "sardar-security",
];

const LIVE_SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

const BLOCKED_DOMAINS = [
  "doorstepmanchester.uk",           // Doorsteps root
  "sardar-security-project.doorstepmanchester.uk",
  "projects.doorstepmanchester.uk",  // panel itself
  "localhost",
  "127.0.0.1",
];

const BLOCKED_SLUG_PREFIXES = [
  "doorstep",
  "localshop",
  "prisom-manager",
  "prisom-backend",
];

const REQUIRED_STAGING_KEYWORDS = ["staging", "trial", "restore"];

// ── Guard ─────────────────────────────────────────────────────────────────────

export async function assertSafeStagingTarget(input: {
  sourceProjectId: string;
  stagingSlug:     string;
  stagingDomain:   string;
}): Promise<void> {
  const { stagingSlug, stagingDomain } = input;

  const slug   = stagingSlug.toLowerCase().trim();
  const domain = stagingDomain.toLowerCase().trim();

  // Must include a staging keyword
  if (!REQUIRED_STAGING_KEYWORDS.some((kw) => slug.includes(kw))) {
    throw new Error(
      `Staging slug "${stagingSlug}" must include "staging", "trial", or "restore".`,
    );
  }
  if (!REQUIRED_STAGING_KEYWORDS.some((kw) => domain.includes(kw))) {
    throw new Error(
      `Staging domain "${stagingDomain}" must include "staging", "trial", or "restore".`,
    );
  }

  // Blocked slugs
  for (const blocked of LIVE_SARDAR_SLUGS) {
    if (slug === blocked) {
      throw new Error(
        `Staging slug "${stagingSlug}" matches the live Sardar project slug. ` +
        `Use a staging-prefixed slug such as "sardar-security-staging".`,
      );
    }
  }
  for (const prefix of BLOCKED_SLUG_PREFIXES) {
    if (slug.startsWith(prefix)) {
      throw new Error(
        `Staging slug "${stagingSlug}" matches a blocked production resource (${prefix}). ` +
        `Only Sardar staging slugs are allowed.`,
      );
    }
  }

  // Blocked domains
  if (domain === LIVE_SARDAR_DOMAIN || domain === `https://${LIVE_SARDAR_DOMAIN}`) {
    throw new Error(
      `Staging domain "${stagingDomain}" is the live Sardar production domain. ` +
      `Use staging-sardar-security-project.doorstepmanchester.uk.`,
    );
  }
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain === blocked || domain === `https://${blocked}`) {
      throw new Error(
        `Staging domain "${stagingDomain}" is a blocked production domain. ` +
        `Use a staging-prefixed subdomain.`,
      );
    }
  }
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_STAGING_SLUG   = "sardar-security-staging";
export const DEFAULT_STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";
