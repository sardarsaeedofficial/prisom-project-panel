/**
 * lib/auth/passwords.ts
 *
 * Sprint 32: Password hashing utilities.
 *
 * Uses Node.js built-in crypto.scrypt — no external dependencies.
 *
 * Hash format: "<saltHex>:<keyHex>"
 *  - salt: 16 random bytes (32 hex chars)
 *  - key:  64 bytes derived by scrypt (128 hex chars)
 *
 * Safety:
 *  - Never logs passwords
 *  - Never returns the raw password
 *  - Hash parameters are fixed to prevent downgrade
 */

import { scrypt, randomBytes, timingSafeEqual } from "crypto";

const SALT_BYTES  = 16;
const KEY_BYTES   = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

// ── Async wrapper (manual Promise — promisify doesn't type the options overload)

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err);
      else     resolve(key);
    });
  });
}

// ── Hash ──────────────────────────────────────────────────────────────────────

/** Hashes a plaintext password. Returns a "<salt>:<key>" string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key  = await scryptAsync(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

// ── Verify ────────────────────────────────────────────────────────────────────

/** Verifies a password against a stored hash. Constant-time comparison. */
export async function verifyPassword(
  password:   string,
  storedHash: string,
): Promise<boolean> {
  try {
    const [saltHex, keyHex] = storedHash.split(":");
    if (!saltHex || !keyHex) return false;

    const salt        = Buffer.from(saltHex, "hex");
    const storedKey   = Buffer.from(keyHex,  "hex");
    const derivedKey  = await scryptAsync(password, salt);

    if (derivedKey.length !== storedKey.length) return false;
    return timingSafeEqual(derivedKey, storedKey);
  } catch {
    return false;
  }
}

// ── Strength validation ───────────────────────────────────────────────────────

export type PasswordStrengthResult = {
  ok:     boolean;
  errors: string[];
};

/** Returns validation errors for a proposed password. */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];

  if (!password || password.length < 10) {
    errors.push("Password must be at least 10 characters.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password should contain at least one uppercase letter.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password should contain at least one lowercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password should contain at least one number.");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Password should contain at least one symbol.");
  }

  return { ok: errors.length === 0, errors };
}
