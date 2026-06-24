import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectTeamPanel } from "@/components/projects/project-team-panel";
import { ProjectPermissionPolicyPanel } from "@/components/projects/project-permission-policy-panel";
import { TeamPermissionReviewChecklist } from "@/components/projects/team-permission-review-checklist";
import { getProjectById } from "@/lib/data/projects";

export const metadata: Metadata = { title: "Team" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectTeamPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Team"
          description={`Manage team members and permissions for ${project.name}`}
        />
        <ProjectTeamPanel projectId={projectId} />

        {/* Sprint 59: Permission hardening + review checklist */}
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border bg-card p-4">
            <ProjectPermissionPolicyPanel projectId={projectId} />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <TeamPermissionReviewChecklist projectId={projectId} />
          </div>
        </div>
      </DashboardShell>
    </div>
  );
}
