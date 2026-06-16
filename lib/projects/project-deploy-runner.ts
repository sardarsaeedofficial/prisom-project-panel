/**
 * lib/projects/project-deploy-runner.ts
 *
 * Safe PM2-based deployment runner for uploaded / blank / GitHub projects.
 *
 * All external commands are executed via runCommand (execFile, never shell).
 * Only an explicit allowlist of command patterns is accepted.
 * Output is sanitised before returning.
 *
 * Disk layout:
 *   storage/projects/<slug>/       ← source (never served directly)
 *   storage/releases/<slug>/<ts>/  ← each immutable release snapshot
 *
 * PM2 naming convention: "project-<slug>"
 * Port range: 4100–4999 (3000–3003 reserved for the panel and LocalShop)
 */

import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import { runCommand, sanitizeOutput } from "@/lib/server/command-runner";
import { FULL_PATH_PNPM } from "@/lib/projects/deploy-constants";

// Re-export so callers that already import from this module don't need to change
export { FULL_PATH_PNPM };

// ── Constants ──────────────────────────────────────────────────────────────

const PROJECT_STORAGE = path.resolve(process.cwd(), "storage", "projects");
const RELEASE_STORAGE = path.resolve(process.cwd(), "storage", "releases");

export const PORT_START = 4100;
export const PORT_MAX   = 4999;

const RESERVED_PORTS = new Set([3000, 3001, 3002, 3003]);

const MAX_LOG_BYTES = 50_000;

// Directories excluded from source copy (lower-case name comparison)
const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".netlify",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  "storage",
  // Build-tool cache directories
  ".turbo",
  ".cache",
]);

// Files matching this pattern are excluded (env files with any suffix)
const ENV_FILE_RE = /^\.env(\.|$)/i;

// TypeScript incremental build cache files — MUST be excluded so tsc does not
// use stale references to dist/ outputs that were intentionally not copied.
// Keeping these causes TS6305 ("Output file has not been built from source file").
const TSBUILDINFO_RE = /\.tsbuildinfo$/i;

