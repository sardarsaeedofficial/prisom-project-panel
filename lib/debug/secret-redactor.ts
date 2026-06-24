/**
 * lib/debug/secret-redactor.ts
 *
 * Sprint 58: Secret redaction for debug output.
 *
 * Wraps the canonical sanitizeOutput from command-runner and adds extra
 * patterns for debug contexts (pasted log text, operation output, build
 * excerpts). Never returns raw secrets.
 */

import { sanitizeOutput } from "@/lib/server/command-runner";

// ── Extra patterns for debug/pasted log contexts ──────────────────────────────
// These catch patterns not covered by the base sanitizer.

const DEBUG_EXTRA_PATTERNS: RegExp[] = [
  // Long bearer tokens (Authorization: Bearer <token>)
  /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi,
  // Inline postgres URLs in error messages (not just KEY= style)
  /postgres(?:ql)?:\/\/[^\s"')>]+/gi,
  // mysql URLs
  /mysql:\/\/[^\s"')>]+/gi,
  // mongodb URLs
  /mongodb(?:\+srv)?:\/\/[^\s"')>]+/gi,
  // Any sk_live_ or sk_test_ Stripe keys (may appear in error dumps)
  /sk_(?:live|test)_[A-Za-z0-9]{10,}/gi,
  // Cloudinary api_secret in error messages
  /api_secret[=:\s]+[A-Za-z0-9_\-]{10,}/gi,
  // SMTP password in error messages
  /smtp[^:]*:[^:]*:[^@]*@/gi,
  // GitHub PATs (ghp_, ghs_, github_pat_)
  /(?:ghp|ghs|github_pat)_[A-Za-z0-9_]{10,}/gi,
  // Resend / SendGrid API keys (re_ prefix or SG. prefix)
  /(?:re_[A-Za-z0-9]{10,}|SG\.[A-Za-z0-9\-_.]{10,})/g,
  // Private key blocks (-----BEGIN ... KEY-----)
  /-----BEGIN [A-Z ]+KEY-----[\s\S]*?-----END [A-Z ]+KEY-----/g,
  // Any environment variable with secret-like name in KEY=value format (catch-all)
  /\b(?:[A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASS|CREDENTIAL|API_KEY)[A-Z0-9_]*)\s*=\s*\S+/gi,
];

/** Redact all known secret patterns from arbitrary text. */
export function redactText(text: string): string {
  // Apply canonical sanitizer first (covers all production patterns)
  let s = sanitizeOutput(text);
  // Then apply extra debug patterns
  for (const p of DEBUG_EXTRA_PATTERNS) {
    s = s.replace(p, "[REDACTED]");
  }
  return s;
}

/** Redact and truncate a log excerpt for safe UI display (max 2 000 chars). */
export function redactExcerpt(text: string, maxChars = 2000): string {
  const redacted = redactText(text);
  if (redacted.length <= maxChars) return redacted;
  return redacted.slice(0, maxChars) + "\n… (truncated)";
}
