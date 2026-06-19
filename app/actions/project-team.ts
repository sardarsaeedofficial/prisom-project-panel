"use server";

/**
 * app/actions/project-team.ts
 *
 * Sprint 17: Project team management server actions.
 *
 * Security:
 *  - All write actions require project.manageTeam permission.
 *  - acceptProjectInviteAction only requires a valid session (any logged-in user).
 *  - The sole owner cannot be removed or demoted.
 *  - Email addresses in invites are masked before being returned to the client.
 *  - Invite tokens are cryptographically random (256-bit hex).
 *  - Do not expose env var values, secrets, or raw invite email addresses.
 *  - Types are NOT re-exported from this file — import from lib/auth/*.
 */

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-workspace";
import { maskEmail } from "@/lib/projects/alert-notifications";
import {
  requireProjectPermission,
  countProjectOwners,
} from "@/lib/auth/project-membership";
import {
  type ProjectRole,
  PROJECT_ROLES,
  assignableRoles,
} from "@/lib/auth/project-permissions";
import { writeProjectAuditEvent } from "@/lib/audit/project-audit";
import { getAuditRequestContext } from "@/lib/audit/request-context";

// ── Shared result type ─────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ── Public return types (safe for client — no raw emails) ─────────────────────

export type TeamMember = {
  id:       string;   // ProjectMember.id
  userId:   string;
  name:     string;
  email:    string;   // masked: "a***@example.com"
  role:     ProjectRole;
  joinedAt: string;   // ISO
  isSelf:   boolean;  // true when this is the requesting user
};

export type TeamInvite = {
  id:           string;  // ProjectInvite.id
  email:        string;  // masked
  role:         ProjectRole;
  status:       string;
  expiresAt:    string;  // ISO
  createdAt:    string;  // ISO
  inviterName:  string;
};

export type TeamData = {
  members: TeamMember[];
  invites: TeamInvite[];
  myRole:  ProjectRole;
};

// ── getProjectTeamAction ───────────────────────────────────────────────────────

/**
 * List all members and pending invites for a project.
 * Requires project.view permission (all members can call this).
 */
export async function getProjectTeamAction(
  projectId: string,
): Promise<ActionResult<TeamData>> {
  const auth = await requireProjectPermission(projectId, "project.view");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const [members, invites] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.projectInvite.findMany({
      where: { projectId, status: "pending" },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const teamMembers: TeamMember[] = members.map((m) => ({
    id:       m.id,
    userId:   m.userId,
    name:     m.user.name,
    email:    maskEmail(m.user.email),
    role:     m.role as ProjectRole,
    joinedAt: m.joinedAt.toISOString(),
    isSelf:   m.userId === auth.userId,
  }));

  const teamInvites: TeamInvite[] = invites.map((inv) => ({
    id:          inv.id,
    email:       maskEmail(inv.email),
    role:        inv.role as ProjectRole,
    status:      inv.status,
    expiresAt:   inv.expiresAt.toISOString(),
    createdAt:   inv.createdAt.toISOString(),
    inviterName: inv.invitedBy.name,
  }));

  return {
    ok: true,
    data: {
      members: teamMembers,
      invites: teamInvites,
      myRole:  auth.role,
    },
  };
}

// ── inviteProjectMemberAction ──────────────────────────────────────────────────

/**
 * Create an invite link for a project.
 * Requires project.manageTeam permission.
 * Returns the invite URL (contains the token).
 */
export async function inviteProjectMemberAction(input: {
  projectId: string;
  email:     string;
  role:      ProjectRole;
  note?:     string;
}): Promise<ActionResult<{ inviteUrl: string; inviteId: string }>> {
  const auth = await requireProjectPermission(input.projectId, "project.manageTeam");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  // Validate email
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Invalid email address.", code: "VALIDATION" };
  }
  if (email.length > 320) {
    return { ok: false, error: "Email address too long.", code: "VALIDATION" };
  }

  // Validate role
  if (!PROJECT_ROLES.includes(input.role)) {
    return { ok: false, error: "Invalid role.", code: "VALIDATION" };
  }

  // Only owners can invite other owners
  const allowed = assignableRoles(auth.role);
  if (!allowed.includes(input.role)) {
    return {
      ok: false,
      error: `Your role (${auth.role}) cannot invite members as ${input.role}.`,
      code: "FORBIDDEN",
    };
  }

  // Check if the user is already a member
  const existingMember = await db.projectMember.findFirst({
    where: {
      projectId: input.projectId,
      user: { email },
    },
  });
  if (existingMember) {
    return {
      ok: false,
      error: "This user is already a member of the project.",
      code: "CONFLICT",
    };
  }

  // Cancel any existing pending invites to the same email
  await db.projectInvite.updateMany({
    where: {
      projectId: input.projectId,
      email,
      status: "pending",
    },
    data: { status: "cancelled" },
  });

  // Generate a cryptographically secure token
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await db.projectInvite.create({
    data: {
      token,
      email,
      role:       input.role,
      note:       input.note?.slice(0, 500) ?? null,
      expiresAt,
      projectId:  input.projectId,
      invitedById: auth.userId,
    },
  });

  revalidatePath(`/projects/${input.projectId}/settings`);

  // Build the invite URL — the panel's own origin
  const inviteUrl = `/invites/project/${token}`;

  // Sprint 18: audit — log key names only, never the token itself
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "team.invite.created",
    category: "team",
    result: "success",
    targetType: "invite",
    targetId: invite.id,
    targetLabel: maskEmail(email),
    summary: `Invite created for ${maskEmail(email)} as ${input.role}`,
    metadata: { role: input.role, inviteId: invite.id },
    ...ctx,
  });

  return { ok: true, data: { inviteUrl, inviteId: invite.id } };
}

