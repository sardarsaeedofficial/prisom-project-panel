import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { AutoImportControlRoom } from "@/components/projects/auto-import-control-room";
import { db } from "@/lib/db";
import {
  resolveProjectLiveEndpoints,
  buildPreviewTarget,
} from "@/lib/projects/live-endpoint-resolver";
import { getPm2AppStatus } from "@/lib/projects/project-deploy-runner";
import { PreviewIframe } from "@/components/projects/preview-iframe";
import type { ProjectPreviewStatus } from "@/app/actions/project-preview";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectPreviewPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Fetch config for PM2 process name
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true },
  });

  // Resolve endpoints and PM2 status in parallel
  const [endpoints, pm2Raw] = await Promise.all([
    resolveProjectLiveEndpoints(projectId),
    config
      ? getPm2AppStatus(config.pm2Name).catch(() => null)
      : Promise.resolve(null),
  ]);

  const isOnline: boolean = pm2Raw?.status === "online";
  const target = buildPreviewTarget(projectId, endpoints, isOnline);

  const initialStatus: ProjectPreviewStatus = {
    pm2Status: pm2Raw?.status ?? null,
    pm2Name:   config?.pm2Name ?? null,
    isOnline,
    target,
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      {/* Sprint 86: Auto Import compact card */}
      <div className="flex-shrink-0 border-b px-4 py-2">
        <AutoImportControlRoom projectId={projectId} compact />
      </div>
      <PreviewIframe
        projectId={projectId}
        initialStatus={initialStatus}
        publishingHref={`/projects/${projectId}/publishing`}
        domainsHref={`/projects/${projectId}/domains`}
      />
    </div>
  );
}
