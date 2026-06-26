// ── Secret value patterns ──────────────────────────────────────────────────────
// Matches KEY=value or KEY: value assignment forms. Never strips variable names.

const SECRET_PATTERNS: RegExp[] = [
  // Named env vars with values
  /DATABASE_URL\s*[=:]\s*\S+/gi,
  /NEXTAUTH_SECRET\s*[=:]\s*\S+/gi,
  /AUTH_SECRET\s*[=:]\s*\S+/gi,
  /SESSION_SECRET\s*[=:]\s*\S+/gi,
  /STRIPE_SECRET_KEY\s*[=:]\s*\S+/gi,
  /STRIPE_WEBHOOK_SECRET\s*[=:]\s*\S+/gi,
  /CLOUDINARY_SECRET\s*[=:]\s*\S+/gi,
  /CLOUDINARY_API_SECRET\s*[=:]\s*\S+/gi,
  /CLOUDINARY_URL\s*[=:]\s*\S+/gi,
  /JWT_SECRET\s*[=:]\s*\S+/gi,
  /RESEND_API_KEY\s*[=:]\s*\S+/gi,
  /GITHUB_CLIENT_SECRET\s*[=:]\s*\S+/gi,
  /NEXTAUTH_URL\s*[=:]\s*\S+/gi,
  /private_key\s*[=:]\s*\S+/gi,

  // Connection string protocols that carry credentials
  /postgres(?:ql)?:\/\/[^\s"'`>]+/gi,
  /mongodb(?:\+srv)?:\/\/[^\s"'`>]+/gi,
  /redis(?:s)?:\/\/[^\s"'`>]+/gi,
  /mysql:\/\/[^\s"'`>]+/gi,

  // PEM / cert blocks
  /-----BEGIN\s[A-Z ]+-----[\s\S]*?-----END\s[A-Z ]+-----/gi,

  // Generic lowercase secret/token/password assignments (avoid over-matching)
  /\bpassword\s*=\s*["']?[^\s"']{4,}["']?/gi,
  /\bapi_key\s*[=:]\s*["']?[^\s"']{4,}["']?/gi,
  /\bsecret\s*[=:]\s*["']?[^\s"']{8,}["']?/gi,
];

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage",
]);

// ── Public API ────────────────────────────────────────────────────────────────

export function redactHelpContent(content: string): string {
  let result = content;
  for (const re of SECRET_PATTERNS) {
    result = result.replace(re, (m) => {
      // Preserve the key name (everything up to and including the = or :)
      const eqIdx = m.search(/[=:]/);
      if (eqIdx >= 0) {
        return m.slice(0, eqIdx + 1) + "[REDACTED]";
      }
      // Connection strings and PEM blocks — replace entirely
      return "[REDACTED]";
    });
  }
  return result;
}

export function isExcludedHelpPath(filePath: string): boolean {
  const p        = filePath.replace(/\\/g, "/");
  const segments = p.split("/");
  const basename = segments[segments.length - 1] ?? "";

  // .env files (including .env.local, .env.production, etc.)
  if (basename.startsWith(".env")) return true;

  // Any hidden file/dir except the repo root itself
  if (basename.startsWith(".") && basename.length > 1) return true;

  // Secret file extensions
  if (
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename.endsWith(".crt") ||
    basename.endsWith(".cer") ||
    basename.endsWith(".p12") ||
    basename.endsWith(".pfx") ||
    basename.endsWith(".log")
  )
    return true;

  // Excluded directory segments
  if (segments.some((s) => EXCLUDED_DIRS.has(s))) return true;

  // Storage backups
  if (p.includes("storage/backups")) return true;

  return false;
}

/**
 * Checks whether a snippet of text contains any pattern that looks like a
 * secret value. Used as a final safety gate before surfacing content in UI.
 */
export function containsSecretPattern(text: string): boolean {
  const patterns = [
    /DATABASE_URL\s*[=:]/i,
    /postgres(?:ql)?:\/\//i,
    /mongodb(?:\+srv)?:\/\//i,
    /redis(?:s)?:\/\//i,
    /-----BEGIN /i,
    /STRIPE_SECRET/i,
    /AUTH_SECRET\s*[=:]/i,
    /SESSION_SECRET\s*[=:]/i,
    /password\s*=/i,
  ];
  return patterns.some((re) => re.test(text));
}
