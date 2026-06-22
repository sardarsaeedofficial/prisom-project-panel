import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { db } from "@/lib/db";
import { isAdminRole } from "@/lib/auth/require-admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    // Middleware handles this redirect in most cases; this is a belt-and-braces check
    redirect("/login");
  }

  // Resolve user role for sidebar admin visibility
  let isAdmin = false;
  try {
    const user = await db.user.findFirst({
      where: { email: { equals: session.email, mode: "insensitive" } },
      select: { role: true },
    });
    isAdmin = isAdminRole(user?.role ?? null);
  } catch {
    // Non-fatal — sidebar Admin link simply won't show
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar user={{ name: session.name, email: session.email }} />
        {children}
      </div>
    </div>
  );
}
