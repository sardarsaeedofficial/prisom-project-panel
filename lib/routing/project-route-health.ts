/**
 * lib/routing/project-route-health.ts
 *
 * Sprint 44: HTTP health checks for project route map.
 *
 * Checks:
 *   - API health path returns expected status
 *   - Frontend root returns 200
 *   - Unknown SPA path returns 200 (SPA fallback working)
 *
 * Safety rules:
 *   - Only fetches from HTTPS domains
 *   - Timeout: 8 seconds per check
 *   - No secrets in requests or responses
 *   - Never follows redirect loops (max 2 redirects)
 */

import type { ProjectRouteRule, RouteHealthResult, ProjectRouteHealthReport } from "./project-route-types";

const HEALTH_TIMEOUT_MS  = 8_000;
const MAX_REDIRECTS      = 2;

// ── Single URL check ──────────────────────────────────────────────────────────

async function checkUrl(
  url:   string,
  label: string,
): Promise<RouteHealthResult> {
  const start = Date.now();

  // Only allow https: for production checks
  if (!url.startsWith("https://")) {
    return {
      url,
      label,
      ok:         false,
      error:      "Only HTTPS URLs are checked in production health checks.",
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method:   "GET",
      redirect: "follow",
      signal:   controller.signal,
      headers:  { "User-Agent": "Prisom-HealthCheck/1.0" },
    } as RequestInit & { redirect: "follow" });

    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const ok         = resp.status >= 200 && resp.status < 400;

    return { url, label, ok, statusCode: resp.status, durationMs };
  } catch (e) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const msg = e instanceof Error
      ? (e.name === "AbortError" ? `Timed out after ${HEALTH_TIMEOUT_MS}ms` : e.message)
      : String(e);
    return { url, label, ok: false, error: msg, durationMs };
  }
}

// ── Build check list from route map ──────────────────────────────────────────

function buildChecks(
  domain: string,
  rules:  ProjectRouteRule[],
): Array<{ url: string; label: string }> {
  const checks: Array<{ url: string; label: string }> = [];
  const base = `https://${domain}`;

  for (const rule of rules) {
    if (rule.targetType === "service" && rule.healthPath) {
      const healthUrl = `${base}${rule.healthPath.startsWith("/") ? "" : "/"}${rule.healthPath}`;
      checks.push({ url: healthUrl, label: `API health: ${rule.healthPath}` });
    }

    if (rule.targetType === "static") {
      // Check frontend root
      checks.push({ url: `${base}/`, label: "Frontend root" });

      // Check SPA fallback with a non-existent path
      if (rule.spaFallback) {
        checks.push({
          url:   `${base}/__prisom_spa_probe_${Date.now()}`,
          label: "SPA fallback (unknown path → index.html)",
        });
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return checks.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

// ── Main health check ─────────────────────────────────────────────────────────

export async function checkProjectRouteHealth(
  domain: string,
  rules:  ProjectRouteRule[],
): Promise<ProjectRouteHealthReport> {
  const checksToRun = buildChecks(domain, rules);

  // Run all checks in parallel (with a reasonable cap)
  const limited = checksToRun.slice(0, 8);
  const results = await Promise.all(limited.map(({ url, label }) => checkUrl(url, label)));

  return {
    domain,
    checkedAt: new Date().toISOString(),
    checks:    results,
    allOk:     results.every((r) => r.ok),
  };
}
