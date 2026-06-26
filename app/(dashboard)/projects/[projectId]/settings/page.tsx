import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus, Eye, BookOpen } from "lucide-react";
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
import { OperatorRunbookPanel }          from "@/components/projects/operator-runbook-panel";
import { ProjectProfileCard }            from "@/components/projects/project-profile-card";
import { ProjectTemplateSelector }       from "@/components/projects/project-template-selector";
import { LaunchSignoffPanel }            from "@/components/projects/launch-signoff-panel";
import { OperatorTrainingPanel }         from "@/components/projects/operator-training-panel";
import { CutoverRehearsalPanel }         from "@/components/projects/cutover-rehearsal-panel";
import { LaunchFreezePanel }             from "@/components/projects/launch-freeze-panel";
import { LaunchDaySupportPanel }         from "@/components/projects/launch-day-support-panel";
import { PostLaunchBugCapturePanel }     from "@/components/projects/post-launch-bug-capture-panel";
import { FinalReadinessAuditPanel }      from "@/components/projects/final-readiness-audit-panel";
import { StopBuildGatePanel }           from "@/components/projects/stop-build-gate-panel";
import { DeployVerificationPanel }      from "@/components/projects/deploy-verification-panel";
import { LaunchExecutionChecklistPanel } from "@/components/projects/launch-execution-checklist-panel";
import { FinalLiveVerificationPanel }    from "@/components/projects/final-live-verification-panel";
import { GoNoGoEvidencePanel }           from "@/components/projects/go-no-go-evidence-panel";
import { HelpCenterPanel }               from "@/components/projects/help-center-panel";
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
          {/* Sprint 71: Project Migration Profile */}
          <div className="max-w-2xl">
            <ProjectProfileCard projectId={projectId} />
          </div>

          {/* Sprint 72: Migration template selector */}
          <div className="max-w-2xl">
            <ProjectTemplateSelector projectId={projectId} compact />
          </div>

          {/* Sprint 74–76: Signoff, Training, Rehearsal, Freeze, Launch-Day, Bug Capture compact cards */}
          <div className="max-w-2xl space-y-3">
            <LaunchSignoffPanel projectId={projectId} compact />
            <OperatorTrainingPanel projectId={projectId} compact />
            <CutoverRehearsalPanel projectId={projectId} compact />
            <LaunchFreezePanel projectId={projectId} compact />
            <LaunchDaySupportPanel projectId={projectId} compact />
            <PostLaunchBugCapturePanel projectId={projectId} compact />
            {/* Sprint 77: Final Readiness Audit + Stop-Build Gate compact cards */}
            <FinalReadinessAuditPanel projectId={projectId} compact />
            <StopBuildGatePanel projectId={projectId} compact />
            {/* Sprint 78: Deploy Verification + Launch Execution compact cards */}
            <DeployVerificationPanel projectId={projectId} compact />
            <LaunchExecutionChecklistPanel projectId={projectId} compact />
            {/* Sprint 79: Final Live Verification + Go/No-Go Evidence compact cards */}
            <FinalLiveVerificationPanel projectId={projectId} compact />
            <GoNoGoEvidencePanel projectId={projectId} compact />
            {/* Sprint 81: Help Center compact card */}
            <HelpCenterPanel projectId={projectId} compact />
          </div>

          <ProjectSettingsForm projectId={projectId} initialValues={formValues} />

          {/* Sprint 67: Project Operations Guide */}
          <Card className="max-w-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Project Operations Guide</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Key operational pages for this project — monitoring, team, backups, and runbook.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: "Operator Runbook",          href: `/projects/${projectId}/runbook` },
                { label: "Team & Permissions",        href: `/projects/${projectId}/team` },
                { label: "Backups",                   href: `/projects/${projectId}/backups` },
                { label: "Monitoring",                href: `/projects/${projectId}/monitoring` },
                { label: "Logs",                      href: `/projects/${projectId}/logs` },
                { label: "Final Go-Live Control Room", href: `/projects/${projectId}/releases` },
              ].map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors py-1"
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </Link>
              ))}
            </CardContent>
          </Card>

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
