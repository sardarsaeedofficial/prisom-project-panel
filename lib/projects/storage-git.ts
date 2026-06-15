/**
 * lib/projects/storage-git.ts
 *
 * Safe git operations for projects stored in storage/projects/<slug>/.
 *
 * Safety rules enforced here:
 *  - Path traversal prevention: cwd is always resolved inside STORAGE_PROJECTS_ROOT
 *  - Only an explicit allowlist of git sub-commands is permitted
 *  - execFile (never exec / shell) via the shared runCommand helper
 *  - GIT_TERMINAL_PROMPT=0 prevents interactive credential prompts
 *  - All output is scrubbed of PATs, bearer tokens, and HTTPS credentials
 *  - Branch names and remote URLs are validated before use
 *
 * NEVER call npm, node, or any script runner from this module.
 */

import path from "path";
import { promises as fs } from "fs";
import { runCommand } from "@/lib/server/command-runner";

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PROJECTS_ROOT = path.resolve(process.cwd(), "storage", "projects");

const GIT_TIMEOUT_MS = 60_000; // 60 s per git command

/** .gitignore written on init — keeps secrets and build artifacts out of the repo */
const GITIGNORE_CONTENT = [
  "# Environment & secrets",
  ".env",
  ".env.*",
  "!.env.example",
  "",
  "# Dependencies",
  "node_modules/",
  ".pnp",
  ".pnp.js",
  "",
  "# Build outputs",
  ".next/",
  "out/",
  "dist/",
  "build/",
  ".nuxt/",
  ".output/",
  ".vercel/",
  "",
  "# Test / coverage",
  "coverage/",
  ".nyc_output/",
  "",
  "# Misc",
  ".DS_Store",
  "Thumbs.db",
  "*.log",
  "",
].join("\n");

// ── Blocklist ─────────────────────────────────────────────────────────────────

/** The canonical "owner/repo" slug for the Project Panel itself — never a valid push target. */
export const BLOCKED_REPO_SLUG = "sardarsaeedofficial/prisom-project-panel";

/**
 * Normalises any GitHub remote URL to a lowercase "owner/repo" slug.
 * Handles HTTPS and SSH forms, with or without a trailing .git.
 * Used for blocklist comparison only — preserves no case for display.
 */
export function normalizeGitHubRepoSlug(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");
}

/** Returns true if the URL resolves to a blocked repository. */
export function isBlockedRepoUrl(url: string): boolean {
  return normalizeGitHubRepoSlug(url) === BLOCKED_REPO_SLUG;
}

/**
 * Derives a stable INT4-safe placeholder ID from a GitHub repo URL.
 *
 * Uses FNV-1a 32-bit hashing on the normalised "owner/repo" slug, optionally
 * salted with a second string (e.g. the project's CUID) to avoid collisions
 * when two different projects connect to the same remote.
 *
 * Returns an integer in [1, 2_000_000_000] — well within Postgres INT4 bounds
 * (max 2,147,483,647). Safe to use as a placeholder githubRepoId until the
 * real GitHub API numeric ID is available via a sync or webhook delivery.
 *
 * @param repoUrl  Any GitHub remote URL (HTTPS or SSH, with or without .git)
 * @param salt     Optional second input, e.g. the projectId, for uniqueness
 */
export function stableGitHubRepoPlaceholderId(
  repoUrl: string,
  salt = ""
): number {
  const input = normalizeGitHubRepoSlug(repoUrl) + (salt ? `|${salt}` : "");

  // FNV-1a 32-bit hash — fast, deterministic, well-distributed
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul gives true 32-bit multiplication; >>> 0 keeps unsigned 32-bit
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  // Map [0, 2^32) → [1, 2_000_000_000] to stay safely inside INT4
  return (hash % 2_000_000_000) + 1;
}

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * Resolves the absolute path for a project's storage directory.
 * Throws if the slug is invalid or the resolved path escapes the root.
 */
