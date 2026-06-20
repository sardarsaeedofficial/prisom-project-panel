import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Clock,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Archive,
  Globe,
  Eye,
  Terminal,
  GitCommit,
  ListChecks,
  Layers,
  Database,
  Circle,
  ListTodo,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { MarkOpened } from "@/components/projects/mark-opened";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectById, type ProjectDetail } from "@/lib/data/projects";
import {
  getProjectFeatures,
  getProjectTasks,
} from "@/lib/data/workspace-modules";
import { FeatureTasksSection } from "@/components/workspace/features-tasks-section";
import { formatRelativeTime, formatDate } from "@/lib/utils";
import {
  DeploymentStatus,
  Visibility,
  ProjectStatus,
  EnvironmentName,
} from "@prisma/client";
import { db } from "@/lib/db";
import { RECENT_BACKUP_DAYS } from "@/lib/backups/project-backup-types";

export const dynamic = "force-dynamic";

// ── Health checklist ───────────────────────────────────────────────────────────

type CheckItem = {
  label: string;
  ok: boolean;
  href?: string;
  hintIfMissing?: string;
};

function HealthChecklist({ items }: { items: CheckItem[] }) {
  const okCount = items.filter((i) => i.ok).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-muted-foreground font-medium flex items-center gap-1.5">
            <ListTodo className="h-4 w-4" />
            Project Checklist
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {okCount}/{items.length} ready
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-xs">
              {item.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <span className={item.ok ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
                {!item.ok && item.hintIfMissing && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{item.hintIfMissing}</p>
                )}
              </div>
              {!item.ok && item.href && (
                <Link
                  href={item.href}
                  className="shrink-0 text-primary text-[10px] hover:underline"
                >
                  Set up →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type Props = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params;
  const project = await getProjectById(projectId);
  return { title: project?.name ?? "Project" };
}

const STATUS_ICONS: Record<ProjectStatus, React.ReactNode> = {
  ACTIVE: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  BUILDING: <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />,
  ERROR: <AlertTriangle className="h-4 w-4 text-red-500" />,
  ARCHIVED: <Archive className="h-4 w-4 text-muted-foreground" />,
  DRAFT: <Eye className="h-4 w-4 text-muted-foreground" />,
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  BUILDING: "Building",
  ERROR: "Error",
  ARCHIVED: "Archived",
  DRAFT: "Draft",
};

const DEPLOY_STATUS_BADGE: Record<
  DeploymentStatus,
  { label: string; variant: "success" | "warning" | "error" | "secondary" }
> = {
  SUCCESS: { label: "Success", variant: "success" },
  BUILDING: { label: "Building", variant: "warning" },
  PENDING: { label: "Pending", variant: "secondary" },
  QUEUED: { label: "Queued", variant: "secondary" },
  FAILED: { label: "Failed", variant: "error" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

const ENV_COLORS: Record<EnvironmentName, string> = {
  DEVELOPMENT: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  PREVIEW: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  PRODUCTION: "bg-green-500/20 text-green-700 dark:text-green-300",
};

function OverviewGrid({ project }: { project: ProjectDetail }) {
  const latestDeployment = project.deployments[0];
  const primaryDomain = project.domains.find((d) => d.isPrimary) ?? project.domains[0];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {STATUS_ICONS[project.status]}
            <span className="font-medium">{STATUS_LABELS[project.status]}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {project.type.charAt(0) + project.type.slice(1).toLowerCase()} ·{" "}
            {project.visibility === Visibility.PUBLIC ? "Public" : project.visibility === Visibility.UNLISTED ? "Unlisted" : "Private"}
          </p>
        </CardContent>
      </Card>

      {/* Stack */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Stack</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{project.language ?? "—"}</p>
          {project.framework && (
            <p className="text-sm text-muted-foreground">{project.framework}</p>
          )}
        </CardContent>
      </Card>

      {/* Last deployed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Last Deployed</CardTitle>
        </CardHeader>
        <CardContent>
          {project.lastDeployedAt ? (
            <div>
              <p className="font-medium flex items-center gap-1.5">
                <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
                {formatRelativeTime(project.lastDeployedAt)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDate(project.lastDeployedAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Never deployed</p>
          )}
        </CardContent>
      </Card>

      {/* GitHub */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Repository</CardTitle>
        </CardHeader>
        <CardContent>
          {project.githubRepository ? (
            <div>
              <p className="font-medium flex items-center gap-1.5 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {project.githubRepository.fullName}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Branch: {project.githubRepository.defaultBranch} ·{" "}
                {project._count.commits} commit{project._count.commits !== 1 ? "s" : ""}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">Not connected</p>
              <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" asChild>
                <Link href={`/projects/${project.id}/github`}>Connect GitHub</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domain */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Domain</CardTitle>
        </CardHeader>
        <CardContent>
          {primaryDomain ? (
            <div>
              <p className="font-medium flex items-center gap-1.5 text-sm">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {primaryDomain.hostname}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                {primaryDomain.status.toLowerCase()} ·{" "}
                SSL {primaryDomain.sslStatus.toLowerCase()}
              </p>
            </div>
          ) : project.liveUrl ? (
            <div>
              <p className="font-medium flex items-center gap-1.5 text-sm">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <a
                  href={project.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {project.liveUrl.replace(/^https?:\/\//, "")}
                </a>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No domain</p>
          )}
        </CardContent>
      </Card>

      {/* Created */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">Created</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium flex items-center gap-1.5 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(project.createdAt)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function EnvironmentsSection({ project }: { project: ProjectDetail }) {
  if (project.environments.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        Environments
      </h2>
      <div className="flex flex-wrap gap-2">
        {project.environments.map((env) => (
          <div
            key={env.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                ENV_COLORS[env.name] ?? "bg-muted text-muted-foreground"
              }`}
            >
              {env.name}
            </span>
            <span className="text-muted-foreground text-xs">
              {env.secrets.length} secret{env.secrets.length !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeploymentsSection({ project }: { project: ProjectDetail }) {
  if (project.deployments.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-muted-foreground" />
        Recent Deployments
      </h2>
      <div className="border rounded-lg divide-y overflow-hidden">
        {project.deployments.map((dep) => {
          const badge = DEPLOY_STATUS_BADGE[dep.status];
          return (
            <div
              key={dep.id}
              className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/30 transition-colors"
            >
              <Badge variant={badge.variant} className="shrink-0 text-xs">
                {badge.label}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                {dep.commitSha ? dep.commitSha.slice(0, 7) : dep.source.toLowerCase()}
              </span>
              {dep.commitMessage && (
                <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                  {dep.commitMessage}
                </span>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(dep.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatsRow({ project }: { project: ProjectDetail }) {
  const stats = [
    { icon: Terminal, label: "Logs", value: project._count.logs },
    { icon: ListChecks, label: "Tasks", value: project._count.tasks },
    { icon: GitCommit, label: "Commits", value: project._count.commits },
    { icon: Database, label: "Features", value: project._count.features },
  ];
  return (
    <div className="mt-6 grid grid-cols-4 gap-3">
      {stats.map(({ icon: Icon, label, value }) => (
        <div
          key={label}
          className="flex flex-col items-center justify-center rounded-lg border p-3 text-center"
        >
          <Icon className="h-4 w-4 text-muted-foreground mb-1" />
          <p className="text-lg font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params;

  const recentBackupCutoff = new Date(Date.now() - RECENT_BACKUP_DAYS * 24 * 60 * 60 * 1000);

  const [project, features, tasks, deployConfig, teamMemberCount, alertSettings, recentBackup] =
    await Promise.all([
      getProjectById(projectId),
      getProjectFeatures(projectId),
      getProjectTasks(projectId),
      db.projectDeploymentConfig.findUnique({ where: { projectId } }).catch(() => null),
      db.projectMember.count({ where: { projectId } }).catch(() => 0),
      db.projectAlertSettings.findUnique({ where: { projectId } }).catch(() => null),
      db.projectBackup.findFirst({
        where: {
          projectId,
          status: "ready",
          deletedAt: null,
          completedAt: { gte: recentBackupCutoff },
        },
        select: { id: true },
      }).catch(() => null),
    ]);

  if (!project) notFound();

  const healthItems: CheckItem[] = [
    {
      label: "Deployment config set",
      ok: !!deployConfig,
      href: `/projects/${projectId}/publishing`,
      hintIfMissing: "Configure your start command, port, and runtime in Publishing.",
    },
    {
      label: "Preview / domain available",
      ok: !!(project.liveUrl || project.domains.length > 0),
      href: `/projects/${projectId}/domains`,
      hintIfMissing: "Add a domain or check the live URL in Domains.",
    },
    {
      label: "Successfully deployed",
      ok: project.deployments.some((d) => d.status === DeploymentStatus.SUCCESS),
      href: `/projects/${projectId}/publishing`,
      hintIfMissing: "Trigger your first deployment in Publishing.",
    },
    {
      label: "Monitoring enabled",
      ok: !!(alertSettings?.schedulerEnabled),
      href: `/projects/${projectId}/monitoring`,
      hintIfMissing: "Enable background alert checks in Monitoring → Alert Settings.",
    },
    {
      label: "Team set up",
      ok: teamMemberCount > 0,
      href: `/projects/${projectId}/team`,
      hintIfMissing: "Invite team members in the Team tab.",
    },
    {
      label: "Environment variables configured",
      ok: (project.environments?.some((e) => e.secrets.length > 0)) ?? false,
      href: `/projects/${projectId}/env`,
      hintIfMissing: "Add env vars like DATABASE_URL or API keys.",
    },
    {
      label: `Recent backup (within ${RECENT_BACKUP_DAYS} days)`,
      ok: !!recentBackup,
      href: `/projects/${projectId}/backups`,
      hintIfMissing: "Create a backup snapshot to protect your project's source files.",
    },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <MarkOpened projectId={projectId} />

      {/* Project header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {STATUS_ICONS[project.status]}
            <h1 className="text-lg font-semibold">{project.name}</h1>
            {project.visibility === Visibility.PUBLIC && (
              <Badge variant="success" className="text-xs">Published</Badge>
            )}
            {project.status === ProjectStatus.ARCHIVED && (
              <Badge variant="secondary" className="text-xs">
                <Archive className="h-3 w-3 mr-1" />
                Archived
              </Badge>
            )}
          </div>
          {project.liveUrl && (
            <a
              href={project.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              {project.liveUrl.replace("https://", "")}
            </a>
          )}
        </div>
        {project.description && (
          <p className="text-sm text-muted-foreground pl-10">{project.description}</p>
        )}
      </div>

      {/* Workspace tabs */}
      <WorkspaceNav projectId={projectId} />

      {/* Content */}
      <DashboardShell>
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <OverviewGrid project={project} />
            <StatsRow project={project} />
          </div>
          <HealthChecklist items={healthItems} />
        </div>
        <EnvironmentsSection project={project} />
        <DeploymentsSection project={project} />
        <FeatureTasksSection
          projectId={projectId}
          features={features.map((f) => ({
            id: f.id,
            title: f.title,
            description: f.description,
            status: f.status,
            priority: f.priority,
            _count: f._count,
          }))}
          tasks={tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            featureId: t.featureId,
          }))}
        />

        {/* Quick actions */}
        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link href={`/projects/${projectId}/publishing`}>
              <Rocket className="h-4 w-4" />
              Deploy
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}/files`}>Open Editor</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}/logs`}>View Logs</Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <Link href={`/projects/${projectId}/settings`}>Settings</Link>
          </Button>
        </div>
      </DashboardShell>
    </div>
  );
}
