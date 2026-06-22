import { requireAdmin }      from "@/lib/auth/require-admin";
import { AdminJobsPanel }   from "@/components/admin/admin-jobs-panel";
import Link                 from "next/link";
import { ChevronLeft }      from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdmin();

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Admin Console
          </Link>
        </div>

        <div>
          <h1 className="text-xl font-semibold">Background Jobs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor and manage scheduled background jobs across the platform.
          </p>
        </div>

        <AdminJobsPanel />
      </div>
    </main>
  );
}