export function resolveStoragePath(slug: string): string {
  // Slugs must be non-empty and contain only safe characters
  if (!slug || /[/\\<>:"|?*\0]/.test(slug)) {
    throw new Error("Invalid project slug.");
  }
  const target = path.resolve(STORAGE_PROJECTS_ROOT, slug);
  // Ensure the resolved path is still inside the root directory
  if (!target.startsWith(STORAGE_PROJECTS_ROOT + path.sep)) {
    throw new Error("Path traversal attempt detected.");
  }
  return target;
}

// ── Output sanitizer ──────────────────────────────────────────────────────────

/**
 * Strips known secret patterns from git command output before it is
 * stored in DB logs or returned to the client.
 */
export function sanitizeGitOutput(output: string): string {
  return output
    // GitHub personal access tokens
    .replace(/ghp_[A-Za-z0-9]{36,}/g, "[REDACTED_PAT]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_PAT]")
    // OAuth / Bearer tokens in Authorization header style
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    // Git HTTPS credential embed (x-access-token:<token>@github.com)
    .replace(/x-access-token:[^@\s]*/gi, "x-access-token:[REDACTED]")
    // Generic HTTPS URL with embedded credentials
    .replace(/https?:\/\/[^:@\s]+:[^@\s]+@/g, "https://[REDACTED]@")
    // Neon / Postgres connection strings
    .replace(/(?:postgresql|postgres):\/\/[^\s"']+/gi, "postgres://[REDACTED]");
}

// ── Internal git runner ───────────────────────────────────────────────────────

type GitResult = { ok: boolean; output: string; error: string };

/**
 * Runs a single git sub-command inside `cwd`.
 * Only sub-commands from an explicit allowlist are accepted.
 */
const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "init",
  "add",
  "commit",
  "remote",
  "rev-parse",
  "push",
  "status",
  "log",
]);

async function runGit(
  subcommand: string,
  args: string[],
  cwd: string
): Promise<GitResult> {
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    return { ok: false, output: "", error: `Git sub-command "${subcommand}" is not allowed.` };
  }

  const result = await runCommand("git", [subcommand, ...args], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: {
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      // Provide a minimal identity for `git commit` if none is configured globally
      GIT_AUTHOR_NAME: "Prisom Project Panel",
      GIT_AUTHOR_EMAIL: "panel@prisom.local",
      GIT_COMMITTER_NAME: "Prisom Project Panel",
      GIT_COMMITTER_EMAIL: "panel@prisom.local",
    },
  });

  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const sanitized = sanitizeGitOutput(combined);

  return {
    ok: result.exitCode === 0,
    output: sanitized,
    error: result.exitCode !== 0 ? sanitized : "",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LocalGitStatus {
  initialized: boolean;
  branch: string | null;
  commitSha: string | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  /** Upstream tracking ref, e.g. "origin/main" — set only after `git push -u`. */
  upstreamBranch: string | null;
}

/**
 * Returns the current git status of a project's storage directory.
 * Never throws — if the directory isn't a git repo, returns `{ initialized: false }`.
 */
const EMPTY_STATUS: LocalGitStatus = {
  initialized: false,
  branch: null,
  commitSha: null,
  hasRemote: false,
  remoteUrl: null,
  upstreamBranch: null,
};

export async function getLocalGitStatus(slug: string): Promise<LocalGitStatus> {
  let cwd: string;
  try {
    cwd = resolveStoragePath(slug);
  } catch {
    return { ...EMPTY_STATUS };
  }

  // Check if it's a git repo at all
  const revParse = await runGit("rev-parse", ["--git-dir"], cwd);
  if (!revParse.ok) {
    return { ...EMPTY_STATUS };
  }

  // Get current branch
  const branchResult = await runGit("rev-parse", ["--abbrev-ref", "HEAD"], cwd);
  const branch = branchResult.ok ? branchResult.output.trim() || null : null;

  // Get latest commit SHA
  const shaResult = await runGit("rev-parse", ["HEAD"], cwd);
  const commitSha =
    shaResult.ok && /^[0-9a-f]{40}$/i.test(shaResult.output.trim())
      ? shaResult.output.trim()
      : null;

  // Check for remote origin URL
  const remoteResult = await runGit("remote", ["get-url", "origin"], cwd);
  const hasRemote = remoteResult.ok;
  const remoteUrl = hasRemote
    ? sanitizeGitOutput(remoteResult.output.trim())
    : null;

  // Detect upstream tracking branch — set only after `git push -u origin <branch>`.
  // `@{u}` is the upstream shorthand; git errors if no upstream is configured.
  // This is the reliable way to detect that a push -u already happened, even if
  // it was done manually from the VPS rather than through the panel.
  const upstreamResult = await runGit("rev-parse", ["--abbrev-ref", "@{u}"], cwd);
  const upstreamBranch = upstreamResult.ok
    ? upstreamResult.output.trim() || null
    : null;

  return {
    initialized: true,
    branch,
    commitSha,
    hasRemote,
    remoteUrl,
    upstreamBranch,
  };
}

/**
 * Validates a GitHub remote URL (HTTPS or SSH).
 */
export function isValidGitHubUrl(url: string): boolean {
  const httpsPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
  const sshPattern = /^git@github\.com:[\w.-]+\/[\w.-]+(\.git)?$/;
  return httpsPattern.test(url) || sshPattern.test(url);
}

/**
 * Validates a git branch name (no shell metacharacters).
 */
export function isValidBranchName(branch: string): boolean {
  return /^[a-zA-Z0-9_\-.\/]+$/.test(branch) && branch.length <= 200;
}

// ── Step 1: Init ──────────────────────────────────────────────────────────────

export interface InitResult {
  ok: boolean;
  output: string;
  error: string;
}

/**
 * Initialises a git repository inside `storage/projects/<slug>/`.
 *
 * Steps:
 *   1. `git init`
 *   2. Write .gitignore (never overwrites existing one)
 *   3. `git add -A`
 *   4. `git commit -m "Initial import from Prisom Project Panel"`
 *
 * Returns a combined output log for display in the UI.
 */
export async function initLocalRepo(slug: string): Promise<InitResult> {
  let cwd: string;
  try {
    cwd = resolveStoragePath(slug);
  } catch (e) {
    return { ok: false, output: "", error: (e as Error).message };
  }

  // Verify directory exists
  try {
    await fs.access(cwd);
  } catch {
    return { ok: false, output: "", error: `Storage directory not found: storage/projects/${slug}/` };
  }

  const lines: string[] = [];

  // 1. git init
  const init = await runGit("init", [], cwd);
  lines.push("▶ git init");
  if (init.output) lines.push(init.output);
  if (!init.ok) {
    return { ok: false, output: lines.join("\n"), error: init.error };
  }
  lines.push("✓ done");

  // 2. Write .gitignore (only if it doesn't already exist or is empty)
  const gitignorePath = path.join(cwd, ".gitignore");
  try {
    const existing = await fs.readFile(gitignorePath, "utf8").catch(() => "");
    if (!existing.trim()) {
      await fs.writeFile(gitignorePath, GITIGNORE_CONTENT, "utf8");
      lines.push("▶ write .gitignore");
      lines.push("✓ done");
    } else {
      lines.push("▶ .gitignore already exists — skipped");
    }
  } catch (e) {
    lines.push(`⚠ Could not write .gitignore: ${(e as Error).message}`);
    // Non-fatal — continue
  }

  // 3. git add -A
  const add = await runGit("add", ["-A"], cwd);
  lines.push("▶ git add -A");
  if (add.output) lines.push(add.output);
  if (!add.ok) {
    return { ok: false, output: lines.join("\n"), error: add.error };
  }
  lines.push("✓ done");

  // 4. git commit
  const commit = await runGit(
    "commit",
    ["-m", "Initial import from Prisom Project Panel"],
    cwd
  );
  lines.push("▶ git commit");
  if (commit.output) lines.push(commit.output);
  if (!commit.ok) {
    // "nothing to commit" is not an error worth blocking on
    if (
      commit.output.toLowerCase().includes("nothing to commit") ||
      commit.output.toLowerCase().includes("nothing added to commit")
    ) {
      lines.push("(working tree is clean — no commit created)");
    } else {
      return { ok: false, output: lines.join("\n"), error: commit.error };
    }
  } else {
    lines.push("✓ done");
  }

  return { ok: true, output: lines.join("\n"), error: "" };
}

// ── Step 2: Add remote ────────────────────────────────────────────────────────

export interface AddRemoteResult {
  ok: boolean;
  output: string;
  error: string;
}

/**
 * Adds or updates the `origin` remote for the project's local git repo.
 *
 * If `origin` already exists, uses `remote set-url origin <url>`.
 * Otherwise uses `remote add origin <url>`.
 *
 * Does NOT push automatically.
 */
export async function addRemoteOrigin(
  slug: string,
  repoUrl: string,
  _branch: string // kept for future use / validation context
): Promise<AddRemoteResult> {
  if (!isValidGitHubUrl(repoUrl)) {
    return { ok: false, output: "", error: "Invalid GitHub repository URL." };
  }

  let cwd: string;
  try {
    cwd = resolveStoragePath(slug);
  } catch (e) {
    return { ok: false, output: "", error: (e as Error).message };
  }

  const lines: string[] = [];

  // Check if origin already exists
  const getUrl = await runGit("remote", ["get-url", "origin"], cwd);
  const originExists = getUrl.ok;

  if (originExists) {
    const setUrl = await runGit("remote", ["set-url", "origin", repoUrl], cwd);
    lines.push("▶ git remote set-url origin");
    if (setUrl.output) lines.push(setUrl.output);
    if (!setUrl.ok) {
      return { ok: false, output: lines.join("\n"), error: setUrl.error };
    }
    lines.push("✓ done");
  } else {
    const addRemote = await runGit("remote", ["add", "origin", repoUrl], cwd);
    lines.push("▶ git remote add origin");
    if (addRemote.output) lines.push(addRemote.output);
    if (!addRemote.ok) {
      return { ok: false, output: lines.join("\n"), error: addRemote.error };
    }
    lines.push("✓ done");
  }

  return { ok: true, output: lines.join("\n"), error: "" };
}

// ── Step 3: Push ──────────────────────────────────────────────────────────────

export interface PushResult {
  ok: boolean;
  output: string;
  error: string;
  isAuthError: boolean;
}

/**
 * Runs `git push -u origin <branch>` inside the project's storage directory.
 *
 * Returns `isAuthError: true` when the failure looks like a credential/SSH error
 * so the caller can show a targeted message in the UI.
 */
export async function pushToRemote(slug: string, branch: string): Promise<PushResult> {
  if (!isValidBranchName(branch)) {
    return { ok: false, output: "", error: "Invalid branch name.", isAuthError: false };
  }

  let cwd: string;
  try {
    cwd = resolveStoragePath(slug);
  } catch (e) {
    return { ok: false, output: "", error: (e as Error).message, isAuthError: false };
  }

  const lines: string[] = [`▶ git push -u origin ${branch}`];

  const push = await runGit("push", ["-u", "origin", branch], cwd);
  if (push.output) lines.push(push.output);
  if (push.error) lines.push(push.error);

  if (!push.ok) {
    const combinedLower = (push.output + push.error).toLowerCase();
    const isAuthError =
      combinedLower.includes("authentication failed") ||
      combinedLower.includes("permission denied") ||
      combinedLower.includes("could not read username") ||
      combinedLower.includes("repository not found") ||
      combinedLower.includes("403") ||
      combinedLower.includes("401") ||
      combinedLower.includes("fatal: could not resolve host") ||
      combinedLower.includes("ssh: connect to host");

    return {
      ok: false,
      output: lines.join("\n"),
      error: push.error || push.output,
      isAuthError,
    };
  }

  lines.push("✓ push complete");
  return { ok: true, output: lines.join("\n"), error: "", isAuthError: false };
}

// ── Remove remote ─────────────────────────────────────────────────────────────

export interface RemoveRemoteResult {
  ok: boolean;
  output: string;
  error: string;
}

/**
 * Removes the `origin` remote from the project's local git repository.
 * Idempotent — succeeds silently if no origin is configured.
 */
export async function removeRemoteOrigin(slug: string): Promise<RemoveRemoteResult> {
  let cwd: string;
  try {
    cwd = resolveStoragePath(slug);
  } catch (e) {
    return { ok: false, output: "", error: (e as Error).message };
  }

  // If no remote exists there is nothing to do — treat as success
  const getUrl = await runGit("remote", ["get-url", "origin"], cwd);
  if (!getUrl.ok) {
    return { ok: true, output: "No remote origin configured — nothing to remove.", error: "" };
  }

  const lines: string[] = ["▶ git remote remove origin"];
  const remove = await runGit("remote", ["remove", "origin"], cwd);
  if (remove.output) lines.push(remove.output);
  if (!remove.ok) {
    return { ok: false, output: lines.join("\n"), error: remove.error };
  }
  lines.push("✓ done");
  return { ok: true, output: lines.join("\n"), error: "" };
}
