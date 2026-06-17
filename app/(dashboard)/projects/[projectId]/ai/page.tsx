import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectAiBootstrapAction } from "@/app/actions/project-ai";
import { ProjectAiAssistant } from "@/components/projects/project-ai-assistant";
import { WorkspaceNav } from "@/components/projects/workspace-nav";

export const metadata: Metadata = { title: "AI Assistant" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectAiPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Pre-fetch bootstrap info server-side so the client component renders
  // without a loading flash (ownership is also verified here).
  const bootstrapResult = await getProjectAiBootstrapAction(projectId);
  const initialInfo = bootstrapResult.ok && bootstrapResult.data
    ? bootstrapResult.data
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <ProjectAiAssistant
        projectId={projectId}
        initialInfo={initialInfo}
      />
    </div>
  );
}
