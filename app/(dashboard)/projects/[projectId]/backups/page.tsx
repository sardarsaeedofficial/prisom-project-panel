import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectBackupsPanel } from "@/components/projects/project-backups-panel";
import { getProjectById } from "@/lib/data/projects";

export const metadata: Metadata = { title: "Backups" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectBackupsPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Backups & Snapshots"
          description={`Point-in-time backups of ${project.name} — restore source files to any previous snapshot.`}
        />
        <ProjectBackupsPanel projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
