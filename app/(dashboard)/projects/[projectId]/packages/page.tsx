import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectPackagesPanel } from "@/components/projects/project-packages-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packages" };

type Props = { params: Promise<{ projectId: string }> };

export default async function PackagesPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="mb-4">
            <h1 className="text-xl font-semibold">Package Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Install, remove, and update packages. All operations use{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">--ignore-scripts</code>.
              Review Git changes and commit when satisfied.
            </p>
          </div>
          <ProjectPackagesPanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
