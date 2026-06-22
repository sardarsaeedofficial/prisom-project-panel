/**
 * lib/auth/user-management.ts
 *
 * Sprint 32: Server-side user CRUD operations.
 *
 * Safety:
 *  - Never returns passwordHash
 *  - Only OWNER can create/promote another OWNER
 *  - Last OWNER cannot be demoted, disabled, or deleted
 *  - Callers must enforce admin permission before calling these functions
 */

import { db }           from "@/lib/db";
import { UserRole }     from "@prisma/client";
import { hashPassword } from "./passwords";

// ── DTO ───────────────────────────────────────────────────────────────────────

export type UserDTO = {
  id:              string;
  email:           string;
  name:            string;
  role:            UserRole;
  emailVerifiedAt: string | null;  // ISO
  disabledAt:      string | null;  // ISO
  disabledReason:  string | null;
  lastLoginAt:     string | null;  // ISO
  createdAt:       string;         // ISO
};

function toDTO(u: {
  id:              string;
  email:           string;
  name:            string;
  role:            UserRole;
  emailVerifiedAt: Date | null;
  disabledAt:      Date | null;
  disabledReason:  string | null;
  lastLoginAt:     Date | null;
  createdAt:       Date;
}): UserDTO {
  return {
    id:              u.id,
    email:           u.email,
    name:            u.name,
    role:            u.role,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    disabledAt:      u.disabledAt?.toISOString()      ?? null,
    disabledReason:  u.disabledReason,
    lastLoginAt:     u.lastLoginAt?.toISOString()     ?? null,
    createdAt:       u.createdAt.toISOString(),
  };
}

const USER_SELECT = {
  id: true, email: true, name: true, role: true,
  emailVerifiedAt: true, disabledAt: true, disabledReason: true,
  lastLoginAt: true, createdAt: true,
} as const;

// ── Guards ────────────────────────────────────────────────────────────────────

async function countOwners(): Promise<number> {
  return db.user.count({ where: { role: UserRole.OWNER } });
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<UserDTO[]> {
  const rows = await db.user.findMany({
    select:  USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

// ── Create ────────────────────────────────────────────────────────────────────

export type CreateUserInput = {
  email:         string;
  name:          string;
  role:          UserRole;
  password:      string;  // plaintext — will be hashed
  emailVerified: boolean;
  actorRole:     UserRole;  // role of the caller — only OWNER may create OWNER
};

export type CreateUserResult =
  | { ok: true;  user: UserDTO }
  | { ok: false; error: string };

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const { email, name, role, password, emailVerified, actorRole } = input;

  if (role === UserRole.OWNER && actorRole !== UserRole.OWNER) {
    return { ok: false, error: "Only an OWNER can create another OWNER." };
  }

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: {
      email:           email.toLowerCase().trim(),
      name:            name.trim() || email.split("@")[0],
      role,
      passwordHash,
      emailVerifiedAt: emailVerified ? new Date() : null,
    },
    select: USER_SELECT,
  });

  return { ok: true, user: toDTO(user) };
}

// ── Update role ───────────────────────────────────────────────────────────────

export type UpdateRoleResult =
  | { ok: true;  user: UserDTO }
  | { ok: false; error: string };

export async function updateUserRole(
  userId:    string,
  newRole:   UserRole,
  actorId:   string,
  actorRole: UserRole,
): Promise<UpdateRoleResult> {
  if (newRole === UserRole.OWNER && actorRole !== UserRole.OWNER) {
    return { ok: false, error: "Only an OWNER can promote another user to OWNER." };
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return { ok: false, error: "User not found." };

  // Prevent demoting the last OWNER
  if (user.role === UserRole.OWNER && newRole !== UserRole.OWNER) {
    const ownerCount = await countOwners();
    if (ownerCount <= 1) {
      return { ok: false, error: "Cannot demote the last OWNER." };
    }
  }

  const updated = await db.user.update({
    where:  { id: userId },
    data:   { role: newRole },
    select: USER_SELECT,
  });

  return { ok: true, user: toDTO(updated) };
}

// ── Reset password ────────────────────────────────────────────────────────────

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function resetUserPassword(
  userId:      string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: userId },
    data:  { passwordHash },
  });

  return { ok: true };
}

// ── Verify email ──────────────────────────────────────────────────────────────

export async function verifyUserEmail(userId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };

  await db.user.update({
    where: { id: userId },
    data:  { emailVerifiedAt: new Date() },
  });

  return { ok: true };
}

// ── Disable ───────────────────────────────────────────────────────────────────

export async function disableUser(
  userId:   string,
  reason:   string,
  actorId:  string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return { ok: false, error: "User not found." };

  if (user.role === UserRole.OWNER) {
    const ownerCount = await countOwners();
    if (ownerCount <= 1) {
      return { ok: false, error: "Cannot disable the last OWNER." };
    }
  }

  if (userId === actorId && user.role === UserRole.OWNER) {
    const ownerCount = await countOwners();
    if (ownerCount <= 1) {
      return { ok: false, error: "Cannot disable yourself — you are the only OWNER." };
    }
  }

  await db.user.update({
    where: { id: userId },
    data:  { disabledAt: new Date(), disabledReason: reason.trim().slice(0, 255) || null },
  });

  return { ok: true };
}

// ── Reactivate ────────────────────────────────────────────────────────────────

export async function reactivateUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, error: "User not found." };

  await db.user.update({
    where: { id: userId },
    data:  { disabledAt: null, disabledReason: null },
  });

  return { ok: true };
}
