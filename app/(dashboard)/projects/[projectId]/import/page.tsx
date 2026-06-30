import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { AiImportAutopilotPanel }     from "@/components/projects/ai-import-autopilot-panel";
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

        <div className="space-y-6 max-w-3xl">
          {/* ── Sprint 88: AI Import Autopilot — primary interface ── */}
          <AiImportAutopilotPanel projectId={projectId} />

          {/* ── Advanced tools — collapsed by default ── */}
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
