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
      base.installCommand  = "pnpm install --frozen-lockfile --ignore-scripts";
      base.buildCommand    = "pnpm run build";
      base.startCommand    = "node artifacts/api-server/dist/index.mjs";
      base.healthPath      = "/api/healthz";
      base.routeMode       = "static_plus_api";
      base.staticOutputDir = "artifacts/sardar-security/dist/public";
      base.apiPrefix       = "/api";
      break;

    case "fix-static-frontend-routing":
      base.routeMode       = "static_plus_api";
      base.staticOutputDir = "artifacts/sardar-security/dist/public";
      base.apiPrefix       = "/api";
      break;

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

  const run = await generateAiImportOperatorRun({ projectId: input.projectId });
  return { ok: true, run };
}