// ── updateProjectMemberRoleAction ──────────────────────────────────────────────

/**
 * Change a project member's role.
 * Requires project.manageTeam permission.
 *
 * Security:
 *  - Cannot demote the sole owner.
 *  - Cannot change your own role.
 *  - Cannot assign a role above your own.
 */
export async function updateProjectMemberRoleAction(input: {
  projectId: string;
  memberId:  string;  // ProjectMember.id
  role:      ProjectRole;
}): Promise<ActionResult<TeamMember>> {
  const auth = await requireProjectPermission(input.projectId, "project.manageTeam");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  if (!PROJECT_ROLES.includes(input.role)) {
    return { ok: false, error: "Invalid role.", code: "VALIDATION" };
  }

  const member = await db.projectMember.findUnique({
    where: { id: input.memberId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!member || member.projectId !== input.projectId) {
    return { ok: false, error: "Member not found.", code: "NOT_FOUND" };
  }

  // Cannot change own role
  if (member.userId === auth.userId) {
    return {
      ok: false,
      error: "You cannot change your own role. Ask another owner or admin.",
      code: "FORBIDDEN",
    };
  }

  // Only owners can assign the owner role or modify other owners
  const allowed = assignableRoles(auth.role);
  if (!allowed.includes(input.role)) {
    return {
      ok: false,
      error: `Your role (${auth.role}) cannot assign the ${input.role} role.`,
      code: "FORBIDDEN",
    };
  }
  if (member.role === "owner" && auth.role !== "owner") {
    return {
      ok: false,
      error: "Only an owner can change another owner's role.",
      code: "FORBIDDEN",
    };
  }

  // If demoting from owner, ensure at least one owner will remain
  if (member.role === "owner" && input.role !== "owner") {
    const ownerCount = await countProjectOwners(input.projectId);
    if (ownerCount <= 1) {
      return {
        ok: false,
        error: "Cannot remove the last owner. Assign another owner first.",
        code: "FORBIDDEN",
      };
    }
  }

  const updated = await db.projectMember.update({
    where: { id: input.memberId },
    data:  { role: input.role },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  revalidatePath(`/projects/${input.projectId}/settings`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "team.member.role_changed",
    category: "team",
    result: "success",
    targetType: "member",
    targetId: member.userId,
    targetLabel: member.user.name,
    summary: `Role changed for ${member.user.name}: ${member.role} → ${input.role}`,
    metadata: { previousRole: member.role, newRole: input.role, memberId: input.memberId },
    ...ctx,
  });

  return {
    ok: true,
    data: {
      id:       updated.id,
      userId:   updated.userId,
      name:     updated.user.name,
      email:    maskEmail(updated.user.email),
      role:     updated.role as ProjectRole,
      joinedAt: updated.joinedAt.toISOString(),
      isSelf:   updated.userId === auth.userId,
    },
  };
}

// ── removeProjectMemberAction ──────────────────────────────────────────────────

/**
 * Remove a member from the project.
 * Requires project.manageTeam permission.
 *
 * Security:
 *  - Cannot remove the sole owner.
 *  - Cannot remove yourself.
 *  - Cannot remove another owner unless you are also an owner.
 */
export async function removeProjectMemberAction(input: {
  projectId: string;
  memberId:  string;
}): Promise<ActionResult<{ memberId: string }>> {
  const auth = await requireProjectPermission(input.projectId, "project.manageTeam");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const member = await db.projectMember.findUnique({
    where: { id: input.memberId },
    select: { id: true, userId: true, role: true, projectId: true },
  });
  if (!member || member.projectId !== input.projectId) {
    return { ok: false, error: "Member not found.", code: "NOT_FOUND" };
  }

  // Cannot remove yourself — use "leave project" flow instead
  if (member.userId === auth.userId) {
    return {
      ok: false,
      error: "Cannot remove yourself. Use the Leave Project option instead.",
      code: "FORBIDDEN",
    };
  }

  // Non-owners cannot remove owners
  if (member.role === "owner" && auth.role !== "owner") {
    return {
      ok: false,
      error: "Only an owner can remove another owner.",
      code: "FORBIDDEN",
    };
  }

  // Prevent removing the last owner
  if (member.role === "owner") {
    const ownerCount = await countProjectOwners(input.projectId);
    if (ownerCount <= 1) {
      return {
        ok: false,
        error: "Cannot remove the last owner. Assign another owner first.",
        code: "FORBIDDEN",
      };
    }
  }

  await db.projectMember.delete({ where: { id: input.memberId } });

  revalidatePath(`/projects/${input.projectId}/settings`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "team.member.removed",
    category: "team",
    result: "success",
    targetType: "member",
    targetId: member.userId,
    summary: `Member removed (role: ${member.role})`,
    metadata: { removedRole: member.role, memberId: input.memberId },
    ...ctx,
  });

  return { ok: true, data: { memberId: input.memberId } };
}

// ── cancelProjectInviteAction ──────────────────────────────────────────────────

/**
 * Cancel a pending project invite.
 * Requires project.manageTeam permission.
 */
export async function cancelProjectInviteAction(input: {
  projectId: string;
  inviteId:  string;
}): Promise<ActionResult<{ inviteId: string }>> {
  const auth = await requireProjectPermission(input.projectId, "project.manageTeam");
  if (!auth.ok) return { ok: false, error: auth.error, code: auth.code };

  const invite = await db.projectInvite.findUnique({
    where: { id: input.inviteId },
    select: { id: true, projectId: true, status: true, email: true },
  });
  if (!invite || invite.projectId !== input.projectId) {
    return { ok: false, error: "Invite not found.", code: "NOT_FOUND" };
  }
  if (invite.status !== "pending") {
    return { ok: false, error: `Invite is already ${invite.status}.`, code: "CONFLICT" };
  }

  await db.projectInvite.update({
    where: { id: input.inviteId },
    data:  { status: "cancelled" },
  });

  revalidatePath(`/projects/${input.projectId}/settings`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: input.projectId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "team.invite.cancelled",
    category: "team",
    result: "success",
    targetType: "invite",
    targetId: input.inviteId,
    targetLabel: maskEmail(invite.email),
    summary: `Invite cancelled for ${maskEmail(invite.email)}`,
    metadata: { inviteId: input.inviteId },
    ...ctx,
  });

  return { ok: true, data: { inviteId: input.inviteId } };
}

// ── acceptProjectInviteAction ──────────────────────────────────────────────────

/**
 * Accept a project invite (called by the invited user from the invite page).
 *
 * Security:
 *  - Requires a valid session (any logged-in user).
 *  - Session email must match the invite email.
 *  - Invite must be pending and not expired.
 *  - Idempotent: if the user is already a member, return success with their current role.
 */
export async function acceptProjectInviteAction(
  token: string,
): Promise<ActionResult<{ projectId: string; projectSlug: string; role: ProjectRole }>> {
  // Resolve the session user
  let userId: string;
  let userEmail: string;
  try {
    const user = await getCurrentUser();
    userId = user.id;
    userEmail = user.email.toLowerCase();
  } catch {
    return { ok: false, error: "Not authenticated.", code: "UNAUTHENTICATED" };
  }

  // Find the invite
  const invite = await db.projectInvite.findUnique({
    where: { token },
    include: {
      project: { select: { id: true, slug: true, workspaceId: true } },
    },
  });

  if (!invite) {
    return { ok: false, error: "Invite not found or link is invalid.", code: "NOT_FOUND" };
  }

  if (invite.status === "accepted") {
    // Already accepted — may be a retry; find their current membership
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.projectId, userId } },
      select: { role: true },
    });
    return {
      ok: true,
      data: {
        projectId:   invite.projectId,
        projectSlug: invite.project.slug,
        role:        (member?.role ?? invite.role) as ProjectRole,
      },
    };
  }

  if (invite.status !== "pending") {
    return {
      ok: false,
      error: `This invite has been ${invite.status} and can no longer be accepted.`,
      code: "GONE",
    };
  }

  if (invite.expiresAt < new Date()) {
    // Mark as expired
    await db.projectInvite.update({ where: { id: invite.id }, data: { status: "expired" } });
    return { ok: false, error: "This invite has expired.", code: "GONE" };
  }

  // Email must match
  if (invite.email.toLowerCase() !== userEmail) {
    return {
      ok: false,
      error:
        "This invite was sent to a different email address. " +
        "Please log in with the account that received the invite.",
      code: "FORBIDDEN",
    };
  }

  // Check if already a member (idempotent)
  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: invite.projectId, userId } },
    select: { role: true },
  });
  if (existing) {
    await db.projectInvite.update({
      where: { id: invite.id },
      data:  { status: "accepted", acceptedById: userId },
    });
    return {
      ok: true,
      data: {
        projectId:   invite.projectId,
        projectSlug: invite.project.slug,
        role:        existing.role as ProjectRole,
      },
    };
  }

  // Create membership + mark invite accepted (in a transaction)
  await db.$transaction([
    db.projectMember.create({
      data: {
        projectId: invite.projectId,
        userId,
        role: invite.role,
      },
    }),
    db.projectInvite.update({
      where: { id: invite.id },
      data:  { status: "accepted", acceptedById: userId },
    }),
  ]);

  revalidatePath(`/projects/${invite.projectId}/settings`);

  // Sprint 18: audit
  const ctx = await getAuditRequestContext();
  void writeProjectAuditEvent({
    projectId: invite.projectId,
    actorUserId: userId,
    action: "team.invite.accepted",
    category: "team",
    result: "success",
    targetType: "invite",
    targetId: invite.id,
    targetLabel: maskEmail(invite.email),
    summary: `Invite accepted — joined as ${invite.role}`,
    metadata: { role: invite.role, inviteId: invite.id },
    ...ctx,
  });

  return {
    ok: true,
    data: {
      projectId:   invite.projectId,
      projectSlug: invite.project.slug,
      role:        invite.role as ProjectRole,
    },
  };
}
