/**
 * lib/projects/package-manager.ts
 *
 * Sprint 9: Safe per-project package manager operations.
 *
 * Safety rules:
 *  - All commands run via runCommand (execFile, shell:false).
 *  - All install/remove/update operations use --ignore-scripts.
 *  - No command chaining. No arbitrary shell execution.
 *  - Package specifier validated via package-validator before use.
 *  - GIT_CEILING_DIRECTORIES set on every operation to prevent parent-repo walk.
 *  - CI=1 set to prevent interactive prompts.
 *  - Timeout: 120 seconds. Output: 100 KB cap.
 *  - No auto-commit, auto-push, auto-restart, auto-deploy.
 *  - Does not check ownership — callers (server actions) must verify that.
 */

import { promises as fs } from "fs";
import path from "path";
import { runCommand, sanitizeOutput } from "@/lib/server/command-runner";
import { getProjectGitStatus, getProjectGitDiff } from "@/lib/projects/git-manager";
import { FULL_PATH_PNPM } from "@/lib/projects/deploy-constants";

// Re-export validator so callers can use a single import
export {
  validatePackageSpecifier,
  type ValidatedPackageSpecifier,
  type ValidationResult,
} from "@/lib/projects/package-validator";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetectedPackageManager = "pnpm" | "npm" | "yarn";
export type PackageOperation = "install" | "install-dev" | "remove" | "update";

export interface ProjectPackageInfo {
  name:                 string | null;
  version:              string | null;
  description:          string | null;
  packageManager:       DetectedPackageManager;
  hasLockfile:          boolean;
  lockfileName:         string | null;
  scripts:              Record<string, string>;
  dependencies:         Record<string, string>;
  devDependencies:      Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies:     Record<string, string>;
}

export interface PackageOperationResult {
  /** Display command shown to user, e.g. "pnpm add zod --ignore-scripts" */
  command:    string;
  exitCode:   number;
  stdout:     string;
  stderr:     string;
  durationMs: number;
  success:    boolean;
}

export interface PackageChangedFile {
  path:   string;
  status: "modified" | "added" | "deleted" | "unknown";
}

export interface PackageDiffResult {
  isGitRepo:       boolean;
  changedFiles:    PackageChangedFile[];
  packageJsonDiff: string | null;
  lockfileDiff:    string | null;
}

// ── Internal result type ──────────────────────────────────────────────────────

type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES     = 100 * 1024;  // 100 KB
const PACKAGE_OP_TIMEOUT   = 120_000;     // 2 minutes
const LOCKFILE_DIFF_CAP    = 50  * 1024;  // 50 KB (lockfiles can be huge)

/** Files considered "package management related" for diff reporting. */
const PACKAGE_FILE_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  ".npmrc",
  ".pnpmfile.cjs",
]);

// ── Package manager detection ─────────────────────────────────────────────────

async function detectPM(root: string): Promise<{
  pm:           DetectedPackageManager;
  lockfileName: string | null;
}> {
  const exists = async (file: string): Promise<boolean> => {
    try { await fs.access(path.join(root, file)); return true; }
    catch { return false; }
  };

  // Lockfile takes priority — unambiguous
  if (await exists("pnpm-lock.yaml"))    return { pm: "pnpm", lockfileName: "pnpm-lock.yaml" };
  if (await exists("package-lock.json")) return { pm: "npm",  lockfileName: "package-lock.json" };
  if (await exists("yarn.lock"))         return { pm: "yarn", lockfileName: "yarn.lock" };

  // packageManager field in package.json
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    if (typeof pkg.packageManager === "string") {
      const pmField = pkg.packageManager.toLowerCase();
      if (pmField.startsWith("pnpm"))  return { pm: "pnpm",  lockfileName: null };
      if (pmField.startsWith("npm"))   return { pm: "npm",   lockfileName: null };
      if (pmField.startsWith("yarn"))  return { pm: "yarn",  lockfileName: null };
    }
  } catch { /* no package.json or not parseable */ }

  // Fallback: pnpm (it's the panel's own package manager)
  return { pm: "pnpm", lockfileName: null };
}

// ── Binary resolver ───────────────────────────────────────────────────────────

function resolvePMBinary(pm: DetectedPackageManager): string {
  switch (pm) {
    case "pnpm": return FULL_PATH_PNPM;
    case "npm":  return "npm";
    case "yarn": return "yarn";
  }
}

// ── Argument builder ──────────────────────────────────────────────────────────

function buildPMArgs(
  pm:        DetectedPackageManager,
  operation: PackageOperation,
  pkgSpec:   string,
): string[] {
  switch (pm) {
    case "pnpm":
      switch (operation) {
        case "install":     return ["add",    pkgSpec, "--ignore-scripts"];
        case "install-dev": return ["add",    "-D", pkgSpec, "--ignore-scripts"];
        case "remove":      return ["remove", pkgSpec, "--ignore-scripts"];
        case "update":      return ["update", pkgSpec, "--ignore-scripts"];
      }
      break;
    case "npm":
      switch (operation) {
        case "install":     return ["install",   pkgSpec, "--ignore-scripts"];
        case "install-dev": return ["install",   "-D", pkgSpec, "--ignore-scripts"];
        case "remove":      return ["uninstall", pkgSpec, "--ignore-scripts"];
        case "update":      return ["update",    pkgSpec, "--ignore-scripts"];
      }
      break;
    case "yarn":
      switch (operation) {
        case "install":     return ["add",     pkgSpec, "--ignore-scripts"];
        case "install-dev": return ["add",     "-D", pkgSpec, "--ignore-scripts"];
        case "remove":      return ["remove",  pkgSpec];  // yarn remove has no --ignore-scripts
        case "update":      return ["upgrade", pkgSpec, "--ignore-scripts"];
      }
      break;
  }
  // Exhaustiveness fallback
  return [];
}

