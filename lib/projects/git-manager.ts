/**
 * lib/projects/git-manager.ts
 *
 * Sprint 8 — Safe git operations for the project Git panel.
 *
 * Safety rules enforced here:
 *  - Only an explicit allowlist of git sub-commands
 *  - Path traversal / absolute-path validation on every file arg
 *  - Secret files (*.pem, .env, *.key, …) blocked from staging
 *  - No destructive operations (no reset --hard, no clean, no force-push, no rebase)
 *  - Remote URLs are redacted before being returned to the client
 *  - execFile only (never shell: true) via the shared runCommand helper
 *  - GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS=echo prevent interactive credential prompts
 *  - git pull only allowed on a clean working tree
 *  - git push requires confirmed:true (UI confirmation gate)
 */

import path from "path";
import { runCommand, sanitizeOutput } from "@/lib/server/command-runner";

// ── Constants ─────────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 60_000;
const DIFF_MAX_BYTES = 100 * 1024; // 100 KB

// ── Types ─────────────────────────────────────────────────────────────────────

export type GitActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface GitRepoStatus {
  isRepo: boolean;
  root: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  changedFiles: GitChangedFile[];
  remotes: GitRemote[];
  recentCommits: GitCommitSummary[];
}

export interface GitChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "unknown";
  staged: boolean;
  unstaged: boolean;
  safeToStage: boolean;
  stageBlockReason?: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

// ── Allowed git subcommands (exhaustive allowlist) ────────────────────────────

const ALLOWED_SUBCOMMANDS = new Set([
  "add",      // staging
  "commit",   // committing staged changes
  "diff",     // viewing diffs (no --output= allowed)
  "fetch",    // fetch (read-only network)
  "log",      // recent commits
  "pull",     // pull --ff-only only
  "push",     // push origin <branch> — no --force
  "remote",   // remote -v (read-only)
  "restore",  // restore --staged (unstage only)
  "rev-parse",// repo detection, branch name
  "status",   // porcelain status
]);

// ── Git env — suppress all interactive prompts ────────────────────────────────

const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS:         "echo",
  GIT_AUTHOR_NAME:     "Prisom Project Panel",
  GIT_AUTHOR_EMAIL:    "panel@prisom.local",
  GIT_COMMITTER_NAME:  "Prisom Project Panel",
  GIT_COMMITTER_EMAIL: "panel@prisom.local",
};

// ── Internal git runner ───────────────────────────────────────────────────────

interface GitRun {
  ok:     boolean;
  stdout: string;
  stderr: string;
  output: string; // combined stdout + stderr (trimmed)
}

async function runGit(subcommand: string, args: string[], root: string): Promise<GitRun> {
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    const err = `Git sub-command "${subcommand}" is not allowed.`;
    return { ok: false, stdout: "", stderr: err, output: err };
  }

  const result = await runCommand("git", [subcommand, ...args], {
    cwd: root,
    timeoutMs: GIT_TIMEOUT_MS,
    env: GIT_ENV,
  });

  const stdout = sanitizeOutput(result.stdout).trim();
  const stderr = sanitizeOutput(result.stderr).trim();
  const output = [stdout, stderr].filter(Boolean).join("\n");

  return { ok: result.exitCode === 0, stdout, stderr, output };
}

// ── Remote URL redaction ──────────────────────────────────────────────────────

function redactRemoteUrl(url: string): string {
  return url
    // https://ghp_xxx@github.com/...  or  https://user:token@github.com/...
    .replace(/https?:\/\/[^@\s]+@/, "https://[REDACTED]@")
    .trim();
}

// ── File staging safety ───────────────────────────────────────────────────────

interface StageCheck { safe: boolean; reason?: string; }

/** Files that must never be staged regardless of user intent. */
const BLOCKED_STAGE_EXTENSIONS = [
  ".pem", ".key", ".crt", ".p12", ".pfx", ".p8",
  ".sqlite", ".sqlite3", ".db",
];

const BLOCKED_STAGE_DIR_PREFIXES = [
  "node_modules/", ".git/", ".next/", "dist/", "build/",
  "coverage/", "storage/", "logs/", ".nuxt/", ".output/",
  ".vercel/", "__pycache__/", ".turbo/", ".cache/", ".nyc_output/",
];

