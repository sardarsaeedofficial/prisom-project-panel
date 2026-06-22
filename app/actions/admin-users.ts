"use server";

/**
 * app/actions/admin-users.ts
 *
 * Sprint 32: Server actions for Admin User Management.
 *
 * All actions require OWNER or ADMIN role.
 * Password hashes are NEVER returned.
 * Only OWNER can create/promote to OWNER.
 */

import { UserRole }              from "@prisma/client";
import { requireAdmin }          from "@/lib/auth/require-admin";
import {
  listUsers,
  createUser,
  updateUserRole,
  resetUserPassword,
  verifyUserEmail,
  disableUser,
  reactivateUser,
  type UserDTO,
  type CreateUserInput,
} from "@/lib/auth/user-management";
import { validatePasswordStrength } from "@/lib/auth/passwords";
import { createPasswordResetToken } from "@/lib/auth/password-reset";

type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ── List ──────────────────────────────────────────────────────────────────────

export async function listUsersAction(): Promise<ActionResult<UserDTO[]>> {
  try {
    await requireAdmin();
    const users = await listUsers();
    return { ok: true, data: users };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list users" };
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createUserAction(input: {
  email:         string;
  name:          string;
  role:          UserRole;
  password:      string;
  emailVerified: boolean;
}): Promise<ActionResult<UserDTO>> {
  try {
    const actor = await requireAdmin();

    const strength = validatePasswordStrength(input.password);
    if (!strength.ok) {
      return { ok: false, error: strength.errors.join(" ") };
    }

    const result = await createUser({
      ...input,
      actorRole: actor.role,
    } as CreateUserInput);

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, data: result.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create user" };
  }
}

// ── Update role ───────────────────────────────────────────────────────────────

export async function updateUserRoleAction(input: {
  userId: string;
  role:   UserRole;
}): Promise<ActionResult<UserDTO>> {
  try {
    const actor  = await requireAdmin();
    const result = await updateUserRole(input.userId, input.role, actor.userId, actor.role);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, data: result.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update role" };
  }
}

// ── Reset password ────────────────────────────────────────────────────────────

export async function resetUserPasswordAction(input: {
  userId:      string;
  newPassword: string;
}): Promise<ActionResult> {
  try {
    await requireAdmin();

    const strength = validatePasswordStrength(input.newPassword);
    if (!strength.ok) {
      return { ok: false, error: strength.errors.join(" ") };
    }

    const result = await resetUserPassword(input.userId, input.newPassword);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reset password" };
  }
}

// ── Verify email ──────────────────────────────────────────────────────────────

export async function verifyUserEmailAction(userId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await verifyUserEmail(userId);
    if (!result.ok) return { ok: false, error: result.error ?? "Failed to verify email" };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to verify email" };
  }
}

// ── Disable ───────────────────────────────────────────────────────────────────

export async function disableUserAction(input: {
  userId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const actor  = await requireAdmin();
    const result = await disableUser(input.userId, input.reason, actor.userId);
    if (!result.ok) return { ok: false, error: result.error ?? "Failed to disable user" };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to disable user" };
  }
}

// ── Reactivate ────────────────────────────────────────────────────────────────

export async function reactivateUserAction(userId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await reactivateUser(userId);
    if (!result.ok) return { ok: false, error: result.error ?? "Failed to reactivate user" };
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reactivate user" };
  }
}

// ── Generate reset link (admin-initiated) ─────────────────────────────────────

export async function generateAdminResetLinkAction(userId: string): Promise<ActionResult<string>> {
  try {
    await requireAdmin();
    const result = await createPasswordResetToken(userId);
    if (!result.ok) return { ok: false, error: result.error };

    const base = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "";
    const link = `${base}/reset-password?token=${result.token}`;
    return { ok: true, data: link };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to generate reset link" };
  }
}