// Shell-injection character reject set
const INJECT_CHARS_RE = /[;&|><`$\\]/;

// Dangerous keyword patterns
const DANGEROUS: RegExp[] = [
  /\bsudo\b/i,
  /\brm\s+-[rf]/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bchmod\s+7/i,
  /\bchown\b/i,
  /\$\(/,
];

// Allowed sub-commands per package manager
const ALLOWED_NPM  = /^(install|ci|start|run\s+[a-zA-Z0-9:_-]+)$/;
const ALLOWED_PNPM = /^(install|ci|build|start|run\s+[a-zA-Z0-9:_-]+)$/;
const ALLOWED_YARN = /^(install|build|start|run\s+[a-zA-Z0-9:_-]+)$/;

// Regex for the full-path pnpm binary's allowed sub-commands
const ALLOWED_FULL_PATH_PNPM = /^(install|start|run\s+(build|start|preview))$/;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  binary: string;
  args: string[];
}

export interface DeployConfig {
  slug: string;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string;
  rootDirectory: string;
  port: number;
  pm2Name: string;
  healthPath: string;
  nodeEnv: string;
}

export interface DeployRunnerResult {
  ok: boolean;
  output: string;
  error: string;
  releasePath?: string;
  deploymentRef?: string;
  sourceRef?: string;
  sourceType?: "git" | "upload";
  durationMs: number;
}

export interface Pm2AppStatus {
  name: string;
  /** "online" | "stopped" | "errored" | "launching" | "unknown" */
  status: string;
  pid: number | null;
  memoryMb: number | null;
  cpu: number | null;
  uptimeMs: number | null;
}

// ── Command validation ─────────────────────────────────────────────────────

/**
 * Validates a user-supplied command string against an allowlist.
 * Returns a parsed { binary, args } on success or an error message on failure.
 * Never passes through a shell.
 */
export function validateAndParseCommand(
  raw: string
): { ok: true; cmd: ParsedCommand } | { ok: false; error: string } {
  const cmd = raw.trim();
  if (!cmd) return { ok: false, error: "Command is empty." };

  if (INJECT_CHARS_RE.test(cmd)) {
    return {
      ok: false,
      error: `Command contains disallowed characters (;&|><\`$\\). Only simple commands are allowed.`,
    };
  }
  for (const re of DANGEROUS) {
    if (re.test(cmd)) {
      return { ok: false, error: `Command contains a disallowed keyword: ${re.source}` };
    }
  }

  const parts = cmd.split(/\s+/);
  const [binary, ...rest] = parts;
  const restStr = rest.join(" ");

  switch (binary) {
    case "npm":
      if (!ALLOWED_NPM.test(restStr))
        return {
          ok: false,
          error: `npm sub-command "${restStr}" is not allowed. Allowed: install, ci, start, run <script>`,
        };
      return { ok: true, cmd: { binary: "npm", args: rest } };

    case "pnpm":
      if (!ALLOWED_PNPM.test(restStr))
        return {
          ok: false,
          error: `pnpm sub-command "${restStr}" is not allowed. Allowed: install, ci, build, start, run <script>`,
        };
      return { ok: true, cmd: { binary: "pnpm", args: rest } };

    case "yarn":
      if (!ALLOWED_YARN.test(restStr))
        return {
          ok: false,
          error: `yarn sub-command "${restStr}" is not allowed. Allowed: install, build, start, run <script>`,
        };
      return { ok: true, cmd: { binary: "yarn", args: rest } };

    case "node": {
      const file = rest[0];
      if (!file) return { ok: false, error: "node: a file argument is required (e.g. node server.js)" };
      if (file.startsWith("/") || file.includes(".."))
        return { ok: false, error: "node: path must be relative and must not contain .." };
      if (!/\.(js|mjs|cjs)$/.test(file))
        return { ok: false, error: "node: only .js / .mjs / .cjs files are allowed" };
      if (rest.length > 1)
        return { ok: false, error: "node: extra arguments are not allowed for safety" };
      return { ok: true, cmd: { binary: "node", args: [file] } };
    }

    case FULL_PATH_PNPM:
      // Full absolute path to pnpm on the production VPS only.
      // Allowed sub-commands are deliberately narrower than the relative "pnpm" case.
      if (!ALLOWED_FULL_PATH_PNPM.test(restStr))
        return {
          ok: false,
          error:
            `Full-path pnpm: sub-command "${restStr}" is not allowed. ` +
            `Allowed: install, start, run build, run start, run preview`,
        };
      return { ok: true, cmd: { binary: FULL_PATH_PNPM, args: rest } };

    default:
      return {
        ok: false,
        error: `Binary "${binary}" is not in the allowlist. Allowed: npm, pnpm, yarn, node, ${FULL_PATH_PNPM}`,
      };
  }
}

// ── Port assignment ────────────────────────────────────────────────────────

/**
 * Returns the next available port from PORT_START, checking the DB for
 * already-assigned ports. Throws if the range is exhausted.
 */
