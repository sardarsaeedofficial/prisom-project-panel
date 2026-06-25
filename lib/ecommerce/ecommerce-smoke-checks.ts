/**
 * lib/ecommerce/ecommerce-smoke-checks.ts
 *
 * Sprint 62: Safe HTTP-only ecommerce smoke checks for staging.
 *
 * Rules:
 *  - GET-only. Never POST checkout, create order, or call Stripe.
 *  - Never upload files or send emails.
 *  - Missing staging domain returns warning, not exception.
 *  - Default target: staging-sardar-security-project.doorstepmanchester.uk
 *
 * Server-only.
 */

import { ECOMMERCE_STAGING_DOMAIN } from "./ecommerce-test-planner";
import type { EcommerceSmokeCheckResult, EcommerceSmokeReport } from "./ecommerce-test-types";

const TIMEOUT_MS = 12000;

// ── Single URL check ──────────────────────────────────────────────────────────

async function checkUrl(
  id:    string,
  label: string,
  url:   string,
): Promise<EcommerceSmokeCheckResult> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start      = Date.now();

  try {
    const res = await fetch(url, {
      method:   "GET",
      signal:   controller.signal,
      redirect: "follow",
      headers:  { "User-Agent": "Prisom-EcommerceTestHarness/1.0 (staging-smoke-check)" },
    });
    clearTimeout(timer);
    const ms = Date.now() - start;

    const ok  = res.status >= 200 && res.status < 400;
    const cli = res.status >= 400 && res.status < 500;
    const srv = res.status >= 500;

    if (ok) {
      return {
        id,
        label,
        url,
        status:     "pass",
        httpStatus: res.status,
        message:    `HTTP ${res.status} OK (${ms}ms)`,
        evidence:   [`${res.status} in ${ms}ms`],
      };
    }
    if (cli) {
      return {
        id,
        label,
        url,
        status:     "warning",
        httpStatus: res.status,
        message:    `HTTP ${res.status} — check route configuration or nginx`,
      };
    }
    if (srv) {
      return {
        id,
        label,
        url,
        status:     "fail",
        httpStatus: res.status,
        message:    `HTTP ${res.status} — server error on staging`,
      };
    }
    return {
      id, label, url,
      status:     "warning",
      httpStatus: res.status,
      message:    `Unexpected HTTP ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - start;

    if (controller.signal.aborted) {
      return {
        id, label, url,
        status:  "warning",
        message: `Request timed out after ${TIMEOUT_MS / 1000}s — staging may not be deployed yet (${ms}ms)`,
      };
    }

    const cause    = err instanceof Error ? err.cause : null;
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    const notFound = causeMsg.includes("ENOTFOUND") || causeMsg.includes("EAI_AGAIN");
    const refused  = causeMsg.includes("ECONNREFUSED");

    const detail = notFound
      ? "DNS not found — staging domain not yet configured"
      : refused
      ? "Connection refused — staging service may not be running"
      : err instanceof Error
      ? err.message.slice(0, 180)
      : "Unknown connection error";

    return {
      id, label, url,
      status:  "warning",
      message: `Connection failed: ${detail}`,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runSafeEcommerceSmokeChecks(input: {
  projectId:    string;
  targetDomain?: string;
}): Promise<EcommerceSmokeReport> {
  const domain = ((input.targetDomain?.trim() || ECOMMERCE_STAGING_DOMAIN))
    .replace(/^https?:\/\//, "");
  const base   = `https://${domain}`;

  // GET-only checks — no POST, no payment endpoints, no file uploads
  const checksToRun: Array<[string, string, string]> = [
    ["root",         "Staging root URL",              `${base}/`],
    ["healthz",      "API health endpoint",            `${base}/api/healthz`],
    ["spa-fallback", "SPA fallback route",             `${base}/non-existent-ecommerce-route`],
    ["products",     "Products page",                  `${base}/products`],
    ["shop",         "Shop page (alternate path)",     `${base}/shop`],
    ["api-products", "API products endpoint",          `${base}/api/products`],
  ];

  const results = await Promise.all(
    checksToRun.map(([id, label, url]) => checkUrl(id, label, url)),
  );

  const hasFail    = results.some((r) => r.status === "fail");
  const hasWarning = results.some((r) => r.status === "warning");
  const overall    = hasFail ? "failed" : hasWarning ? "warning" : "passed";

  const warnings: string[] = [];
  for (const r of results) {
    if (r.status === "warning") warnings.push(`${r.label}: ${r.message}`);
    if (r.status === "fail")    warnings.push(`${r.label}: FAILED — ${r.message}`);
  }

  return {
    projectId:   input.projectId,
    generatedAt: new Date().toISOString(),
    targetDomain: domain,
    status:       overall,
    results,
    warnings,
  };
}
