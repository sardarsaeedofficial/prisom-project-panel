import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageOpen, ChevronDown } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { ReplitImportWizard }         from "@/components/projects/replit-import-wizard";
import { DbMigrationPanel }           from "@/components/projects/db-migration-panel";
import { SourceIntakePanel }          from "@/components/projects/source-intake-panel";
import { SmartImportPanel }           from "@/components/projects/smart-import-panel";
import { AutoImportControlRoom }      from "@/components/projects/auto-import-control-room";
import { AiImportOperatorPanel }      from "@/components/projects/ai-import-operator-panel";
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
          {/* ── Sprint 87: AI Import Operator — primary interface ── */}
          <AiImportOperatorPanel projectId={projectId} />

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
