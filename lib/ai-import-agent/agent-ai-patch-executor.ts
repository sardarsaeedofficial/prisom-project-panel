/**
 * lib/ai-import-agent/agent-ai-patch-executor.ts
 *
 * Sprint 93: Executes a single AiImportPlanAction safely.
 *
 * Safety rules:
 *  - update_deployment_config: only allowed keys (no port, pm2Name, etc.)
 *  - run_command: validated through validateAndParseCommand allowlist
 *  - edit_file: NEVER applied automatically — always returns needsApproval
 *  - inspect_file: read-only via readProjectTextFile
 *  - ask_user / manual_blocker: returns structured pause
 *
 * Blocked always:
 *  - db:seed, rm -rf, DROP, touch prisom-manager/backend
 */

import { db }                          from "@/lib/db";
import { readProjectTextFile }         from "@/lib/projects/file-manager";
import { validateAndParseCommand }     from "@/lib/projects/project-deploy-runner";
import { runCommand, sanitizeOutput }  from "@/lib/server/command-runner";
import { findLatestReleasePath }       from "./agent-output-inspector";
import type { AiImportPlanAction, PendingPatch } from "./agent-run-types";

// ── Allowed deployment config fields ─────────────────────────────────────────

const ALLOWED_CONFIG_FIELDS = new Set([
  "staticOutputDir", "routeMode", "apiPrefix", "healthPath",
  "installCommand", "buildCommand", "startCommand",
]);

// ── Result types ──────────────────────────────────────────────────────────────

export type ActionExecuteResult =
  | { outcome: "done";         message: string; output?: string }
  | { outcome: "needs_approval"; pendingPatch: Omit<PendingPatch, "actionIndex"> }
  | { outcome: "needs_input";  message: string }
  | { outcome: "blocked";      message: string }
  | { outcome: "error";        message: string; output?: string };

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeAiAction(
  projectId: string,
  action: AiImportPlanAction,
  actionIndex: number,
): Promise<ActionExecuteResult> {
  switch (action.kind) {
    case "update_deployment_config":
      return executeConfigUpdate(projectId, action);

    case "run_command":
      return executeRunCommand(projectId, action);

    case "inspect_file":
      return executeInspectFile(projectId, action);

    case "edit_file":
      return executeEditFile(action, actionIndex);

    case "ask_user":
      return { outcome: "needs_input", message: action.reason ?? action.title };

    case "manual_blocker":
      return { outcome: "blocked", message: action.reason ?? action.title };

    default:
      return { outcome: "error", message: `Unknown action kind: ${(action as AiImportPlanAction).kind}` };
  }
}

// ── Config update ─────────────────────────────────────────────────────────────

async function executeConfigUpdate(
  projectId: string,
  action: AiImportPlanAction,
): Promise<ActionExecuteResult> {
  if (!action.configPatch || Object.keys(action.configPatch).length === 0) {
    return { outcome: "error", message: "configPatch is empty." };
  }

  // Filter to allowed keys only
  const safePatch: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(action.configPatch)) {
    if (ALLOWED_CONFIG_FIELDS.has(key)) {
      safePatch[key] = value;
    }
  }

  if (Object.keys(safePatch).length === 0) {
    return { outcome: "error", message: "No allowed config fields in configPatch." };
  }

  try {
    await db.projectDeploymentConfig.update({
      where: { projectId },
      data:  safePatch,
    });

    const changes = Object.entries(safePatch)
      .map(([k, v]) => `${k} = ${v === null ? "(cleared)" : String(v)}`)
      .join(", ");

    return { outcome: "done", message: `Updated deployment config: ${changes}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : "DB update failed";
    return { outcome: "error", message: msg };
  }
}

// ── Run command ───────────────────────────────────────────────────────────────

async function executeRunCommand(
  projectId: string,
  action: AiImportPlanAction,
): Promise<ActionExecuteResult> {
  if (!action.command) {
    return { outcome: "error", message: "No command specified." };
  }

  // Validate against the existing allowlist
  const parsed = validateAndParseCommand(action.command);
  if (!parsed.ok) {
    return { outcome: "error", message: `Command rejected: ${parsed.error}` };
  }

  // Run in latest release snapshot if one exists; fall back to cwd
  const releasePath = await (async () => {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { slug: true } });
    return project ? findLatestReleasePath(project.slug) : null;
  })();

  const cwd = releasePath ?? process.cwd();

  const result = await runCommand(parsed.cmd.binary, parsed.cmd.args, {
    cwd,
    timeoutMs: 120_000,
    env: { NODE_ENV: "production" },
  });

  const output = sanitizeOutput(
    [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  );

  if (result.exitCode !== 0) {
    return {
      outcome: "error",
      message: `Command exited with code ${result.exitCode}: ${action.command}`,
      output: output.slice(0, 2000),
    };
  }

  return {
    outcome: "done",
    message: `Command completed: ${action.command}`,
    output: output.slice(0, 2000),
  };
}

// ── Inspect file ──────────────────────────────────────────────────────────────

async function executeInspectFile(
  projectId: string,
  action: AiImportPlanAction,
): Promise<ActionExecuteResult> {
  if (!action.filePath) {
    return { outcome: "error", message: "No filePath specified for inspect_file." };
  }

  const result = await readProjectTextFile(projectId, action.filePath);
  if (!result.ok) {
    return { outcome: "done", message: `Could not read ${action.filePath}: ${result.error}` };
  }

  const preview = result.data.content.slice(0, 800);
  return {
    outcome: "done",
    message: `Inspected ${action.filePath} (${result.data.size} bytes)`,
    output: preview,
  };
}

// ── Edit file — always requires approval ─────────────────────────────────────

function executeEditFile(
  action: AiImportPlanAction,
  actionIndex: number,
): ActionExecuteResult {
  if (!action.filePath) {
    return { outcome: "error", message: "No filePath specified for edit_file." };
  }

  if (!action.proposedContent) {
    return {
      outcome: "error",
      message: `AI proposed editing ${action.filePath} but did not provide new content.`,
    };
  }

  return {
    outcome: "needs_approval",
    pendingPatch: {
      actionId: action.id,
      filePath: action.filePath,
      reason: action.reason,
      proposedContent: action.proposedContent,
      unifiedDiff: action.unifiedDiff,
    },
  };
}
