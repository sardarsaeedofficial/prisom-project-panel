/**
 * lib/ai-import-agent/agent-output-inspector.ts
 *
 * Sprint 90 hotfix: filesystem inspection helpers for diagnosing
 * frontend_build_output_missing errors. Finds where the built frontend
 * index.html actually lives inside a release snapshot, optionally re-runs
 * the build command when no output is found, and returns the relative dir
 * so the caller can update staticOutputDir in the DB before redeploying.
 *
 * All paths are derived from the release directory — never the source dir —
 * so no secret files (.env) are touched.
 */

import path          from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { runCommand, sanitizeOutput }        from "@/lib/server/command-runner";
import { validateAndParseCommand }           from "@/lib/projects/project-deploy-runner";

const RELEASE_STORAGE = path.resolve(process.cwd(), "storage", "releases");

/**
 * Candidate dirs (relative to release root) where the built index.html
 * might live. Checked in order — first match wins.
 */
export const FRONTEND_INDEX_HTML_CANDIDATE_DIRS = [
  "artifacts/sardar-security/dist/public",
  "artifacts/sardar-security/dist",
  "artifacts/sardar-security/build",
  "artifacts/sardar-security/public",
  "dist/public",
  "dist",
  "build",
  "public",
];

export type IndexHtmlLocation = {
  /** Absolute path to the directory that contains index.html. */
  absolutePath: string;
  /** Path relative to the release root — the value to write to staticOutputDir. */
  relativeDir: string;
};

export type BuildOnlyResult = {
  ok: boolean;
  output: string;
};

/** Returns the most-recently-modified release directory for the given slug, or null. */
export function findLatestReleasePath(slug: string): string | null {
  const slugDir = path.join(RELEASE_STORAGE, slug);
  if (!existsSync(slugDir)) return null;

  try {
    const entries = readdirSync(slugDir)
      .map((name) => {
        const full = path.join(slugDir, name);
        try {
          const s = statSync(full);
          return s.isDirectory() ? { full, mtime: s.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((e): e is { full: string; mtime: number } => e !== null)
      .sort((a, b) => b.mtime - a.mtime);

    return entries[0]?.full ?? null;
  } catch {
    return null;
  }
}

/** Returns true if index.html exists at `relativeDir` inside `rootDir`. */
export function checkIndexHtmlAt(rootDir: string, relativeDir: string): boolean {
  return existsSync(path.join(rootDir, relativeDir, "index.html"));
}

/**
 * Searches FRONTEND_INDEX_HTML_CANDIDATE_DIRS inside `rootDir` for an index.html.
 * Returns the first match, or null if none found.
 */
export function findIndexHtml(rootDir: string): IndexHtmlLocation | null {
  for (const relativeDir of FRONTEND_INDEX_HTML_CANDIDATE_DIRS) {
    const absoluteDir = path.join(rootDir, relativeDir);
    if (existsSync(path.join(absoluteDir, "index.html"))) {
      return { absolutePath: absoluteDir, relativeDir };
    }
  }
  return null;
}

/**
 * Runs `buildCommand` inside `releasePath` (max 8 minutes).
 * The release is expected to already have node_modules from the previous
 * install step — this only re-runs the build phase.
 * Returns sanitized combined stdout+stderr.
 */
export async function runBuildInRelease(
  releasePath: string,
  buildCommand: string,
): Promise<BuildOnlyResult> {
  const parsed = validateAndParseCommand(buildCommand);
  if (!parsed.ok) {
    return { ok: false, output: `Invalid build command: ${parsed.error}` };
  }

  const result = await runCommand(parsed.cmd.binary, parsed.cmd.args, {
    cwd: releasePath,
    timeoutMs: 480_000,
    env: { NODE_ENV: "production" },
  });

  const output = sanitizeOutput(
    [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  );
  return { ok: result.exitCode === 0, output };
}
