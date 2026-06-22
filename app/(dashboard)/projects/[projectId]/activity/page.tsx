import type { Metadata }  from "next";
import { notFound }        from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }    from "@/components/projects/workspace-nav";
import { ProjectActivityTimeline } from "@/components/projects/project-activity-timeline";
import { getProjectById }  from "@/lib/data/projects";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectActivityPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Activity Timeline"
          description={`Unified event history for ${project.name} — deployments, operations, backups, jobs, and audit events.`}
        />
        <ProjectActivityTimeline projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
