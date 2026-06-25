import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectTeamPanel } from "@/components/projects/project-team-panel";
import { ProjectPermissionPolicyPanel } from "@/components/projects/project-permission-policy-panel";
import { TeamPermissionReviewChecklist } from "@/components/projects/team-permission-review-checklist";
import { getProjectById } from "@/lib/data/projects";
import Link from "next/link";
import { Trophy } from "lucide-react";

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

          {/* Sprint 63: Final Go-Live Gate note */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Trophy className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Final Go-Live Gate</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The Final Go-Live Gate (Releases page) requires a completed team permission review.
                Complete the review checklist above before generating the gate report.
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
