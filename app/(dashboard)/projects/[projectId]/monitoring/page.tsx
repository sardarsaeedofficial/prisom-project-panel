import type { Metadata } from "next";
import { notFound }      from "next/navigation";

import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { db }                          from "@/lib/db";
import { ProjectMonitoringPanel }      from "@/components/projects/project-monitoring-panel";

export const metadata: Metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectMonitoringPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Monitoring"
          description="On-demand observability snapshot for this project. Read-only — no actions are performed."
        />

        <div className="max-w-3xl">
          <Card>
            <CardContent className="pt-5 pb-5">
              <ProjectMonitoringPanel
                projectId={projectId}
                projectSlug={project.slug}
              />
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    </div>
  );
}
