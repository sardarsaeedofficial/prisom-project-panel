/**
 * lib/projects/terminal-runner.ts
 *
 * Sprint 7: executes a project-scoped command after safety classification.
 *
 * Builds on lib/server/command-runner.ts (execFile, shell: false).
 * Never executes blocked or unclassified commands.
 * Redacts stdout/stderr before returning.
 * Optionally writes a ProjectLog entry.
 */

import { promises as fs } from "fs";
import path from "path";
import { runCommand, sanitizeOutput } from "@/lib/server/command-runner";
import { classifyProjectCommand, type CommandRiskLevel } from "@/lib/projects/command-safety";
import { getProjectFileRoot } from "@/lib/projects/file-manager";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { db } from "@/lib/db";
import { FULL_PATH_PNPM } from "@/lib/projects/deploy-constants";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 100 * 1024;   // 100 KB per stdout/stderr
const DEFAULT_TIMEOUT  = 60_000;       // 60 seconds
const MAX_TIMEOUT      = 120_000;      // 2 minutes max

// ── Result types ──────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

export interface CommandResult {
  commandId:  string;
  command:    string;
  cwd:        string;
  exitCode:   number | null;
  stdout:     string;
  stderr:     string;
  durationMs: number;
  risk:       "safe" | "confirm";
}

// ── Executable path resolver ──────────────────────────────────────────────────

/**
 * Resolve executable name to an absolute path where known.
 * Falls back to the plain name (PATH resolution at process spawn time).
 */
function resolveExecutable(name: string): string {
  switch (name.toLowerCase()) {
    case "pnpm":
      // Use full path on VPS; fall back to name for local dev
      return FULL_PATH_PNPM;
    default:
      return name;
  }
}

// ── Package.json reader ───────────────────────────────────────────────────────

export async function readPackageScripts(
  projectRoot: string,
): Promise<Record<string, string>> {
  const pkgPath = path.join(projectRoot, "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.scripts === "object" && pkg.scripts !== null) {
      const scripts: Record<string, string> = {};
      for (const [k, v] of Object.entries(pkg.scripts)) {
        if (typeof v === "string") scripts[k] = v;
      }
      return scripts;
    }
  } catch {
    // no package.json or not parseable — return empty
  }
  return {};
}

export async function detectPackageManager(
  projectRoot: string,
): Promise<"pnpm" | "npm" | "yarn" | "unknown"> {
  const check = async (file: string) => {
    try { await fs.access(path.join(projectRoot, file)); return true; }
    catch { return false; }
  };
  if (await check("pnpm-lock.yaml"))   return "pnpm";
  if (await check("yarn.lock"))        return "yarn";
  if (await check("package-lock.json")) return "npm";
  return "unknown";
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runProjectCommand(input: {
  projectId:   string;
  rawCommand:  string;
  confirmed?:  boolean;
  timeoutMs?:  number;
}): Promise<ActionResult<CommandResult>> {
  const { projectId, rawCommand, confirmed = false } = input;
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  // ── Ownership check ─────────────────────────────────────────────────────
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) {
    return { ok: false, error: "Not authenticated.", code: "FORBIDDEN" };
  }
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    return { ok: false, error: "Project not found.", code: "FORBIDDEN" };
  }

  // ── Resolve project root ────────────────────────────────────────────────
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) {
    return { ok: false, error: rootResult.error, code: "NO_ROOT" };
  }
  const { root } = rootResult;

  // ── Load deployment config + package info ───────────────────────────────
  const [deployConfig, packageScripts, packageManager] = await Promise.all([
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { pm2Name: true },
    }),
    readPackageScripts(root),
    detectPackageManager(root),
  ]);

  const pm2Name = deployConfig?.pm2Name ?? undefined;

  // ── Classify ────────────────────────────────────────────────────────────
  const safety = classifyProjectCommand({
    rawCommand,
    projectPm2Name: pm2Name,
    packageScripts,
    packageManager,
  });

  if (!safety.ok) {
    // Log blocked attempt
    await logCommand(projectId, `[terminal] BLOCKED: ${rawCommand} — ${safety.reason}`, "BLOCKED").catch(() => null);
    return { ok: false, error: safety.reason, code: "BLOCKED" };
  }

  if (safety.risk === "confirm" && !confirmed) {
    return {
      ok:    false,
      error: `This command requires confirmation: "${safety.normalized.display}"`,
      code:  "NEEDS_CONFIRMATION",
    };
  }

  // ── Execute ─────────────────────────────────────────────────────────────
  const { executable, args, display } = safety.normalized;
  const resolvedExec = resolveExecutable(executable);

  const result = await runCommand(resolvedExec, args, {
    cwd:       root,
    timeoutMs,
  });

  // Truncate and redact output
  const stdout = sanitizeOutput(result.stdout.slice(0, MAX_OUTPUT_BYTES));
  const stderr = sanitizeOutput(result.stderr.slice(0, MAX_OUTPUT_BYTES));

  // ── Log to ProjectLog ───────────────────────────────────────────────────
  const logLevel = result.exitCode === 0 ? "INFO" : "WARN";
  const logMsg   = `[terminal] ${display} → exit ${result.exitCode ?? "?"} (${result.durationMs}ms)`;
  await logCommand(projectId, logMsg, logLevel).catch(() => null);

  return {
    ok: true,
    data: {
      commandId:  crypto.randomUUID(),
      command:    display,
      cwd:        root,
      exitCode:   result.exitCode,
      stdout,
      stderr,
      durationMs: result.durationMs,
      risk:       safety.risk,
    },
  };
}

// ── Logging helper ────────────────────────────────────────────────────────────

async function logCommand(
  projectId: string,
  message:   string,
  level:     "INFO" | "WARN" | "ERROR" | "BLOCKED",
): Promise<void> {
  await db.projectLog.create({
    data: {
      projectId,
      // Map BLOCKED → WARN in the DB enum
      level:   level === "BLOCKED" ? "WARN" : level,
      source:  "SYSTEM",
      message: message.slice(0, 1000),
    },
  });
}
