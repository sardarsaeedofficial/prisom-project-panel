import type { Metadata }  from "next";
import Link                from "next/link";
import { ChevronLeft }     from "lucide-react";
import { requireAdmin }    from "@/lib/auth/require-admin";
import { AdminActivityFeed } from "@/components/admin/admin-activity-feed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity Feed" };

export default async function AdminActivityPage() {
  await requireAdmin();

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto space-y-5">
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
          <h1 className="text-xl font-semibold">Activity Feed</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Global activity across all projects — deployments, operations, jobs, backups, and audit events.
          </p>
        </div>

        <AdminActivityFeed />
      </div>
    </main>
  );
}
