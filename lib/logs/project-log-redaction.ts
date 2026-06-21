/**
 * lib/logs/project-log-redaction.ts
 *
 * Sprint 28: Redaction layer for the Logs Center.
 *
 * Re-exports and extends the canonical sanitizeOutput from command-runner with
 * additional patterns that may appear in structured log output but not in raw
 * command stdout (e.g. JSON-encoded env var values, inline secrets that appear
 * in operation metadata).
 *
 * ALL log text must pass through redactLogText() before reaching the client.
 * Never bypass this for any log source.
 */

import { sanitizeOutput } from "@/lib/server/command-runner";

// ── Extended patterns (beyond sanitizeOutput) ─────────────────────────────────
// These catch secrets that may appear in structured JSON log payloads or that
// are printed without a KEY= prefix (e.g. in stack traces or env dumps).

const EXTRA_PATTERNS: RegExp[] = [
  // JSON-encoded key/value pairs: "DATABASE_URL":"postgres://..."
  /"(?:DATABASE_URL|JWT_SECRET|SESSION_SECRET|NEXTAUTH_SECRET|ENCRYPTION_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|GITHUB_CLIENT_SECRET|GITHUB_APP_PRIVATE_KEY|R2_SECRET_ACCESS_KEY)":\s*"[^"]*"/gi,
  // Any JSON key ending in _secret, _key, _token, _password, _pass
  /"[^"]*(?:_secret|_key|_token|_password|_pass)":\s*"[^"]+"/gi,
  // Inline password in env dump lines: "password = hunter2"
  /password\s*[=:]\s*\S+/gi,
];

/**
 * Redacts all known secret patterns from a log text string.
 * Always applied before any log content is returned to the client.
 */
export function redactLogText(text: string): string {
  // Run the canonical sanitizer first (covers all the big patterns)
  let s = sanitizeOutput(text);
  // Then apply extra patterns specific to structured log output
  for (const p of EXTRA_PATTERNS) {
    s = s.replace(p, "[REDACTED]");
  }
  return s;
}

/**
 * Redact an array of log lines in-place (returns a new array).
 * Use this after parsing raw text into LogLine[]s.
 */
export function redactLogLines<T extends { text: string }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, text: redactLogText(l.text) }));
}
