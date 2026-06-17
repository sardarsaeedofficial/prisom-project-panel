/**
 * lib/projects/file-manager.ts
 *
 * Sprint 6: safe project file browser / editor helpers.
 *
 * Safety rules enforced:
 *  - Files are always resolved relative to the project's storage root.
 *  - Path traversal (..) is rejected.
 *  - Symlink escapes are rejected (realpath must stay inside root).
 *  - Absolute paths from callers are rejected.
 *  - .env and secret files are blocked.
 *  - Binary / non-text file types are blocked.
 *  - Build output dirs (node_modules, .next, dist, build, …) are hidden.
 *  - Max read/write size is enforced.
 *  - Ownership is verified by the caller (server actions do this).
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";

// ── File-size limits ──────────────────────────────────────────────────────────

export const MAX_FILE_READ_BYTES  = 300 * 1024;  // 300 KB
export const MAX_FILE_WRITE_BYTES = 300 * 1024;
export const MAX_FILE_AI_BYTES    =  80 * 1024;  // 80 KB — fed into AI context

// ── Block-lists ───────────────────────────────────────────────────────────────

/** .env variants that must never be opened or edited. */
const BLOCKED_ENV_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.prod",
  ".env.development",
  ".env.dev",
  ".env.staging",
  ".env.test",
  ".env.ci",
]);

/** Directories that are never walked or exposed. */
const BLOCKED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  "logs",
  "storage",
  ".nuxt",
  ".output",
  ".vercel",
  ".netlify",
  "__pycache__",
  ".turbo",
  ".cache",
  ".parcel-cache",
]);

/** File extensions that are never readable/editable. */
const BLOCKED_EXTENSIONS = new Set([
  ".pem", ".key", ".crt", ".csr", ".cer", ".der", ".p12", ".pfx",
  ".sqlite", ".db", ".sqlite3",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".webm",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".pyc",
]);

/** Extensions (and special basenames) that ARE editable. */
const EDITABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx",
  ".css", ".scss", ".sass", ".less",
  ".html", ".htm",
  ".yml", ".yaml",
  ".prisma", ".sql",
  ".txt",
  ".sh",
  ".toml", ".ini", ".cfg",
]);

const EDITABLE_BASENAMES = new Set([
  "Dockerfile",
  "Procfile",
  "Makefile",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".env.example",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  "LICENSE",
  "README",
]);

/**
 * System roots that must never become the project file root.
 * We block exact matches — subdirectories inside prisom-project-panel are OK.
 */
const BLOCKED_EXACT_ROOTS = new Set([
  "/",
  "/etc",
  "/var",
  "/home",
  "/home/prisom",
  "/home/prisom/prisom-panel",
  "/home/prisom/prisom-project-panel",
  "/root",
]);

// ── ActionResult type (same shape as other modules) ───────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── File tree types ───────────────────────────────────────────────────────────

export interface ProjectFileEntry {
  path:  string;  // relative to project root
  name:  string;
  isDir: boolean;
  size:  number;
  depth: number;
}

export type ProjectFileTree = {
  root:  string;   // absolute root (server-only)
  label: string;   // human label for the root
  files: ProjectFileEntry[];
};

// ── Root resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the safe editable file root for a project.
 *
 * Returns the absolute path to `storage/projects/<slug>/` if it exists
 * and is safe.  Ownership is NOT verified here — callers must do that.
 */
export async function getProjectFileRoot(projectId: string): Promise<
  | { ok: true;  root: string; label: string }
  | { ok: false; error: string }
> {
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true, name: true },
  });
  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  // The editable source lives in storage/projects/<slug>/
  const root = path.resolve(process.cwd(), "storage", "projects", project.slug);

  // Safety: must not be a blocked system root
  if (BLOCKED_EXACT_ROOTS.has(root)) {
    return { ok: false, error: "Computed root is a blocked system path." };
  }

  // Must exist and be a directory
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Project source path is not a directory." };
    }
  } catch {
    return {
      ok:    false,
      error: "No editable source found for this project. Upload a zip or link a GitHub repo first.",
    };
  }

  return { ok: true, root, label: `storage/projects/${project.slug}` };
}

// ── Path normalisation ────────────────────────────────────────────────────────

/**
 * Strip leading slashes and collapse double-slashes.
 * Reject obviously unsafe patterns.
 */
export function normalizeProjectRelativePath(input: string): string {
  // Remove leading slashes
  let p = input.replace(/^[/\\]+/, "");
  // Collapse internal double-slashes
  p = p.replace(/[/\\]+/g, "/");
  // Remove trailing slash
  p = p.replace(/\/$/, "");
  return p;
}

