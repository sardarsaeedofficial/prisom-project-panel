/**
 * lib/ai-import-agent/agent-fix-runner.ts
 *
 * Sprint 89: Applies safe fixes for the Live AI Import Agent Console.
 *
 * Standard deployment-config fixes (apply-sardar-preset, fix-static-frontend-routing,
 * fix-health-path, etc.) delegate to the existing Sprint 88 safe-fix engine —
 * single source of truth, no duplication.
 *
 * refresh_panel_pm2_env_and_retry_preview is new: it does NOT shell out to
 * `pm2 restart` (unsafe to trigger from inside the app process being restarted).
 * Instead it verifies the panel's own DATABASE_URL is present in the CURRENT
 * Next.js process and retries the preview check — if DATABASE_URL is genuinely
 * missing from the running process, it reports manual SSH instructions with
 * no secret values.
 */

import { applyAutopilotSafeFix } from "@/lib/ai-import-autopilot/ai-import-autopilot-fix-engine";
import { checkAgentPreview, type AgentPreviewResult } from "./agent-preview-checker";
import { classifyAgentErrorOrFallback } from "./agent-error-classifier";
import type { AgentError } from "./agent-run-types";

export const PANEL_ENV_RESTART_INSTRUCTIONS =
  "cd /home/prisom/prisom-project-panel\n" +
  "set -a\n" +
  ". ./.env\n" +
  "set +a\n" +
  "pm2 restart 2 --update-env\n" +
  "pm2 save";

type FixRunnerResult =
  | { ok: true;  label: string; fieldsChanged: string[]; preview?: AgentPreviewResult }
  | { ok: false; error: string; agentError?: AgentError };

const DELEGATED_FIX_IDS = new Set([
  "apply-sardar-preset",
  "switch-to-pnpm-preset",
  "fix-static-frontend-routing",
  "fix-health-path",
  "normalize-start-command",
  "fix-static-output-path",
  "fix-route-mode",
]);

/**
 * repair_static_frontend_routing is the Sprint 89 Agent's id for "API works,
 * frontend doesn't" (see agent-error-classifier.ts classifyPreviewChecks).
 * It applies the exact same field set as fix-static-frontend-routing
 * (routeMode/apiPrefix/staticOutputDir/healthPath/install/build/start —
 * the full Sardar pnpm preset), so it's an alias, not a new implementation.
 */
const FIX_ID_ALIASES: Record<string, string> = {
  repair_static_frontend_routing: "fix-static-frontend-routing",
};

export async function applyAgentFix(input: {
  projectId: string;
  fixId: string;
}): Promise<FixRunnerResult> {
  const { projectId } = input;
  const fixId = FIX_ID_ALIASES[input.fixId] ?? input.fixId;

  if (fixId === "refresh_panel_pm2_env_and_retry_preview") {
    return refreshPanelEnvAndRetryPreview(projectId);
  }

  if (fixId === "retry-deploy") {
    // No config change needed — the caller (orchestrator action) redeploys after this.
    return { ok: true, label: "Retry deployment", fieldsChanged: [] };
  }

  if (DELEGATED_FIX_IDS.has(fixId)) {
    const result = await applyAutopilotSafeFix({ projectId, fixId });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, label: result.appliedFix.label, fieldsChanged: result.appliedFix.fieldsChanged };
  }

  return { ok: false, error: `Unknown safe fix: ${fixId}. Manual review required.` };
}

async function refreshPanelEnvAndRetryPreview(projectId: string): Promise<FixRunnerResult> {
  // Step 2: verify DATABASE_URL exists in the CURRENT running Next process.
  // Never logs or returns the value itself — presence check only.
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      error:
        "Panel DATABASE_URL is missing in the running process. Restart the panel with --update-env:\n\n" +
        PANEL_ENV_RESTART_INSTRUCTIONS,
      agentError: {
        kind: "panel_database_url_missing_in_process",
        whatHappened: "The panel's own DATABASE_URL is not present in the currently running process.",
        why: "The panel process was likely started or restarted without loading .env, so it has no database connection string in memory.",
        whatICanDo: "This needs a manual restart with environment reloaded — I can't safely do this from inside the app.",
        fixSafetyLevel: "needs_approval",
        safeFixAvailable: false,
        technicalReason: "process.env.DATABASE_URL is undefined in the panel's Node process.",
        manualInstructions: PANEL_ENV_RESTART_INSTRUCTIONS,
      },
    };
  }

  // Step 4: DATABASE_URL is present — retry the preview check.
  const preview = await checkAgentPreview({ projectId });
  if (preview.allPass) {
    return { ok: true, label: "Refresh panel environment and retry preview", fieldsChanged: [], preview };
  }

  // Step 5: still failing — escalate to a runtime error, not env-missing.
  const reason = preview.panelGateError ?? "Preview checks are still failing after confirming DATABASE_URL is present.";
  return {
    ok: false,
    error: reason,
    agentError: classifyAgentErrorOrFallback(reason, "Preview"),
  };
}
