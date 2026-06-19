import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectAuditPanel } from "@/components/projects/project-audit-panel";
import { getProjectById } from "@/lib/data/projects";

export const metadata: Metadata = { title: "Audit Log" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectAuditPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Audit Log"
          description={`Complete activity history for ${project.name} — who did what, when, and whether it succeeded.`}
        />
        <ProjectAuditPanel projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
