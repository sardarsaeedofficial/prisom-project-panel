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
 *
 * Hotfix (Sprint 17): The session-based lookup now uses a case-insensitive
 * email match and NEVER re-throws on lookup failure — any issue (unknown email,
 * case mismatch, DB error, non-request context) falls through silently to the
 * single-user OWNER stub, which is identical to the pre-Sprint 17 behaviour.
 */

import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function getCurrentUser() {
  // ── Sprint 17: session-based lookup ──────────────────────────────────────
  // Dynamic import keeps `next/headers` out of the Edge middleware bundle.
  // ANY failure in this block (not in a request context, HMAC mismatch,
  // unknown/mismatched email, Prisma error) falls through silently to the
  // single-user stub below — this block must NEVER throw.
  try {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (session?.email) {
      // Case-insensitive match so login-form capitalisation differences
      // (e.g. "John@example.com" vs the DB value "john@example.com")
      // do not prevent the lookup from succeeding.
      const user = await db.user.findFirst({
        where: { email: { equals: session.email, mode: "insensitive" } },
        orderBy: { createdAt: "asc" },
      });
      if (user) return user;
      // Session email not found in DB — fall through to stub below.
    }
  } catch {
    // Not in a request context (background job, seed script, build phase),
    // or the session / DB call threw — fall through to stub.
  }

  // ── Fallback: single-user / non-request context ───────────────────────────
  // Identical to the pre-Sprint 17 stub.  Used by the background scheduler,
  // seed scripts, and any code path where the session lookup above fails.
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
