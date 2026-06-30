/**
 * lib/ai-import-autopilot/ai-import-autopilot-fix-engine.ts
 *
 * Sprint 88: Internal safe-fix engine for the AI Import Autopilot.
 *
 * Unlike lib/ai-import-operator/ai-import-fix-executor.ts (which requires a
 * typed "APPLY FIX" confirmation per fix), these fixes are applied automatically
 * by the orchestrator loop once the user has clicked "Make This Project Live".
 * Only fixes on the safe-fix allowlist live here — destructive operations
 * (DB wipe, DNS, file deletion, other PM2 processes, secret exposure) are never
 * handled by this module.
 */

import { saveDeploymentConfigAction } from "@/app/actions/project-deployments";
import { db }                          from "@/lib/db";
import { getSardarReplitFullPreset }   from "@/lib/smart-import/smart-import-presets";
import type { AppliedFix }             from "./ai-import-autopilot-types";

export const SAFE_FIX_LABELS: Record<string, string> = {
  "apply-sardar-preset":           "Apply Sardar/Replit pnpm deploy preset",
  "switch-to-pnpm-preset":         "Switch to pnpm preset",
  "fix-static-frontend-routing":   "Apply full Sardar/Replit pnpm deploy preset",
  "fix-health-path":               "Set health path to /api/healthz",
  "normalize-start-command":       "Normalize start command",
  "fix-static-output-path":        "Set static output directory",
  "fix-route-mode":                "Set route mode to static_plus_api",
  "use-panel-preview-proxy":       "Use panel preview proxy instead of raw localhost",
  "retry-deploy":                  "Retry deployment",
};

const SARDAR_FIX_IDS = new Set([
  "apply-sardar-preset",
  "switch-to-pnpm-preset",
  "fix-static-frontend-routing",
]);

type FixEngineResult =
  | { ok: true;  appliedFix: AppliedFix }
  | { ok: false; error: string };

/**
 * Applies a single safe fix by id. No confirmation phrase — the caller
 * (the autopilot orchestrator) is itself gated by the user's "Make This
 * Project Live" click and the safe-fix allowlist.
 */
export async function applyAutopilotSafeFix(input: {
  projectId: string;
  fixId: string;
}): Promise<FixEngineResult> {
  const { projectId, fixId } = input;

  // "use-panel-preview-proxy" and "retry-deploy" are no-op config changes —
  // they describe behaviour already handled elsewhere (preview-verifier always
  // returns the proxy path; the orchestrator always redeploys after a fix).
  if (fixId === "use-panel-preview-proxy" || fixId === "retry-deploy") {
    return {
      ok: true,
      appliedFix: {
        id:            fixId,
        label:         SAFE_FIX_LABELS[fixId] ?? fixId,
        appliedAt:     new Date().toISOString(),
        fieldsChanged: [],
      },
    };
  }

  const existing = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      installCommand:  true,
      buildCommand:    true,
      startCommand:    true,
      healthPath:      true,
      routeMode:       true,
      staticOutputDir: true,
      apiPrefix:       true,
      nodeEnv:         true,
      rootDirectory:   true,
    },
  });

  const base = {
    installCommand:  existing?.installCommand  ?? "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand:    existing?.buildCommand    ?? "pnpm run build",
    startCommand:    existing?.startCommand    ?? "node artifacts/api-server/dist/index.mjs",
    healthPath:      existing?.healthPath      ?? "/api/healthz",
    routeMode:       existing?.routeMode       ?? "fullstack_node",
    staticOutputDir: existing?.staticOutputDir ?? undefined,
    apiPrefix:       existing?.apiPrefix       ?? "/api",
    nodeEnv:         existing?.nodeEnv         ?? "production",
    rootDirectory:   existing?.rootDirectory   ?? ".",
  };

  const fieldsChanged: string[] = [];

  if (SARDAR_FIX_IDS.has(fixId)) {
    const p = getSardarReplitFullPreset();
    base.installCommand  = p.installCommand;
    base.buildCommand    = p.buildCommand;
    base.startCommand    = p.startCommand;
    base.healthPath      = p.healthPath      ?? "/api/healthz";
    base.routeMode       = p.routeMode       ?? "static_plus_api";
    base.staticOutputDir = p.staticOutputPath ?? "artifacts/sardar-security/dist/public";
    base.apiPrefix       = p.apiPrefix        ?? "/api";
    fieldsChanged.push(
      "installCommand", "buildCommand", "startCommand",
      "healthPath", "routeMode", "staticOutputDir", "apiPrefix",
    );
  } else if (fixId === "fix-health-path") {
    base.healthPath = "/api/healthz";
    fieldsChanged.push("healthPath");
  } else if (fixId === "normalize-start-command") {
    base.startCommand = "node artifacts/api-server/dist/index.mjs";
    fieldsChanged.push("startCommand");
  } else if (fixId === "fix-static-output-path") {
    base.staticOutputDir = "artifacts/sardar-security/dist/public";
    base.routeMode       = "static_plus_api";
    fieldsChanged.push("staticOutputDir", "routeMode");
  } else if (fixId === "fix-route-mode") {
    base.routeMode = "static_plus_api";
    fieldsChanged.push("routeMode");
  } else {
    return { ok: false, error: `Unknown safe fix: ${fixId}. Manual review required.` };
  }

  const saveResult = await saveDeploymentConfigAction(projectId, {
    installCommand:  base.installCommand,
    buildCommand:    base.buildCommand,
    startCommand:    base.startCommand,
    rootDirectory:   base.rootDirectory,
    healthPath:      base.healthPath,
    nodeEnv:         base.nodeEnv,
    routeMode:       base.routeMode,
    staticOutputDir: base.staticOutputDir,
    apiPrefix:       base.apiPrefix,
  });

  if (!saveResult.ok) {
    return { ok: false, error: `Fix validation failed: ${saveResult.error}` };
  }

  // Post-save verification for Sardar fixes — catches any silent upsert failure.
  if (SARDAR_FIX_IDS.has(fixId)) {
    const saved = await db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { installCommand: true },
    });
    if (saved?.installCommand?.trimStart().startsWith("npm ")) {
      return {
        ok: false,
        error: "Fix incomplete: deployment commands are still using npm after applying the preset.",
      };
    }
  }

  return {
    ok: true,
    appliedFix: {
      id:            fixId,
      label:         SAFE_FIX_LABELS[fixId] ?? fixId,
      appliedAt:     new Date().toISOString(),
      fieldsChanged,
    },
  };
}
