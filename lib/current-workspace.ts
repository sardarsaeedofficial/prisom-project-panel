// Temporary auth stub — queries the DB for the seeded OWNER user + workspace.
// Replace with real session-based auth (NextAuth / Clerk) before adding multi-user support.
import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function getCurrentUser() {
  const user = await db.user.findFirst({
    where: { role: UserRole.OWNER },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    throw new Error(
      "No owner user found. Run: npm run db:push && npm run db:seed"
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
      "No workspace found. Run: npm run db:push && npm run db:seed"
    );
  }
  return workspace;
}

export async function getCurrentWorkspaceId(): Promise<string> {
  const ws = await getCurrentWorkspace();
  return ws.id;
}
