/**
 * lib/templates/template-safety.ts
 *
 * Sprint 19: Validates a set of template files before they are written to disk.
 *
 * Rules:
 *  - All paths must be relative (no leading /)
 *  - No path traversal (../)
 *  - No backslash separators (normalised on write, but rejected here for clarity)
 *  - No null bytes
 *  - No absolute paths
 *  - Max file content: 250 KB
 *  - Max total payload: 2 MB
 *  - Max number of files: 100
 *  - .env files blocked (except .env.example and .env.example.*)
 *  - Private key / secret file names blocked
 *  - Executable flag is informational only — the action may apply it safely
 *
 * This validator operates on file content strings, not on-disk files.
 */

import type { ProjectTemplateFile } from "@/lib/templates/project-templates";

// ── Limits ─────────────────────────────────────────────────────────────────────

const MAX_FILES = 100;
const MAX_FILE_BYTES = 250 * 1024; // 250 KB
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2 MB

// ── Block-lists ────────────────────────────────────────────────────────────────

/** Blocked .env patterns (exact basename). .env.example is allowed. */
const BLOCKED_ENV_PATTERN = /^(\.env)(\.(local|prod(uction)?|dev(elopment)?|staging|test|ci))?$/i;

/** Blocked key/secret file basenames. */
const BLOCKED_SECRET_NAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "private.pem",
  "private.key",
  "server.key",
  "ssl.key",
]);

/** Blocked filename extensions for sensitive material. */
const BLOCKED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".der"]);

// ── Path validation ────────────────────────────────────────────────────────────

function isUnsafePath(filePath: string): string | null {
  if (!filePath || typeof filePath !== "string") {
    return "File path must be a non-empty string.";
  }

  // Null bytes
  if (filePath.includes("\0")) {
    return `Path "${filePath}" contains a null byte.`;
  }

  // Absolute paths
  if (filePath.startsWith("/") || /^[A-Za-z]:[/\\]/.test(filePath)) {
    return `Path "${filePath}" must be relative, not absolute.`;
  }

  // Backslash separators (Windows-style)
  if (filePath.includes("\\")) {
    return `Path "${filePath}" must use forward slashes.`;
  }

  // Leading dot-slash is fine (./foo) — normalise conceptually
  const normalised = filePath.replace(/^\.\//, "");

  // Path traversal
  const parts = normalised.split("/");
  for (const part of parts) {
    if (part === "..") {
      return `Path "${filePath}" contains a directory traversal component ("..").`;
    }
    if (part === ".") {
      // A mid-path "." is odd but not dangerous — skip
      continue;
    }
  }

  // Basename checks
  const basename = parts[parts.length - 1] ?? "";

  // Blocked .env files (allow .env.example and .env.example.*)
  if (BLOCKED_ENV_PATTERN.test(basename)) {
    return `Path "${filePath}" is a blocked .env file. Use ".env.example" instead.`;
  }

  // Blocked secret basenames
  if (BLOCKED_SECRET_NAMES.has(basename.toLowerCase())) {
    return `Path "${filePath}" matches a blocked secret file name.`;
  }

  // Blocked extensions
  const ext = basename.includes(".")
    ? "." + basename.split(".").pop()!.toLowerCase()
    : "";
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `Path "${filePath}" has a blocked extension (${ext}).`;
  }

  // next.config.ts is not supported by Next.js 14 at runtime — block it so
  // generated templates are always deployable. Use next.config.mjs instead.
  if (basename === "next.config.ts") {
    return `Path "${filePath}" is not supported. Use "next.config.mjs" for Next.js configuration.`;
  }

  return null; // safe
}

// ── Turbopack content guard ────────────────────────────────────────────────────
//
// Block template file content that would cause `next build` to run in Turbopack
// mode, which Next.js 14 does not support for production builds.

const TURBOPACK_CONTENT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /next\s+build\s+--turbo\b/,        label: "next build --turbo" },
  { pattern: /next\s+build\s+--turbopack\b/,    label: "next build --turbopack" },
  { pattern: /NEXT_PRIVATE_TURBOPACK/,           label: "NEXT_PRIVATE_TURBOPACK" },
  { pattern: /TURBOPACK\s*=\s*["']?1["']?/,     label: "TURBOPACK=1" },
  { pattern: /experimental\s*[:{]\s*[^}]*turbo/, label: "experimental.turbo config" },
];

function isUnsafeContent(content: string, filePath: string): string | null {
  for (const { pattern, label } of TURBOPACK_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      return `File "${filePath}" contains "${label}" which enables Turbopack. Production builds must not use Turbopack.`;
    }
  }
  return null;
}

// ── File-set validation ────────────────────────────────────────────────────────

export function validateTemplateFileSet(
  files: ProjectTemplateFile[],
): { ok: true } | { ok: false; error: string } {
  // Check file count
  if (files.length === 0) {
    return { ok: false, error: "Template produced no files." };
  }
  if (files.length > MAX_FILES) {
    return { ok: false, error: `Template exceeds max file count (${MAX_FILES}).` };
  }

  let totalBytes = 0;
  const seenPaths = new Set<string>();

  for (const file of files) {
    // Path safety
    const pathError = isUnsafePath(file.path);
    if (pathError) return { ok: false, error: pathError };

    // Duplicate paths
    const normPath = file.path.replace(/^\.\//, "");
    if (seenPaths.has(normPath)) {
      return { ok: false, error: `Duplicate file path: "${file.path}".` };
    }
    seenPaths.add(normPath);

    // Turbopack content guard
    const contentError = isUnsafeContent(file.content, file.path);
    if (contentError) return { ok: false, error: contentError };

    // Per-file size
    const bytes = Buffer.byteLength(file.content, "utf-8");
    if (bytes > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `File "${file.path}" exceeds the 250 KB limit (${Math.round(bytes / 1024)} KB).`,
      };
    }

    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: `Total template size exceeds the 2 MB limit.`,
      };
    }
  }

  return { ok: true };
}

// ── Individual path check (exported for tests) ─────────────────────────────────

export { isUnsafePath };
