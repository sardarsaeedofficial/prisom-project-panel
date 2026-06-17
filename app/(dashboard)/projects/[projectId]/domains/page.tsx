import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { db } from "@/lib/db";
import { DomainManager, type DomainRow } from "@/components/projects/domain-manager";

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

  const domains: DomainRow[] = rawDomains.map((d) => ({
    id:              d.id,
    hostname:        d.hostname,
    isPrimary:       d.isPrimary,
    status:          d.status  as DomainRow["status"],
    sslStatus:       d.sslStatus as DomainRow["sslStatus"],
    nginxConfigPath: d.nginxConfigPath,
    targetPort:      d.targetPort,
    lastError:       d.lastError,
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Domains"
          description="Publish your app to a public URL. Nginx and SSL are configured automatically."
        />

        <div className="max-w-2xl">
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
