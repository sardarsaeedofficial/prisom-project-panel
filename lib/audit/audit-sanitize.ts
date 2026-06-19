/**
 * lib/audit/audit-sanitize.ts
 *
 * Sprint 18: Sanitisation helpers for audit log metadata.
 *
 * Rules:
 *  - Redact values for keys containing: secret, token, key, password,
 *    credential, database_url, auth, cookie, authorization, bearer
 *  - Truncate long strings to prevent bloat
 *  - Cap total metadata JSON size
 *  - Never store raw env values, terminal output, or database row contents
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const REDACTED = "[REDACTED]";

/** Keys whose VALUES should always be redacted (case-insensitive substring match). */
const SENSITIVE_KEY_PATTERNS = [
  "secret",
  "token",
  "password",
  "credential",
  "database_url",
  "auth",
  "cookie",
  "authorization",
  "bearer",
  "private_key",
  "api_key",
  "apikey",
];

/** Maximum length of any single string value in audit metadata. */
const MAX_STRING_LENGTH = 500;

/** Maximum total serialised JSON size for metadata (bytes). */
const MAX_METADATA_BYTES = 4096;

/** Maximum nesting depth before we stop recursing. */
const MAX_DEPTH = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

function truncate(s: string): string {
  if (s.length <= MAX_STRING_LENGTH) return s;
  return s.slice(0, MAX_STRING_LENGTH) + "…[truncated]";
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[nested]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, depth + 1);
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

function sanitizeObject(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const entries = Object.entries(obj).slice(0, 50); // cap key count
  for (const [k, v] of entries) {
    if (isSensitiveKey(k)) {
      result[k] = REDACTED;
    } else {
      result[k] = sanitizeValue(v, depth);
    }
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sanitise arbitrary input for storage as audit metadata.
 *
 * - Redacts sensitive key names
 * - Truncates long strings
 * - Caps total JSON size
 * - Returns a plain Record safe to store in Prisma Json field
 */
export function sanitizeAuditMetadata(
  input: unknown,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const sanitized = sanitizeObject(
    input as Record<string, unknown>,
    0,
  );

  // Cap total serialised size
  let json = JSON.stringify(sanitized);
  if (json.length > MAX_METADATA_BYTES) {
    return { _truncated: true, _note: "Metadata exceeded size limit and was dropped." };
  }

  // Verify it round-trips (catches any non-serialisable values)
  try {
    JSON.parse(json);
  } catch {
    return { _error: "Metadata could not be serialised." };
  }

  return sanitized;
}

/**
 * Redact sensitive patterns from a free-form text string.
 *
 * Handles common formats:
 *   DATABASE_URL=postgresql://...  →  DATABASE_URL=[REDACTED]
 *   Authorization: Bearer abc123  →  Authorization: [REDACTED]
 *   "apiKey": "sk-..."           →  "apiKey": "[REDACTED]"
 */
export function redactSensitiveText(text: string): string {
  if (!text) return text;

  let result = text;

  // KEY=value patterns (env file format)
  result = result.replace(
    /(\b(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|DATABASE_URL|AUTH|COOKIE|AUTHORIZATION|BEARER|PRIVATE_KEY|API_KEY|APIKEY)\w*\s*=\s*)([^\s\n"']+)/gi,
    "$1[REDACTED]",
  );

  // "key": "value" / 'key': 'value' (JSON-like)
  result = result.replace(
    /("(?:secret|token|password|credential|database_url|auth|cookie|authorization|bearer|private_key|api_key|apikey)\w*"\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gi,
    '$1"[REDACTED]"',
  );

  // Authorization: Bearer <token>
  result = result.replace(
    /(authorization\s*:\s*(?:bearer|basic|token)\s+)([A-Za-z0-9\-._~+/]+=*)/gi,
    "$1[REDACTED]",
  );

  // postgresql:// and mysql:// connection strings
  result = result.replace(
    /(?:postgresql|mysql|postgres):\/\/[^\s"'<>]+/gi,
    "[REDACTED_URL]",
  );

  return result;
}

/**
 * Build a safe command preview from a raw terminal command.
 * Truncates the command and strips potential inline secrets.
 */
export function safeCommandPreview(rawCommand: string): string {
  const preview = redactSensitiveText(rawCommand.trim());
  return preview.slice(0, 200);
}

/**
 * Build a safe SQL query preview.
 * Does not include values — only the structural query text.
 */
export function safeQueryPreview(sql: string): string {
  // Remove string literals that might contain data
  const stripped = sql
    .replace(/'[^']*'/g, "'?'")
    .replace(/"[^"]*"/g, '"?"')
    .trim();
  return stripped.slice(0, 300);
}
