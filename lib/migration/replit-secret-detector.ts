/**
 * lib/migration/replit-secret-detector.ts
 *
 * Sprint 24: Detects env var names referenced in project source code.
 *
 * Scans source content for:
 *   - process.env.FOO
 *   - import.meta.env.FOO
 *   - env("FOO")
 *   - Drizzle/Prisma connection strings
 *   - Stripe, Cloudinary, JWT patterns
 *   - Replit-specific env vars
 *
 * Safety: only receives pre-read source strings (not file paths).
 * Never returns or stores actual secret values.
 */

import type { DetectedSecret } from "./replit-detection-types";

// ── Patterns ──────────────────────────────────────────────────────────────────

/** Match process.env.SOME_VAR or process.env["SOME_VAR"] */
const PROCESS_ENV_RE = /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[["']([A-Z_][A-Z0-9_]*)["']\])/g;

/** Match import.meta.env.VITE_VAR or import.meta.env.SOME_VAR */
const IMPORT_META_ENV_RE = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;

/** Match env("VAR") or getEnv("VAR") or z.string().env("VAR") */
const ENV_CALL_RE = /(?:env|getEnv|c\.env)\(["']([A-Z_][A-Z0-9_]*)["']\)/g;

/** Replit-specific env vars that need replacement */
const REPLIT_ENV_VARS = new Set([
  "REPLIT_DOMAINS",
  "REPLIT_DB_URL",
  "REPLIT_CONNECTORS_HOSTNAME",
  "REPLIT_CONNECTORS_AUDIENCE",
  "REPLIT_CLUSTER",
  "REPL_ID",
  "REPL_SLUG",
  "REPL_OWNER",
  "REPLIT_DEV_DOMAIN",
]);

/** Replit → Prisom replacement mapping */
const REPLIT_REPLACEMENTS: Record<string, string> = {
  REPLIT_DOMAINS:                "APP_URL",
  REPLIT_DB_URL:                 "(export from Replit KV — no auto-replace)",
  REPLIT_CONNECTORS_HOSTNAME:    "SMTP_HOST (configure SMTP provider)",
  REPLIT_CONNECTORS_AUDIENCE:    "Remove — use SMTP provider credentials instead",
};

/** Well-known secrets and their categories */
const KNOWN_SECRET_CATEGORIES: Record<string, DetectedSecret["category"]> = {
  DATABASE_URL:            "database",
  POSTGRES_URL:            "database",
  PG_CONNECTION:           "database",
  MYSQL_URL:               "database",
  MONGODB_URI:             "database",
  MONGO_URI:               "database",
  REDIS_URL:               "database",

  STRIPE_SECRET_KEY:       "payments",
  STRIPE_PUBLISHABLE_KEY:  "payments",
  STRIPE_WEBHOOK_SECRET:   "payments",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "payments",

  SMTP_HOST:               "email",
  SMTP_PORT:               "email",
  SMTP_USER:               "email",
  SMTP_PASS:               "email",
  SMTP_FROM:               "email",
  SMTP_PASSWORD:           "email",
  RESEND_API_KEY:          "email",
  SENDGRID_API_KEY:        "email",
  MAILGUN_API_KEY:         "email",
  POSTMARK_API_TOKEN:      "email",

  CLOUDINARY_CLOUD_NAME:   "media",
  CLOUDINARY_API_KEY:      "media",
  CLOUDINARY_API_SECRET:   "media",
  CLOUDINARY_URL:          "media",
  AWS_ACCESS_KEY_ID:       "media",
  AWS_SECRET_ACCESS_KEY:   "media",
  AWS_REGION:              "media",
  S3_BUCKET:               "media",
  R2_ACCOUNT_ID:           "media",
  R2_ACCESS_KEY_ID:        "media",
  R2_SECRET_ACCESS_KEY:    "media",
  R2_BUCKET:               "media",

  JWT_SECRET:              "auth",
  SESSION_SECRET:          "auth",
  NEXTAUTH_SECRET:         "auth",
  AUTH_SECRET:             "auth",
  COOKIE_SECRET:           "auth",
  NEXTAUTH_URL:            "auth",

  APP_URL:                 "app",
  NEXT_PUBLIC_APP_URL:     "app",
  PUBLIC_URL:              "app",
  BASE_URL:                "app",
  PORT:                    "app",
  NODE_ENV:                "app",
};

/** Secrets that are typically required (not optional) */
const REQUIRED_SECRETS = new Set([
  "DATABASE_URL", "POSTGRES_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "SESSION_SECRET", "JWT_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET",
  "APP_URL", "RESEND_API_KEY", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET", "SMTP_HOST", "SMTP_PASS", "SMTP_USER",
]);

// ── Main detector ─────────────────────────────────────────────────────────────

/**
 * Scan all source content strings and return a deduplicated list of
 * detected secret names with categorization.
 *
 * @param sourceContents  Map of relPath → file content (pre-read)
 * @returns               Detected secrets list (no values, keys only)
 */
export function detectRequiredSecrets(
  sourceContents: Map<string, string>,
): DetectedSecret[] {
  const found = new Map<string, DetectedSecret>();

  const allContent = Array.from(sourceContents.values()).join("\n");

  function addSecret(name: string) {
    if (found.has(name)) return;
    const isReplit = REPLIT_ENV_VARS.has(name);
    found.set(name, {
      name,
      category: isReplit
        ? "replit-specific"
        : (KNOWN_SECRET_CATEGORIES[name] ?? "other"),
      required:           REQUIRED_SECRETS.has(name),
      replitReplacement:  REPLIT_REPLACEMENTS[name],
      notes:              isReplit ? "Replit-specific — must be replaced before VPS deployment." : undefined,
    });
  }

  // Scan process.env.X
  let m: RegExpExecArray | null;
  const re1 = new RegExp(PROCESS_ENV_RE.source, "g");
  while ((m = re1.exec(allContent)) !== null) {
    const name = m[1] ?? m[2];
    if (name) addSecret(name);
  }

  // Scan import.meta.env.X
  const re2 = new RegExp(IMPORT_META_ENV_RE.source, "g");
  while ((m = re2.exec(allContent)) !== null) {
    if (m[1]) addSecret(m[1]);
  }

  // Scan env("X") / getEnv("X")
  const re3 = new RegExp(ENV_CALL_RE.source, "g");
  while ((m = re3.exec(allContent)) !== null) {
    if (m[1]) addSecret(m[1]);
  }

  // Return sorted: required first, then by category, then alphabetical
  return Array.from(found.values()).sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Return the subset of detected secrets that are Replit-specific replacements.
 */
export function getReplitSecretReplacements(secrets: DetectedSecret[]): DetectedSecret[] {
  return secrets.filter((s) => s.category === "replit-specific");
}
