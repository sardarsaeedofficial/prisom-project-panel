import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus, Eye } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProjectSettingsForm, type ProjectFormValues } from "@/components/projects/project-settings-form";
import { getProjectById } from "@/lib/data/projects";

export const metadata: Metadata = { title: "Settings" };

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectSettingsPage({ params }: Props) {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  if (!project) notFound();

  const formValues: ProjectFormValues = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description ?? "",
    type: project.type,
    visibility: project.visibility,
    language: project.language ?? "",
    framework: project.framework ?? "",
    liveUrl: project.liveUrl ?? "",
    installCommand: project.installCommand ?? "",
    buildCommand: project.buildCommand ?? "",
    startCommand: project.startCommand ?? "",
    outputDirectory: project.outputDirectory ?? "",
    defaultBranch: project.githubRepository?.defaultBranch ?? "main",
    hasGithubRepo: !!project.githubRepository,
  };

  // Collect secrets across environments (keys only — values are encrypted)
  const envSecrets = project.environments.flatMap((env) =>
    env.secrets.map((s) => ({ ...s, envName: env.name }))
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader title="Settings" description={`Configure ${project.name}`} />

        <div className="space-y-8">
          <ProjectSettingsForm projectId={projectId} initialValues={formValues} />

          {/* Environment variables (read-only display in this phase) */}
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Environment Variables</CardTitle>
                  <CardDescription className="mt-1">
                    Values are encrypted at rest. Manage them per environment.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" disabled>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {envSecrets.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">
                  No secrets configured yet.
                </p>
              ) : (
                <div className="divide-y">
                  {envSecrets.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-6 py-3">
                      <code className="text-xs font-mono w-48 shrink-0 text-foreground">
                        {s.key}
                      </code>
                      <span className="text-xs text-muted-foreground capitalize">
                        {s.envName.toLowerCase()}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <Input
                          value={"•".repeat(16)}
                          type="password"
                          className="h-8 text-xs font-mono"
                          readOnly
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    </div>
  );
}
