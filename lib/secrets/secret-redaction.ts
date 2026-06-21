/**
 * lib/secrets/secret-redaction.ts
 *
 * Sprint 22: Safe redaction helpers for displaying secret values in UI and logs.
 *
 * Rules:
 *  - Never return the full plaintext.
 *  - Short values → all dots.
 *  - Long values → show prefix + last 4 chars.
 *  - URL-format values → redact user:pass@ portion only.
 *  - API keys with well-known prefixes → show prefix + ...last4.
 *  - All redacted strings are safe to log and display.
 */

// ── Patterns ──────────────────────────────────────────────────────────────────

/** Matches URLs with credentials: protocol://user:pass@host/path */
const URL_WITH_CREDS_RE = /^(https?|postgresql|postgres|mysql|redis|mongodb):\/\/([^:]+):([^@]+)@(.+)$/i;

/** Well-known API key prefixes to preserve for readability */
const KNOWN_PREFIXES: RegExp[] = [
  /^(sk-ant-api\d+-)/i,     // Anthropic
  /^(sk_live_)/i,            // Stripe live
  /^(sk_test_)/i,            // Stripe test
  /^(rk_live_)/i,            // Stripe restricted live
  /^(rk_test_)/i,            // Stripe restricted test
  /^(re_)/i,                 // Resend
  /^(key_)/i,                // Generic key prefix
  /^(Bearer\s+)/i,           // Bearer token
];

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Returns a redacted string safe for UI display and audit logs.
 * Never reveals the full value.
 *
 * Examples:
 *   "abc"                      → "••••"
 *   "sk-ant-api03-abc...xyz"   → "sk-ant-api03-...xyz"
 *   "postgresql://u:p@host/db" → "postgresql://***:***@host/db"
 *   "https://user:pw@example"  → "https://***:***@example"
 *   "mysupersecretvalue123"    → "my...e123"
 */
export function redactSecret(value: string): string {
  if (!value || typeof value !== "string") return "••••";
  const v = value.trim();

  if (v.length === 0) return "••••";
  if (v.length <= 6) return "••••";

  // URL with credentials
  const urlMatch = v.match(URL_WITH_CREDS_RE);
  if (urlMatch) {
    const [, protocol, , , hostAndPath] = urlMatch;
    return `${protocol}://***:***@${hostAndPath}`;
  }

  // Well-known API key prefixes
  for (const re of KNOWN_PREFIXES) {
    const m = v.match(re);
    if (m) {
      const prefix = m[1];
      const tail = v.slice(-4);
      if (prefix.length + 4 >= v.length) return `${prefix}••••`;
      return `${prefix}...${tail}`;
    }
  }

  // Generic long value: show first 2 + last 4
  const head = v.slice(0, 2);
  const tail = v.slice(-4);
  return `${head}...${tail}`;
}

/**
 * Returns a "shape hint" — safe enough to show during import preview.
 * Reveals length category and first/last 1-2 chars only.
 *
 * Useful for confirming the user pasted the right value class during import.
 */
export function redactForImportPreview(value: string): string {
  if (!value) return "(empty)";
  const v = value.trim();
  if (v.length === 0) return "(empty)";
  if (v.length <= 4) return "••••";

  // URL-style: show protocol + redact creds
  const urlMatch = v.match(URL_WITH_CREDS_RE);
  if (urlMatch) {
    const [, protocol, , , hostAndPath] = urlMatch;
    // Show just enough of hostAndPath to identify the DB/host
    const hostPreview = hostAndPath.length > 24
      ? hostAndPath.slice(0, 24) + "…"
      : hostAndPath;
    return `${protocol}://***:***@${hostPreview}`;
  }

  // API key prefix
  for (const re of KNOWN_PREFIXES) {
    const m = v.match(re);
    if (m) {
      const prefix = m[1];
      return `${prefix}${"•".repeat(Math.min(8, v.length - prefix.length))}`;
    }
  }

  // Generic: first char + bullets + length hint
  return `${v[0]}${"•".repeat(Math.min(8, v.length - 2))}${v.slice(-1)} (${v.length} chars)`;
}

/**
 * Masks a value for display in the var list (shorter, simpler).
 * Consistent with existing maskEnvValue but improved.
 */
export function maskForDisplay(value: string): string {
  if (!value || value.length <= 6) return "••••••••";
  return value.slice(0, 2) + "••••" + value.slice(-2);
}
