/**
 * lib/monitoring/production-health-check-runner.ts
 *
 * Sprint 66: GET-only production health checks for post-cutover monitoring.
 *
 * Safety:
 *  - GET requests only
 *  - no checkout, no order creation, no Stripe calls, no upload, no email send
 *  - DNS/SSL failure becomes a finding, not a crash
 *  - 12s timeout per request
 */

import type { MonitoringCheck } from "./post-cutover-monitoring-types";

const LIVE_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const TIMEOUT_MS  = 12_000;
const UA          = "Prisom-PostCutoverMonitor/1.0 (health-check)";

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function safeGet(
  id:       string,
  category: MonitoringCheck["category"],
  label:    string,
  url:      string,
  required: boolean,
): Promise<MonitoringCheck> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:   "GET",
      headers:  { "User-Agent": UA },
      signal:   ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 400;
    const status: MonitoringCheck["status"] =
      ok ? "pass" :
      res.status >= 500 ? "fail" :
      "warning";
    return {
      id, category, label, status, required,
      url,
      httpStatus: res.status,
      message:    ok
        ? `HTTP ${res.status} OK`
        : `HTTP ${res.status} — check nginx and PM2 logs.`,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg    = err instanceof Error ? err.message : String(err);
    const isDns  = msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") ||
                   msg.includes("ECONNRESET")   || msg.includes("ETIMEDOUT") ||
                   msg.includes("aborted")       || msg.includes("fetch failed");
    return {
      id, category, label,
      status:   isDns ? "fail" : "warning",
      required,
      url,
      message:  isDns
        ? `Cannot reach ${url}: ${msg.slice(0, 120)}`
        : `Request error: ${msg.slice(0, 200)}`,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runProductionHealthChecks(input: {
  projectId: string;
  domain?:   string;
}): Promise<MonitoringCheck[]> {
  const { domain = LIVE_DOMAIN } = input;
  const base = `https://${domain}`;

  const tasks: Array<[string, MonitoringCheck["category"], string, string, boolean]> = [
    ["health-frontend-root",   "frontend", "Production root loads",           `${base}/`,                       true],
    ["health-api-healthz",     "api",      "API health endpoint",             `${base}/api/healthz`,            true],
    ["health-spa-fallback",    "routing",  "SPA fallback route (404→200)",    `${base}/non-existent-spa-route`, false],
    ["health-products",        "frontend", "Product listing page",            `${base}/products`,               false],
    ["health-shop",            "frontend", "Shop page",                       `${base}/shop`,                   false],
    ["health-api-products",    "api",      "API products endpoint",           `${base}/api/products`,           false],
  ];

  const results = await Promise.all(
    tasks.map(([id, cat, label, url, req]) => safeGet(id, cat, label, url, req)),
  );

  return results;
}
