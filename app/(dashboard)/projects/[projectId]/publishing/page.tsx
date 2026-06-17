import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  XCircle,
  Clock,
  Loader2,
  Ban,
  ExternalLink,
  GitBranch,
  GitCommit,
  CheckCircle2,
} from "lucide-react";
import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { DeployPanel } from "@/components/projects/deploy-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  getProjectDeployments,
  getProjectEnvironments,
} from "@/lib/data/workspace-modules";
import { updateDeploymentStatusAction } from "@/app/actions/workspace-modules";
import { getDeploymentConfig } from "@/lib/projects/deployment-config";
import { db } from "@/lib/db";
import { DeploymentStatus } from "@prisma/client";
import { DeploymentSetupForm } from "@/components/projects/deployment-setup-form";
import { ProjectDeployPanel } from "@/components/projects/project-deploy-panel";
import { getPm2AppStatus } from "@/lib/projects/project-deploy-runner";
import { LiveEndpointsCard } from "@/components/projects/live-endpoints-card";

export const metadata: Metadata = { title: "Publishing" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

// ── Status UI helpers ─────────────────────────────────────────────────────────

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

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function ProjectPublishingPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, liveUrl: true, slug: true },
  });
  if (!project) notFound();

  const [deployments, environments, dbDeployConfig, allDomains] = await Promise.all([
    getProjectDeployments(projectId),
    getProjectEnvironments(projectId),
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  // First active domain (highest priority) — still used for the legacy deploy panel prop
  const activeDomainRow = allDomains.find(
    (d) => d.status === "ACTIVE" && "nginxConfigPath" in d
  ) ?? allDomains.find((d) => d.status === "ACTIVE") ?? null;

  // Static VPS config (LocalShop only) — must not be touched
  const deployConfig = getDeploymentConfig(project.slug);
  const hasDeployConfig = !!deployConfig;

  // PM2 status for the project's runtime (only fetched if a DB config exists)
  const initialPm2Status = dbDeployConfig
    ? await getPm2AppStatus(dbDeployConfig.pm2Name).catch(() => null)
    : null;

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
          description={
            hasDeployConfig || dbDeployConfig
              ? "Live deployment controls and history for this project."
              : "Configure deployment to run your project on the VPS."
          }
        />

        <div className="space-y-6 max-w-3xl">

          {/* ── Live Endpoints (shown for all PM2-deployed projects) ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <LiveEndpointsCard
              projectId={projectId}
              port={dbDeployConfig.port}
              publicPreviewUrl={dbDeployConfig.publicPreviewUrl ?? null}
              publicPreviewMode={dbDeployConfig.publicPreviewMode ?? "disabled"}
              publicPreviewStatus={dbDeployConfig.publicPreviewStatus ?? "inactive"}
              domains={allDomains.map((d) => ({
                hostname:  d.hostname,
                isPrimary: d.isPrimary,
                status:    d.status as string,
                sslStatus: d.sslStatus as string,
              }))}
              isDeployed={!!successDeploy || !!project.liveUrl}
              domainsHref={`/projects/${projectId}/domains`}
            />
          )}

          {/* ── LocalShop: static VPS config (unchanged path) ── */}
          {hasDeployConfig && deployConfig && (
            <DeployPanel
              projectId={projectId}
              domain={deployConfig.domain}
              branch={deployConfig.branch}
              pm2Apps={deployConfig.pm2Apps}
            />
          )}

          {/* ── Uploaded / blank / GitHub projects: PM2-based deployment ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <ProjectDeployPanel
              projectId={projectId}
              projectSlug={project.slug}
              config={dbDeployConfig}
              latestDeployment={deployments[0] ?? null}
              initialPm2Status={initialPm2Status}
              activeDomain={activeDomainRow?.hostname ?? null}
            />
          )}

          {/* ── No config yet: show setup form ── */}
          {!hasDeployConfig && !dbDeployConfig && (
            <DeploymentSetupForm
              projectId={projectId}
              projectSlug={project.slug}
            />
          )}

          {/* ── Latest deployment card ── */}
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
                      {latest.duration && (
                        <span>{formatDuration(latest.duration)}</span>
                      )}
                    </div>
                    {/* Error snippet */}
                    {latest.status === DeploymentStatus.FAILED &&
                      latest.errorMessage && (
                        <pre className="mt-2 text-xs font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded p-2 overflow-x-auto max-h-24 whitespace-pre-wrap">
                          {latest.errorMessage.slice(0, 500)}
                        </pre>
                      )}
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

          {/* ── Deployment history ── */}
          {deployments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                <Clock className="h-8 w-8 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium">No deployments yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {hasDeployConfig || dbDeployConfig
                      ? "Deploy from the controls above to create the first record."
                      : "Configure deployment above to get started."}
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
                {!hasDeployConfig && !dbDeployConfig && (
                  <CardDescription>
                    Metadata records — no live pipeline connected for this project.
                  </CardDescription>
                )}
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
                            {dep.duration && (
                              <span>{formatDuration(dep.duration)}</span>
                            )}
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

                        {/* Status update for in-flight records */}
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
                                  e.target.closest(
                                    "form"
                                  ) as HTMLFormElement;
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

                        <Badge
                          variant={meta.variant}
                          className="shrink-0 text-xs"
                        >
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
