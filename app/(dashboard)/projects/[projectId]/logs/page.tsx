import type { Metadata } from "next";
import { notFound }     from "next/navigation";
import { db }           from "@/lib/db";
import Link             from "next/link";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectLogsCenter } from "@/components/projects/project-logs-center";
import { discoverLogSources } from "@/lib/logs/project-log-sources";
import { DebugSummaryPanel } from "@/components/projects/debug-summary-panel";

export const metadata: Metadata = { title: "Logs" };
export const dynamic = "force-dynamic";

type Props = {
  params:       Promise<{ projectId: string }>;
  searchParams: Promise<{ source?: string }>;
};

export default async function ProjectLogsPage({ params, searchParams }: Props) {
  const { projectId }        = await params;
  const { source: sourceParam } = await searchParams;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  // Discover sources server-side so the initial render is populated
  // (crash-safe: if something fails we fall back to an empty list)
  const sources = await discoverLogSources(projectId).catch(() => []);

  // If the URL contains ?source=<id> (e.g. from the Operations panel "View logs"
  // link), pre-select that source.  Validate that the ID belongs to the
  // discovered source list to avoid client spoofing.
  const validSourceParam =
    sourceParam &&
    !sourceParam.includes("/") &&
    !sourceParam.includes("\\") &&
    sources.some((s) => s.id === sourceParam)
      ? sourceParam
      : undefined;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      {/* Sprint 65/66: smoke check and monitoring debug hints */}
      <div className="flex-shrink-0 border-b px-4 py-2 bg-background/95 space-y-1">
        <p className="text-xs text-muted-foreground">
          Debugging a production cutover smoke check failure?{" "}
          <Link href={`/projects/${projectId}/releases`} className="text-primary hover:underline">
            Production Cutover Execution Guard →
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">
          Post-cutover production health issues?{" "}
          <Link href={`/projects/${projectId}/monitoring`} className="text-primary hover:underline">
            Post-Cutover Monitoring Control Room →
          </Link>
          {" "}Check nginx error logs (<code className="font-mono text-xs">sudo tail -f /var/log/nginx/error.log</code>) and PM2 logs below.
        </p>
      </div>

      {/* Debug summary panel — collapsible, sits above the logs viewer */}
      <div className="flex-shrink-0 border-b px-4 py-3 bg-background/95">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
            Debug Summary — Analyze Failures
          </summary>
          <div className="mt-3 max-w-3xl">
            <DebugSummaryPanel projectId={projectId} />
          </div>
        </details>
      </div>
      <div className="flex-1 overflow-hidden">
        <ProjectLogsCenter
          projectId={projectId}
          initialSources={sources}
          initialSelectedId={validSourceParam}
        />
      </div>
    </div>
  );
}
