/**
 * lib/env/env-value-safety.ts
 *
 * Sprint 46: Placeholder/suspicious value detection and safe masked previews.
 *
 * Safety rules:
 *  - Functions that receive raw values must never return them
 *  - Only masked previews are returned (last 4 chars, host, key prefix)
 *  - Stripe test key detection for production environments
 *  - localhost detection for production APP_URL
 */

import type { EnvVarStatus } from "./env-readiness-types";

// ── Known placeholder sentinels ───────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^<required:/i,
  /^<add\s/i,
  /^TODO$/i,
  /^CHANGE.?ME$/i,
  /^your[-_]/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\btest_test_test\b/i,
  /\.example\.com/i,
  /^https?:\/\/your/i,
  /^https?:\/\/example\.com/i,
  /change.?me/i,
  /fill.?this/i,
  /replace.?me/i,
  /^<secret>/i,
  /^<value>/i,
];

/** Env vars where localhost/127.0.0.1 is suspicious in production. */
const URL_VAR_NAMES = new Set([
  "APP_URL", "PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL", "VITE_APP_URL",
  "VITE_PUBLIC_APP_URL", "BASE_URL", "NEXTAUTH_URL", "AUTH_URL",
  "FRONTEND_URL", "BACKEND_URL", "API_URL", "PUBLIC_URL",
]);

// ── Classification ─────────────────────────────────────────────────────────────

function isPlaceholderString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed));
}

function isLocalhostUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "0.0.0.0" ||
      u.hostname.endsWith(".local")
    );
  } catch {
    return (
      value.includes("localhost") ||
      value.includes("127.0.0.1") ||
      value.includes("0.0.0.0")
    );
  }
}

/**
 * Classifies a decrypted env var value.
 * Never returns the raw value — only the classification.
 */
export function classifyEnvValue(
  name:  string,
  value: string,
): EnvVarStatus {
  if (!value || value.trim() === "") return "empty";
  if (isPlaceholderString(value))       return "placeholder";

  // Stripe test keys in production
  if (name === "STRIPE_SECRET_KEY" && value.startsWith("sk_test_"))        return "suspicious";
  if (name === "STRIPE_PUBLISHABLE_KEY" && value.startsWith("pk_test_"))   return "suspicious";

  // localhost URLs
  if (URL_VAR_NAMES.has(name) && isLocalhostUrl(value)) return "suspicious";

  return "configured";
}

// ── Masked preview generation ─────────────────────────────────────────────────

function last4(s: string): string {
  return s.length > 4 ? `***${s.slice(-4)}` : "***";
}

function maskDatabaseUrl(value: string): string {
  try {
    const u = new URL(value);
    u.username = "***";
    u.password = "";
    return u.toString().replace(":@", "@");
  } catch {
    return "***";
  }
}

function maskWebUrl(value: string): string {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return value.slice(0, 30);
  }
}

/**
 * Generates a safe display preview for an env var value.
 * Input is the decrypted plaintext — output contains no credential information.
 */
export function buildMaskedPreview(name: string, value: string): string | undefined {
  if (!value || value.trim() === "") return undefined;

  const n = name.toUpperCase();

  // Database URLs
  if (n === "DATABASE_URL" || n === "DIRECT_URL" || n === "SHADOW_DATABASE_URL" ||
      n.startsWith("POSTGRES") || n === "MONGODB_URI" || n === "DATABASE_REPLICA_URL") {
    return maskDatabaseUrl(value);
  }

  // App URLs — safe to show the origin
  if (URL_VAR_NAMES.has(n) || n.endsWith("_URL") || n.endsWith("_ENDPOINT")) {
    try {
      new URL(value);
      return maskWebUrl(value);
    } catch {
      return undefined;
    }
  }

  // Stripe keys — show prefix + last4
  if (n.startsWith("STRIPE_")) {
    if (value.startsWith("sk_live_"))  return `sk_live_${last4(value)}`;
    if (value.startsWith("sk_test_"))  return `sk_test_${last4(value)}`;
    if (value.startsWith("pk_live_"))  return `pk_live_${last4(value)}`;
    if (value.startsWith("pk_test_"))  return `pk_test_${last4(value)}`;
    if (value.startsWith("whsec_"))    return `whsec_${last4(value)}`;
    return last4(value);
  }

  // Cloudinary / S3 / R2 — show last 4 only
  if (n.startsWith("CLOUDINARY_") || n.startsWith("S3_") || n.startsWith("AWS_") || n.startsWith("R2_")) {
    return last4(value);
  }

  // Auth secrets — show last 4 only
  if (n.includes("SECRET") || n.includes("API_KEY") || n.includes("PRIVATE") ||
      n.includes("PASSWORD") || n.includes("TOKEN") || n.includes("_KEY")) {
    return last4(value);
  }

  // Generic — show last 4 only
  return last4(value);
}

/**
 * Checks whether a decrypted value is considered a placeholder
 * (as created by the migration wizard's placeholder generation).
 */
export function isPlaceholder(value: string): boolean {
  return isPlaceholderString(value.trim());
}