// ── Helper: extract Record<string,string> from unknown JSON value ─────────────

function toStringRecord(val: unknown): Record<string, string> {
  if (!val || typeof val !== "object" || Array.isArray(val)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read package.json and detect the package manager for a project root.
 * Returns sensible defaults if package.json doesn't exist.
 */
export async function getPackageInfo(root: string): Promise<Result<ProjectPackageInfo>> {
  const { pm, lockfileName } = await detectPM(root);

  let pkg: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // No package.json — return empty info
    return {
      ok: true,
      data: {
        name: null, version: null, description: null,
        packageManager: pm,
        hasLockfile: lockfileName !== null,
        lockfileName,
        scripts: {}, dependencies: {}, devDependencies: {},
        optionalDependencies: {}, peerDependencies: {},
      },
    };
  }

  return {
    ok: true,
    data: {
      name:                 typeof pkg.name        === "string" ? pkg.name        : null,
      version:              typeof pkg.version     === "string" ? pkg.version     : null,
      description:          typeof pkg.description === "string" ? pkg.description : null,
      packageManager:       pm,
      hasLockfile:          lockfileName !== null,
      lockfileName,
      scripts:              toStringRecord(pkg.scripts),
      dependencies:         toStringRecord(pkg.dependencies),
      devDependencies:      toStringRecord(pkg.devDependencies),
      optionalDependencies: toStringRecord(pkg.optionalDependencies),
      peerDependencies:     toStringRecord(pkg.peerDependencies),
    },
  };
}

/**
 * Run a package operation (install / install-dev / remove / update).
 *
 * Requires a ValidatedPackageSpecifier from validatePackageSpecifier().
 * Always uses --ignore-scripts. Sets GIT_CEILING_DIRECTORIES to prevent
 * postinstall hooks from discovering the panel's parent git repo.
 */
export async function runPackageOperation(
  root:      string,
  operation: PackageOperation,
  specifier: { raw: string; display: string },
): Promise<Result<PackageOperationResult>> {
  const { pm } = await detectPM(root);
  const binary  = resolvePMBinary(pm);
  const args    = buildPMArgs(pm, operation, specifier.raw);

  if (!args.length) {
    return { ok: false, error: "Could not build package operation arguments." };
  }

  const displayCmd = [pm, ...args].join(" ");

  const result = await runCommand(binary, args, {
    cwd:       root,
    timeoutMs: PACKAGE_OP_TIMEOUT,
    env: {
      // Prevent any postinstall hook from discovering the panel's parent git repo
      GIT_CEILING_DIRECTORIES: path.dirname(root),
      // Suppress interactive prompts
      CI:         "1",
      NO_COLOR:   "1",
      FORCE_COLOR:"0",
    },
  });

  const stdout = sanitizeOutput(result.stdout.slice(0, MAX_OUTPUT_BYTES));
  const stderr = sanitizeOutput(result.stderr.slice(0, MAX_OUTPUT_BYTES));

  return {
    ok: true,
    data: {
      command:    displayCmd,
      exitCode:   result.exitCode,
      stdout,
      stderr,
      durationMs: result.durationMs,
      success:    result.exitCode === 0,
    },
  };
}

/**
 * Return git diffs for package.json and the lockfile, if the project is
 * in a git repo.  Always returns ok:true — diffs are optional context.
 */
export async function getPackageDiff(root: string): Promise<Result<PackageDiffResult>> {
  const statusResult = await getProjectGitStatus(root);

  if (!statusResult.ok) {
    // Not a git repo, or git unavailable
    return {
      ok: true,
      data: { isGitRepo: false, changedFiles: [], packageJsonDiff: null, lockfileDiff: null },
    };
  }

  const allChanged   = statusResult.data.changedFiles;
  const pkgChanged   = allChanged.filter((f) => PACKAGE_FILE_NAMES.has(f.path));

  const changedFiles: PackageChangedFile[] = pkgChanged.map((f) => ({
    path:   f.path,
    status: f.status === "modified" ? "modified"
          : f.status === "added"    ? "added"
          : f.status === "deleted"  ? "deleted"
          : "unknown",
  }));

  // ── package.json diff ──────────────────────────────────────────────────────
  let packageJsonDiff: string | null = null;
  const pkgEntry = pkgChanged.find((f) => f.path === "package.json");
  if (pkgEntry && (pkgEntry.staged || pkgEntry.unstaged)) {
    // Prefer unstaged (working tree) diff; fall back to staged (index) diff
    const staged = pkgEntry.staged && !pkgEntry.unstaged;
    const diffR  = await getProjectGitDiff(root, "package.json", staged);
    if (diffR.ok && diffR.data.diff) {
      packageJsonDiff = diffR.data.diff;
    }
  }

  // ── lockfile diff ──────────────────────────────────────────────────────────
  let lockfileDiff: string | null = null;
  for (const lf of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    const lfEntry = pkgChanged.find((f) => f.path === lf);
    if (lfEntry && (lfEntry.staged || lfEntry.unstaged)) {
      const staged = lfEntry.staged && !lfEntry.unstaged;
      const diffR  = await getProjectGitDiff(root, lf, staged);
      if (diffR.ok && diffR.data.diff) {
        let raw = diffR.data.diff;
        const truncated = raw.length > LOCKFILE_DIFF_CAP;
        if (truncated) raw = raw.slice(0, LOCKFILE_DIFF_CAP) + "\n\n[lockfile diff truncated at 50 KB]";
        lockfileDiff = raw;
      }
      break;
    }
  }

  return {
    ok: true,
    data: { isGitRepo: true, changedFiles, packageJsonDiff, lockfileDiff },
  };
}
