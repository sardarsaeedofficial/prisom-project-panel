/**
 * lib/staging/staging-deployment-smoke-checks.ts
 *
 * Sprint 64: Safe GET-only smoke checks for a staging deployment.
 *
 * Safety:
 *  - GET requests only, no POST/mutation
 *  - No checkout, no order creation, no provider mutation
 *  - DNS failure / ECONNREFUSED → warning, not fail
 *  - AbortController + 12s timeout per request
 */

import {
  assertSafeStagingTarget,
  DEFAULT_STAGING_SLUG,
  DEFAULT_STAGING_DOMAIN,
} from "./staging-target-guard";
import type { StagingSmokeResult } from "./staging-deployment-types";

const TIMEOUT_MS = 12_000;
const UA         = "Prisom-StagingDryRun/1.0 (staging-smoke-check)";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeGet(label: string, url: string): Promise<StagingSmokeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  "GET",
      headers: { "User-Agent": UA },
      signal:  ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 400;
    return {
      label,
      url,
      status:     ok ? "pass" : res.status >= 500 ? "fail" : "warning",
      httpStatus: res.status,
      message:    ok
        ? `${res.status} OK`
        : `HTTP ${res.status} — check staging server logs.`,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    // DNS / connection errors → warning (staging may not be up yet)
    const isNetworkError =
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("aborted") ||
      msg.includes("fetch failed");
    return {
      label,
      url,
      status:  "warning",
      message: isNetworkError
        ? `Cannot reach staging server — DNS may not be configured yet. (${msg.slice(0, 120)})`
        : `Request error: ${msg.slice(0, 200)}`,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export type StagingSmokeReport = {
  projectId:    string;
  generatedAt:  string;
  stagingDomain: string;
  status:       "passed" | "warning" | "failed";
  results:      StagingSmokeResult[];
  warnings:     string[];
};

export async function runStagingDeploymentSmokeChecks(input: {
  projectId:     string;
  stagingSlug?:  string;
  stagingDomain?: string;
}): Promise<StagingSmokeReport> {
  const {
    projectId,
    stagingSlug  = DEFAULT_STAGING_SLUG,
    stagingDomain = DEFAULT_STAGING_DOMAIN,
  } = input;

  // Guard
  await assertSafeStagingTarget({ sourceProjectId: projectId, stagingSlug, stagingDomain });

  const base = `https://${stagingDomain}`;

  const checks: Array<[string, string]> = [
    ["Staging root",        `${base}/`],
    ["Staging API health",  `${base}/api/healthz`],
    ["SPA fallback route",  `${base}/non-existent-spa-route`],
  ];

  const results = await Promise.all(
    checks.map(([label, url]) => safeGet(label, url)),
  );

  const hasFail    = results.some((r) => r.status === "fail");
  const hasWarning = results.some((r) => r.status === "warning");
  const overallStatus: "passed" | "warning" | "failed" =
    hasFail ? "failed" : hasWarning ? "warning" : "passed";

  const extraWarnings: string[] = [];
  if (hasWarning || hasFail) {
    extraWarnings.push("Some smoke checks did not pass — ensure the staging server is running and DNS is configured.");
  }
  extraWarnings.push("Smoke checks are GET-only. No production mutation, no payment calls, no order creation.");

  return {
    projectId,
    generatedAt:  new Date().toISOString(),
    stagingDomain,
    status:       overallStatus,
    results,
    warnings:     extraWarnings,
  };
}
