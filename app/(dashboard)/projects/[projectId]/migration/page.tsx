import type { Metadata } from "next";
import { notFound }      from "next/navigation";
import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { ReplitMigrationAssistant }   from "@/components/projects/replit-migration-assistant";
import { db }                         from "@/lib/db";

export const metadata: Metadata = { title: "Migration Assistant" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectMigrationPage({ params }: Props) {
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
          title="Replit Migration Assistant"
          description="Analyze Replit-style projects and prepare them for VPS deployment with Prisom."
        />
        <div className="max-w-3xl">
          <ReplitMigrationAssistant projectId={projectId} />
        </div>
      </DashboardShell>
    </div>
  );
}
