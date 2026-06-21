import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { ProjectOperationsPanel }     from "@/components/projects/project-operations-panel";
import { getProjectById }             from "@/lib/data/projects";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOperationsPage({ params }: Props) {
  const { projectId } = await params;
  const project       = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Operation History"
          description={`Track deploys, backups, restores, and patch operations for ${project.name}. Active operations are shown in the banner above.`}
        />
        <ProjectOperationsPanel projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
