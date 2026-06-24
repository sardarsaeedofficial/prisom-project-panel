import { requireAdmin }      from "@/lib/auth/require-admin";
import { AdminJobsPanel }   from "@/components/admin/admin-jobs-panel";
import Link                 from "next/link";
import { ChevronLeft, Bug, ExternalLink } from "lucide-react";

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

        {/* Debug entry point — job failures can be investigated per-project */}
        <div className="rounded-lg border bg-card px-4 py-3 flex items-start gap-2.5">
          <Bug className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Debug failed jobs:</span>{" "}
            Open a project&apos;s{" "}
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">Operations</span>{" "}
            or{" "}
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">Logs</span>{" "}
            page to analyze failure output, classify errors, and export a debug bundle.
          </div>
        </div>

        <AdminJobsPanel />
      </div>
    </main>
  );
}
