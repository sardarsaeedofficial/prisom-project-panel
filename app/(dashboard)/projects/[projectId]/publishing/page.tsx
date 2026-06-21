import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  XCircle,
  Clock,
  Loader2,
  Ban,
  ExternalLink,
  GitBranch,
  CheckCircle2,
} from "lucide-react";
import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { DeployPanel }  from "@/components/projects/deploy-panel";
import { Badge }        from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProjectDeployments } from "@/lib/data/workspace-modules";
import { getDeploymentConfig }   from "@/lib/projects/deployment-config";
import { db }                    from "@/lib/db";
import { DeploymentStatus }      from "@prisma/client";
import { DeploymentSetupForm }   from "@/components/projects/deployment-setup-form";
import { ProjectDeployPanel }    from "@/components/projects/project-deploy-panel";
import { getPm2AppStatus }       from "@/lib/projects/project-deploy-runner";
import { LiveEndpointsCard }     from "@/components/projects/live-endpoints-card";
import { ReadinessPanel }        from "@/components/projects/readiness-panel";
import { DeploymentConfigPanel } from "@/components/projects/deployment-config-panel";
import { DeploymentHistoryPanel } from "@/components/projects/deployment-history-panel";
import { ProjectServicesPanel }  from "@/components/projects/project-services-panel";
import { ReplitImportChecklist } from "@/components/projects/replit-import-checklist";

export const metadata: Metadata = { title: "Publishing" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

// ── Status UI helpers ─────────────────────────────────────────────────────────

type StatusMeta = {
  icon:    React.ReactNode;
  label:   string;
  variant: "success" | "warning" | "error" | "secondary";
};

const STATUS_META: Record<DeploymentStatus, StatusMeta> = {
  SUCCESS: {
    icon:    <CheckCircle2 className="h-4 w-4 text-green-500" />,
    label:   "Success",
    variant: "success",
  },
  FAILED: {
    icon:    <XCircle className="h-4 w-4 text-red-500" />,
    label:   "Failed",
    variant: "error",
  },
  CANCELLED: {
    icon:    <Ban className="h-4 w-4 text-muted-foreground" />,
    label:   "Cancelled",
    variant: "secondary",
  },
  PENDING: {
    icon:    <Clock className="h-4 w-4 text-muted-foreground" />,
    label:   "Pending",
    variant: "secondary",
  },
  QUEUED: {
    icon:    <Clock className="h-4 w-4 text-yellow-500" />,
    label:   "Queued",
    variant: "warning",
  },
  BUILDING: {
    icon:    <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />,
    label:   "Building",
    variant: "warning",
  },
};

function formatRelative(date: Date) {
  const diff    = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)  return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours}h ago`;
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
    where:  { id: projectId },
    select: { id: true, name: true, liveUrl: true, slug: true },
  });
  if (!project) notFound();

  const [deployments, dbDeployConfig, allDomains, serviceCount] = await Promise.all([
    getProjectDeployments(projectId),
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    // Sprint 23: detect multi-service mode
    db.projectService.count({ where: { projectId } }),
  ]);

  // A project is in multi-service mode if it has any ProjectService rows
  const isMultiService = serviceCount > 0;

  // First active domain (highest priority) — still used for the legacy deploy panel prop
  const activeDomainRow =
    allDomains.find((d) => d.status === "ACTIVE" && "nginxConfigPath" in d) ??
    allDomains.find((d) => d.status === "ACTIVE") ?? null;

  // Static VPS config (LocalShop only) — must not be touched
  const deployConfig    = getDeploymentConfig(project.slug);
  const hasDeployConfig = !!deployConfig;

  // PM2 status for the project's runtime (only fetched if a DB config exists)
  const initialPm2Status = dbDeployConfig
    ? await getPm2AppStatus(dbDeployConfig.pm2Name).catch(() => null)
    : null;

  const latest       = deployments[0] ?? null;
  const successDeploy = deployments.find(
    (d) => d.status === DeploymentStatus.SUCCESS && d.url,
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

          {/* ── Live Endpoints ── */}
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

          {/* ── Readiness panel ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <ReadinessPanel
              projectId={projectId}
              hasConfig={!!dbDeployConfig}
              defaultEnv="production"
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

          {/* ── PM2-based deployment panel ── */}
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

          {/* ── Deployment config editor ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <DeploymentConfigPanel
              projectId={projectId}
              config={{
                id:                  dbDeployConfig.id,
                port:                dbDeployConfig.port,
                pm2Name:             dbDeployConfig.pm2Name,
                runtime:             (dbDeployConfig as unknown as { runtime: string }).runtime ?? "node",
                installCommand:      dbDeployConfig.installCommand,
                buildCommand:        dbDeployConfig.buildCommand,
                startCommand:        dbDeployConfig.startCommand,
                rootDirectory:       dbDeployConfig.rootDirectory,
                outputDirectory:     dbDeployConfig.outputDirectory,
                healthPath:          dbDeployConfig.healthPath,
                loginPath:           (dbDeployConfig as unknown as { loginPath: string }).loginPath ?? "/login",
                nodeEnv:             dbDeployConfig.nodeEnv,
                routeMode:           dbDeployConfig.routeMode,
                staticOutputDir:     dbDeployConfig.staticOutputDir,
                apiPrefix:           dbDeployConfig.apiPrefix,
                primaryDomain:       (dbDeployConfig as unknown as { primaryDomain: string | null }).primaryDomain ?? null,
                publicPreviewUrl:    dbDeployConfig.publicPreviewUrl,
                publicPreviewMode:   dbDeployConfig.publicPreviewMode,
                publicPreviewStatus: dbDeployConfig.publicPreviewStatus,
                lastValidatedAt:     (dbDeployConfig as unknown as { lastValidatedAt: Date | null }).lastValidatedAt ?? null,
                validationStatus:    (dbDeployConfig as unknown as { validationStatus: string | null }).validationStatus ?? null,
                validationError:     (dbDeployConfig as unknown as { validationError: string | null }).validationError ?? null,
              }}
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
                    {latest.status === DeploymentStatus.FAILED && latest.errorMessage && (
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

          {/* ── Sprint 23: Multi-service mode ── */}
          {isMultiService && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Services</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ProjectServicesPanel projectId={projectId} />
              </CardContent>
            </Card>
          )}

          {/* ── Sprint 23: Add-services section for projects without services yet ──
               Only shown when there is a DB deploy config (PM2 project) and
               no services have been configured — acts as a prompt to upgrade. ── */}
          {!hasDeployConfig && dbDeployConfig && !isMultiService && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Multi-service deployments</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Add services to deploy multiple processes (e.g. API + frontend) from this project.
                  Single-service deployments above continue to work as before.
                </p>
                <ProjectServicesPanel projectId={projectId} />
              </CardContent>
            </Card>
          )}

          {/* ── Sprint 23: Replit import checklist (collapsible, dismissable) ── */}
          <ReplitImportChecklist defaultCollapsed />

          {/* ── Deployment History (Sprint 13) ──
               Single history section with rollback, filters, and pagination.
               Only shown for PM2-deployed projects. ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <Card>
              <CardContent className="pt-5 pb-5">
                <DeploymentHistoryPanel
                  projectId={projectId}
                  projectSlug={project.slug}
                  pm2Name={dbDeployConfig.pm2Name}
                />
              </CardContent>
            </Card>
          )}

        </div>
      </DashboardShell>
    </div>
  );
}
