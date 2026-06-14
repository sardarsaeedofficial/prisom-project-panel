import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eye, Monitor, Tablet, Smartphone, ExternalLink, RefreshCw } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectPreviewPage({ params }: Props) {
  const { projectId } = await params;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, liveUrl: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />

      {/* Preview toolbar */}
      <div className="border-b bg-background px-4 py-2 flex items-center gap-2">
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Monitor className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Tablet className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Smartphone className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 mx-4">
          <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-1.5 max-w-sm">
            <span className="text-xs text-muted-foreground font-mono truncate">
              {project.liveUrl ?? "http://localhost:3000"}
            </span>
          </div>
        </div>
        <div className="flex gap-1 ml-auto">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {project.liveUrl && (
            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
              <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Preview area */}
      {/* TODO: Render live preview in iframe once project runtime is connected */}
      <div className="flex-1 bg-muted/30 flex items-center justify-center">
        <div className="text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted mx-auto flex items-center justify-center mb-4">
            <Eye className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-1">Live Preview</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            {project.liveUrl
              ? "Preview will load once the project runtime is connected."
              : "Deploy your project to see a live preview here."}
          </p>
          {project.liveUrl && (
            <Button className="mt-4" asChild>
              <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in new tab
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
