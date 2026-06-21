/**
 * lib/secrets/secret-validation.ts
 *
 * Sprint 22: Secret key and value validation utilities.
 *
 * Validation focuses on safety and correctness — not on guessing format.
 * We never validate a value against expected format for security reasons
 * (format hints could help an attacker guess secrets).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; blocked?: boolean };

// ── Key validation ─────────────────────────────────────────────────────────────

const RESERVED_KEYS = new Set([
  "NODE_ENV", "PORT", "HOST", "PWD", "HOME", "PATH",
  "SHELL", "USER", "PM2_HOME",
]);

/**
 * Validates a secret key name.
 * Rules: UPPER_SNAKE_CASE, starts with letter, no reserved keys.
 */
export function validateSecretKey(key: string): ValidationResult {
  const clean = key.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Key name is required." };
  if (!/^[A-Z][A-Z0-9_]*$/.test(clean)) {
    return {
      ok: false,
      error: `Invalid key "${key}". Must start with a letter and contain only uppercase letters, digits, and underscores.`,
    };
  }
  if (RESERVED_KEYS.has(clean)) {
    return {
      ok: false,
      error: `"${clean}" is a reserved platform key and cannot be set as a project secret.`,
      blocked: true,
    };
  }
  return { ok: true };
}

// ── Value validation ───────────────────────────────────────────────────────────

const MAX_VALUE_BYTES = 8 * 1024; // 8 KB

const PRIVATE_KEY_PATTERNS: RegExp[] = [
  /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/i,
  /-----BEGIN\s+EC\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+DSA\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+OPENSSH\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+ENCRYPTED\s+PRIVATE KEY-----/i,
  /-----BEGIN\s+PGP\s+PRIVATE KEY BLOCK-----/i,
];

/**
 * Validates a secret value.
 * Returns ok: true if safe to store.
 * Returns ok: false with error if value is dangerous or malformed.
 */
export function validateSecretValue(value: string): ValidationResult {
  if (!value || !value.trim()) {
    return { ok: false, error: "Secret value cannot be empty." };
  }

  // Block binary content
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) {
    return {
      ok: false,
      error: "Secret value contains binary or non-printable characters.",
      blocked: true,
    };
  }

  // Block private keys
  if (PRIVATE_KEY_PATTERNS.some((re) => re.test(value))) {
    return {
      ok: false,
      error:
        "Private key-style values are blocked by default. Store them outside Prisom or use a dedicated secure secret type.",
      blocked: true,
    };
  }

  // Size limit
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    return {
      ok: false,
      error: `Value is too large (${Math.round(Buffer.byteLength(value, "utf8") / 1024)} KB). Maximum is 8 KB.`,
      blocked: true,
    };
  }

  return { ok: true };
}

/**
 * Returns a human-readable source label for display.
 */
export function sourceLabel(source: string | null | undefined): string {
  const s = source ?? "manual";
  const labels: Record<string, string> = {
    manual:     "Manual",
    import:     "Imported",
    template:   "Template",
    deployment: "Deployment config",
    system:     "System",
  };
  return labels[s] ?? s;
}
