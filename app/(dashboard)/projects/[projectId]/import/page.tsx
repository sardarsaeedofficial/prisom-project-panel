import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { AiImportAgentConsole }       from "@/components/projects/ai-import-agent-console";
import { AdvancedToolsSection }       from "@/components/projects/advanced-tools-section";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectImportPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  const existingConfig = await db.projectDeploymentConfig.findUnique({
    where: { projectId },
    select: { id: true },
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Import"
          description="One click to make your project live. I'll detect the stack, ask for what's missing, and handle the rest."
        />

        {/* Sprint 95: full-width workspace — no max-w constraint */}
        <AiImportAgentConsole projectId={projectId} />

        {/* Advanced tools below, constrained */}
        <div className="max-w-3xl mt-6">
          <AdvancedToolsSection
            projectId={projectId}
            projectSlug={project.slug}
            projectName={project.name}
            hasExistingConfig={!!existingConfig}
          />
        </div>
      </DashboardShell>
    </div>
  );
}
