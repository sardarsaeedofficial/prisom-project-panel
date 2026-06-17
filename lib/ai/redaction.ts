/**
 * lib/ai/redaction.ts
 *
 * Redacts secrets from text before it is included in any AI prompt.
 *
 * IMPORTANT: This is a best-effort defence-in-depth layer.
 * The primary safety rule is: never pass decrypted env var values,
 * DATABASE_URL, JWT secrets, API keys, tokens, passwords, or cookies
 * to the AI provider at all.  This module redacts incidental leaks that
 * might appear in log lines, config snippets, or other project text.
 */

// ── Patterns ───────────────────────────────────────────────────────────────

/** Each entry: [label, regex] */
const REDACT_PATTERNS: [string, RegExp][] = [
  // Connection strings
  ["DATABASE_URL",      /DATABASE_URL\s*=\s*\S+/gi],
  ["postgres URI",      /postgres(?:ql)?:\/\/[^\s'"]+/gi],
  ["mysql URI",         /mysql:\/\/[^\s'"]+/gi],
  ["mongodb URI",       /mongodb(?:\+srv)?:\/\/[^\s'"]+/gi],
  ["redis URI",         /redis:\/\/[^\s'"]+/gi],

  // JWT / auth
  ["JWT_SECRET",        /JWT_SECRET\s*=\s*\S+/gi],
  ["JWT_SECRET value",  /(?:^|\s)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],

  // API keys by name
  ["ANTHROPIC_API_KEY", /ANTHROPIC_API_KEY\s*=\s*\S+/gi],
  ["STRIPE_SECRET",     /STRIPE_SECRET_KEY\s*=\s*\S+/gi],
  ["STRIPE_KEY",        /sk_(?:live|test)_[A-Za-z0-9_]+/g],
  ["OPENAI_API_KEY",    /OPENAI_API_KEY\s*=\s*\S+/gi],
  ["OPENAI_KEY",        /sk-[A-Za-z0-9_-]{20,}/g],

  // Generic patterns
  ["API_KEY",           /[A-Z_]+API_KEY\s*=\s*\S+/gi],
  ["SECRET_KEY",        /[A-Z_]*SECRET(?:_KEY)?\s*=\s*\S+/gi],
  ["TOKEN_VAR",         /[A-Z_]+TOKEN\s*=\s*\S+/gi],
  ["PASSWORD_VAR",      /[A-Z_]*PASSWORD\s*=\s*\S+/gi],

  // Auth headers in logs / curl commands
  ["Authorization header", /Authorization:\s*Bearer\s+[^\s'"]+/gi],
  ["Cookie header",         /Cookie:\s*[^\r\n]+/gi],

  // password= / token= / secret= in query strings or config
  ["password param",   /password=[^\s&'"]+/gi],
  ["token param",      /token=[^\s&'"]+/gi],
  ["secret param",     /secret=[^\s&'"]+/gi],

  // AWS
  ["AWS_SECRET",        /AWS_SECRET_ACCESS_KEY\s*=\s*\S+/gi],
  ["AWS_KEY",           /AKIA[0-9A-Z]{16}/g],
];

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Redact known secret patterns from a string.
 * Returns the cleaned string; never throws.
 */
export function redact(text: string): string {
  let out = text;
  for (const [label, pattern] of REDACT_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${label}]`);
  }
  return out;
}

/**
 * Redact an entire object by redacting every string leaf.
 * Shallow — only one level deep. Use for simple key/value maps.
 */
export function redactRecord(
  record: Record<string, string | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value ? redact(value) : "";
  }
  return out;
}
