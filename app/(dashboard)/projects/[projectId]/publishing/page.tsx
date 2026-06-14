import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  ExternalLink,
  GitBranch,
  GitCommit,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateDeploymentForm } from "@/components/workspace/create-deployment-form";
import {
  getProjectDeployments,
  getProjectEnvironments,
} from "@/lib/data/workspace-modules";
import { updateDeploymentStatusAction } from "@/app/actions/workspace-modules";
import { db } from "@/lib/db";
import { DeploymentStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Publishing" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

// ── Status UI ─────────────────────────────────────────────────────────────────

type StatusMeta = {
  icon: React.ReactNode;
  label: string;
  variant: "success" | "warning" | "error" | "secondary";
};

const STATUS_META: Record<DeploymentStatus, StatusMeta> = {
  SUCCESS: {
    icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    label: "Success",
    variant: "success",
  },
  FAILED: {
    icon: <XCircle className="h-4 w-4 text-red-500" />,
    label: "Failed",
    variant: "error",
  },
  CANCELLED: {
    icon: <Ban className="h-4 w-4 text-muted-foreground" />,
    label: "Cancelled",
    variant: "secondary",
  },
  PENDING: {
    icon: <Clock className="h-4 w-4 text-muted-foreground" />,
    label: "Pending",
    variant: "secondary",
  },
  QUEUED: {
    icon: <Clock className="h-4 w-4 text-yellow-500" />,
    label: "Queued",
    variant: "warning",
  },
  BUILDING: {
    icon: <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />,
    label: "Building",
    variant: "warning",
  },
};

const TERMINAL_STATUSES: DeploymentStatus[] = [
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.CANCELLED,
];

const SELECT_CLASS =
  "rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

function formatRelative(date: Date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function ProjectPublishingPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, liveUrl: true },
  });
  if (!project) notFound();

  const [deployments, environments] = await Promise.all([
    getProjectDeployments(projectId),
    getProjectEnvironments(projectId),
  ]);

  const latest = deployments[0] ?? null;
  const successDeploy = deployments.find(
    (d) => d.status === DeploymentStatus.SUCCESS && d.url
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Publishing"
          description="Create deployment records and track the history for this project."
        />

        <div className="space-y-6 max-w-3xl">
          {/* Create form */}
          <CreateDeploymentForm
            projectId={projectId}
            environments={environments}
          />

          {/* Live URL banner */}
          {(successDeploy?.url ?? project.liveUrl) && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm text-green-800 dark:text-green-300">
                Live at{" "}
              </span>
              <a
                href={successDeploy?.url ?? project.liveUrl ?? ""}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-green-700 dark:text-green-400 hover:underline flex items-center gap-1"
              >
                {(successDeploy?.url ?? project.liveUrl ?? "").replace(
                  "https://",
                  ""
                )}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Latest deployment card */}
          {latest && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Latest Deployment</CardTitle>
                  <Badge variant={STATUS_META[latest.status].variant}>
                    {STATUS_META[latest.status].label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  {STATUS_META[latest.status].icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {latest.commitMessage ?? latest.source.toLowerCase()}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {latest.branch && (
                        <span className="flex items-center gap-0.5">
                          <GitBranch className="h-3 w-3" />
                          {latest.branch}
                        </span>
                      )}
                      {latest.commitSha && (
                        <code className="font-mono">
                          {latest.commitSha.slice(0, 7)}
                        </code>
                      )}
                      {latest.environment && (
                        <span>{latest.environment.name}</span>
                      )}
                      <span>{formatRelative(latest.startedAt)}</span>
                    </div>
                  </div>
                  {latest.url && (
                    <a
                      href={latest.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* History */}
          {deployments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                <Clock className="h-8 w-8 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium">No deployments yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create a deployment record above.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Deployment History ({deployments.length})
                </CardTitle>
                <CardDescription>
                  Metadata records only — no build pipeline runs in Phase 6.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {deployments.map((dep) => {
                    const meta = STATUS_META[dep.status];
                    const isTerminal = TERMINAL_STATUSES.includes(dep.status);
                    return (
                      <div
                        key={dep.id}
                        className="flex items-center gap-3 px-6 py-3.5"
                      >
                        {meta.icon}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            {dep.commitMessage ?? dep.source.toLowerCase()}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                            {dep.branch && (
                              <span className="flex items-center gap-0.5">
                                <GitBranch className="h-3 w-3" />
                                {dep.branch}
                              </span>
                            )}
                            {dep.commitSha && (
                              <code className="font-mono">
                                <GitCommit className="h-3 w-3 inline mr-0.5" />
                                {dep.commitSha.slice(0, 7)}
                              </code>
                            )}
                            {dep.environment && (
                              <span>{dep.environment.name}</span>
                            )}
                            <span>{formatRelative(dep.startedAt)}</span>
                          </div>
                        </div>

                        {dep.url && (
                          <a
                            href={dep.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}

                        {/* Status update (only for non-terminal) */}
                        {!isTerminal && (
                          <form
                            action={updateDeploymentStatusAction.bind(
                              null,
                              dep.id,
                              projectId
                            )}
                            className="flex items-center gap-1"
                          >
                            <select
                              name="status"
                              defaultValue={dep.status}
                              className={SELECT_CLASS}
                              onChange={(e) => {
                                const form =
                                  e.target.closest("form") as HTMLFormElement;
                                form?.requestSubmit();
                              }}
                            >
                              {Object.keys(STATUS_META).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </form>
                        )}

                        <Badge variant={meta.variant} className="shrink-0 text-xs">
                          {meta.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardShell>
    </div>
  );
}
