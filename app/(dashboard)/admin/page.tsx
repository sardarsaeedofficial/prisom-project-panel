import { requireAdmin }         from "@/lib/auth/require-admin";
import { runAdminHealthReport } from "@/lib/admin/admin-health-runner";
import { AdminConsole }         from "@/components/admin/admin-console";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const actor = await requireAdmin();

  const initialReport = await runAdminHealthReport().catch(() => null);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <AdminConsole
        initialReport={initialReport}
        actorEmail={actor.email}
        actorRole={actor.role}
      />
    </main>
  );
}
