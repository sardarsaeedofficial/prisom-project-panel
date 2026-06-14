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
import { getProjects, toProjectViewModel } from "@/lib/data/projects";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { ProjectStatus, Visibility } from "@prisma/client";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // ── Fetch real data from DB ──────────────────────────────────────────────────
  type DashboardStats = {
    totalProjects: number;
    activeProjects: number;
    publishedProjects: number;
    totalDeployments: number;
  };

  let stats: DashboardStats = {
    totalProjects: 0,
    activeProjects: 0,
    publishedProjects: 0,
    totalDeployments: 0,
  };
  let recentProjectCards: ReturnType<typeof toProjectViewModel>[] = [];
  let dbError: string | null = null;

  try {
    const [allProjects, workspaceId] = await Promise.all([
      getProjects(),
      getCurrentWorkspaceId(),
    ]);

    stats = {
      totalProjects: allProjects.length,
      activeProjects: allProjects.filter((p) => p.status === ProjectStatus.ACTIVE).length,
      publishedProjects: allProjects.filter(
        (p) => p.visibility === Visibility.PUBLIC
      ).length,
      totalDeployments: await db.deployment.count({
        where: { project: { workspaceId } },
      }),
    };

    recentProjectCards = allProjects
      .slice(0, 4)
      .map((p) => toProjectViewModel(p));
  } catch {
    dbError =
      "Could not connect to the database. Set DATABASE_URL in .env and run db:seed.";
  }

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

      {/* DB error banner */}
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
          trend={{ value: "From database", positive: true }}
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
