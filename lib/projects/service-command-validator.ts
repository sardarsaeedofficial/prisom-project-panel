/**
 * lib/projects/service-command-validator.ts
 *
 * Sprint 23: Command validator for ProjectService deployment configs.
 *
 * Extends the existing validateAndParseCommand from project-deploy-runner.ts
 * with two additional safe patterns needed for monorepo / Replit workspaces:
 *
 *   1. pnpm --filter <workspace-filter> run <script>
 *      e.g. pnpm --filter @workspace/api-server run build
 *
 *   2. node <safe-flags>* <file.js|mjs|cjs>
 *      e.g. node --enable-source-maps artifacts/api-server/dist/index.mjs
 *
 * All other command patterns delegate to the existing validateAndParseCommand.
 * This module MUST NOT weaken any existing restrictions.
 */

import {
  validateAndParseCommand,
  type ParsedCommand,
} from "@/lib/projects/project-deploy-runner";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ServiceCommandResult =
  | { ok: true;  cmd: ParsedCommand; display: string }
  | { ok: false; error: string };

// ── Shell metacharacter guard (same as deploy runner) ─────────────────────────

const INJECT_CHARS_RE = /[;&|><`$\\]/;

const DANGEROUS_PATTERNS: RegExp[] = [
  /\bsudo\b/i,
  /\brm\s+-[rf]/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\$\(/,
];

// ── pnpm workspace filter validation ─────────────────────────────────────────
//
// A valid pnpm workspace filter is:
//   @scope/package-name
//   package-name
//   ./relative/path          ← we do NOT allow these (path traversal risk)
//
// We restrict to alphanumeric + @ / - _ . only.

const WORKSPACE_FILTER_RE = /^@?[a-zA-Z0-9][a-zA-Z0-9@/_.-]{0,99}$/;

// ── Allowed pnpm workspace scripts ────────────────────────────────────────────
//
// Scripts that may be run per-workspace package.
// "dev", "start" are blocked — they are long-running; use startCommand instead.

const ALLOWED_WORKSPACE_SCRIPTS = new Set([
  "build",
  "typecheck",
  "test",
  "lint",
  "generate",
  "prisma",
  "clean",
  "compile",
  "check",
  "validate",
  "prepare",
  "prebuild",
  "postbuild",
]);

// ── Allowed node flags before the script file ─────────────────────────────────

const ALLOWED_NODE_FLAGS = new Set([
  "--enable-source-maps",
  "--experimental-specifier-resolution=node",
  "--experimental-vm-modules",
  "--no-warnings",
  "--max-old-space-size=512",
  "--max-old-space-size=1024",
  "--max-old-space-size=2048",
  "--max-old-space-size=4096",
]);

// also allow --max-old-space-size=N (any N) via regex
const MEM_FLAG_RE = /^--max-old-space-size=\d{1,5}$/;

// ── Main validator ─────────────────────────────────────────────────────────────

/**
 * Validates a service deployment command (install, build, or start).
 *
 * Returns { ok, cmd, display } on success or { ok: false, error } on failure.
 */
export function validateServiceCommand(raw: string): ServiceCommandResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Command is empty." };
  if (trimmed.length > 400) {
    return { ok: false, error: "Command too long (max 400 chars)." };
  }

  // Shell injection guard
  if (INJECT_CHARS_RE.test(trimmed)) {
    return {
      ok: false,
      error:
        "Shell metacharacters (;&|><`$\\) are not allowed. Each command must be standalone.",
    };
  }
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, error: `Command contains a blocked keyword: ${re.source}` };
    }
  }

  const tokens = trimmed.split(/\s+/);
  const binary = tokens[0];

  // ── pnpm --filter <filter> run <script> ─────────────────────────────────────
  if (binary === "pnpm" && tokens[1] === "--filter") {
    return validatePnpmWorkspaceFilter(tokens);
  }

  // ── node with optional safe flags ───────────────────────────────────────────
  if (binary === "node") {
    return validateNodeWithFlags(tokens);
  }

  // ── Delegate everything else to the existing deploy runner validator ─────────
  const result = validateAndParseCommand(trimmed);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, cmd: result.cmd, display: trimmed };
}

// ── pnpm --filter validator ────────────────────────────────────────────────────