export async function assignNextPort(): Promise<number> {
  const { db } = await import("@/lib/db");
  const rows = await db.projectDeploymentConfig.findMany({ select: { port: true } });
  const used = new Set([...RESERVED_PORTS, ...rows.map((r) => r.port)]);
  for (let p = PORT_START; p <= PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("All ports in range 4100–4999 are in use. Remove unused deployment configs.");
}

// ── Source copy ────────────────────────────────────────────────────────────

/**
 * Copies the project source to a release snapshot directory, excluding
 * git artifacts, build outputs, node_modules, env files, and TS build cache.
 *
 * Files that are intentionally preserved as-is:
 *   - pnpm-workspace.yaml  — copied verbatim; must never be overwritten by
 *                            the runner (contains user-defined workspace config).
 *   - package.json         — copied verbatim.
 *   - tsconfig*.json       — copied verbatim (build cache files removed separately).
 */
export async function copySourceToRelease(
  slug: string,
  releasePath: string,
  rootDirectory = "."
): Promise<void> {
  const projectRoot = path.resolve(PROJECT_STORAGE, slug);

  const sourceRoot =
    rootDirectory && rootDirectory !== "."
      ? path.resolve(projectRoot, rootDirectory)
      : projectRoot;

  // Path-traversal guard
  if (
    sourceRoot !== projectRoot &&
    !sourceRoot.startsWith(projectRoot + path.sep)
  ) {
    throw new Error("rootDirectory must not escape the project storage root.");
  }

  await fs.mkdir(releasePath, { recursive: true });

  async function copy(src: string, dst: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dst, { recursive: true });

    for (const e of entries) {
      if (EXCLUDE_DIRS.has(e.name.toLowerCase())) continue;
      if (ENV_FILE_RE.test(e.name)) continue;
      if (TSBUILDINFO_RE.test(e.name)) continue; // skip stale TS build cache

      const srcPath = path.join(src, e.name);
      const dstPath = path.join(dst, e.name);

      if (e.isDirectory()) {
        await copy(srcPath, dstPath);
      } else if (e.isFile() || e.isSymbolicLink()) {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }

  await copy(sourceRoot, releasePath);
}

// ── Post-copy TypeScript cache cleanup ────────────────────────────────────

/**
 * Recursively walks `dir` and deletes every `*.tsbuildinfo` file found.
 * This is a safety sweep run after `copySourceToRelease` in case any cache
 * files slipped through (e.g. inside a subdirectory that was not excluded).
 *
 * Returns the number of files deleted.
 * Uses only fs/path — no shell, no external commands.
 */
async function removeTsBuildInfoFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        count += await removeTsBuildInfoFiles(fullPath);
      } else if (e.isFile() && TSBUILDINFO_RE.test(e.name)) {
        try {
          await fs.unlink(fullPath);
          count++;
        } catch {
          // Non-fatal — best-effort cleanup
        }
      }
    }
  } catch {
    // Directory may not exist or be unreadable — skip silently
  }
  return count;
}

// ── PM2 helpers ────────────────────────────────────────────────────────────

/**
 * Builds the `pm2 start` argument list for a given parsed start command.
 *
 * - npm/pnpm/yarn: `pm2 start <binary> --name <name> --cwd <dir> -- <args>`
 * - node: `pm2 start <absolute-path> --name <name>`
 */
function buildPm2StartArgs(
  pm2Name: string,
  parsed: ParsedCommand,
  releasePath: string
): string[] {
  if (parsed.binary === "node") {
    // Use absolute path so PM2 resolves the cwd to the file's directory
    const absFile = path.resolve(releasePath, parsed.args[0]);
    return ["start", absFile, "--name", pm2Name];
  }
  // Package manager: set cwd explicitly so PM2 runs in the release directory
  return [
    "start",
    parsed.binary,
    "--name", pm2Name,
    "--cwd",  releasePath,
    "--",
    ...parsed.args,
  ];
}

