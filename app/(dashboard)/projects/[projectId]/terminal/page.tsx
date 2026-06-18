import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectTerminal } from "@/components/projects/project-terminal";
import { getProjectTerminalBootstrapAction } from "@/app/actions/project-terminal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terminal" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectTerminalPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Bootstrap terminal context server-side for instant load
  const bootstrapResult = await getProjectTerminalBootstrapAction(projectId);

  if (!bootstrapResult.ok || !bootstrapResult.data) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <WorkspaceNav projectId={projectId} />
        <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {bootstrapResult.ok ? "No terminal context available." : (bootstrapResult as { ok: false; error: string }).error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <ProjectTerminal
        projectId={projectId}
        bootstrap={bootstrapResult.data}
      />
    </div>
  );
}
