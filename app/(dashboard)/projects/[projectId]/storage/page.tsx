import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { ProjectStorageCenter }       from "@/components/projects/project-storage-center";
import { getProjectById }             from "@/lib/data/projects";

export const metadata: Metadata = { title: "Storage" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectStoragePage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Storage Center"
          description={`Disk usage, retention policy, and cleanup tools for ${project.name}.`}
        />
        <ProjectStorageCenter projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
