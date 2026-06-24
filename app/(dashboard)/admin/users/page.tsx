import { requireAdmin }     from "@/lib/auth/require-admin";
import { listUsers }         from "@/lib/auth/user-management";
import { AdminUsersPanel }   from "@/components/admin/admin-users-panel";
import { ShieldAlert }       from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await requireAdmin();
  const users = await listUsers().catch(() => []);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      {/* Sprint 59: Permission review note */}
      <div className="max-w-7xl mx-auto mb-4 rounded-lg border bg-card px-4 py-3 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Project permissions are managed per-project.</span>{" "}
          Global users listed here can exist without project access. Review each project&apos;s{" "}
          <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">Team</span> page to confirm
          deploy, cutover, and secret-write access is limited to trusted users before go-live.
        </p>
      </div>
      <AdminUsersPanel
        initialUsers={users}
        actorRole={actor.role}
        actorEmail={actor.email}
      />
    </main>
  );
}
