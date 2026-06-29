/**
 * lib/import/replit-preset-detector.ts
 *
 * Sprint 84: Detects whether a project source resembles a Replit/pnpm-workspace
 * export and returns a safe deploy preset.
 *
 * Detection is path-based — looks for pnpm-workspace.yaml + known artifact dirs
 * in the project's source directory (storage/projects/<slug>/).
 *
 * Server-side only. Returns null on any error — never throws.
 */

import fsSync from "fs";
import path from "path";

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");

export type ReplitDeployPreset = {
  installCommand:  string;
  buildCommand:    string;
  startCommand:    string;
  healthPath:      string;
  routeMode:       "static_plus_api";
  staticOutputDir: string;
  apiPrefix:       string;
  nodeEnv:         string;
  detected:        "sardar-pnpm-workspace" | "generic-pnpm-workspace";
  detectionNote:   string;
};

function exists(p: string): boolean {
  try { return fsSync.existsSync(p); } catch { return false; }
}

/**
 * Inspects `storage/projects/<slug>/` and returns a preset if the source looks
 * like a Replit pnpm-workspace export, or null if it cannot be detected.
 */
export function detectReplitPreset(slug: string): ReplitDeployPreset | null {
  const sourceDir = path.join(PROJECT_STORAGE, slug);

  try {
    if (!exists(sourceDir)) return null;

    // Must have pnpm-workspace.yaml at project root
    if (!exists(path.join(sourceDir, "pnpm-workspace.yaml"))) return null;

    const hasSardarApi = exists(path.join(sourceDir, "artifacts", "api-server"));
    const hasSardarSec = exists(path.join(sourceDir, "artifacts", "sardar-security"));

    if (hasSardarApi && hasSardarSec) {
      return {
        installCommand:  "pnpm install --frozen-lockfile --ignore-scripts",
        buildCommand:    "pnpm run build",
        startCommand:    "node artifacts/api-server/dist/index.mjs",
        healthPath:      "/api/healthz",
        routeMode:       "static_plus_api",
        staticOutputDir: "artifacts/sardar-security/dist/public",
        apiPrefix:       "/api",
        nodeEnv:         "production",
        detected:        "sardar-pnpm-workspace",
        detectionNote:
          "Detected pnpm-workspace.yaml + artifacts/api-server + artifacts/sardar-security. " +
          "Preset: API at /api/* served by Node, frontend at /* served from static build.",
      };
    }

    if (hasSardarApi) {
      // Generic pnpm workspace: api-server only, guess static output
      const guessedStaticDir =
        exists(path.join(sourceDir, "artifacts", "web"))
          ? "artifacts/web/dist/public"
          : "artifacts/api-server/dist/public";

      return {
        installCommand:  "pnpm install --frozen-lockfile --ignore-scripts",
        buildCommand:    "pnpm run build",
        startCommand:    "node artifacts/api-server/dist/index.mjs",
        healthPath:      "/api/healthz",
        routeMode:       "static_plus_api",
        staticOutputDir: guessedStaticDir,
        apiPrefix:       "/api",
        nodeEnv:         "production",
        detected:        "generic-pnpm-workspace",
        detectionNote:
          "Detected pnpm-workspace.yaml + artifacts/api-server. " +
          "Static output directory is a best-guess — verify before deploying.",
      };
    }

    return null;
  } catch {
    return null;
  }
}
