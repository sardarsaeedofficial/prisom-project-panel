import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectBackupsPanel } from "@/components/projects/project-backups-panel";
import { ProjectBackupSchedulePanel } from "@/components/projects/project-backup-schedule-panel";
import { DisasterRecoveryPanel } from "@/components/projects/disaster-recovery-panel";
import { getProjectById } from "@/lib/data/projects";
import { getOrCreateBackupSchedule } from "@/lib/backups/backup-schedule-service";

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
      </DashboardShell>
    </div>
  );
}
