import type { Metadata } from "next";
import { notFound }     from "next/navigation";
import { db }           from "@/lib/db";
import Link             from "next/link";
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

        {/* Sprint 65: production apply/rollback audit note */}
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Production Cutover Audit: </span>
          All production apply and rollback requests from the{" "}
          <Link href={`/projects/${projectId}/releases`} className="text-primary hover:underline">
            Releases → Production Cutover Execution Guard
          </Link>{" "}
          are recorded as audit events (
          <code className="font-mono">production_execution.cutover_apply_requested</code>,{" "}
          <code className="font-mono">production_execution.rollback_requested</code>) and will appear in the operation history below.
        </div>

        <ProjectOperationsPanel projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