// ── Path safety guard ─────────────────────────────────────────────────────────

/**
 * Validate a relative path against the project root.
 *
 * Checks:
 *  - No .. components.
 *  - No absolute paths.
 *  - No null bytes.
 *  - Resolved absolute path stays inside root (symlink-aware via realpath).
 *  - Basename is not a blocked .env file.
 *  - Extension is not in BLOCKED_EXTENSIONS.
 */
export async function assertSafeProjectPath(
  root:         string,
  relativePath: string,
): Promise<
  | { ok: true;  absolutePath: string }
  | { ok: false; error: string }
> {
  if (!relativePath || relativePath.trim() === "") {
    return { ok: false, error: "Path cannot be empty." };
  }
  if (relativePath.includes("\0")) {
    return { ok: false, error: "Path contains null bytes." };
  }
  if (path.isAbsolute(relativePath)) {
    return { ok: false, error: "Absolute paths are not allowed." };
  }

  const normalized = normalizeProjectRelativePath(relativePath);

  // Reject .. at any depth
  const parts = normalized.split("/");
  if (parts.some((p) => p === ".." || p === ".")) {
    return { ok: false, error: "Path traversal (..) is not allowed." };
  }

  // Reject leading dot-env patterns in any path segment
  const basename = parts[parts.length - 1] ?? "";
  if (BLOCKED_ENV_BASENAMES.has(basename.toLowerCase())) {
    return { ok: false, error: `Access to ${basename} is blocked.` };
  }

  // Reject blocked extensions
  const ext = getExtension(basename).toLowerCase();
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `File type ${ext} is not supported.` };
  }

  // Compute absolute path
  const abs = path.resolve(root, normalized);

  // Must stay inside root
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    return { ok: false, error: "Path is outside the project root." };
  }

  // Symlink check: resolve real path and verify it's still inside root
  try {
    const real = await fs.realpath(abs).catch(() => abs);
    if (real !== root && !real.startsWith(rootWithSep)) {
      return { ok: false, error: "Path resolves outside the project root (symlink escape blocked)." };
    }
  } catch {
    // File doesn't exist yet (for new file creation) — that's fine
  }

  return { ok: true, absolutePath: abs };
}

// ── Is editable text file? ────────────────────────────────────────────────────

export function isEditableTextFile(relativePath: string): boolean {
  const normalized = normalizeProjectRelativePath(relativePath);
  const basename   = path.basename(normalized);
  const lower      = basename.toLowerCase();

  // Block .env variants
  if (BLOCKED_ENV_BASENAMES.has(lower)) return false;

  // Check special basenames
  if (EDITABLE_BASENAMES.has(basename) || EDITABLE_BASENAMES.has(lower)) return true;

  // Check extension
  const ext = getExtension(basename).toLowerCase();
  if (!ext) return false;

  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  if (EDITABLE_EXTENSIONS.has(ext)) return true;

  return false;
}

// ── Language detection (for display) ─────────────────────────────────────────

export function detectLanguage(relativePath: string): string {
  const ext = getExtension(path.basename(relativePath)).toLowerCase();
  const map: Record<string, string> = {
    ".ts":      "typescript",
    ".tsx":     "typescriptreact",
    ".js":      "javascript",
    ".jsx":     "javascriptreact",
    ".mjs":     "javascript",
    ".cjs":     "javascript",
    ".json":    "json",
    ".md":      "markdown",
    ".mdx":     "mdx",
    ".css":     "css",
    ".scss":    "scss",
    ".sass":    "sass",
    ".less":    "less",
    ".html":    "html",
    ".htm":     "html",
    ".yml":     "yaml",
    ".yaml":    "yaml",
    ".prisma":  "prisma",
    ".sql":     "sql",
    ".sh":      "shell",
    ".txt":     "text",
    ".toml":    "toml",
    ".ini":     "ini",
    ".cfg":     "ini",
  };
  const base = path.basename(relativePath);
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return "dockerfile";
  if (base === "Makefile") return "makefile";
  return map[ext] ?? "text";
}

// ── List project files ────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_FILES = 800;

