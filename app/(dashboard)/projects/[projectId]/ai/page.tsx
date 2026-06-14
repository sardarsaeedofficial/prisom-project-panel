import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrCreateDefaultSession } from "@/lib/data/workspace-modules";
import { AiChat } from "@/components/workspace/ai-chat";
import { WorkspaceNav } from "@/components/projects/workspace-nav";

export const metadata: Metadata = { title: "AI Assistant" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectAiPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const { session, messages } = await getOrCreateDefaultSession(projectId);

  // Convert to plain objects with ISO strings so they serialise safely
  const initialMessages = messages.map((m) => ({
    id: m.id,
    role: m.role as string,
    content: m.content,
    createdAt:
      m.createdAt instanceof Date
        ? m.createdAt.toISOString()
        : String(m.createdAt),
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <AiChat
        projectId={projectId}
        session={{ id: session.id, title: session.title }}
        initialMessages={initialMessages}
      />
    </div>
  );
}
