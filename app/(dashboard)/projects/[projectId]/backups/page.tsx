import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectBackupsPanel } from "@/components/projects/project-backups-panel";
import { ProjectBackupSchedulePanel } from "@/components/projects/project-backup-schedule-panel";
import { DisasterRecoveryPanel } from "@/components/projects/disaster-recovery-panel";
import { getProjectById } from "@/lib/data/projects";
import { getOrCreateBackupSchedule } from "@/lib/backups/backup-schedule-service";
import Link from "next/link";
import { Trophy } from "lucide-react";

export const metadata: Metadata = { title: "Backups" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectBackupsPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  // Pre-load schedule (non-blocking — page never crashes if this fails)
  const initialSchedule = await getOrCreateBackupSchedule(projectId).catch(() => null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Backups & Snapshots"
          description={`Point-in-time backups of ${project.name} — restore source files to any previous snapshot.`}
        />

        {/* Sprint 30: Scheduled backup configuration */}
        <div className="mb-8 max-w-2xl">
          <ProjectBackupSchedulePanel
            projectId={projectId}
            initialSchedule={initialSchedule}
          />
        </div>

        <hr className="border-border mb-6" />

        {/* Existing manual backups panel */}
        <ProjectBackupsPanel projectId={projectId} />

        <hr className="border-border my-8" />

        {/* Sprint 60: Disaster Recovery Drill */}
        <div className="max-w-3xl">
          <DisasterRecoveryPanel projectId={projectId} />
        </div>

        {/* Sprint 63: Final Go-Live Gate note */}
        <div className="max-w-3xl mt-6">
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Trophy className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Final Go-Live Gate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The Final Go-Live Gate (Releases page) requires a completed backup/restore drill.
                Complete <strong>MARK DRILL COMPLETE</strong> above before generating the gate report.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/releases`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Releases →
            </Link>
          </div>
        </div>
      </DashboardShell>
    </div>
  );
}
