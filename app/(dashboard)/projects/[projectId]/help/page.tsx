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
          description="Living README, operator SOPs, troubleshooting playbooks, and deep project map. Read-only — no secrets exposed, no production mutation."
        />

        <div className="max-w-3xl space-y-5">
          {/* Context card */}
          <ContextualHelpCard
            purpose="Generate complete project documentation including knowledge base, deep project map, operator SOPs, and troubleshooting playbooks. Search or ask questions from the generated content."
            doHere="Click 'Generate All Documentation'. Browse the Sections, Deep Map, SOPs, Troubleshooting, and Exports tabs. Download all 6 documentation exports. Use Search and Ask for quick answers."
            dontDo="This page is read-only documentation only. Do not use it to deploy, restart PM2, change DNS, reload nginx, run DB migrations, or expose secrets."
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
