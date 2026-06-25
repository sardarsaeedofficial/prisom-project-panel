import { requireAdmin }          from "@/lib/auth/require-admin";
import { runAdminFastSummary }   from "@/lib/admin/admin-health-runner";
import { AdminConsole }          from "@/components/admin/admin-console";
import { AdminOnboardingChecklist } from "@/components/admin/admin-onboarding-checklist";

// Must be dynamic for auth correctness (reads session cookie)
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const actor = await requireAdmin();

  // Only fast DB checks — PM2/disk/schedulers load client-side after mount
  const initialFastSummary = await runAdminFastSummary().catch(() => null);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      {/* Sprint 67: Admin onboarding checklist */}
      <div className="max-w-7xl mx-auto mb-6">
        <AdminOnboardingChecklist />
      </div>

      <AdminConsole
        initialFastSummary={initialFastSummary}
        actorEmail={actor.email}
        actorRole={actor.role}
      />
    </main>
  );
}