export function isSafeToStage(relativePath: string): StageCheck {
  if (!relativePath || typeof relativePath !== "string") {
    return { safe: false, reason: "Invalid path" };
  }

  // No absolute paths
  if (path.isAbsolute(relativePath)) {
    return { safe: false, reason: "Absolute paths not allowed" };
  }

  // No null bytes or shell metacharacters
  if (/[\0|;&`$<>!]/.test(relativePath)) {
    return { safe: false, reason: "Invalid characters in path" };
  }

  // No path traversal
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized.startsWith("..")) {
    return { safe: false, reason: "Path traversal not allowed" };
  }

  const lower = relativePath.toLowerCase().replace(/\\/g, "/");
  const basename = lower.split("/").pop() ?? lower;

  // Block .env files
  if (basename === ".env" || basename.startsWith(".env.") || basename === ".envrc") {
    return { safe: false, reason: "Environment files cannot be staged" };
  }

  // Block by extension
  for (const ext of BLOCKED_STAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return { safe: false, reason: `${ext} files cannot be staged` };
    }
  }

  // Block blocked directory prefixes
  for (const dir of BLOCKED_STAGE_DIR_PREFIXES) {
    if (lower === dir.slice(0, -1) || lower.startsWith(dir)) {
      return { safe: false, reason: `${dir.slice(0, -1)} directory cannot be staged` };
    }
  }

  return { safe: true };
}

// ── Path validation for git file args ────────────────────────────────────────

function isValidRelativePath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  if (path.isAbsolute(p)) return false;
  if (/[\0]/.test(p)) return false;
  const normalized = path.posix.normalize(p.replace(/\\/g, "/"));
  if (normalized.startsWith("..")) return false;
  return true;
}

// ── Porcelain=v1 branch-line parser ──────────────────────────────────────────

interface BranchInfo {
  branch:   string | null;
  upstream: string | null;
  ahead:    number;
  behind:   number;
}

function parseBranchLine(line: string): BranchInfo {
  const empty: BranchInfo = { branch: null, upstream: null, ahead: 0, behind: 0 };
  if (!line.startsWith("## ")) return empty;

  const rest = line.slice(3);

  // Detached HEAD
  if (rest.startsWith("HEAD (no branch)")) {
    return { branch: "HEAD", upstream: null, ahead: 0, behind: 0 };
  }

  // No commits yet
  const noCommitsMatch = rest.match(/^No commits yet on (\S+)/);
  if (noCommitsMatch) {
    return { branch: noCommitsMatch[1], upstream: null, ahead: 0, behind: 0 };
  }

  // "branch...upstream [ahead N, behind M]" or plain "branch"
  const ellipsisIdx = rest.indexOf("...");
  const branchPart  = ellipsisIdx >= 0 ? rest.slice(0, ellipsisIdx) : rest.split(" ")[0];
  const branch      = branchPart.trim() || null;

  let upstream: string | null = null;
  let ahead  = 0;
  let behind = 0;

  if (ellipsisIdx >= 0) {
    const afterEllipsis = rest.slice(ellipsisIdx + 3);
    const spaceIdx = afterEllipsis.indexOf(" ");
    upstream = (spaceIdx >= 0 ? afterEllipsis.slice(0, spaceIdx) : afterEllipsis).trim() || null;

    const aheadMatch  = afterEllipsis.match(/ahead (\d+)/);
    const behindMatch = afterEllipsis.match(/behind (\d+)/);
    if (aheadMatch)  ahead  = parseInt(aheadMatch[1],  10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);
  }

  return { branch, upstream, ahead, behind };
}

// ── Porcelain=v1 file-line parser ─────────────────────────────────────────────

function parseStatusLine(line: string): GitChangedFile | null {
  if (line.length < 4) return null;

  const X        = line[0]; // index / staged status
  const Y        = line[1]; // worktree / unstaged status
  // line[2] is always a space in porcelain=v1
  const filePath = line.slice(3).trim();

  if (!filePath) return null;

  // Ignored files — skip entirely
  if (X === "!" && Y === "!") return null;

  // Untracked
  if (X === "?" && Y === "?") {
    const check = isSafeToStage(filePath);
    return {
      path: filePath,
      status: "untracked",
      staged: false,
      unstaged: true,
      safeToStage: check.safe,
      stageBlockReason: check.reason,
    };
  }

  const staged   = X !== " ";
  const unstaged = Y !== " " && Y !== "?";

  // Determine display status from the more significant of X or Y
  const dominant = X !== " " ? X : Y;
  let status: GitChangedFile["status"] = "unknown";
  switch (dominant) {
    case "M": status = "modified"; break;
    case "A": status = "added";    break;
    case "D": status = "deleted";  break;
    case "R": status = "renamed";  break;
    case "C": status = "added";    break;
    default:  status = "modified"; break;
  }

  const check = isSafeToStage(filePath);

  return {
    path: filePath,
    status,
    staged,
    unstaged,
    safeToStage: check.safe,
    stageBlockReason: check.reason,
  };
}

// ── Remote -v output parser ───────────────────────────────────────────────────

function parseRemotes(output: string): GitRemote[] {
  const map = new Map<string, GitRemote>();

  for (const line of output.split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const [, name, rawUrl, type] = m;
    const url = redactRemoteUrl(rawUrl);

    if (!map.has(name)) {
      map.set(name, { name, fetchUrl: url, pushUrl: url });
    }
    const remote = map.get(name)!;
    if (type === "fetch") remote.fetchUrl = url;
    if (type === "push")  remote.pushUrl  = url;
  }

  return Array.from(map.values());
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns full git status for the project root.
 * Never throws — returns { isRepo: false } if directory is not a git repo.
 */
export async function getProjectGitStatus(
  root: string,
): Promise<GitActionResult<GitRepoStatus>> {
  // Is it a git repo at all?
  const revParse = await runGit("rev-parse", ["--git-dir"], root);
  if (!revParse.ok) {
    return {
      ok: true,
      data: {
        isRepo: false, root,
        branch: null, upstream: null,
        ahead: 0, behind: 0,
        clean: true,
        changedFiles: [], remotes: [], recentCommits: [],
      },
    };
  }

  // Status (porcelain=v1 with branch info)
  const statusResult = await runGit("status", ["--porcelain=v1", "-b"], root);
  const lines = statusResult.stdout.split("\n").filter(Boolean);

  const branchLine = lines.find((l) => l.startsWith("## ")) ?? "";
  const { branch, upstream, ahead, behind } = parseBranchLine(branchLine);

  const changedFiles = lines
    .filter((l) => !l.startsWith("## "))
    .map(parseStatusLine)
    .filter((f): f is GitChangedFile => f !== null);

  // Remotes (read-only, redacted)
  const remotesResult = await runGit("remote", ["-v"], root);
  const remotes = remotesResult.ok ? parseRemotes(remotesResult.stdout) : [];

  // Recent commits
  const logResult = await runGit(
    "log",
    ["--pretty=format:%H|%s|%an|%ai", "-15"],
    root,
  );

  const recentCommits: GitCommitSummary[] = [];
  if (logResult.ok && logResult.stdout) {
    for (const logLine of logResult.stdout.split("\n").filter(Boolean)) {
      const pipeIdx = logLine.indexOf("|");
      if (pipeIdx < 7) continue;
      const hash = logLine.slice(0, pipeIdx);
      const rest = logLine.slice(pipeIdx + 1);
      // Remaining format: message|author|date (date is last)
      const lastPipe  = rest.lastIndexOf("|");
      if (lastPipe < 0) continue;
      const date      = rest.slice(lastPipe + 1).split(" ").slice(0, 2).join(" ");
      const rest2     = rest.slice(0, lastPipe);
      const penult    = rest2.lastIndexOf("|");
      const author    = penult >= 0 ? rest2.slice(penult + 1) : rest2;
      const message   = penult >= 0 ? rest2.slice(0, penult) : "";
      recentCommits.push({
        hash,
        shortHash: hash.slice(0, 7),
        message:   message.slice(0, 200),
        author,
        date,
      });
    }
  }

  return {
    ok: true,
    data: {
      isRepo: true,
      root,
      branch,
      upstream,
      ahead,
      behind,
      clean: changedFiles.length === 0,
      changedFiles,
      remotes,
      recentCommits,
    },
  };
}

/**
 * Returns the diff for a single file (or the entire working tree if path is null).
 * Truncated at 100 KB.
 */
export async function getProjectGitDiff(
  root:         string,
  relativePath: string | null,
  staged:       boolean,
): Promise<GitActionResult<{ diff: string; truncated: boolean }>> {
  const args: string[] = [];
  if (staged) args.push("--cached");
  args.push("--no-color");

  if (relativePath !== null) {
    if (!isValidRelativePath(relativePath)) {
      return { ok: false, error: "Invalid file path." };
    }
    args.push("--", relativePath);
  }

  const result = await runGit("diff", args, root);
  // git diff exits 0 even when there is no diff — that's fine
  const raw       = result.stdout;
  const truncated = raw.length > DIFF_MAX_BYTES;
  const diff      = truncated
    ? raw.slice(0, DIFF_MAX_BYTES) + "\n\n[... diff truncated at 100 KB ...]"
    : raw;

  return { ok: true, data: { diff: diff || "(no differences)", truncated } };
}

/**
 * Stages the given relative paths via `git add -- <paths>`.
 * Silently skips paths that fail the safety check; errors only if ALL are blocked.
 */
export async function stageProjectFiles(
  root:  string,
  paths: string[],
): Promise<GitActionResult<{ staged: number; blocked: string[] }>> {
  if (!paths.length) return { ok: false, error: "No files specified." };

  const safe: string[]    = [];
  const blocked: string[] = [];

  for (const p of paths) {
    if (!isValidRelativePath(p)) {
      blocked.push(`${p}: invalid path`);
      continue;
    }
    const check = isSafeToStage(p);
    if (!check.safe) {
      blocked.push(`${p}: ${check.reason}`);
      continue;
    }
    safe.push(p);
  }

  if (safe.length === 0) {
    return { ok: false, error: `No safe files to stage. Blocked: ${blocked.join("; ")}` };
  }

  const result = await runGit("add", ["--", ...safe], root);
  if (!result.ok) {
    return { ok: false, error: result.output || "git add failed." };
  }

  return { ok: true, data: { staged: safe.length, blocked } };
}

/**
 * Unstages the given relative paths via `git restore --staged -- <paths>`.
 */
export async function unstageProjectFiles(
  root:  string,
  paths: string[],
): Promise<GitActionResult<{ unstaged: number }>> {
  if (!paths.length) return { ok: false, error: "No files specified." };

  const valid = paths.filter(isValidRelativePath);
  if (valid.length === 0) {
    return { ok: false, error: "No valid file paths provided." };
  }

  const result = await runGit("restore", ["--staged", "--", ...valid], root);
  if (!result.ok) {
    return { ok: false, error: result.output || "git restore --staged failed." };
  }

  return { ok: true, data: { unstaged: valid.length } };
}

/**
 * Commits currently staged changes with the given message.
 */
export async function commitProjectChanges(
  root:    string,
  message: string,
): Promise<GitActionResult<{ hash: string; output: string }>> {
  const trimmed = message.trim();
  if (!trimmed)           return { ok: false, error: "Commit message cannot be empty." };
  if (trimmed.length > 5_000) return { ok: false, error: "Commit message too long (max 5 000 chars)." };
  if (/\0/.test(trimmed)) return { ok: false, error: "Commit message contains invalid characters." };

  const result = await runGit("commit", ["-m", trimmed], root);

  if (!result.ok) {
    const lower = result.output.toLowerCase();
    if (lower.includes("nothing to commit") || lower.includes("nothing added to commit")) {
      return { ok: false, error: "Nothing staged to commit." };
    }
    return { ok: false, error: result.output || "git commit failed." };
  }

  // "[main abc1234] message" — extract short hash
  const hashMatch = result.output.match(/\[[\w/\-.]+\s+([a-f0-9]{5,})\]/);
  const hash      = hashMatch ? hashMatch[1] : "unknown";

  return { ok: true, data: { hash, output: result.output } };
}

/**
 * Fetches from origin (read-only network call, no changes to working tree).
 */
export async function fetchProjectRepo(
  root: string,
): Promise<GitActionResult<{ output: string }>> {
  const result = await runGit("fetch", ["origin"], root);
  if (!result.ok) {
    return { ok: false, error: result.output || "git fetch failed." };
  }
  return { ok: true, data: { output: result.output || "Fetch complete." } };
}

/**
 * Pulls with --ff-only.
 *
 * Sprint 8 rule: "Do not auto-pull if working tree has uncommitted changes."
 * The caller (server action) must verify the tree is clean first and pass
 * clean:true. This function refuses to pull on a dirty tree.
 */
export async function pullProjectRepo(
  root:  string,
  clean: boolean,
): Promise<GitActionResult<{ output: string }>> {
  if (!clean) {
    return {
      ok: false,
      error:
        "You have uncommitted changes. Please commit or stash them before pulling.",
    };
  }

  const result = await runGit("pull", ["--ff-only"], root);
  if (!result.ok) {
    return { ok: false, error: result.output || "git pull --ff-only failed." };
  }
  return { ok: true, data: { output: result.output || "Pull complete (fast-forward)." } };
}

/**
 * Pushes the current branch to origin.
 *
 * Sprint 8 rules:
 *  - No --force or --force-with-lease
 *  - confirmed must be true (UI gate)
 */
export async function pushProjectRepo(
  root:      string,
  branch:    string,
  confirmed: boolean,
): Promise<GitActionResult<{ output: string; isAuthError: boolean }>> {
  if (!confirmed) {
    return { ok: false, error: "Push requires explicit confirmation." };
  }

  // Branch name validation
  if (!branch || !/^[a-zA-Z0-9_\-.\/]+$/.test(branch) || branch.length > 200) {
    return { ok: false, error: "Invalid branch name." };
  }

  const result = await runGit("push", ["origin", branch], root);

  if (!result.ok) {
    const lower       = result.output.toLowerCase();
    const isAuthError =
      lower.includes("authentication failed") ||
      lower.includes("permission denied") ||
      lower.includes("could not read username") ||
      lower.includes("repository not found") ||
      lower.includes("403") ||
      lower.includes("401") ||
      lower.includes("could not resolve host") ||
      lower.includes("ssh: connect to host");
    return { ok: false, error: result.output || "git push failed." };
  }

  return { ok: true, data: { output: result.output || "Push complete.", isAuthError: false } };
}
