/**
 * lib/auth/require-admin.ts
 *
 * Sprint 31: Global admin guard.
 *
 * Uses the existing UserRole enum from Prisma — OWNER and ADMIN roles
 * are granted admin-console access. MEMBER is denied.
 *
 * Server-only — never import from client components.
 */

import { redirect }        from "next/navigation";
import { UserRole }        from "@prisma/client";
import { getCurrentUser }  from "@/lib/current-workspace";

export type AdminContext = {
  userId: string;
  email:  string;
  name:   string;
  role:   UserRole;
};

/**
 * Returns the current user if they are OWNER or ADMIN.
 * Redirects to /dashboard if not authenticated or not admin.
 * Never throws — all errors redirect.
 */
export async function requireAdmin(): Promise<AdminContext> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    redirect("/login");
  }

  if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  return {
    userId: user.id,
    email:  user.email,
    name:   user.name,
    role:   user.role,
  };
}

/**
 * Returns true if the given UserRole grants admin-console access.
 * Used by the sidebar to conditionally show the Admin link.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === UserRole.OWNER || role === UserRole.ADMIN;
}
