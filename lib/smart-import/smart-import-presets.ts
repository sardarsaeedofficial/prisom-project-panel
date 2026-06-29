/**
 * lib/smart-import/smart-import-presets.ts
 *
 * Sprint 85: Selects the best deployment preset for a detected stack.
 * Pure function — no async, no DB, no side effects.
 */

import type {
  SmartImportDetectedStack,
  SmartImportDeploymentPreset,
} from "./smart-import-types";

// ── Preset library ────────────────────────────────────────────────────────────

export const PRESET_SARDAR_PNPM: SmartImportDeploymentPreset = {
  id:              "sardar-pnpm-ecommerce",
  label:           "Sardar Ecommerce (pnpm workspace)",
  confidence:      "high",
  installCommand:  "pnpm install --frozen-lockfile --ignore-scripts",
  buildCommand:    "pnpm run build",
  startCommand:    "node artifacts/api-server/dist/index.mjs",
  healthPath:      "/api/healthz",
  routeMode:       "static_plus_api",
  staticOutputPath: "artifacts/sardar-security/dist/public",
  spaFallback:     true,
  apiPrefix:       "/api",
  notes: [
    "pnpm workspace detected — uses pnpm for all commands",
    "API at artifacts/api-server, frontend at artifacts/sardar-security",
    "Route mode: /api/* → Node backend, /* → static frontend",
    "--ignore-scripts prevents esbuild postinstall conflicts",
  ],
};

const PRESET_GENERIC_REPLIT_PNPM: SmartImportDeploymentPreset = {
  id:              "generic-replit-pnpm",
  label:           "Generic Replit React + Express (pnpm workspace)",
  confidence:      "medium",
  installCommand:  "pnpm install --frozen-lockfile --ignore-scripts",
  buildCommand:    "pnpm run build",
  startCommand:    "node artifacts/api-server/dist/index.mjs",
  healthPath:      "/api/healthz",
  routeMode:       "static_plus_api",
  staticOutputPath: "artifacts/web/dist/public",
  spaFallback:     true,
  apiPrefix:       "/api",
  notes: [
    "pnpm workspace detected with api-server but no sardar-security frontend",
    "Static output path is a best-guess — verify before deploying",
  ],
};

const PRESET_NEXTJS: SmartImportDeploymentPreset = {
  id:             "nextjs",
  label:          "Next.js App",
  confidence:     "high",
  installCommand: "npm install --ignore-scripts",
  buildCommand:   "npm run build",
  startCommand:   "npm start",
  healthPath:     "/",
  routeMode:      "fullstack_node",
  notes: [
    "Next.js serves both API routes and frontend from a single process",
    "No static output directory needed — Next.js handles SSR/SSG",
  ],
};

const PRESET_VITE_STATIC: SmartImportDeploymentPreset = {
  id:              "vite-static",
  label:           "Vite Static App",
  confidence:      "medium",
  installCommand:  "npm install --ignore-scripts",
  buildCommand:    "npm run build",
  startCommand:    "",
  healthPath:      "/",
  routeMode:       "static_only",
  staticOutputPath: "dist",
  spaFallback:     true,
  notes: [
    "Pure static site — no Node backend process needed",
    "Static files served directly by nginx after build",
  ],
};

const PRESET_API_ONLY: SmartImportDeploymentPreset = {
  id:             "api-only-node",
  label:          "API-only Node Service",
  confidence:     "medium",
  installCommand: "npm install --ignore-scripts",
  buildCommand:   "npm run build",
  startCommand:   "node dist/index.js",
  healthPath:     "/api/healthz",
  routeMode:      "api_only",
  notes: [
    "Backend API only — no static frontend",
    "All traffic proxied to Node process",
  ],
};

const PRESET_MANUAL: SmartImportDeploymentPreset = {
  id:             "manual-review",
  label:          "Manual Review Required",
  confidence:     "low",
  installCommand: "npm install",
  buildCommand:   "npm run build",
  startCommand:   "node server.js",
  healthPath:     "/",
  routeMode:      "fullstack_node",
  notes: [
    "Stack could not be auto-detected with confidence",
    "Review install/build/start commands before deploying",
    "Check the Source Intake panel for more details",
  ],
};

