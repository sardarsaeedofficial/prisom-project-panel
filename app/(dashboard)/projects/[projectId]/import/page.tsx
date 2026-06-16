import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageOpen } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ReplitImportWizard } from "@/components/projects/replit-import-wizard";
import { DbMigrationPanel } from "@/components/projects/db-migration-panel";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Import from Replit" };
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
          title="Import from Replit"
          description="Migrate your Replit project — code, database, media, and secrets — into Prisom Project Manager."
        />

        <div className="space-y-8 max-w-2xl">
          {/* ── Import wizard ── */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <PackageOpen className="h-4 w-4" />
              Import Wizard
            </h2>
            <ReplitImportWizard
              projectId={projectId}
              projectSlug={project.slug}
              projectName={project.name}
              hasExistingConfig={!!existingConfig}
            />
          </section>

          {/* ── DB migration ── */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Database Migration
            </h2>
            <DbMigrationPanel projectId={projectId} />
          </section>
        </div>
      </DashboardShell>
    </div>
  );
}
