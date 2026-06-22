import { redirect }          from "next/navigation";
import { getSession }         from "@/lib/session";
import { Sidebar }            from "@/components/layout/sidebar";
import { TopBar }             from "@/components/layout/topbar";
import { CommandPalette }     from "@/components/navigation/command-palette";
import { getCurrentUser }     from "@/lib/current-workspace";
import { isAdminRole }        from "@/lib/auth/require-admin";

// Force dynamic so the session cookie is read — and the sidebar Admin link
// appears — on every request rather than being frozen in a cached render.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Use the same getCurrentUser() path as requireAdmin() so both the sidebar
  // and /admin page agree on who is logged in.
  let isAdmin = false;
  try {
    const user = await getCurrentUser();
    isAdmin = isAdminRole(user.role);
  } catch {
    // Non-fatal — sidebar Admin link won't show
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar user={{ name: session.name, email: session.email }} />
        {children}
      </div>
      {/* Command palette — fixed overlay, Ctrl/Cmd+K or search button */}
      <CommandPalette isAdmin={isAdmin} />
    </div>
  );
}