// ── Sardar full-preset accessor ───────────────────────────────────────────────

/**
 * Returns the canonical deployment preset for Sardar/Replit pnpm ecommerce projects.
 * Centralises the values so the AI Import Operator and fix classifier never duplicate them.
 */
export function getSardarReplitFullPreset(): typeof PRESET_SARDAR_PNPM {
  return PRESET_SARDAR_PNPM;
}

// ── Selector ──────────────────────────────────────────────────────────────────

/**
 * Returns the best deployment preset for the detected stack.
 *
 * Priority order:
 * 1. Sardar/Replit pnpm ecommerce workspace (high confidence)
 * 2. Generic Replit React + Express pnpm workspace
 * 3. Next.js app
 * 4. Vite static app
 * 5. API-only Node service
 * 6. Manual review
 */
export function selectSmartImportPreset(input: {
  detectedStack: SmartImportDetectedStack;
}): SmartImportDeploymentPreset {
  const { detectedStack: stack } = input;

  const hasPnpmWorkspace = stack.replitMarkers.includes("pnpm-workspace.yaml");
  const hasApiServer     = stack.replitMarkers.includes("artifacts/api-server");
  const hasSardarFrontend = stack.services.some(
    (s) => s.type === "static" && s.root.includes("sardar-security"),
  );
  const hasWebFrontend = stack.services.some(
    (s) => s.type === "static" && s.root.includes("artifacts/web"),
  );

  // 1. Sardar pnpm ecommerce
  if (hasPnpmWorkspace && hasApiServer && hasSardarFrontend) {
    return PRESET_SARDAR_PNPM;
  }

  // 2. Generic Replit pnpm (api-server + web or api-server only)
  if (hasPnpmWorkspace && hasApiServer) {
    const preset = { ...PRESET_GENERIC_REPLIT_PNPM };
    if (hasWebFrontend) {
      preset.staticOutputPath = "artifacts/web/dist/public";
    } else if (stack.services.find((s) => s.type === "static")?.outputPath) {
      preset.staticOutputPath = stack.services.find((s) => s.type === "static")!.outputPath;
    }
    return preset;
  }

  // 3. Next.js
  if (stack.framework.includes("next")) {
    const pm = stack.packageManager !== "unknown" ? stack.packageManager : "npm";
    return {
      ...PRESET_NEXTJS,
      installCommand: `${pm} install --ignore-scripts`,
      buildCommand:   `${pm} run build`,
      startCommand:   `${pm} start`,
    };
  }

  // 4. Vite static (no API service detected)
  if (
    stack.framework.includes("vite") &&
    stack.services.every((s) => s.type === "static" || s.type === "unknown") &&
    !stack.services.some((s) => s.type === "api")
  ) {
    const staticSvc = stack.services.find((s) => s.type === "static");
    const pm = stack.packageManager !== "unknown" ? stack.packageManager : "npm";
    return {
      ...PRESET_VITE_STATIC,
      installCommand:   `${pm} install --ignore-scripts`,
      buildCommand:     `${pm} run build`,
      staticOutputPath: staticSvc?.outputPath ?? "dist",
    };
  }

  // 5. API only (api service, no static)
  if (
    stack.services.some((s) => s.type === "api") &&
    !stack.services.some((s) => s.type === "static")
  ) {
    const apiSvc = stack.services.find((s) => s.type === "api");
    const pm = stack.packageManager !== "unknown" ? stack.packageManager : "npm";
    return {
      ...PRESET_API_ONLY,
      installCommand: `${pm} install --ignore-scripts`,
      buildCommand:   `${pm} run build`,
      startCommand:   apiSvc?.startCommand ?? PRESET_API_ONLY.startCommand,
      healthPath:     apiSvc?.healthPath   ?? PRESET_API_ONLY.healthPath,
    };
  }

  // 6. Fallback
  return PRESET_MANUAL;
}
