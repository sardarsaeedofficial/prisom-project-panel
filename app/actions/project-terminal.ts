"use server";

/**
 * app/actions/project-terminal.ts
 *
 * Sprint 7: server actions for the safe project terminal.
 *
 * Every action verifies project ownership before doing anything.
 * No commands are executed without going through the safety classifier.
 */

import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/auth/project-membership";
import {
  runProjectCommand,
  readPackageScripts,
  detectPackageManager,
  type CommandResult,
} from "@/lib/projects/terminal-runner";
import {
  classifyProjectCommand,
  buildPresetCommands,
  type CommandRiskLevel,
  type PresetCommand,
} from "@/lib/projects/command-safety";
import { getProjectFileRoot } from "@/lib/projects/file-manager";

// ── Shared result type ─────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ────────────────────────────────────────────────────────────

async function verifyOwnership(
  projectId: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  // Sprint 17: require terminal.use permission
  const auth = await requireProjectPermission(projectId, "terminal.use");
  if (!auth.ok) return { ok: false, error: auth.error };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { workspaceId: true },
  });
  if (!project) return { ok: false, error: "Project not found." };
  return { ok: true, workspaceId: project.workspaceId };
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

export interface PackageScriptInfo {
  name:    string;
  command: string;
  allowed: boolean;
  risk:    CommandRiskLevel;
  reason?: string;
}

export interface TerminalBootstrapData {
  project: {
    id:   string;
    slug: string;
    name: string;
  };
  terminal: {
    hasEditableRoot:  boolean;
    cwdLabel:         string;
    pm2ProcessName:   string | null;
    port:             number | null;
    packageManager:   "pnpm" | "npm" | "yarn" | "unknown";
    packageScripts:   PackageScriptInfo[];
    presets:          PresetCommand[];
  };
}

export async function getProjectTerminalBootstrapAction(
  projectId: string,
): Promise<ActionResult<TerminalBootstrapData>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found.", code: "FORBIDDEN" };

  // Deployment config
  const deployConfig = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true, port: true },
  });

  const pm2Name = deployConfig?.pm2Name ?? null;
  const port    = deployConfig?.port    ?? null;

  // File root
  const rootResult = await getProjectFileRoot(projectId);
  const hasEditableRoot = rootResult.ok;
  const cwdLabel = rootResult.ok ? rootResult.label : "No editable source";
  const root     = rootResult.ok ? rootResult.root  : null;

  // Package info (if root exists)
  let packageManager: "pnpm" | "npm" | "yarn" | "unknown" = "unknown";
  let rawScripts:     Record<string, string> = {};
  if (root) {
    [packageManager, rawScripts] = await Promise.all([
      detectPackageManager(root),
      readPackageScripts(root),
    ]);
  }

  // Classify each package script
  const packageScripts: PackageScriptInfo[] = Object.entries(rawScripts).map(([name, command]) => {
    const pm = packageManager === "unknown" ? "npm" : packageManager;
    const result = classifyProjectCommand({
      rawCommand:      `${pm} run ${name}`,
      projectPm2Name:  pm2Name ?? undefined,
      packageScripts:  rawScripts,
      packageManager,
    });
    if (result.ok) {
      return { name, command, allowed: true, risk: result.risk };
    } else {
      return { name, command, allowed: false, risk: "blocked", reason: result.reason };
    }
  });

  // Build presets
  const presets = buildPresetCommands({
    pm2Name:        pm2Name ?? undefined,
    packageManager,
  });

  return {
    ok:   true,
    data: {
      project: { id: project.id, slug: project.slug, name: project.name },
      terminal: {
        hasEditableRoot,
        cwdLabel,
        pm2ProcessName: pm2Name,
        port,
        packageManager,
        packageScripts,
        presets,
      },
    },
  };
}

// ── Run command ────────────────────────────────────────────────────────────────

export interface RunCommandInput {
  projectId:  string;
  command:    string;
  confirmed?: boolean;
}

export type RunCommandOutput = CommandResult;

export async function runProjectCommandAction(
  input: RunCommandInput,
): Promise<ActionResult<RunCommandOutput>> {
  const { projectId, command, confirmed = false } = input;

  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  if (!command || command.trim().length === 0) {
    return { ok: false, error: "No command provided." };
  }

  const result = await runProjectCommand({ projectId, rawCommand: command, confirmed });

  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code };
  }

  return { ok: true, data: result.data };
}

// ── Classify AI-suggested command ─────────────────────────────────────────────

export interface AiCommandClassification {
  command:  string;
  allowed:  boolean;
  risk:     CommandRiskLevel;
  reason?:  string;
}

/**
 * Classify a command suggested by the AI before showing it to the user.
 * The AI never bypasses the safety classifier — same rules apply.
 */
export async function classifyAiSuggestedCommandAction(
  projectId: string,
  command:   string,
): Promise<ActionResult<AiCommandClassification>> {
  const auth = await verifyOwnership(projectId);
  if (!auth.ok) return { ok: false, error: auth.error, code: "FORBIDDEN" };

  const deployConfig = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true },
  });

  const rootResult = await getProjectFileRoot(projectId);
  const root    = rootResult.ok ? rootResult.root : null;
  let rawScripts: Record<string, string> = {};
  let pm: "pnpm" | "npm" | "yarn" | "unknown" = "unknown";
  if (root) {
    [pm, rawScripts] = await Promise.all([
      detectPackageManager(root),
      readPackageScripts(root),
    ]);
  }

  const result = classifyProjectCommand({
    rawCommand:     command,
    projectPm2Name: deployConfig?.pm2Name ?? undefined,
    packageScripts: rawScripts,
    packageManager: pm,
  });

  if (result.ok) {
    return { ok: true, data: { command, allowed: true, risk: result.risk } };
  } else {
    return { ok: true, data: { command, allowed: false, risk: "blocked", reason: result.reason } };
  }
}
