import type { Metadata } from "next";
import { notFound }     from "next/navigation";
import { db }           from "@/lib/db";
import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav }           from "@/components/projects/workspace-nav";
import { ProjectOperationsPanel } from "@/components/projects/project-operations-panel";
import { DebugSummaryPanel }      from "@/components/projects/debug-summary-panel";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOperationsPage({ params }: Props) {
  const { projectId } = await params;

  // Lightweight query — matches the pattern used by monitoring, logs, and
  // other working project pages.  Avoids the heavy multi-join getProjectById
  // call that can throw if any eager-loaded relation has a schema/DB mismatch.
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Operation History"
          description={`Track deploys, backups, restores, and patch operations for ${project.name}. Active operations are shown in the banner above.`}
        />
        <DebugSummaryPanel projectId={projectId} compact context="operation" />
        <ProjectOperationsPanel projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
