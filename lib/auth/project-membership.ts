/**
 * lib/auth/project-membership.ts
 *
 * Sprint 17: Project membership resolution and permission enforcement.
 *
 * Server-only — do not import from "use client" files.
 *
 * Hotfix (Sprint 17): requireProjectPermission now wraps the ProjectMember-based
 * RBAC block in try/catch so that a missing ProjectMember table (schema migration
 * not yet applied with `pnpm prisma db push`) degrades gracefully.  When no role
 * can be resolved from the ProjectMember table, a workspace-ownership check is
 * used as a fallback — granting owner-level access only to the project's or
 * workspace's original owner.
 */

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-workspace";
import {
  hasPermission,
  type ProjectPermission,
  type ProjectRole,
} from "@/lib/auth/project-permissions";

// ── Result types ──────────────────────────────────────────────────────────────

export type MembershipContext = {
  ok: true;
  userId: string;
  projectId: string;
  role: ProjectRole;
};

export type MembershipError = {
  ok: false;
  error: string;
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";
};

export type MembershipResult = MembershipContext | MembershipError;

// ── Owner bootstrapping ───────────────────────────────────────────────────────

/**
 * Lazily create a ProjectMember row for the project's original owner so that
 * pre-Sprint 17 projects work without a data migration.
 *
 * Called internally by requireProjectPermission before every permission check.
 * Safe to call multiple times — uses upsert internally.
 */
export async function ensureProjectOwnerMembership(
  projectId: string,
  userId: string,
): Promise<void> {
  // Fast path: member record already exists
  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });
  if (existing) return;

  // Check whether this user owns the project or its workspace
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      workspace: { select: { ownerId: true } },
    },
  });
  if (!project) return;

  const isOwner =
    project.ownerId === userId || project.workspace.ownerId === userId;

  if (isOwner) {
    // Upsert so concurrent calls don't race
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role: "owner" },
      update: {}, // Already owner — don't downgrade
    });
  }
}

// ── Role lookup ───────────────────────────────────────────────────────────────

/**
 * Return the user's role in a project, or null if they have no membership.
 * Does NOT run ensureProjectOwnerMembership — call that first if needed.
 */
export async function getProjectRoleForUser(
  projectId: string,
  userId: string,
): Promise<ProjectRole | null> {
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return (member?.role as ProjectRole) ?? null;
}

// ── Permission enforcement ────────────────────────────────────────────────────

/**
 * Resolve the current session user's role and verify they hold `permission`
 * on the given project.
 *
 * Bootstraps owner membership lazily so pre-Sprint 17 projects don't need
 * a migration step.
 *
 * Returns MembershipContext (ok: true) or MembershipError (ok: false).
 * Never throws — all errors are returned as MembershipError.
 *
 * Resolution order:
 *  1. getCurrentUser() — resolves the current logged-in user (session or stub).
 *  2. ensureProjectOwnerMembership() — lazily seeds the owner ProjectMember row.
 *  3. getProjectRoleForUser() — reads the ProjectMember role.
 *  4. Workspace-ownership fallback — used when steps 2–3 fail or return null
 *     (e.g. ProjectMember table not yet created by `pnpm prisma db push`).
 *     Only grants access when the resolved user is the project/workspace owner.
 */
export async function requireProjectPermission(
  projectId: string,
  permission: ProjectPermission,
): Promise<MembershipResult> {
  // ── Step 1: resolve the current user ──────────────────────────────────────
  let userId: string;
  try {
    const user = await getCurrentUser();
    userId = user.id;
  } catch {
    return {
      ok: false,
      error: "Not authenticated.",
      code: "UNAUTHENTICATED",
    };
  }

  // ── Steps 2–3: ProjectMember-based RBAC ───────────────────────────────────
  // Wrapped in try/catch so that a missing ProjectMember table (schema not yet
  // applied with `pnpm prisma db push`) degrades to the fallback below.
  let role: ProjectRole | null = null;
  try {
    // Lazy-seed owner membership for pre-Sprint 17 projects
    await ensureProjectOwnerMembership(projectId, userId);
    // Fetch the user's role
    role = await getProjectRoleForUser(projectId, userId);
  } catch {
    // ProjectMember table does not exist yet — fall through to workspace check.
  }

  // ── Step 4: workspace-ownership fallback ──────────────────────────────────
  // Reached when: (a) ProjectMember table missing, (b) no member row yet
  // (ensureProjectOwnerMembership hasn't run or raced), or (c) user is not
  // a member at all (handled below as "Project not found.").
  if (!role) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        id:        true,
        ownerId:   true,
        workspace: { select: { ownerId: true } },
      },
    });

    if (!project) {
      return { ok: false, error: "Project not found.", code: "FORBIDDEN" };
    }

    const isOwner =
      project.ownerId === userId || project.workspace.ownerId === userId;

    if (!isOwner) {
      // User exists but has no membership and does not own the project.
      return { ok: false, error: "Project not found.", code: "FORBIDDEN" };
    }

    // Workspace / project owner is treated as full owner.
    role = "owner";
  }

  // ── Permission check ───────────────────────────────────────────────────────
  if (!hasPermission(role, permission)) {
    return {
      ok: false,
      error: `You do not have permission to perform this action (${permission}).`,
      code: "FORBIDDEN",
    };
  }

  return { ok: true, userId, projectId, role };
}

/**
 * Boolean variant of requireProjectPermission.
 * Useful for conditional server-side rendering. Does not throw.
 */
export async function hasProjectPermission(
  projectId: string,
  permission: ProjectPermission,
): Promise<boolean> {
  const result = await requireProjectPermission(projectId, permission);
  return result.ok;
}

// ── Team query helpers ────────────────────────────────────────────────────────

/**
 * Count how many owners a project has.
 * Used to prevent removing the last owner.
 */
export async function countProjectOwners(projectId: string): Promise<number> {
  return db.projectMember.count({
    where: { projectId, role: "owner" },
  });
}
