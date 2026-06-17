/**
 * lib/projects/env-manager.ts
 *
 * AES-256-GCM encryption for per-project environment variables.
 *
 * Key: ENV_ENCRYPTION_KEY environment variable (64 hex chars = 32 bytes).
 * Generate on VPS:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Then add to .env: ENV_ENCRYPTION_KEY=<output>
 *
 * If key is missing, a deterministic dev-mode fallback is used.
 * NEVER deploy to production without setting ENV_ENCRYPTION_KEY.
 */

import crypto from "crypto";

const ALGO        = "aes-256-gcm" as const;
const KEY_ENV_VAR = "ENV_ENCRYPTION_KEY";

// ── Key ────────────────────────────────────────────────────────────────────

let _devKeyWarned = false;

function getKey(): Buffer {
  const k = process.env[KEY_ENV_VAR];
  if (!k) {
    if (!_devKeyWarned && process.env.NODE_ENV !== "test") {
      console.warn(
        `[env-manager] WARNING: ${KEY_ENV_VAR} is not set. ` +
          "Using an insecure dev key. Set ENV_ENCRYPTION_KEY in production."
      );
      _devKeyWarned = true;
    }
    // Dev fallback: derive from a fixed seed (NOT production-safe)
    return crypto
      .createHash("sha256")
      .update(`prisom-dev-key-${process.env.HOSTNAME ?? "localhost"}`)
      .digest();
  }
  if (k.length !== 64) {
    throw new Error(
      `${KEY_ENV_VAR} must be exactly 64 hex characters (32 bytes). ` +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(k, "hex");
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns `iv:tag:ciphertext` (all hex), safe to store in the database.
 */
export function encryptEnvValue(plaintext: string): string {
  const key      = getKey();
  const iv       = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher   = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag      = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a value produced by encryptEnvValue.
 * Throws if the ciphertext is malformed or the authentication tag fails.
 */
export function decryptEnvValue(ciphertext: string): string {
  const key    = getKey();
  const parts  = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format (expected iv:tag:data)");
  const [ivHex, tagHex, dataHex] = parts;
  const iv       = Buffer.from(ivHex,   "hex");
  const tag      = Buffer.from(tagHex,  "hex");
  const data     = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ── Masking ────────────────────────────────────────────────────────────────

/**
 * Returns a display-safe masked version of a secret value.
 * First 2 and last 2 characters are shown; the rest is replaced with ****.
 */
export function maskEnvValue(value: string): string {
  if (value.length <= 6) return "****";
  return value.slice(0, 2) + "****" + value.slice(-2);
}

// ── Bulk helpers ───────────────────────────────────────────────────────────

/**
 * Decrypts an array of DB env var rows into a plain Record<string, string>.
 * Silently skips rows that fail to decrypt (logs error to stderr — no values).
 *
 * WARNING: The returned record contains plaintext secrets.
 * Never log, serialise, or return this to the client.
 */
export function decryptEnvVars(
  rows: { name: string; value: string }[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    try {
      result[row.name] = decryptEnvValue(row.value);
    } catch (e) {
      console.error(
        `[env-manager] Failed to decrypt env var "${row.name}":`,
        e instanceof Error ? e.message : "unknown"
      );
    }
  }
  return result;
}

/**
 * Returns a safe-to-log copy of an env record with all values masked.
 */
export function maskEnvRecord(
  env: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, maskEnvValue(v)])
  );
}

// ── Classification ─────────────────────────────────────────────────────────

/**
 * Regex that matches env var names that are almost certainly secrets.
 * Used to auto-set isSecret=true when importing env vars.
 */
export const SECRET_NAME_RE =
  /(?:SECRET|PASSWORD|PASS\b|_PASS$|_KEY$|KEY\b|TOKEN|PRIVATE|CREDENTIAL|WEBHOOK|DATABASE_URL|DSN|_URL$|PWD)/i;

export function isLikelySecret(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}

// ── Reserved platform keys ─────────────────────────────────────────────────

/**
 * Keys that are set by the platform / PM2 ecosystem and MUST NOT be overridden
 * by user-supplied project secrets.
 */
export const RESERVED_PLATFORM_KEYS: ReadonlySet<string> = new Set([
  "NODE_ENV", "PORT", "HOST", "PWD", "HOME", "PATH", "SHELL", "USER", "PM2_HOME",
]);

export function isReservedPlatformKey(name: string): boolean {
  return RESERVED_PLATFORM_KEYS.has(name.trim().toUpperCase());
}

/**
 * Validates an env var name.
 * Returns null if valid, or a human-readable error string if not.
 *
 * Rules:
 *   - Must not be empty
 *   - Must match ^[A-Z][A-Z0-9_]*$ (after trim + uppercase)
 *   - Must not be a reserved platform key
 */
export function validateEnvVarName(name: string): string | null {
  const clean = name.trim().toUpperCase();
  if (!clean) return "Name is required.";
  if (!/^[A-Z][A-Z0-9_]*$/.test(clean)) {
    return `Invalid name "${name}". Must start with a letter and contain only uppercase letters, digits, and underscores.`;
  }
  if (isReservedPlatformKey(clean)) {
    return `"${clean}" is a reserved platform key and cannot be set as a project secret.`;
  }
  return null;
}

// ── Environment helpers ────────────────────────────────────────────────────

export const VALID_ENVIRONMENTS = ["development", "preview", "production"] as const;
export type EnvEnvironment = (typeof VALID_ENVIRONMENTS)[number];

export function isValidEnvironment(env: string): env is EnvEnvironment {
  return (VALID_ENVIRONMENTS as readonly string[]).includes(env);
}

/**
 * Parses a .env file string into a Record<string, string>.
 * Handles KEY=value, KEY="value", KEY='value', comments, blank lines.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name  = trimmed.slice(0, eq).trim();
    let   value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name) result[name] = value;
  }
  return result;
}
