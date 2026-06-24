/**
 * lib/deploy/dry-run-runner.ts
 *
 * Sprint 53: Optional non-mutating validation runner.
 *
 * Safety rules:
 *  - NEVER restarts PM2 services
 *  - NEVER applies nginx routes or reloads nginx
 *  - NEVER runs database migrations
 *  - NEVER writes secrets
 *  - Build execution requires RUN BUILD DRY RUN confirmation
 *  - Build runs in source directory only, with a time limit
 *  - Any classified "blocked" command is rejected before execution
 */

import path                from "path";
import { promises as fs }  from "fs";
import { db }              from "@/lib/db";
import { classifyCommand } from "./safe-command-classifier";
import type { DeploymentDryRunBuildResult } from "./dry-run-types";

const BUILD_TIMEOUT_MS = 120_000; // 2 minutes max
const BUILD_STDOUT_LIMIT = 8_000; // chars to capture

export const BUILD_CONFIRMATION_PHRASE = "RUN BUILD DRY RUN";

// ── File existence checks (read-only) ─────────────────────────────────────────

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkPackageJsonExists(rootDir: string): Promise<boolean> {
  return checkFileExists(path.join(rootDir, "package.json"));
}

export async function checkLockfileExists(rootDir: string): Promise<"pnpm-lock.yaml" | "yarn.lock" | "package-lock.json" | null> {
  if (await checkFileExists(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm-lock.yaml";
  if (await checkFileExists(path.join(rootDir, "yarn.lock")))      return "yarn.lock";
  if (await checkFileExists(path.join(rootDir, "package-lock.json"))) return "package-lock.json";
  return null;
}

export async function checkScriptExists(rootDir: string, scriptName: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return !!(pkg.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

// ── Optional build dry run ────────────────────────────────────────────────────
// This function runs a build command in the project directory.
// It requires explicit confirmation and rejects blocked commands.

export async function runBuildDryRun(input: {
  projectId:    string;
  serviceId?:   string;
  confirmation: string;
}): Promise<DeploymentDryRunBuildResult> {
  const start = Date.now();

  if (input.confirmation !== BUILD_CONFIRMATION_PHRASE) {
    return {
      command:    "",
      success:    false,
      stdout:     "",
      stderr:     "",
      durationMs: 0,
      error:      `Confirmation required: type "${BUILD_CONFIRMATION_PHRASE}"`,
    };
  }

  // Load config
  const [config, services] = await Promise.all([
    db.projectDeploymentConfig.findUnique({
      where:  { projectId: input.projectId },
      select: { buildCommand: true, rootDirectory: true, installCommand: true },
    }),
    input.serviceId
      ? db.projectService.findUnique({
          where:  { id: input.serviceId },
          select: { name: true, buildCommand: true },
        })
      : Promise.resolve(null),
  ]);

  const buildCmd =
    (services as { buildCommand?: string | null } | null)?.buildCommand ??
    config?.buildCommand ??
    null;

  const serviceName =
    (services as { name?: string } | null)?.name ?? undefined;

  if (!buildCmd) {
    return {
      serviceId:    input.serviceId,
      serviceName,
      command:      "",
      success:      false,
      stdout:       "",
      stderr:       "",
      durationMs:   Date.now() - start,
      error:        "No build command configured.",
    };
  }

  // Safety gate
  const cls = classifyCommand(buildCmd);
  if (cls.safety === "blocked") {
    return {
      serviceId:  input.serviceId,
      serviceName,
      command:    buildCmd,
      success:    false,
      stdout:     "",
      stderr:     "",
      durationMs: Date.now() - start,
      error:      `Build command blocked: ${cls.reason}`,
    };
  }

  // Determine working directory — must be within the project source
  const rootDir = config?.rootDirectory ?? null;
  let cwd: string;
  try {
    cwd = rootDir ? path.resolve(rootDir) : process.cwd();
    // Safety: do not run outside /home
    if (!cwd.startsWith("/home") && !cwd.startsWith("/tmp")) {
      return {
        serviceId:  input.serviceId,
        serviceName,
        command:    buildCmd,
        success:    false,
        stdout:     "",
        stderr:     "",
        durationMs: Date.now() - start,
        error:      `Refusing to run build in ${cwd} — path must be under /home or /tmp.`,
      };
    }
  } catch {
    cwd = process.cwd();
  }

  // Execute the build with a timeout
  const { spawn } = await import("child_process");
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("sh", ["-c", buildCmd], {
        cwd,
        env:   { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, BUILD_TIMEOUT_MS);

      proc.stdout.on("data", (d: Buffer) => {
        if (stdout.length < BUILD_STDOUT_LIMIT) stdout += d.toString();
      });
      proc.stderr.on("data", (d: Buffer) => {
        if (stderr.length < BUILD_STDOUT_LIMIT) stderr += d.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`Build timed out after ${BUILD_TIMEOUT_MS / 1000}s.`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build exited with code ${code}.`));
        }
      });

      proc.on("error", reject);
    });

    return {
      serviceId:  input.serviceId,
      serviceName,
      command:    buildCmd,
      success:    true,
      stdout:     stdout.slice(0, BUILD_STDOUT_LIMIT),
      stderr:     stderr.slice(0, BUILD_STDOUT_LIMIT),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      serviceId:  input.serviceId,
      serviceName,
      command:    buildCmd,
      success:    false,
      stdout:     stdout.slice(0, BUILD_STDOUT_LIMIT),
      stderr:     stderr.slice(0, BUILD_STDOUT_LIMIT),
      durationMs: Date.now() - start,
      error:      err instanceof Error ? err.message : "Build failed.",
    };
  }
}
