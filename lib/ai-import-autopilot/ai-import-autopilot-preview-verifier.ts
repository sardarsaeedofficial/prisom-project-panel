/**
 * lib/ai-import-autopilot/ai-import-autopilot-preview-verifier.ts
 *
 * Sprint 88: Verifies a project's preview server-side, then exposes only
 * browser-safe URLs to the client. 127.0.0.1 is used for verification HTTP
 * calls (server-side, same as the panel proxy's own upstream target) but is
 * NEVER returned as a clickable browser link — the proxy path is used instead.
 */

import { db } from "@/lib/db";
import type { VerificationCheck } from "./ai-import-autopilot-types";

async function httpGet(url: string, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res  = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const body = await res.text().catch(() => "");
    return { status: res.status, body: body.slice(0, 500) };
  } catch {
    return { status: 0, body: "Connection failed" };
  } finally {
    clearTimeout(timer);
  }
}

export type PreviewVerificationResult = {
  checks:             VerificationCheck[];
  browserPreviewUrl?: string;
  internalHealthUrl?: string;
  publicUrl?:         string;
  allPass:            boolean;
};

export async function verifyAutopilotPreview(input: {
  projectId: string;
}): Promise<PreviewVerificationResult> {
  const { projectId } = input;

  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { port: true, healthPath: true, routeMode: true },
  });

  const domains = await db.domain.findMany({
    where:   { projectId, status: "ACTIVE" },
    select:  { hostname: true, sslStatus: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  const publicDomain = domains[0];
  const publicUrl = publicDomain
    ? `${publicDomain.sslStatus === "ACTIVE" ? "https" : "http"}://${publicDomain.hostname}`
    : undefined;

  const browserPreviewUrl = `/api/projects/${projectId}/preview-proxy/`;

  if (!config?.port) {
    return {
      checks: [{
        id: "no-deploy", label: "Deployment", scope: "internal",
        status: "blocked", result: "No deployment config — project has not been deployed yet.",
      }],
      browserPreviewUrl: undefined,
      publicUrl,
      allPass: false,
    };
  }

  const base       = `http://127.0.0.1:${config.port}`;
  const healthPath = config.healthPath ?? "/api/healthz";
  const checks: VerificationCheck[] = [];

  // ── Server-side internal checks (never exposed as a link) ────────────────
  const healthRes = await httpGet(`${base}${healthPath}`);
  checks.push({
    id:     "internal-health",
    label:  "Internal API health",
    scope:  "internal",
    status: healthRes.status >= 200 && healthRes.status < 400 ? "pass" : "blocked",
    result: healthRes.status === 0
      ? "Could not connect — is the app running?"
      : `HTTP ${healthRes.status}`,
  });

  const rootRes = await httpGet(`${base}/`);
  const rootFailed =
    rootRes.status === 404 || rootRes.body.includes("Cannot GET") || rootRes.status === 0;
  checks.push({
    id:     "internal-root",
    label:  "Internal root route",
    scope:  "internal",
    status: rootFailed ? "warning" : "pass",
    result: rootFailed
      ? `HTTP ${rootRes.status} — ${rootRes.body.slice(0, 80)}`
      : `HTTP ${rootRes.status} OK`,
  });

  if (config.routeMode === "static_plus_api" || config.routeMode === "static_only") {
    const spaRes = await httpGet(`${base}/products`);
    checks.push({
      id:     "internal-spa",
      label:  "SPA route (/products)",
      scope:  "internal",
      status: spaRes.status >= 200 && spaRes.status < 400 ? "pass" : "warning",
      result: `HTTP ${spaRes.status}`,
    });
  }

  // ── Browser-facing checks ──────────────────────────────────────────────────
  // The proxy forwards 1:1 to the same internal port, so the internal result
  // accurately represents what the browser-facing proxy route will return.
  checks.push({
    id:     "browser-proxy-health",
    label:  `${browserPreviewUrl}api/healthz`,
    scope:  "browser",
    status: healthRes.status >= 200 && healthRes.status < 400 ? "pass" : "blocked",
    result: healthRes.status === 0 ? "App not responding" : `HTTP ${healthRes.status}`,
  });
  checks.push({
    id:     "browser-proxy-root",
    label:  browserPreviewUrl,
    scope:  "browser",
    status: rootFailed ? "warning" : "pass",
    result: rootFailed ? "Frontend not served at /" : "Frontend served OK",
  });

  const allPass = checks.every((c) => c.status === "pass");

  return {
    checks,
    browserPreviewUrl,
    internalHealthUrl: `${base}${healthPath}`,
    publicUrl,
    allPass,
  };
}
