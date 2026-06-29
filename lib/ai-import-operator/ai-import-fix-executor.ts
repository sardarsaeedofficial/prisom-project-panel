/**
 * lib/ai-import-operator/ai-import-fix-executor.ts
 *
 * Sprint 87: Safe fix executor for the AI Import Operator.
 * Applies known-safe configuration changes with confirmation.
 *
 * Confirmation phrase: APPLY FIX
 * No database wipe. No DNS mutation. No go-live. No secret exposure.
 */

import { saveDeploymentConfigAction } from "@/app/actions/project-deployments";
import { db }                         from "@/lib/db";
import { getSardarReplitFullPreset }   from "@/lib/smart-import/smart-import-presets";
import { generateAiImportOperatorRun } from "./ai-import-operator-service";
import type { AiImportOperatorRun }    from "./ai-import-operator-types";

type FixResult =
  | { ok: true;  run: AiImportOperatorRun }
  | { ok: false; error: string };

export async function executeAiImportFix(input: {
  projectId: string;
  fixId: string;
  confirmation: string;
}): Promise<FixResult> {
  if (input.confirmation !== "APPLY FIX") {
    return { ok: false, error: "Type APPLY FIX to confirm." };
  }

  const existing = await db.projectDeploymentConfig.findUnique({
    where:  { projectId: input.projectId },
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

  switch (input.fixId) {
    case "apply-sardar-preset":
    case "switch-to-pnpm-preset":
    case "fix-static-frontend-routing": {
      // All Sardar/Replit pnpm ecommerce fixes apply the same canonical full preset.
      // Using getSardarReplitFullPreset() ensures a single source of truth and
      // prevents partial-write bugs where some fields (e.g. installCommand) stay as npm.
      const p = getSardarReplitFullPreset();
      base.installCommand  = p.installCommand;
      base.buildCommand    = p.buildCommand;
      base.startCommand    = p.startCommand;
      base.healthPath      = p.healthPath      ?? "/api/healthz";
      base.routeMode       = p.routeMode       ?? "static_plus_api";
      base.staticOutputDir = p.staticOutputPath ?? "artifacts/sardar-security/dist/public";
      base.apiPrefix       = p.apiPrefix        ?? "/api";
      break;
    }

    case "fix-health-path":
      base.healthPath = "/api/healthz";
      break;

    case "normalize-start-command":
      base.startCommand = "node artifacts/api-server/dist/index.mjs";
      break;

    case "fix-static-output-path":
      base.staticOutputDir = "artifacts/sardar-security/dist/public";
      base.routeMode       = "static_plus_api";
      break;

    case "fix-route-mode":
      base.routeMode = "static_plus_api";
      break;

    default:
      return { ok: false, error: `Unknown fix: ${input.fixId}. Manual review required.` };
  }

  const saveResult = await saveDeploymentConfigAction(input.projectId, {
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

  // Post-save verification: confirm the DB was actually updated with pnpm commands.
  // This catches any silent failure in the upsert path.
  const SARDAR_FIX_IDS = new Set([
    "apply-sardar-preset",
    "switch-to-pnpm-preset",
    "fix-static-frontend-routing",
  ]);
  if (SARDAR_FIX_IDS.has(input.fixId)) {
    const saved = await db.projectDeploymentConfig.findUnique({
      where:  { projectId: input.projectId },
      select: { installCommand: true },
    });
    if (saved?.installCommand?.trimStart().startsWith("npm ")) {
      return {
        ok: false,
        error:
          "Fix incomplete: deployment commands are still using npm. " +
          "Please apply the fix again or use the Replit Import Wizard in Advanced tools.",
      };
    }
  }

  const run = await generateAiImportOperatorRun({ projectId: input.projectId });
  return { ok: true, run };
}
