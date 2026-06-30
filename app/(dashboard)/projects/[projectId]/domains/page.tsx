import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { db } from "@/lib/db";
import { DomainManager, type DomainRow } from "@/components/projects/domain-manager";
import { ProjectDomainCenter }            from "@/components/projects/project-domain-center";
import { DomainReadinessPanel }           from "@/components/projects/domain-readiness-panel";
import { runDomainHealthReport }          from "@/lib/domains/domain-health-runner";
import { AiImportAutopilotPanel }        from "@/components/projects/ai-import-autopilot-panel";

export const metadata: Metadata = { title: "Domains" };
export const dynamic = "force-dynamic";

const VPS_IP = process.env.VPS_IP ?? "178.105.105.59";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectDomainsPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  const [dbDeployConfig, rawDomains] = await Promise.all([
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
    db.domain.findMany({
      where:   { projectId },
      select: {
        id:              true,
        hostname:        true,
        isPrimary:       true,
        status:          true,
        sslStatus:       true,
        nginxConfigPath: true,
        targetPort:      true,
        lastError:       true,
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const primaryDomain = rawDomains.find((d) => d.isPrimary)?.hostname ?? rawDomains[0]?.hostname ?? null;

  const domains: DomainRow[] = rawDomains.map((d) => ({
    id:              d.id,
    hostname:        d.hostname,
    isPrimary:       d.isPrimary,
    status:          d.status    as DomainRow["status"],
    sslStatus:       d.sslStatus as DomainRow["sslStatus"],
    nginxConfigPath: d.nginxConfigPath,
    targetPort:      d.targetPort,
    lastError:       d.lastError,
  }));

  // Pre-run health checks server-side (non-blocking — page never crashes if checks fail)
  const initialReport = rawDomains.length > 0
    ? await runDomainHealthReport(
        projectId,
        rawDomains.map((d) => ({ id: d.id, hostname: d.hostname, isPrimary: d.isPrimary })),
      ).catch(() => null)
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Domains"
          description="Manage domains, check DNS and SSL health, and publish your app to a public URL."
        />

        <div className="space-y-8 max-w-2xl">
          {/* Sprint 88: AI Import Autopilot compact card */}
          <AiImportAutopilotPanel projectId={projectId} compact />

          {/* Sprint 47: Domain Readiness */}
          <DomainReadinessPanel projectId={projectId} primaryDomain={primaryDomain} />

          {/* Sprint 29: Domain + SSL Health Center */}
          <ProjectDomainCenter projectId={projectId} initialReport={initialReport} />

          <hr className="border-border" />

          {/* Existing domain publishing manager */}
          <DomainManager
            projectId={projectId}
            projectSlug={project.slug}
            port={dbDeployConfig?.port ?? 4100}
            vpsIp={VPS_IP}
            hasDeployConfig={!!dbDeployConfig}
            domains={domains}
          />
        </div>
      </DashboardShell>
    </div>
  );
}
