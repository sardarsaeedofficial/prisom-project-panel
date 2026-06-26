import type { Metadata } from "next";
import { notFound }      from "next/navigation";
import { db }            from "@/lib/db";
import {
  DashboardShell,
  PageHeader,
}                        from "@/components/layout/dashboard-shell";
import { WorkspaceNav }  from "@/components/projects/workspace-nav";
import { ContextualHelpCard } from "@/components/projects/contextual-help-card";
import { HelpCenterPanel }    from "@/components/projects/help-center-panel";
import { HelpSearchPanel }    from "@/components/projects/help-search-panel";

export const metadata: Metadata = { title: "Help Center" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectHelpPage({ params }: Props) {
  const { projectId } = await params;

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
          title="Project Help Center"
          description="Living README and knowledge base for this project. Read-only — no secrets exposed, no production mutation."
        />

        <div className="max-w-3xl space-y-5">
          {/* Context card */}
          <ContextualHelpCard
            purpose="Generate a searchable knowledge base, explore file inventory, search project documentation, and ask questions about the panel codebase."
            doHere="Generate Knowledge Base. Export PROJECT_KNOWLEDGE_BASE.md, PROJECT_FILE_INVENTORY.md, PROJECT_METHODS_AND_RESOURCES.md. Search sections. Ask questions."
            dontDo="Do not use this page to deploy, restart PM2, change DNS, or run migrations. This page is documentation and search only."
            nextPage={{ label: "Releases (go-live)", href: `/projects/${projectId}/releases` }}
          />

          {/* Help Center Panel — generate + export */}
          <HelpCenterPanel projectId={projectId} />

          {/* Search & Ask Panel */}
          <HelpSearchPanel projectId={projectId} />
        </div>
      </DashboardShell>
    </div>
  );
}
