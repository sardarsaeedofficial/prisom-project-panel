import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectSecretsVault }             from "@/components/projects/project-secrets-vault";
import { EnvReadinessPanel }               from "@/components/projects/env-readiness-panel";
import { ExternalServicesReadinessPanel }  from "@/components/projects/external-services-readiness-panel";
import { db }                              from "@/lib/db";

export const metadata: Metadata = { title: "Secrets Vault" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectSecretsPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Secrets Vault"
          description="Manage encrypted secrets and environment variables. Values are encrypted at rest and never exposed in logs, backups, or exports."
        />
        {/* Sprint 46: Environment Readiness + Sprint 54: External Services */}
        <div className="space-y-6 max-w-3xl mb-6">
          <EnvReadinessPanel projectId={projectId} />
          <ExternalServicesReadinessPanel projectId={projectId} />
        </div>
        <ProjectSecretsVault projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
