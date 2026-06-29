/**
 * lib/smart-import/smart-preview-checks.ts
 *
 * Sprint 85: Runs HTTP checks against a deployed project's internal port.
 * Server-side only — hits 127.0.0.1:<port> directly (no proxy, no auth headers).
 *
 * Safety: only reads HTTP responses, never mutates state.
 */

import { db } from "@/lib/db";
import type { SmartImportReport } from "./smart-import-types";

const CHECK_TIMEOUT_MS = 8_000;

type PreviewCheck = SmartImportReport["previewChecks"][number];

async function httpGet(url: string): Promise<{ status: number; text: string; ok: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    return { status: res.status, text: text.slice(0, 200), ok: res.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET")) {
      throw new Error("Project process is offline (ECONNREFUSED). Deploy or restart first.");
    }
    if (msg.includes("AbortError") || msg.includes("timeout")) {
      throw new Error("Request timed out after 8 seconds.");
    }
    throw new Error(msg.slice(0, 120));
  }
}

export async function runSmartPreviewChecks(input: {
  projectId: string;
}): Promise<PreviewCheck[]> {
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId: input.projectId },
    select: { port: true, healthPath: true, routeMode: true },
  });

  if (!config) {
    return [
      {
        path:     "/",
        expected: "Project deployed and config saved",
        status:   "blocked",
        result:   "No deployment config found. Deploy the project first.",
      },
    ];
  }

  const base = `http://127.0.0.1:${config.port}`;
  const checks: PreviewCheck[] = [];

  // ── 1. Health endpoint ────────────────────────────────────────────────────
  const healthPath = config.healthPath ?? "/";
  try {
    const r = await httpGet(`${base}${healthPath}`);
    checks.push({
      path:     healthPath,
      expected: "200 OK from health endpoint",
      status:   r.status >= 200 && r.status < 400 ? "passed" : "blocked",
      result:   `HTTP ${r.status}${r.ok ? "" : " — API not healthy"}`,
    });
  } catch (e) {
    checks.push({
      path:     healthPath,
      expected: "200 OK from health endpoint",
      status:   "blocked",
      result:   e instanceof Error ? e.message : String(e),
    });
  }

  // ── 2. Root path ──────────────────────────────────────────────────────────
  try {
    const r = await httpGet(`${base}/`);
    const isApiOnly = r.text.includes("Cannot GET /") || r.status === 404;
    if (isApiOnly && (config.routeMode === "static_plus_api" || config.routeMode === "fullstack_node")) {
      checks.push({
        path:     "/",
        expected: "Frontend loads at /",
        status:   "warning",
        result:
          "API is healthy, but frontend static output is not served at /. " +
          "Apply API + Static Frontend preset (static_plus_api routing).",
      });
    } else {
      checks.push({
        path:     "/",
        expected: "Page loads at /",
        status:   r.status >= 200 && r.status < 500 ? "passed" : "warning",
        result:   `HTTP ${r.status}`,
      });
    }
  } catch (e) {
    checks.push({
      path:     "/",
      expected: "Page loads at /",
      status:   "blocked",
      result:   e instanceof Error ? e.message : String(e),
    });
  }

  // ── 3. SPA route check (non-root page) ───────────────────────────────────
  if (config.routeMode === "static_plus_api" || config.routeMode === "static_only") {
    const spaPath = "/products";
    try {
      const r = await httpGet(`${base}${spaPath}`);
      checks.push({
        path:     spaPath,
        expected: "SPA route returns index.html (200)",
        status:   r.status === 200 ? "passed" : "warning",
        result:   `HTTP ${r.status}${r.status !== 200 ? " — SPA fallback may not be configured" : ""}`,
      });
    } catch (e) {
      checks.push({
        path:     spaPath,
        expected: "SPA route returns index.html (200)",
        status:   "warning",
        result:   e instanceof Error ? e.message : String(e),
      });
    }
  }

  return checks;
}
