import type { Metadata }   from "next";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { NotificationsCenter }        from "@/components/notifications/notifications-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <DashboardShell>
        <PageHeader
          title="Notifications"
          description="Job failures, backup results, alerts, and other important events."
        />
        <NotificationsCenter />
      </DashboardShell>
    </main>
  );
}
