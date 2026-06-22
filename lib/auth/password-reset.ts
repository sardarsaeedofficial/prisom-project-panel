/**
 * lib/auth/password-reset.ts
 *
 * Sprint 32: Password reset token management.
 *
 * Safety:
 *  - Raw token is never stored — only SHA-256 hash
 *  - Tokens expire after 30 minutes
 *  - Tokens are single-use (usedAt set on consumption)
 *  - Expiry + used tokens cannot be reused
 */

import { randomBytes, createHash }  from "crypto";
import { db }                        from "@/lib/db";
import { hashPassword }              from "./passwords";

const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ── Token hash helper ─────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Create ────────────────────────────────────────────────────────────────────

export type CreateResetTokenResult = {
  ok:    true;
  token: string; // raw token — pass to user; do NOT store
} | {
  ok:    false;
  error: string;
};

/**
 * Generate a new password reset token for a user.
 * Invalidates any existing unused tokens for the same user.
 */
export async function createPasswordResetToken(
  userId: string,
): Promise<CreateResetTokenResult> {
  try {
    const raw      = randomBytes(32).toString("hex");
    const hash     = hashToken(raw);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    // Invalidate any prior unexpired unused tokens for this user
    await db.passwordResetToken.updateMany({
      where:  { userId, usedAt: null, expiresAt: { gte: new Date() } },
      data:   { usedAt: new Date() },
    });

    await db.passwordResetToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });

    return { ok: true, token: raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create reset token";
    return { ok: false, error: msg };
  }
}

// ── Validate and consume ──────────────────────────────────────────────────────

export type ConsumeResetTokenResult =
  | { ok: true;  userId: string }
  | { ok: false; error: string };

/**
 * Validate a raw token and set a new password atomically.
 * Marks the token as used on success.
 */
export async function validateAndConsumeResetToken(
  rawToken:    string,
  newPassword: string,
): Promise<ConsumeResetTokenResult> {
  const hash = hashToken(rawToken);

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hash },
  }).catch(() => null);

  if (!record)              return { ok: false, error: "Invalid or expired reset link." };
  if (record.usedAt)        return { ok: false, error: "This reset link has already been used." };
  if (record.expiresAt < new Date()) return { ok: false, error: "This reset link has expired." };

  const newHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data:  { passwordHash: newHash },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data:  { usedAt: new Date() },
    }),
  ]);

  return { ok: true, userId: record.userId };
}
