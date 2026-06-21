/**
 * lib/secrets/secret-fingerprint.ts
 *
 * Sprint 22: Stable fingerprints for secret values.
 *
 * A fingerprint is a one-way hash of the plaintext value, truncated to 12 hex
 * characters and prefixed with "fp_". It is safe to store, display, and include
 * in audit logs. It does NOT provide cryptographic security — its sole purpose
 * is to allow detection of value changes and safe identification in the UI.
 *
 * Example:
 *   fingerprintSecret("sk-ant-abc123") → "fp_a3c9f1e2b804"
 *
 * Same value → same fingerprint (deterministic).
 * Different value → different fingerprint (with very high probability).
 * Cannot be reversed to the original value.
 */

import crypto from "crypto";

/**
 * Compute a display-safe fingerprint for a secret value.
 * Returns "fp_<12 lowercase hex chars>".
 */
export function fingerprintSecret(plaintext: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(plaintext, "utf8")
    .digest("hex");
  return `fp_${hash.slice(0, 12)}`;
}

/**
 * Returns true if two fingerprints differ (i.e. the value changed).
 * Handles null/undefined gracefully — null vs non-null is treated as a change.
 */
export function fingerprintsdiffer(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  return (before ?? null) !== (after ?? null);
}
