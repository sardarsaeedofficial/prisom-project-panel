import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectFileBrowser } from "@/components/projects/file-browser";
import { getProjectFileRoot } from "@/lib/projects/file-manager";
import { getProjectAiBootstrapAction } from "@/app/actions/project-ai";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Files" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectFilesPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  // Check if this project has an editable source root.
  // If not, we fall through to an informational page.
  const rootResult = await getProjectFileRoot(projectId);
  const hasEditableRoot = rootResult.ok;

  // Check if AI assistant is configured (for the "Ask AI" button hint)
  const aiBootstrap = await getProjectAiBootstrapAction(projectId);
  const hasApiKey = aiBootstrap.ok && aiBootstrap.data?.hasApiKey;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />

      {hasEditableRoot ? (
        <ProjectFileBrowser
          projectId={projectId}
          projectName={project.name}
        />
      ) : (
        /* ── No editable source: informational fallback ── */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="rounded-full bg-muted/60 p-4">
            <svg
              className="h-8 w-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <div className="max-w-sm space-y-2">
            <h2 className="text-base font-semibold">No editable source found</h2>
            <p className="text-sm text-muted-foreground">
              {rootResult.ok === false ? rootResult.error :
                "This project does not have an editable source directory yet."}
            </p>
          </div>
          <div className="max-w-sm text-sm text-muted-foreground space-y-1">
            <p>To enable the file editor:</p>
            <ul className="list-disc list-inside text-left space-y-0.5">
              <li>Upload a project zip on the Import page, or</li>
              <li>Deploy the project once so a source directory is created.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
