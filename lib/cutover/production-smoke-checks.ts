/**
 * lib/cutover/production-smoke-checks.ts
 *
 * Sprint 55: HTTP smoke checks for production cutover.
 *
 * Safety rules:
 *  - HTTP GET/HEAD only — no mutations
 *  - No Stripe payloads, no real orders
 *  - No DB migrations, no PM2/nginx changes
 *  - Timeouts: 10s per request
 */

import { db } from "@/lib/db";
import type {
  ProductionCutoverSmokeResult,
  ProductionCutoverSmokeReport,
} from "./production-cutover-types";

const SARDAR_PROD_DOMAIN  = "sardar-security-project.doorstepmanchester.uk";
const SARDAR_PROD_ROOT    = `https://${SARDAR_PROD_DOMAIN}/`;
const SARDAR_PROD_HEALTH  = `https://${SARDAR_PROD_DOMAIN}/api/healthz`;
const SARDAR_PROD_WEBHOOK = `https://${SARDAR_PROD_DOMAIN}/api/webhooks/stripe`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function httpCheck(
  id:     string,
  label:  string,
  url:    string,
  method: "GET" | "HEAD" = "GET",
  successCodes: number[] = [200, 301, 302, 307, 308],
): Promise<ProductionCutoverSmokeResult> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10_000);
    const res  = await fetch(url, {
      method,
      signal:   ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(tid);
    const ms = Date.now() - t0;
    if (successCodes.includes(res.status)) {
      return {
        id, label, url, status: "pass", httpStatus: res.status,
        message: `${url} → HTTP ${res.status} in ${ms}ms`,
      };
    }
    return {
      id, label, url, status: "warning", httpStatus: res.status,
      message: `${url} → HTTP ${res.status} (expected 2xx/3xx) in ${ms}ms`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ms  = Date.now() - t0;
    return {
      id, label, url, status: "fail",
      message: msg.includes("abort")
        ? `${url} timed out after ${ms}ms`
        : `${url} unreachable: ${msg.slice(0, 100)}`,
    };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runProductionSmokeChecks(
  projectId: string,
): Promise<ProductionCutoverSmokeReport> {
  const runAt  = new Date().toISOString();
  const checks: ProductionCutoverSmokeResult[] = [];

  try {
    const [domain, config, services] = await Promise.all([
      db.domain.findFirst({
        where:  { projectId, isPrimary: true },
        select: { hostname: true, sslStatus: true },
      }),
      db.projectDeploymentConfig.findUnique({
        where:  { projectId },
        select: { port: true, healthPath: true },
      }),
      db.projectService.findMany({
        where:  { projectId, isEnabled: true },
        select: { serviceType: true, healthPath: true, spaFallback: true, internalPort: true },
      }),
    ]);

    const hostname       = domain?.hostname ?? null;
    const hasApiService  = services.some((s) => s.serviceType === "API" || s.serviceType === "BACKEND");
    const hasSpa         = services.some((s) => s.spaFallback === true || s.serviceType === "STATIC");
    const apiHealthPath  = services.find((s) => s.healthPath)?.healthPath ?? config?.healthPath ?? "/api/healthz";

    // ── 1. SSL status ──────────────────────────────────────────────────────
    if (domain?.sslStatus === "ACTIVE") {
      checks.push({
        id: "ssl", label: "SSL certificate", url: hostname ? `https://${hostname}` : "",
        status: "pass", message: `SSL active for ${hostname ?? "domain"}.`,
      });
    } else if (domain) {
      checks.push({
        id: "ssl", label: "SSL certificate", url: `https://${hostname}`,
        status: "warning",
        message: `SSL status: ${domain.sslStatus} for ${hostname}. Certificate may not be ready.`,
      });
    } else {
      checks.push({
        id: "ssl", label: "SSL certificate", url: "",
        status: "warning", message: "No primary domain configured — SSL status unknown.",
      });
    }

    // ── 2. Domain root → 200 ──────────────────────────────────────────────
    if (hostname) {
      const rootUrl = `https://${hostname}/`;
      checks.push(await httpCheck("domain_root", "Domain root (HTTPS)", rootUrl));
    } else {
      checks.push({
        id: "domain_root", label: "Domain root (HTTPS)", url: "",
        status: "warning", message: "No primary domain — cannot check root URL.",
      });
    }

    // ── 3. API health endpoint ────────────────────────────────────────────
    if (hostname && (hasApiService || config?.healthPath)) {
      const healthUrl = `https://${hostname}${apiHealthPath}`;
      checks.push(await httpCheck("api_health", "API health endpoint", healthUrl));
    } else if (config?.port && config?.healthPath) {
      // fallback: internal port check
      const internalUrl = `http://127.0.0.1:${config.port}${config.healthPath}`;
      checks.push(await httpCheck("api_health", "API health endpoint (internal)", internalUrl));
    } else {
      checks.push({
        id: "api_health", label: "API health endpoint", url: "",
        status: "warning", message: "No API service with health path configured.",
      });
    }

    // ── 4. SPA fallback ───────────────────────────────────────────────────
    if (hostname && hasSpa) {
      const spaUrl = `https://${hostname}/non-existent-spa-route-check`;
      // SPA fallback means any route should return 200 (the index.html)
      const result = await httpCheck("spa_fallback", "SPA fallback route", spaUrl, "GET", [200]);
      checks.push(result);
    } else if (hostname) {
      checks.push({
        id: "spa_fallback", label: "SPA fallback route", url: "",
        status: "warning", message: "No static SPA service configured — skipping SPA fallback check.",
      });
    }

    // ── 5. Stripe webhook reachability (HEAD only, no payload) ────────────
    const stripeWebhookUrl = hostname
      ? `https://${hostname}/api/webhooks/stripe`
      : null;
    if (stripeWebhookUrl) {
      // HEAD check only — confirms the path exists/nginx routes it
      // We expect either 200 (method allowed) or 405 (POST required) — both mean reachable
      const t0   = Date.now();
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10_000);
        const res  = await fetch(stripeWebhookUrl, { method: "HEAD", signal: ctrl.signal });
        clearTimeout(tid);
        const ms = Date.now() - t0;
        if (res.status < 500) {
          checks.push({
            id: "stripe_webhook", label: "Stripe webhook URL reachable", url: stripeWebhookUrl,
            status: "pass", httpStatus: res.status,
            message: `${stripeWebhookUrl} → HTTP ${res.status} in ${ms}ms (HEAD, no payload sent).`,
          });
        } else {
          checks.push({
            id: "stripe_webhook", label: "Stripe webhook URL reachable", url: stripeWebhookUrl,
            status: "warning", httpStatus: res.status,
            message: `${stripeWebhookUrl} → HTTP ${res.status}. Verify webhook path after routing is applied.`,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        checks.push({
          id: "stripe_webhook", label: "Stripe webhook URL reachable", url: stripeWebhookUrl,
          status: "warning",
          message: msg.includes("abort")
            ? `${stripeWebhookUrl} timed out after 10s.`
            : `${stripeWebhookUrl} not reachable — configure routing before cutover.`,
        });
      }
    }

    // ── 6. Sardar-specific checks ─────────────────────────────────────────
    const isSardarDomain = hostname === SARDAR_PROD_DOMAIN;
    if (isSardarDomain) {
      checks.push(await httpCheck("sardar_root",    "Sardar production root",         SARDAR_PROD_ROOT));
      checks.push(await httpCheck("sardar_health",  "Sardar API health (/api/healthz)", SARDAR_PROD_HEALTH));
      // Stripe webhook — HEAD only, no payload
      const t0  = Date.now();
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10_000);
        const res  = await fetch(SARDAR_PROD_WEBHOOK, { method: "HEAD", signal: ctrl.signal });
        clearTimeout(tid);
        const ms  = Date.now() - t0;
        checks.push({
          id: "sardar_webhook", label: "Sardar Stripe webhook URL", url: SARDAR_PROD_WEBHOOK,
          status: res.status < 500 ? "pass" : "warning",
          httpStatus: res.status,
          message: `${SARDAR_PROD_WEBHOOK} → HTTP ${res.status} in ${ms}ms (HEAD only, no payload).`,
        });
      } catch {
        checks.push({
          id: "sardar_webhook", label: "Sardar Stripe webhook URL", url: SARDAR_PROD_WEBHOOK,
          status: "warning",
          message: `${SARDAR_PROD_WEBHOOK} not reachable — configure routing/services first.`,
        });
      }
    }
  } catch {
    checks.push({
      id: "smoke_error", label: "Smoke check error", url: "",
      status: "fail", message: "Failed to run smoke checks. Check database connection.",
    });
  }

  const overallPass = checks.every((c) => c.status !== "fail");
  return { projectId, runAt, overallPass, results: checks };
}
