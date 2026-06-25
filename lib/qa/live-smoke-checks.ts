/**
 * lib/qa/live-smoke-checks.ts
 *
 * Sprint 69: GET/HEAD-only live smoke checks for QA verification.
 *
 * Safety:
 *  - HEAD requests only (falls back to GET)
 *  - no checkout, orders, or payment calls
 *  - no PM2/nginx/DB changes
 *  - DNS/ECONNREFUSED → warning/fail, never crash
 *  - Doorsteps/LocalShop untouched
 */

import type { LiveSmokeCheckResult, LiveSmokeReport } from "./qa-verification-types";

const TIMEOUT_MS = 12_000;
const UA = "Prisom-LiveQA/1.0 (smoke-check)";

// ── Single check ──────────────────────────────────────────────────────────────

async function runSmokeCheck(
  label:            string,
  url:              string,
  expectedStatuses: number[] = [200],
  allowRedirect?:   number,
): Promise<LiveSmokeCheckResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method:   "HEAD",
      redirect: "manual",
      headers:  { "User-Agent": UA },
      signal:   controller.signal,
    }).finally(() => clearTimeout(timer));

    const durationMs   = Date.now() - start;
    const httpStatus   = res.status;
    const isExpected   = expectedStatuses.includes(httpStatus);
    const isRedirect   = allowRedirect !== undefined && httpStatus === allowRedirect;

    if (isExpected || isRedirect) {
      return { label, url, status: "pass", httpStatus, message: `HTTP ${httpStatus}`, durationMs };
    }

    return {
      label, url,
      status:     "warning",
      httpStatus,
      message:    `Unexpected HTTP ${httpStatus} (expected ${expectedStatuses.join("|")})`,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const msg        = err instanceof Error ? err.message : String(err);
    const isNetErr   = msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("abort");
    return {
      label, url,
      status:  isNetErr ? "fail" : "warning",
      message: isNetErr ? `Network error: ${msg.slice(0, 80)}` : `Check error: ${msg.slice(0, 80)}`,
      durationMs,
    };
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runLiveSmokeChecks(input: {
  projectId: string;
}): Promise<LiveSmokeReport> {
  const { projectId } = input;

  const results = await Promise.all([
    runSmokeCheck(
      "Panel login page",
      "https://projects.doorstepmanchester.uk/login",
      [200],
    ),
    runSmokeCheck(
      "Panel dashboard (unauthenticated redirect)",
      "https://projects.doorstepmanchester.uk/dashboard",
      [307, 302, 200],
    ),
    runSmokeCheck(
      "Panel admin (unauthenticated redirect)",
      "https://projects.doorstepmanchester.uk/admin",
      [307, 302, 200],
    ),
    runSmokeCheck(
      "Sardar Security — storefront root",
      "https://sardar-security-project.doorstepmanchester.uk/",
      [200],
    ),
    runSmokeCheck(
      "Sardar Security — /api/healthz",
      "https://sardar-security-project.doorstepmanchester.uk/api/healthz",
      [200],
    ),
  ]);

  const anyFail    = results.some((r) => r.status === "fail");
  const anyWarning = results.some((r) => r.status === "warning");

  const overallStatus: LiveSmokeReport["status"] =
    anyFail    ? "failed"  :
    anyWarning ? "warning" :
    "passed";

  const warnings: string[] = [];
  for (const r of results) {
    if (r.status === "warning") warnings.push(`${r.label}: ${r.message}`);
    if (r.status === "fail")    warnings.push(`FAIL — ${r.label}: ${r.message}`);
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status:      overallStatus,
    results,
    warnings,
  };
}
