/**
 * lib/ai-import-agent/agent-preview-checker.ts
 *
 * Sprint 89: Preview verification for the Live AI Import Agent Console.
 *
 * Two layers, matching how the real preview-proxy route behaves:
 *   1. Panel-level auth/workspace gate — the same requireProjectPermission()
 *      check the proxy route itself performs before it ever reaches the app.
 *      If this fails, ALL paths fail uniformly with the same panel-level error
 *      (this is exactly what produced the real "503 Panel database is
 *      unreachable" bug — see app/api/projects/[projectId]/preview-proxy).
 *   2. App-level checks — reuses Sprint 88's verifyAutopilotPreview() for the
 *      actual /, /api/healthz, /products checks against the internal port.
 *
 * 127.0.0.1 is used for verification HTTP calls server-side only — never
 * returned as a browser-facing link (browserPreviewUrl is always the proxy path).
 */

import { existsSync } from "fs";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  verifyAutopilotPreview,
  type PreviewVerificationResult,
} from "@/lib/ai-import-autopilot/ai-import-autopilot-preview-verifier";
import type { AgentTimelineStep } from "./agent-run-types";

export type AgentPreviewResult = {
  checks: AgentTimelineStep[];
  browserPreviewUrl?: string;
  internalHealthUrl?: string;
  publicUrl?: string;
  allPass: boolean;
  /** Set when the panel-level gate itself failed — distinct from an app-level failure. */
  panelGateError?: string;
  /** True when the configured static output directory does not exist on disk. */
  staticOutputMissing?: boolean;
};

function checkToStep(label: string, status: "pass" | "warning" | "blocked", result: string): AgentTimelineStep {
  return {
    id: `preview-${label}`,
    title: label,
    status: status === "pass" ? "success" : status === "warning" ? "warning" : "error",
    summary: result,
  };
}

export async function checkAgentPreview(input: {
  projectId: string;
}): Promise<AgentPreviewResult> {
  const { projectId } = input;

  const PATHS = ["/", "/api/healthz", "/products"];

  // ── Layer 1: panel-level auth/workspace gate ──────────────────────────────
  let auth: Awaited<ReturnType<typeof requireProjectPermission>>;
  try {
    auth = await requireProjectPermission(projectId, "project.view");
  } catch {
    const msg = "503 — Panel database is unreachable.";
    return {
      checks: PATHS.map((p) => checkToStep(p, "blocked", msg)),
      allPass: false,
      panelGateError: msg,
    };
  }
  if (!auth.ok) {
    const msg = auth.code === "NOT_FOUND" ? "404 — Project not found." : "403 — Access denied.";
    return {
      checks: PATHS.map((p) => checkToStep(p, "blocked", msg)),
      allPass: false,
      panelGateError: msg,
    };
  }

  // ── Layer 2: app-level checks (internal port, via Sprint 88 verifier) ────
  // The proxy forwards 1:1 to the internal port, so internal-scope results are
  // exactly what the browser-facing proxy path would return. Map by check id
  // to clean path labels (Sprint 88's "browser" scope only covers / and
  // /api/healthz — /products is internal-only there, so id-mapping is needed
  // to surface all 3 required paths here).
  const verification: PreviewVerificationResult = await verifyAutopilotPreview({ projectId });

  const PATH_LABELS: Record<string, string> = {
    "internal-health": "/api/healthz",
    "internal-root":   "/",
    "internal-spa":    "/products",
  };

  const checks: AgentTimelineStep[] = verification.checks
    .filter((c) => c.id in PATH_LABELS)
    .map((c) => checkToStep(PATH_LABELS[c.id], c.status, c.result));

  // If the API is healthy but root is failing, check whether this is because
  // the build output simply isn't on disk yet (vs. a routing config issue).
  // publicStaticPath is the ABSOLUTE path the preview-proxy route actually
  // serves from (set by deployProjectAction after a successful publish) —
  // staticOutputDir is only the relative build-config value, not a real path.
  let staticOutputMissing: boolean | undefined;
  const healthCheck = checks.find((c) => c.title === "/api/healthz");
  const rootCheck    = checks.find((c) => c.title === "/");
  if (healthCheck?.status === "success" && rootCheck && rootCheck.status !== "success") {
    const config = await db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { staticOutputDir: true, publicStaticPath: true },
    });
    if (config?.staticOutputDir) {
      staticOutputMissing = !config.publicStaticPath || !existsSync(config.publicStaticPath);
    }
  }

  return {
    checks: checks.length > 0 ? checks : PATHS.map((p) => checkToStep(p, "blocked", "Not checked — no deployment yet.")),
    browserPreviewUrl: verification.browserPreviewUrl,
    internalHealthUrl: verification.internalHealthUrl,
    publicUrl: verification.publicUrl,
    allPass: verification.allPass,
    staticOutputMissing,
  };
}
