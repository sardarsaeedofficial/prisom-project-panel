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
import { ReplitImportChecklist }   from "@/components/projects/replit-import-checklist";
import { ProjectPromotionPanel }   from "@/components/projects/project-promotion-panel";
import { ProductionRoutingPanel }  from "@/components/projects/production-routing-panel";
import { AlertTriangle, RefreshCw, Flag, ShoppingCart, Trophy, Container, ShieldCheck } from "lucide-react";
import Link                         from "next/link";
import { generateProjectRouteMap }  from "@/lib/routing/project-route-planner";
import { generateNginxFromRouteMap } from "@/lib/routing/nginx-route-generator";
import { hasBackupConfig }          from "@/lib/routing/nginx-route-apply";
import { SardarMigrationRunbookPanel }        from "@/components/projects/sardar-migration-runbook-panel";
import { StagingImportPanel }                 from "@/components/projects/staging-import-panel";
import { DeploymentDryRunPanel }              from "@/components/projects/deployment-dry-run-panel";
import { ExternalServicesReadinessPanel }     from "@/components/projects/external-services-readiness-panel";
import { ProductionCutoverPanel }             from "@/components/projects/production-cutover-panel";
import { SourceIntakePanel }                  from "@/components/projects/source-intake-panel";
import { DebugSummaryPanel }                  from "@/components/projects/debug-summary-panel";
import { isSardarProject }                    from "@/lib/migration/sardar-migration-types";

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

  // Sprint 50: Sardar runbook compact card
  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [deployments, dbDeployConfig, allDomains, services, syncSettings] = await Promise.all([
    getProjectDeployments(projectId),
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    // Sprint 23: detect multi-service mode (full list for route planner)
    db.projectService.findMany({
      where:  { projectId },
      select: {
        id: true, name: true, slug: true, serviceType: true,
        internalPort: true, healthPath: true, staticOutputDir: true,
        spaFallback: true, isPrimary: true, isEnabled: true,
        buildCommand: true, startCommand: true,
      },
    }),
    // Sprint 40: GitHub auto-sync status (non-fatal)
    db.projectGitHubSyncSettings.findUnique({
      where:  { projectId },
      select: { lastSyncStatus: true, lastSyncMessage: true, lastSyncedAt: true },
    }).catch(() => null),
  ]);

  const serviceCount = services.length;

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

  // Sprint 44: Pre-compute route map server-side (non-fatal)
  const activeDomain = allDomains.find((d) => d.status === "ACTIVE" && d.isPrimary)
    ?? allDomains.find((d) => d.status === "ACTIVE")
    ?? null;
  const routingDomain = activeDomain?.hostname ?? (dbDeployConfig as unknown as { primaryDomain?: string } | null)?.primaryDomain ?? null;

  let initialRouteMap   = null;
  let initialNginx      = null;
  let routingHasBackup  = false;

  // Sprint 47: Domain readiness check (non-fatal)
  let domainReadinessStatus:  "ready" | "warning" | "blocked" | null = null;
  let domainReadinessDomain:  string | null = null;
  let domainReadinessBlockers: string[] = [];
  try {
    const primaryDomain = await db.domain.findFirst({
      where:   { projectId, isPrimary: true },
      select:  { hostname: true },
    });
    if (primaryDomain?.hostname) {
      const { generateDomainReadinessReport } = await import("@/lib/domains/domain-readiness-service");
      const domainReport = await generateDomainReadinessReport({
        projectId,
        domain:      primaryDomain.hostname,
        projectSlug: project.slug,
      });
      domainReadinessStatus  = domainReport.status;
      domainReadinessDomain  = domainReport.domain;
      domainReadinessBlockers = domainReport.blockers.slice(0, 3);
    }
  } catch { /* non-fatal */ }

  // Sprint 49: Go-live readiness check (non-fatal, compact banner only)
  let goLiveReadinessStatus: "warning" | "blocked" | null = null;
  let goLiveBlockerCount = 0;
  try {
    const { generateGoLiveReadinessReport } = await import("@/lib/go-live/go-live-readiness-service");
    const glReport = await generateGoLiveReadinessReport(projectId);
    if (glReport.status === "blocked") {
      goLiveReadinessStatus = "blocked";
      goLiveBlockerCount    = glReport.blockers.length;
    } else if (glReport.status === "warning") {
      goLiveReadinessStatus = "warning";
    }
  } catch { /* non-fatal */ }

  // Sprint 48: GitHub readiness check (non-fatal)
  let githubReadinessStatus:   "warning" | "blocked" | null = null;
  let githubReadinessBlockers: string[] = [];
  try {
    const { generateGitHubReadinessReport } = await import("@/lib/github/github-readiness-service");
    const ghReport = await generateGitHubReadinessReport(projectId);
    if (ghReport.status === "warning" || ghReport.status === "blocked") {
      githubReadinessStatus   = ghReport.status;
      githubReadinessBlockers = ghReport.blockers.slice(0, 3);
    }
  } catch { /* non-fatal */ }

  // Sprint 46: Env readiness check (non-fatal)
  let envReadinessStatus:  "ready" | "warning" | "blocked" | null = null;
  let envReadinessBlocked: string[] = [];
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const envReport = await generateEnvReadinessReport(projectId);
    if (envReport && envReport.findings.length > 0) {
      envReadinessStatus  = envReport.status;
      envReadinessBlocked = envReport.findings
        .filter((f) => f.severity === "required" && (f.status === "missing" || f.status === "placeholder" || f.status === "empty"))
        .map((f) => f.name)
        .slice(0, 8);
    }
  } catch { /* non-fatal */ }

  if (dbDeployConfig && (serviceCount > 0 || routingDomain)) {
    try {
      const rm = generateProjectRouteMap({
        projectId,
        projectSlug: project.slug,
        domain:      routingDomain,
        services:    services as Parameters<typeof generateProjectRouteMap>[0]["services"],
        deployConfig: {
          port:            dbDeployConfig.port,
          routeMode:       dbDeployConfig.routeMode,
          apiPrefix:       dbDeployConfig.apiPrefix,
          staticOutputDir: dbDeployConfig.staticOutputDir,
          publicStaticPath: (dbDeployConfig as unknown as { publicStaticPath?: string | null }).publicStaticPath ?? null,
          healthPath:      dbDeployConfig.healthPath,
          primaryDomain:   (dbDeployConfig as unknown as { primaryDomain?: string | null }).primaryDomain ?? null,
        },
      });
      initialRouteMap = rm;

      const ng = generateNginxFromRouteMap(rm);
      if (ng.ok) initialNginx = ng.config;

      if (routingDomain) {
        routingHasBackup = await hasBackupConfig(routingDomain).catch(() => false);
      }
    } catch { /* non-fatal — panel loads without initial data */ }
  }

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

          {/* ── Sprint 57: Source Intake compact card ── */}
          <SourceIntakePanel projectId={projectId} compact />

          {/* ── Sprint 58: Debug failed build/deploy ── */}
          <DebugSummaryPanel projectId={projectId} compact context="deploy" />

          {/* ── Sprint 60: Disaster Recovery compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ExternalLink className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Backup / Restore Drill</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Confirm your backup is intact and run a staging restore drill before applying production routes.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/backups`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Backups →
            </Link>
          </div>

          {/* ── Sprint 61: Staging Trial Migration compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Flag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Sardar Staging Trial Migration</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Run a guided staging trial before production cutover — smoke checks, env, DB, routing, and backup drill.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          {/* ── Sprint 62: Ecommerce Test Harness compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ShoppingCart className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Ecommerce Test Harness</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Prove checkout, order, Stripe test-mode, and provider readiness on staging before going live.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          {/* ── Sprint 65: Production Execution Guard compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Production Cutover Execution Guard</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Final guarded workflow for production route apply, smoke checks, and rollback confirmation.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/releases`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Releases →
            </Link>
          </div>

          {/* ── Sprint 64: Staging Deployment compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Container className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Sardar Staging Deployment</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plan and verify an isolated staging deployment before production cutover — service config, source prep, smoke checks.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          {/* ── Sprint 63: Final Go-Live Control Room compact card ── */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Trophy className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Final Go-Live Control Room</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aggregate readiness gate for all Sprint 50–62 checks. Generate the final gate report and FINAL_GO_LIVE_PACK.md before cutover.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/releases`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Releases →
            </Link>
          </div>

          {/* ── Sprint 55: Production Cutover compact card ── */}
          {dbDeployConfig && (
            <ProductionCutoverPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 54: External Services compact card ── */}
          {dbDeployConfig && (
            <ExternalServicesReadinessPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 53: Deployment dry-run compact card ── */}
          {dbDeployConfig && (
            <DeploymentDryRunPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 51: Staging import compact card ── */}
          {isSardar && (
            <StagingImportPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 50: Sardar migration runbook compact card ── */}
          {isSardar && (
            <SardarMigrationRunbookPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 49: Go-live readiness banner ── */}
          {goLiveReadinessStatus && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              goLiveReadinessStatus === "blocked"
                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
            }`}>
              <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
                goLiveReadinessStatus === "blocked"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  goLiveReadinessStatus === "blocked"
                    ? "text-red-800 dark:text-red-200"
                    : "text-amber-800 dark:text-amber-200"
                }`}>
                  Go-live readiness:{" "}
                  {goLiveReadinessStatus === "blocked"
                    ? `${goLiveBlockerCount} blocker${goLiveBlockerCount > 1 ? "s" : ""} detected`
                    : "warnings — review before promoting"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  <Link href={`/projects/${projectId}/releases`} className="underline hover:no-underline">
                    Open Go-Live Readiness →
                  </Link>
                </p>
              </div>
            </div>
          )}

          {/* ── Sprint 48: GitHub readiness banner ── */}
          {githubReadinessStatus && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              githubReadinessStatus === "blocked"
                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
            }`}>
              <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
                githubReadinessStatus === "blocked"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  githubReadinessStatus === "blocked"
                    ? "text-red-800 dark:text-red-200"
                    : "text-amber-800 dark:text-amber-200"
                }`}>
                  GitHub auto-sync readiness:{" "}
                  {githubReadinessStatus === "blocked" ? "blocked" : "warnings"}
                </p>
                {githubReadinessBlockers.length > 0 && (
                  <ul className={`text-xs mt-0.5 space-y-0.5 ${
                    githubReadinessStatus === "blocked"
                      ? "text-red-700 dark:text-red-300"
                      : "text-amber-700 dark:text-amber-300"
                  }`}>
                    {githubReadinessBlockers.map((b, i) => (
                      <li key={i}>• {b}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs mt-1 text-muted-foreground">
                  <Link href={`/projects/${projectId}/github`} className="underline hover:no-underline">
                    Open GitHub Readiness →
                  </Link>
                </p>
              </div>
            </div>
          )}

          {/* ── Sprint 47: Domain readiness banner ── */}
          {domainReadinessStatus && domainReadinessStatus !== "ready" && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              domainReadinessStatus === "blocked"
                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
            }`}>
              <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
                domainReadinessStatus === "blocked"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  domainReadinessStatus === "blocked"
                    ? "text-red-800 dark:text-red-200"
                    : "text-amber-800 dark:text-amber-200"
                }`}>
                  Domain readiness — {domainReadinessDomain}:{" "}
                  {domainReadinessStatus === "blocked" ? "blocked" : "warnings"}
                </p>
                {domainReadinessBlockers.length > 0 && (
                  <ul className={`text-xs mt-0.5 space-y-0.5 ${
                    domainReadinessStatus === "blocked"
                      ? "text-red-700 dark:text-red-300"
                      : "text-amber-700 dark:text-amber-300"
                  }`}>
                    {domainReadinessBlockers.map((b, i) => (
                      <li key={i}>• {b}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs mt-1 text-muted-foreground">
                  <Link href={`/projects/${projectId}/domains`} className="underline hover:no-underline">
                    Open Domain Readiness →
                  </Link>
                </p>
              </div>
            </div>
          )}

          {/* ── Sprint 46: Env readiness banner ── */}
          {envReadinessStatus && envReadinessStatus !== "ready" && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              envReadinessStatus === "blocked"
                ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
            }`}>
              {envReadinessStatus === "blocked"
                ? <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                : <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  envReadinessStatus === "blocked"
                    ? "text-red-800 dark:text-red-200"
                    : "text-amber-800 dark:text-amber-200"
                }`}>
                  Secrets readiness:{" "}
                  {envReadinessStatus === "blocked" ? "blocked — missing required env vars" : "warnings — some values need attention"}
                </p>
                {envReadinessBlocked.length > 0 && (
                  <p className={`text-xs mt-0.5 ${
                    envReadinessStatus === "blocked"
                      ? "text-red-700 dark:text-red-300"
                      : "text-amber-700 dark:text-amber-300"
                  }`}>
                    Missing required vars: {envReadinessBlocked.map((n) => (
                      <code key={n} className="mx-0.5 font-mono">{n}</code>
                    ))}.{" "}
                    <Link href={`/projects/${projectId}/env`} className="underline hover:no-underline">
                      Open Secrets Vault →
                    </Link>
                  </p>
                )}
                {envReadinessBlocked.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Check placeholder or suspicious values.{" "}
                    <Link href={`/projects/${projectId}/env`} className="underline hover:no-underline">
                      Open Secrets Vault →
                    </Link>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Sprint 45: DB warning — shown if DB env is not tested ── */}
          {dbDeployConfig && (
            dbDeployConfig.dbConnStatus === "missing_url" ||
            dbDeployConfig.dbConnStatus === "failed" ||
            (!dbDeployConfig.dbConnStatus && !dbDeployConfig.dbConnLastCheckedAt)
          ) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {dbDeployConfig.dbConnStatus === "failed"
                    ? "Database connection failed"
                    : dbDeployConfig.dbConnStatus === "missing_url"
                    ? "DATABASE_URL not configured"
                    : "Database connection not verified"}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  {dbDeployConfig.dbConnStatus === "failed"
                    ? `Last error: ${dbDeployConfig.dbConnErrorMessage?.slice(0, 120) ?? "unknown"}.`
                    : dbDeployConfig.dbConnStatus === "missing_url"
                    ? "Add DATABASE_URL to the Secrets Vault before first deploy."
                    : "Run a connection test before deploying to production."}{" "}
                  <Link href={`/projects/${projectId}/database`} className="underline hover:no-underline">
                    Go to Database →
                  </Link>
                </p>
              </div>
            </div>
          )}

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

          {/* ── Sprint 40: dirty worktree warning ── */}
          {syncSettings?.lastSyncStatus === "dirty" && (
            <Card className="border-yellow-500/40 bg-yellow-50/30 dark:bg-yellow-950/10">
              <CardContent className="py-3 px-4 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    Uncommitted changes — auto-pull blocked
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {syncSettings.lastSyncMessage ?? "Worktree has uncommitted changes."}
                  </p>
                </div>
                <Link
                  href={`/projects/${projectId}/github`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
                >
                  <RefreshCw className="h-3 w-3" />
                  Resolve
                </Link>
              </CardContent>
            </Card>
          )}

          {/* ── Sprint 40: behind remote notice ── */}
          {syncSettings?.lastSyncStatus === "behind" && (
            <Card className="border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/10">
              <CardContent className="py-3 px-4 flex items-start gap-3">
                <RefreshCw className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Behind remote</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {syncSettings.lastSyncMessage ?? "New commits are available on the remote."}
                  </p>
                </div>
                <Link
                  href={`/projects/${projectId}/github`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Sync
                </Link>
              </CardContent>
            </Card>
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

          {/* ── Sprint 53: Deployment Dry Run ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <DeploymentDryRunPanel projectId={projectId} />
          )}

          {/* ── Sprint 44: Production Routing ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <ProductionRoutingPanel
              projectId={projectId}
              initialRouteMap={initialRouteMap}
              initialNginx={initialNginx}
              hasBackup={routingHasBackup}
              domain={routingDomain}
            />
          )}

          {/* ── Sprint 39: Release promotion workflow ── */}
          {!hasDeployConfig && dbDeployConfig && (
            <ProjectPromotionPanel projectId={projectId} />
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
