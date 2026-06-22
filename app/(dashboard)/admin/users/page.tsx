import { requireAdmin }     from "@/lib/auth/require-admin";
import { listUsers }         from "@/lib/auth/user-management";
import { AdminUsersPanel }   from "@/components/admin/admin-users-panel";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await requireAdmin();
  const users = await listUsers().catch(() => []);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <AdminUsersPanel
        initialUsers={users}
        actorRole={actor.role}
        actorEmail={actor.email}
      />
    </main>
  );
}
