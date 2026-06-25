/**
 * lib/cutover/production-smoke-check-runner.ts
 *
 * Sprint 65: GET-only production smoke checks for the Execution Guard.
 *
 * Safety:
 *  - GET requests only
 *  - no checkout POST, no order creation, no Stripe/payment call
 *  - no provider mutation
 *  - timeout safely (12s)
 *  - DNS/SSL failure returns fail/warning — no crash
 */

import type {
  ProductionExecutionSmokeReport,
  ProductionExecutionSmokeResult,
} from "./production-execution-types";

const LIVE_SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const TIMEOUT_MS         = 12_000;
const UA                 = "Prisom-ProductionExecutionGuard/1.0 (smoke-check)";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeGet(label: string, url: string): Promise<ProductionExecutionSmokeResult> {
  const ctrl  = new AbortController();
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
        ? `HTTP ${res.status} OK`
        : `HTTP ${res.status} — check production logs.`,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const isDns = msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") ||
                  msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") ||
                  msg.includes("aborted") || msg.includes("fetch failed");
    return {
      label,
      url,
      status:  isDns ? "fail" : "warning",
      message: isDns
        ? `Cannot reach production server: ${msg.slice(0, 120)}`
        : `Request error: ${msg.slice(0, 200)}`,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runProductionExecutionSmokeChecks(input: {
  projectId: string;
  domain?:   string;
}): Promise<ProductionExecutionSmokeReport> {
  const { projectId, domain = LIVE_SARDAR_DOMAIN } = input;

  const base = `https://${domain}`;

  const checks: Array<[string, string]> = [
    ["Production root",         `${base}/`],
    ["Production API health",   `${base}/api/healthz`],
    ["SPA fallback route",      `${base}/non-existent-spa-route`],
  ];

  const results = await Promise.all(
    checks.map(([label, url]) => safeGet(label, url)),
  );

  const hasFail    = results.some((r) => r.status === "fail");
  const hasWarning = results.some((r) => r.status === "warning");
  const status: "passed" | "warning" | "failed" =
    hasFail ? "failed" : hasWarning ? "warning" : "passed";

  const warnings: string[] = [
    "Smoke checks are GET-only. No checkout, no orders, no Stripe calls, no provider mutation.",
  ];
  if (hasFail || hasWarning) {
    warnings.push("One or more smoke checks did not pass — review production logs before proceeding.");
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    domain,
    status,
    results,
    warnings,
  };
}
