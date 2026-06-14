import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eye, ExternalLink } from "lucide-react";
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

      {/* URL bar — read only */}
      {project.liveUrl && (
        <div className="border-b bg-background px-4 py-2 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-md px-3 py-1.5 max-w-sm">
            <span className="text-xs text-muted-foreground font-mono truncate">
              {project.liveUrl}
            </span>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open
            </a>
          </Button>
        </div>
      )}

      {/* Preview area */}
      <div className="flex-1 bg-muted/30 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="h-16 w-16 rounded-2xl bg-muted mx-auto flex items-center justify-center mb-4">
            <Eye className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-1">Preview not available</h3>
          <p className="text-sm text-muted-foreground">
            {project.liveUrl
              ? "An embedded preview is not yet connected. Open the live URL in a new tab to view the project."
              : "No live URL is set for this project. Deploy it first, then set the URL in Settings."}
          </p>
          {project.liveUrl && (
            <Button className="mt-4" asChild>
              <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open live site
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
