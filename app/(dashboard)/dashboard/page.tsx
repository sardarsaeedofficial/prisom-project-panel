import type { Metadata } from "next";
import {
  FolderOpen,
  Globe,
  Rocket,
  Activity,
  Plus,
  Database,
} from "lucide-react";
import Link from "next/link";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ProjectCard } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import { getProjects, toProjectViewModel, type ProjectListItem } from "@/lib/data/projects";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { ProjectStatus, Visibility } from "@prisma/client";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type DashboardStats = {
  totalProjects:     number;
  activeProjects:    number;
  publishedProjects: number;
  totalDeployments:  number;
};

// Shared include so the Tier-2 fallback query produces the same shape as getProjects().
const PROJECT_INCLUDE = {
  githubRepository: true,
  domains:          { where: { isPrimary: true }, take: 1 },
  deployments:      { orderBy: { createdAt: "desc" } as const, take: 1 },
  environments:     true,
  _count:           { select: { logs: true, tasks: true, features: true, commits: true } },
} as const;

function renderPage(
  stats:              DashboardStats,
  recentProjectCards: ReturnType<typeof toProjectViewModel>[],
  dbError:            string | null,
) {
  return (
    <DashboardShell>
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's an overview of your projects."
        action={
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        }
      />

      {/* DB error banner — only shown when data genuinely could not be loaded */}
      {dbError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 mb-6 text-sm text-destructive">
          <Database className="h-4 w-4 shrink-0" />
          <span>{dbError}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
        <StatCard
          title="Total Projects"
          value={stats.totalProjects}
          icon={FolderOpen}
          description="All projects"
        />
        <StatCard
          title="Active"
          value={stats.activeProjects}
          icon={Activity}
          description="Currently running"
        />
        <StatCard
          title="Published"
          value={stats.publishedProjects}
          icon={Globe}
          description="Publicly visible"
        />
        <StatCard
          title="Deployments"
          value={stats.totalDeployments}
          icon={Rocket}
          description="Total across projects"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent projects */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Recent Projects</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/projects">View all →</Link>
            </Button>
          </div>

          {recentProjectCards.length === 0 && !dbError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
              <p className="text-sm text-muted-foreground">No projects yet.</p>
              <Button asChild className="mt-3" size="sm">
                <Link href="/projects/new">Create your first project</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {recentProjectCards.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div>
          <ActivityFeed />
        </div>
      </div>
    </DashboardShell>
  );
}

export default async function DashboardPage() {
  let stats: DashboardStats = {
    totalProjects:     0,
    activeProjects:    0,
    publishedProjects: 0,
    totalDeployments:  0,
  };
  let recentProjectCards: ReturnType<typeof toProjectViewModel>[] = [];

  // ── Tier 1: session-aware, workspace-scoped query ─────────────────────────
  // Normal path — uses the current user's session to scope projects to their workspace.
  try {
    const [allProjects, workspaceId] = await Promise.all([
      getProjects(),
      getCurrentWorkspaceId(),
    ]);

    stats = {
      totalProjects:     allProjects.length,
      activeProjects:    allProjects.filter((p) => p.status === ProjectStatus.ACTIVE).length,
      publishedProjects: allProjects.filter((p) => p.visibility === Visibility.PUBLIC).length,
      totalDeployments:  await db.deployment.count({
        where: { project: { workspaceId } },
      }),
    };
    recentProjectCards = allProjects.slice(0, 4).map((p) => toProjectViewModel(p));
    return renderPage(stats, recentProjectCards, null);
  } catch {
    // Tier 1 failed — often a session/workspace lookup issue, not a DB problem.
    // Fall through to Tier 2 before deciding on an error message.
  }

  // ── Tier 2: direct DB query (no session/workspace dependency) ────────────
  // Used when the session-based path fails (e.g. workspace not found, no active session).
  // DATABASE_URL being set and the DB being reachable are the only requirements.
  if (!process.env.DATABASE_URL) {
    return renderPage(stats, [], "DATABASE_URL is missing from the panel environment.");
  }

  try {
    const [totalProjects, activeProjects, publishedProjects, totalDeployments, recentRaw] =
      await Promise.all([
        db.project.count(),
        db.project.count({ where: { status: ProjectStatus.ACTIVE } }),
        db.project.count({ where: { visibility: Visibility.PUBLIC } }),
        db.deployment.count(),
        db.project.findMany({
          include:  PROJECT_INCLUDE,
          orderBy:  { updatedAt: "desc" },
          take:     4,
        }),
      ]);

    stats = { totalProjects, activeProjects, publishedProjects, totalDeployments };
    recentProjectCards = recentRaw.map((p) => toProjectViewModel(p as ProjectListItem));
    return renderPage(stats, recentProjectCards, null);
  } catch (err) {
    console.error("[dashboard] failed to load dashboard data", err);
    return renderPage(stats, [], "Dashboard data failed to load. Check server logs.");
  }
}
