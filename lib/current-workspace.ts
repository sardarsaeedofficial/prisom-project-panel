/**
 * lib/current-workspace.ts
 *
 * Resolves the current user and workspace from the active session.
 *
 * Sprint 17 update: session-aware. When called inside a request context
 * (Server Component / Server Action) the session cookie is read to identify
 * the real logged-in user. When called outside a request context (scheduler
 * background tasks, seed scripts, build phase) the original single-user stub
 * behaviour is preserved as a fallback.
 *
 * Do NOT replace with NextAuth / Clerk — the session system in lib/session.ts
 * is intentional and must remain unchanged.
 */

import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function getCurrentUser() {
  // ── Sprint 17: session-based lookup ──────────────────────────────────────
  try {
    // Dynamic import so this file remains importable outside request contexts
    // (the `next/headers` module throws when accessed outside a request).
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (session?.email) {
      const user = await db.user.findUnique({ where: { email: session.email } });
      if (user) return user;
      // Session is present but references an unknown email — treat as unauthenticated.
      throw new Error("Session references an unknown user email.");
    }
  } catch (err) {
    // Re-throw real auth errors so callers see "Not authenticated."
    if (
      err instanceof Error &&
      err.message === "Session references an unknown user email."
    ) {
      throw err;
    }
    // Otherwise we're outside a request context — fall through to stub.
  }

  // ── Fallback: single-user / non-request context ───────────────────────────
  // Used by the background scheduler, seed scripts, and legacy code paths that
  // run before sessions are available.
  const user = await db.user.findFirst({
    where: { role: UserRole.OWNER },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    throw new Error(
      "No owner user found. Run: pnpm prisma db push && pnpm prisma db seed"
    );
  }
  return user;
}

export async function getCurrentWorkspace() {
  const user = await getCurrentUser();
  const workspace = await db.workspace.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!workspace) {
    throw new Error(
      "No workspace found. Run: pnpm prisma db push && pnpm prisma db seed"
    );
  }
  return workspace;
}

export async function getCurrentWorkspaceId(): Promise<string> {
  const ws = await getCurrentWorkspace();
  return ws.id;
}
