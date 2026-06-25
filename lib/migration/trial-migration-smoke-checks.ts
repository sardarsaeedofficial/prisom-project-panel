/**
 * lib/migration/trial-migration-smoke-checks.ts
 *
 * Sprint 61: Staging smoke checks for the trial migration.
 *
 * Checks staging domain only — never calls production unless explicitly passed.
 * Does not send Stripe webhook payloads. Does not place orders.
 * Returns a warning (not an error) when the staging domain is unreachable.
 *
 * Server-only.
 */

import type { SmokeCheckResult, StagingSmokeCheckReport } from "./trial-migration-types";

export const STAGING_DOMAIN_DEFAULT = "staging-sardar-security-project.doorstepmanchester.uk";

const TIMEOUT_MS = 12000;

async function checkUrl(url: string): Promise<SmokeCheckResult> {
  const start      = Date.now();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method:   "HEAD",
      signal:   controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const durationMs = Date.now() - start;

    if (res.status >= 200 && res.status < 400) {
      return {
        url,
        status:     "pass",
        httpStatus: res.status,
        message:    `HTTP ${res.status} OK`,
        durationMs,
      };
    }
    if (res.status >= 400 && res.status < 500) {
      return {
        url,
        status:     "warning",
        httpStatus: res.status,
        message:    `HTTP ${res.status} — check routing or nginx config`,
        durationMs,
      };
    }
    return {
      url,
      status:     "fail",
      httpStatus: res.status,
      message:    `HTTP ${res.status} — server error`,
      durationMs,
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;

    if (controller.signal.aborted) {
      return {
        url,
        status:     "warning",
        httpStatus: null,
        message:    `Request timed out after ${TIMEOUT_MS / 1000}s — staging may not be deployed yet`,
        durationMs,
      };
    }

    const cause   = err instanceof Error ? err.cause : null;
    const causeMsg =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    const isNotFound =
      causeMsg.includes("ENOTFOUND") || causeMsg.includes("EAI_AGAIN");
    const isRefused  = causeMsg.includes("ECONNREFUSED");

    const detail = isNotFound
      ? "DNS not found — staging domain not yet configured"
      : isRefused
      ? "Connection refused — staging service may not be running yet"
      : err instanceof Error
      ? err.message.slice(0, 200)
      : "Unknown connection error";

    return {
      url,
      status:     "warning",
      httpStatus: null,
      message:    `Connection failed: ${detail}`,
      durationMs,
    };
  }
}

export async function runStagingSmokeChecks(
  stagingDomain?: string,
): Promise<StagingSmokeCheckReport> {
  const domain = (stagingDomain?.trim() || STAGING_DOMAIN_DEFAULT).replace(/^https?:\/\//, "");
  const base   = `https://${domain}`;

  const urls = [
    `${base}/`,
    `${base}/api/healthz`,
    `${base}/non-existent-spa-route`,
  ];

  const results = await Promise.all(urls.map((url) => checkUrl(url)));

  const hasFail    = results.some((r) => r.status === "fail");
  const hasWarning = results.some((r) => r.status === "warning");
  const overall    = hasFail ? "fail" : hasWarning ? "warning" : "pass";

  return {
    domain,
    checkedAt: new Date().toISOString(),
    overall,
    results,
  };
}