export async function listProjectFiles(
  projectId: string,
  options?: { maxDepth?: number; maxFiles?: number },
): Promise<ActionResult<ProjectFileTree>> {
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) {
    return { ok: false, error: rootResult.error };
  }
  const { root, label } = rootResult;

  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const files:    ProjectFileEntry[] = [];

  async function walk(dir: string, relPrefix: string, depth: number) {
    if (depth > maxDepth || files.length >= maxFiles) return;

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: dirs first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const lower = entry.name.toLowerCase();

      // Skip blocked env files
      if (BLOCKED_ENV_BASENAMES.has(lower)) continue;
      // Skip hidden files that look like secrets (but allow .gitignore, .prettierrc etc.)
      if (lower.startsWith(".env")) continue;

      if (entry.isDirectory()) {
        if (BLOCKED_DIRS.has(lower)) continue;

        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        files.push({ path: rel, name: entry.name, isDir: true, size: 0, depth });
        await walk(path.join(dir, entry.name), rel, depth + 1);
      } else {
        // Check extension is readable (not blocked binary)
        const ext = getExtension(entry.name).toLowerCase();
        if (ext && BLOCKED_EXTENSIONS.has(ext)) continue;

        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        let size = 0;
        try {
          const stat = await fs.lstat(path.join(dir, entry.name));
          // Skip symlinks for safety
          if (stat.isSymbolicLink()) continue;
          size = stat.size;
        } catch {
          continue;
        }

        files.push({ path: rel, name: entry.name, isDir: false, size, depth });
      }
    }
  }

  await walk(root, "", 0);

  return { ok: true, data: { root, label, files } };
}

// ── Read a text file ──────────────────────────────────────────────────────────

export async function readProjectTextFile(
  projectId: string,
  relativePath: string,
): Promise<ActionResult<{
  path:       string;
  content:    string;
  size:       number;
  modifiedAt: string;
  language:   string;
}>> {
  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };

  const { root } = rootResult;
  const pathResult = await assertSafeProjectPath(root, relativePath);
  if (!pathResult.ok) return { ok: false, error: pathResult.error };

  const { absolutePath } = pathResult;

  // Verify editable
  if (!isEditableTextFile(relativePath)) {
    return { ok: false, error: "This file type cannot be viewed or edited." };
  }

  let stat: import("fs").Stats;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return { ok: false, error: "File not found." };
  }

  // Reject symlinks
  if (stat.isSymbolicLink()) {
    return { ok: false, error: "Symlinks are not supported." };
  }
  if (stat.isDirectory()) {
    return { ok: false, error: "Path is a directory, not a file." };
  }
  if (stat.size > MAX_FILE_READ_BYTES) {
    return {
      ok:    false,
      error: `File is too large to view (${Math.round(stat.size / 1024)} KB, max ${MAX_FILE_READ_BYTES / 1024} KB).`,
    };
  }

  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    return { ok: false, error: "Failed to read file." };
  }

  return {
    ok: true,
    data: {
      path:       normalizeProjectRelativePath(relativePath),
      content,
      size:       stat.size,
      modifiedAt: stat.mtime.toISOString(),
      language:   detectLanguage(relativePath),
    },
  };
}

// ── Write a text file ─────────────────────────────────────────────────────────

export async function writeProjectTextFile(
  projectId: string,
  relativePath: string,
  content: string,
): Promise<ActionResult<{
  path:       string;
  size:       number;
  modifiedAt: string;
}>> {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_WRITE_BYTES) {
    return {
      ok:    false,
      error: `Content too large (max ${MAX_FILE_WRITE_BYTES / 1024} KB).`,
    };
  }

  const rootResult = await getProjectFileRoot(projectId);
  if (!rootResult.ok) return { ok: false, error: rootResult.error };

  const { root } = rootResult;
  const pathResult = await assertSafeProjectPath(root, relativePath);
  if (!pathResult.ok) return { ok: false, error: pathResult.error };

  const { absolutePath } = pathResult;

  if (!isEditableTextFile(relativePath)) {
    return { ok: false, error: "This file type cannot be edited." };
  }

  // Ensure parent directory exists
  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  } catch {
    return { ok: false, error: "Failed to create parent directory." };
  }

  try {
    await fs.writeFile(absolutePath, content, "utf8");
  } catch {
    return { ok: false, error: "Failed to write file." };
  }

  let stat: import("fs").Stats;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return { ok: false, error: "Write succeeded but could not stat result." };
  }

  return {
    ok: true,
    data: {
      path:       normalizeProjectRelativePath(relativePath),
      size:       stat.size,
      modifiedAt: stat.mtime.toISOString(),
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  // Handle names like ".gitignore" — the dot is a prefix, not an extension
  if (i <= 0) return "";
  return name.slice(i);
}