/** Returns true if a PM2 process with `pm2Name` is registered. */
async function pm2ProcessExists(pm2Name: string): Promise<boolean> {
  const r = await runCommand("pm2", ["id", pm2Name], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  const out = r.stdout.trim();
  return r.exitCode === 0 && out !== "" && out !== "[]";
}

/** Fetches live PM2 status for one named process. Returns null if not found. */
export async function getPm2AppStatus(pm2Name: string): Promise<Pm2AppStatus | null> {
  const r = await runCommand("pm2", ["jlist"], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  if (r.exitCode !== 0) return null;

  try {
    type Entry = {
      name?: string;
      pid?: number;
      pm2_env?: { status?: string; pm_uptime?: number };
      monit?: { memory?: number; cpu?: number };
    };
    const list: Entry[] = JSON.parse(r.stdout.trim() || "[]");
    const app = list.find((a) => a.name === pm2Name);
    if (!app) return null;

    return {
      name: app.name ?? pm2Name,
      status: app.pm2_env?.status ?? "unknown",
      pid: app.pid ?? null,
      memoryMb:
        app.monit?.memory != null
          ? Math.round(app.monit.memory / 1024 / 1024)
          : null,
      cpu: app.monit?.cpu ?? null,
      uptimeMs: app.pm2_env?.pm_uptime ?? null,
    };
  } catch {
    return null;
  }
}

/** Returns the last N lines of PM2 output logs, sanitised. */
export async function getPm2AppLogs(pm2Name: string, lines = 200): Promise<string> {
  const r = await runCommand(
    "pm2",
    ["logs", pm2Name, "--nostream", "--raw", `--lines=${lines}`],
    { cwd: process.cwd(), timeoutMs: 15_000 }
  );
  const raw = [r.stdout, r.stderr].filter(Boolean).join("\n");
  return sanitizeOutput(raw.slice(0, MAX_LOG_BYTES));
}

/**
 * Deletes any existing PM2 process with `pm2Name`, then starts a fresh one.
 * Deleting first ensures the new `--cwd` takes effect.
 */
async function pm2StartFresh(
  pm2Name: string,
  parsedStart: ParsedCommand,
  releasePath: string,
  port: number,
  nodeEnv: string
): Promise<{ ok: boolean; output: string }> {
  const log: string[] = [];

  const exists = await pm2ProcessExists(pm2Name);
  if (exists) {
    log.push(`▶ pm2 delete ${pm2Name}`);
    const del = await runCommand("pm2", ["delete", pm2Name], {
      cwd: process.cwd(),
      timeoutMs: 15_000,
    });
    if (del.stdout.trim()) log.push(del.stdout.trim());
    // Ignore delete exit code — the process may already be stopped
  }

  const startArgs = buildPm2StartArgs(pm2Name, parsedStart, releasePath);
  log.push(`▶ pm2 ${startArgs.join(" ")}`);

  const startResult = await runCommand("pm2", startArgs, {
    cwd: process.cwd(),
    timeoutMs: 30_000,
    env: { PORT: String(port), NODE_ENV: nodeEnv },
  });
  if (startResult.stdout.trim()) log.push(startResult.stdout.trim());
  if (startResult.stderr.trim()) log.push(startResult.stderr.trim());

  if (startResult.exitCode !== 0) {
    return { ok: false, output: sanitizeOutput(log.join("\n")) };
  }

  // Persist the process list so PM2 survives reboots
  const save = await runCommand("pm2", ["save"], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
  });
  if (save.stdout.trim()) log.push(save.stdout.trim());
  log.push("✓ PM2 process started and saved");

  return { ok: true, output: sanitizeOutput(log.join("\n")) };
}

/** Stops a PM2 process by name (does not delete it). */
export async function pm2StopApp(pm2Name: string): Promise<{ ok: boolean; output: string }> {
  const r = await runCommand("pm2", ["stop", pm2Name], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  return {
    ok: r.exitCode === 0,
    output: sanitizeOutput([r.stdout, r.stderr].filter(Boolean).join("\n")),
  };
}

/** Restarts an existing PM2 process in-place (same release directory). */
export async function pm2RestartApp(pm2Name: string): Promise<{ ok: boolean; output: string }> {
  const r = await runCommand("pm2", ["restart", pm2Name, "--update-env"], {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  return {
    ok: r.exitCode === 0,
    output: sanitizeOutput([r.stdout, r.stderr].filter(Boolean).join("\n")),
  };
}

// ── Health check ───────────────────────────────────────────────────────────

/**
 * Polls `http://127.0.0.1:<port><healthPath>` until it returns a non-5xx
 * status or `maxAttempts` is exhausted.
 */
export async function runHealthCheck(
  port: number,
  healthPath: string,
  maxAttempts = 5,
  delayMs = 4_000
): Promise<boolean> {
  const safePath = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  const url = `http://127.0.0.1:${port}${safePath}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise<void>((res) => setTimeout(res, delayMs));
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        redirect: "manual",
      });
      // 2xx / 3xx / 4xx all mean the process is listening
      if (res.status < 500) return true;
    } catch {
      // ECONNREFUSED or timeout — not ready yet, retry
    }
  }
  return false;
}

// ── Source fingerprinting ──────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 fingerprint of the project source files.
 * Uses the same exclusion rules as copySourceToRelease so the hash reflects
 * exactly what will be deployed.
 * Returns the first 10 hex characters of the combined hash.
 */
async function computeFilesHash(dir: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  async function walk(currentDir: string): Promise<void> {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort deterministically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const lname = entry.name.toLowerCase();
      if (EXCLUDE_DIRS.has(lname)) continue;
      if (ENV_FILE_RE.test(entry.name)) continue;
      if (TSBUILDINFO_RE.test(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        // Include relative path in hash so renames are detected
        hash.update(path.relative(dir, fullPath));
        try {
          const content = await fs.readFile(fullPath);
          hash.update(content);
        } catch {
          // Skip unreadable files — don't abort the entire hash
        }
      }
    }
  }

  await walk(dir);
  return hash.digest("hex").slice(0, 10);
}

/**
 * Returns a short source reference for the project:
 *   - Git projects: first 7 chars of HEAD commit SHA
 *   - Upload / blank projects: first 10 chars of SHA-256 of source files
 *
 * Never throws — falls back to file hash on any git error.
 */
async function computeSourceRef(
  projectRoot: string
): Promise<{ sourceRef: string; sourceType: "git" | "upload" }> {
  // Try to read a git commit SHA (not user-supplied — internal, fixed command)
  try {
    const r = await runCommand("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      timeoutMs: 5_000,
    });
    if (r.exitCode === 0 && r.stdout.trim().length >= 7) {
      return { sourceRef: r.stdout.trim().slice(0, 7), sourceType: "git" };
    }
  } catch {
    // Not a git repo, or git not available — fall through
  }

  const sourceRef = await computeFilesHash(projectRoot);
  return { sourceRef, sourceType: "upload" };
}

/**
 * Generates a deployment reference string:
 *   dep_<YYYYMMDDHHmmss>_<shortSourceRef>
 *
 * Example:  dep_20241201120034_a3f7b2c1e9
 */
function generateDeploymentRef(sourceRef: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14); // YYYYMMDDHHmmss
  return `dep_${timestamp}_${sourceRef}`;
}

// ── Main deploy pipeline ───────────────────────────────────────────────────

/**
 * Runs the full deployment pipeline for one project:
 *   1. Create timestamped release directory
 *   2. Copy source (exclusions applied)
 *   3. Run install (optional)
 *   4. Run build (optional)
 *   5. Start/restart via PM2
 *   6. Health check
 *
 * Returns a result object — never throws.
 */
export async function runProjectDeployment(
  config: DeployConfig
): Promise<DeployRunnerResult> {
  const t0 = Date.now();
  const lines: string[] = [];

  // ── Pre-flight: verify source + compute deployment reference ─────────────
  const projectRoot = path.resolve(PROJECT_STORAGE, config.slug);

  // sourceRef and deploymentRef are computed before the release dir is created
  // so they can be used as the directory name. On error we still have placeholders.
  let sourceRef = "unknown";
  let sourceType: "git" | "upload" = "upload";
  let deploymentRef = `dep_${"0".repeat(14)}_unknown`;

  const log = (msg: string) => lines.push(msg);
  const out = () => sanitizeOutput(lines.join("\n")).slice(0, MAX_LOG_BYTES);

  // Resolve release path only after we have the deploymentRef
  let releasePath = "";

  const fail = (error: string): DeployRunnerResult => ({
    ok: false,
    output: out(),
    error,
    releasePath: releasePath || undefined,
    deploymentRef,
    sourceRef,
    sourceType,
    durationMs: Date.now() - t0,
  });

  try {
    // ── 0. Verify source exists ───────────────────────────────────────────
    try {
      await fs.access(projectRoot);
    } catch {
      return fail(
        `Source directory not found: storage/projects/${config.slug}/. ` +
          "Upload your project files first."
      );
    }

    // ── 0a. Compute source fingerprint ────────────────────────────────────
    log("▶ Computing source fingerprint…");
    const computed = await computeSourceRef(projectRoot);
    sourceRef = computed.sourceRef;
    sourceType = computed.sourceType;
    deploymentRef = generateDeploymentRef(sourceRef);
    releasePath = path.join(RELEASE_STORAGE, config.slug, deploymentRef);
    log(
      `✓ ${sourceType === "git" ? "Git commit" : "Source hash"}: ${sourceRef}` +
        `  →  ${deploymentRef}`
    );

    // ── 1. Create release dir ─────────────────────────────────────────────
    log(`▶ Creating release snapshot: storage/releases/${config.slug}/${deploymentRef}`);
    await fs.mkdir(releasePath, { recursive: true });
    log("✓ Release directory created");

    // ── 2. Copy source ────────────────────────────────────────────────────
    log(`▶ Copying source from storage/projects/${config.slug}/…`);
    await copySourceToRelease(config.slug, releasePath, config.rootDirectory);
    log("✓ Source copied to release");

    // ── 2a. Remove TypeScript build cache ─────────────────────────────────
    // *.tsbuildinfo files are excluded during copy, but we run a safety sweep
    // in case any survived (e.g. nested in a sub-package not in EXCLUDE_DIRS).
    // Stale cache files cause TS6305 by making tsc believe referenced packages
    // are already built even though their dist/ outputs were not copied.
    log("▶ Removing TypeScript build cache");
    const removedCount = await removeTsBuildInfoFiles(releasePath);
    log(
      `✓ TypeScript build cache removed` +
        (removedCount > 0 ? ` (${removedCount} file${removedCount !== 1 ? "s" : ""} deleted)` : " (none found)")
    );

    // ── 3. Install ────────────────────────────────────────────────────────
    if (config.installCommand) {
      const parsed = validateAndParseCommand(config.installCommand);
      if (!parsed.ok) return fail(`Invalid install command: ${parsed.error}`);

      log(`\n▶ Install: ${config.installCommand}`);
      const r = await runCommand(parsed.cmd.binary, parsed.cmd.args, {
        cwd: releasePath,
        timeoutMs: 300_000,
        env: { NODE_ENV: config.nodeEnv, PORT: String(config.port) },
      });
      if (r.stdout.trim()) log(sanitizeOutput(r.stdout.trimEnd()));
      if (r.stderr.trim()) log(sanitizeOutput(r.stderr.trimEnd()));
      if (r.exitCode !== 0) return fail("Install step failed (see output above).");
      log("✓ Install complete");
    }

    // ── 4. Build ──────────────────────────────────────────────────────────
    if (config.buildCommand) {
      const parsed = validateAndParseCommand(config.buildCommand);
      if (!parsed.ok) return fail(`Invalid build command: ${parsed.error}`);

      log(`\n▶ Build: ${config.buildCommand}`);
      const r = await runCommand(parsed.cmd.binary, parsed.cmd.args, {
        cwd: releasePath,
        timeoutMs: 600_000,
        env: { NODE_ENV: config.nodeEnv, PORT: String(config.port) },
      });
      if (r.stdout.trim()) log(sanitizeOutput(r.stdout.trimEnd()));
      if (r.stderr.trim()) log(sanitizeOutput(r.stderr.trimEnd()));
      if (r.exitCode !== 0) return fail("Build step failed (see output above).");
      log("✓ Build complete");
    }

    // ── 5. PM2 start ──────────────────────────────────────────────────────
    const parsedStart = validateAndParseCommand(config.startCommand);
    if (!parsedStart.ok) return fail(`Invalid start command: ${parsedStart.error}`);

    log(`\n▶ Starting PM2 process: ${config.pm2Name}`);
    const pm2Result = await pm2StartFresh(
      config.pm2Name,
      parsedStart.cmd,
      releasePath,
      config.port,
      config.nodeEnv
    );
    log(pm2Result.output);
    if (!pm2Result.ok) return fail("PM2 start failed — see output above.");

    // ── 6. Health check ───────────────────────────────────────────────────
    log(
      `\n▶ Health check: http://127.0.0.1:${config.port}${config.healthPath} ` +
        `(up to 5 attempts, 4 s apart)`
    );
    const healthy = await runHealthCheck(config.port, config.healthPath);
    if (!healthy) {
      log("✗ Health check timed out — process may still be starting.");
      return fail(
        `Health check failed after 5 attempts on port ${config.port}. ` +
          "The app may need more startup time. Check PM2 logs for errors."
      );
    }
    log("✓ Health check passed");

    return {
      ok: true,
      output: out(),
      error: "",
      releasePath,
      deploymentRef,
      sourceRef,
      sourceType,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`\n✗ Unexpected error: ${msg}`);
    return fail(msg);
  }
}