function validatePnpmWorkspaceFilter(tokens: string[]): ServiceCommandResult {
  // Expected: pnpm --filter <expr> run <script>
  // tokens:   [0]   [1]        [2]  [3]  [4]
  if (tokens.length < 5) {
    return {
      ok: false,
      error:
        'pnpm --filter: expected format: pnpm --filter <workspace> run <script>. ' +
        'Example: pnpm --filter @workspace/api-server run build',
    };
  }

  const filterExpr = tokens[2];
  const subCmd     = tokens[3];
  const scriptName = tokens[4];
  const extraArgs  = tokens.slice(5);

  // Validate filter expression
  if (!filterExpr || !WORKSPACE_FILTER_RE.test(filterExpr)) {
    return {
      ok: false,
      error:
        `Invalid workspace filter "${filterExpr}". ` +
        'Must be a package name like "@workspace/api-server" or "my-package". ' +
        'Relative paths (./...) are not allowed.',
    };
  }

  // Must be "run"
  if (subCmd !== "run") {
    return {
      ok: false,
      error: `pnpm --filter <pkg> "${subCmd}" is not allowed. Only "run" is supported.`,
    };
  }

  // Script name validation
  if (!scriptName || !/^[a-zA-Z0-9:_.-]+$/.test(scriptName)) {
    return {
      ok: false,
      error: `pnpm --filter: invalid script name "${scriptName ?? ""}". Must be alphanumeric with :_.-`,
    };
  }

  if (!ALLOWED_WORKSPACE_SCRIPTS.has(scriptName)) {
    return {
      ok: false,
      error:
        `pnpm --filter: script "${scriptName}" is not in the allowed list. ` +
        `Allowed: ${[...ALLOWED_WORKSPACE_SCRIPTS].join(", ")}. ` +
        `Long-running scripts (dev, start, serve) must use the start command field instead.`,
    };
  }

  // No extra args allowed
  if (extraArgs.length > 0) {
    return {
      ok: false,
      error: `pnpm --filter: extra arguments "${extraArgs.join(" ")}" are not allowed.`,
    };
  }

  const cmd: ParsedCommand = {
    binary: "pnpm",
    args:   ["--filter", filterExpr, "run", scriptName],
  };
  return {
    ok:      true,
    cmd,
    display: `pnpm --filter ${filterExpr} run ${scriptName}`,
  };
}

// ── node with safe flags validator ────────────────────────────────────────────

function validateNodeWithFlags(tokens: string[]): ServiceCommandResult {
  // Expected: node [<safe-flag>...] <file.js|mjs|cjs>
  const args = tokens.slice(1);

  if (args.length === 0) {
    return { ok: false, error: 'Bare "node" opens a REPL; not allowed.' };
  }

  // Separate flags from the file argument
  const flags: string[] = [];
  let fileArg: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("-")) {
      // Validate flag
      if (!ALLOWED_NODE_FLAGS.has(arg) && !MEM_FLAG_RE.test(arg)) {
        return {
          ok: false,
          error:
            `node flag "${arg}" is not allowed. ` +
            `Allowed flags: ${[...ALLOWED_NODE_FLAGS].join(", ")}`,
        };
      }
      flags.push(arg);
    } else {
      // This should be the file — ensure nothing comes after
      if (fileArg !== undefined) {
        return { ok: false, error: "node: only one script file is allowed." };
      }
      fileArg = arg;
    }
  }

  if (!fileArg) {
    return { ok: false, error: "node: a script file is required (e.g. node dist/index.mjs)." };
  }

  // File path safety
  if (fileArg.startsWith("/") || fileArg.includes("..")) {
    return { ok: false, error: "node: script path must be relative and must not contain .." };
  }
  if (!/\.(js|mjs|cjs)$/.test(fileArg)) {
    return { ok: false, error: "node: only .js / .mjs / .cjs files are allowed." };
  }

  // block node -e equivalents
  if (flags.some((f) => f === "-e" || f === "--eval" || f === "--print" || f === "-p")) {
    return { ok: false, error: "node -e (eval) is not allowed." };
  }

  const cmd: ParsedCommand = {
    binary: "node",
    args:   [...flags, fileArg],
  };
  return {
    ok:      true,
    cmd,
    display: ["node", ...flags, fileArg].join(" "),
  };
}

// ── Path safety helpers ────────────────────────────────────────────────────────

/**
 * Validates a relative working directory or static output dir for a service.
 * Blocks absolute paths, path traversal, and suspicious characters.
 */
export function validateServiceRelativePath(
  value: string,
  fieldName: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === ".") return { ok: true };

  if (trimmed.startsWith("/")) {
    return { ok: false, error: `${fieldName}: absolute paths are not allowed.` };
  }
  if (trimmed.includes("..")) {
    return { ok: false, error: `${fieldName}: path traversal (..) is not allowed.` };
  }
  // Allow: letters, digits, / - _ . and nothing else
  if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
    return {
      ok: false,
      error: `${fieldName}: contains invalid characters. Use only letters, digits, /, -, _, .`,
    };
  }
  if (trimmed.length > 200) {
    return { ok: false, error: `${fieldName}: path too long (max 200 chars).` };
  }
  return { ok: true };
}

/**
 * Validates a service slug: lowercase alphanumeric and hyphens, no leading/trailing hyphens.
 */
export function validateServiceSlug(slug: string): { ok: true } | { ok: false; error: string } {
  const trimmed = (slug ?? "").trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "Service slug is required." };
  if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$|^[a-z]$/.test(trimmed)) {
    return {
      ok: false,
      error:
        'Service slug must be lowercase, start with a letter, and contain only letters, digits, and hyphens.',
    };
  }
  return { ok: true };
}

/**
 * Validates a health path for a node service.
 * Must start with / and be a safe path.
 */
export function validateHealthPath(
  value: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!value) return { ok: true }; // optional
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return { ok: false, error: 'Health path must start with "/" (e.g. "/api/healthz").' };
  }
  if (trimmed.length > 200) {
    return { ok: false, error: "Health path too long." };
  }
  if (/[;&|`$<>\\]/.test(trimmed)) {
    return { ok: false, error: "Health path contains invalid characters." };
  }
  return { ok: true };
}
