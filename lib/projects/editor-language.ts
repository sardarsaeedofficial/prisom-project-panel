/**
 * lib/projects/editor-language.ts
 *
 * Sprint 10: Map file paths to Monaco Editor language IDs.
 * Pure JS — no Node.js imports — safe to use in client components.
 */

// ── Language map ──────────────────────────────────────────────────────────────

/** Extension → Monaco language ID */
const EXT_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  ts:         "typescript",
  tsx:        "typescript",
  js:         "javascript",
  jsx:        "javascript",
  mjs:        "javascript",
  cjs:        "javascript",
  // Data / config
  json:       "json",
  jsonc:      "json",
  yml:        "yaml",
  yaml:       "yaml",
  toml:       "ini",    // Monaco has no TOML; ini is close enough
  ini:        "ini",
  cfg:        "ini",
  env:        "ini",    // only .env.example reaches here (blocked files never open)
  // Markup
  html:       "html",
  htm:        "html",
  xml:        "xml",
  svg:        "xml",
  // Styles
  css:        "css",
  scss:       "scss",
  sass:       "scss",
  less:       "less",
  // Documentation
  md:         "markdown",
  mdx:        "markdown",
  txt:        "plaintext",
  // Database / query
  sql:        "sql",
  prisma:     "plaintext",   // Monaco has no prisma language (community extensions exist)
  // Shell
  sh:         "shell",
  bash:       "shell",
  zsh:        "shell",
  fish:       "shell",
  // Other
  graphql:    "graphql",
  gql:        "graphql",
  dockerfile: "dockerfile",
  rs:         "rust",
  go:         "go",
  py:         "python",
  rb:         "ruby",
  php:        "php",
  java:       "java",
  cs:         "csharp",
  cpp:        "cpp",
  c:          "c",
  h:          "cpp",
  swift:      "swift",
  kt:         "kotlin",
};

/** Exact basename (case-sensitive) → Monaco language ID */
const BASENAME_MAP: Record<string, string> = {
  Dockerfile:      "dockerfile",
  "Dockerfile.dev":"dockerfile",
  Makefile:        "makefile",
  Procfile:        "plaintext",
  ".gitignore":    "plaintext",
  ".dockerignore": "plaintext",
  ".editorconfig": "ini",
  ".npmrc":        "ini",
  ".nvmrc":        "plaintext",
  ".babelrc":      "json",
  ".eslintrc":     "json",
  ".prettierrc":   "json",
  ".env.example":  "plaintext",
  LICENSE:         "plaintext",
  README:          "markdown",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the Monaco language ID for a file path.
 * Falls back to "plaintext" for unknown types.
 *
 * @example
 *   getEditorLanguage("src/index.tsx")  // "typescript"
 *   getEditorLanguage("package.json")  // "json"
 *   getEditorLanguage("Dockerfile")    // "dockerfile"
 *   getEditorLanguage(".gitignore")    // "plaintext"
 */
export function getEditorLanguage(filePath: string): string {
  // Extract the filename from the path
  const name = filePath.split("/").pop() ?? filePath;

  // Exact basename match first (e.g. "Dockerfile", ".gitignore")
  if (BASENAME_MAP[name]) return BASENAME_MAP[name];

  // Extract extension
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) {
    // No extension or starts with dot (e.g. ".babelrc" not caught above)
    return "plaintext";
  }
  const ext = name.slice(dotIdx + 1).toLowerCase();

  return EXT_MAP[ext] ?? "plaintext";
}
