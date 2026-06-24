import type { Metadata } from "next";
import { notFound }      from "next/navigation";
import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav }                    from "@/components/projects/workspace-nav";
import { ReplitMigrationAssistant }           from "@/components/projects/replit-migration-assistant";
import { SourceIntakePanel }                  from "@/components/projects/source-intake-panel";
import { DebugSummaryPanel }                  from "@/components/projects/debug-summary-panel";
import { SardarMigrationRunbookPanel }        from "@/components/projects/sardar-migration-runbook-panel";
import { StagingImportPanel }                 from "@/components/projects/staging-import-panel";
import { DeploymentDryRunPanel }              from "@/components/projects/deployment-dry-run-panel";
import { ExternalServicesReadinessPanel }     from "@/components/projects/external-services-readiness-panel";
import { ProductionCutoverPanel }             from "@/components/projects/production-cutover-panel";
import { db }                                 from "@/lib/db";
import { isSardarProject }                    from "@/lib/migration/sardar-migration-types";

export const metadata: Metadata = { title: "Migration Assistant" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectMigrationPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  // Sprint 50: show Sardar runbook prominently when project is Sardar-related
  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Replit Migration Assistant"
          description="Analyze Replit-style projects and prepare them for VPS deployment with Prisom."
        />
        <div className="max-w-3xl space-y-6">
          {/* Sprint 57: Source Intake — compact card above migration panels */}
          <SourceIntakePanel projectId={projectId} compact />

          {/* Sprint 58: Debug failed migration/routing */}
          <DebugSummaryPanel projectId={projectId} compact context="routing" />

          {/* Sprint 55: Production Cutover — compact reference card */}
          <ProductionCutoverPanel projectId={projectId} compact />

          {/* Sprint 54: External Services — check Stripe/Cloudinary/Email before promotion */}
          <ExternalServicesReadinessPanel projectId={projectId} compact />

          {/* Sprint 53: Deployment dry run — run before promotion */}
          <DeploymentDryRunPanel projectId={projectId} compact />

          {/* Sprint 50: Sardar runbook + Sprint 51: Staging import — shown prominently for Sardar projects */}
          {isSardar ? (
            <>
              <StagingImportPanel projectId={projectId} />
              <SardarMigrationRunbookPanel projectId={projectId} />
            </>
          ) : (
            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground list-none flex items-center gap-1.5 py-1">
                <span className="text-xs border rounded px-2 py-0.5 group-open:bg-muted">
                  + Ecommerce migration (Sardar Security Supplies)
                </span>
              </summary>
              <div className="mt-2 space-y-4">
                <StagingImportPanel projectId={projectId} />
                <SardarMigrationRunbookPanel projectId={projectId} />
              </div>
            </details>
          )}

          <ReplitMigrationAssistant projectId={projectId} />
        </div>
      </DashboardShell>
    </div>
  );
}
