import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Database } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { ProjectCard } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getProjects, toProjectViewModel, type ProjectListItem } from "@/lib/data/projects";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects" };

type Props = { searchParams: Promise<{ status?: string }> };

const STATUS_MAP: Record<string, string> = {
  active: "ACTIVE",
  building: "BUILDING",
  error: "ERROR",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "building", label: "Building" },
  { key: "error", label: "Error" },
];

// Shared include so the Tier-2 fallback query produces the same shape as getProjects().
const PROJECT_INCLUDE = {
  githubRepository: true,
  domains:          { where: { isPrimary: true }, take: 1 },
  deployments:      { orderBy: { createdAt: "desc" } as const, take: 1 },
  environments:     true,
  _count:           { select: { logs: true, tasks: true, features: true, commits: true } },
} as const;

export default async function ProjectsPage({ searchParams }: Props) {
  const { status: statusParam } = await searchParams;

  let allProjects: ProjectListItem[] = [];
  let dbError: string | null = null;

  // ── Tier 1: session-aware, workspace-scoped query ─────────────────────────
  try {
    allProjects = await getProjects();
  } catch (err) {
    console.error("[projects] workspace-scoped project load failed", err);

    // ── Tier 2: direct DB query (no session/workspace dependency) ──────────
    if (!process.env.DATABASE_URL) {
      dbError = "DATABASE_URL is missing from the panel environment.";
    } else {
      try {
        allProjects = await db.project.findMany({
          include: PROJECT_INCLUDE,
          orderBy: { updatedAt: "desc" },
        }) as ProjectListItem[];
      } catch (fallbackErr) {
        console.error("[projects] direct DB fallback also failed", fallbackErr);
        dbError = "Projects failed to load. Check server logs.";
      }
    }
  }

  const nonArchivedProjects = allProjects.filter((p) => p.status !== "ARCHIVED");
  const prismaStatus = statusParam ? STATUS_MAP[statusParam] : undefined;
  const activeProjects = prismaStatus
    ? nonArchivedProjects.filter((p) => p.status === prismaStatus)
    : nonArchivedProjects;
  const archivedProjects = allProjects.filter((p) => p.status === "ARCHIVED");

  return (
    <DashboardShell>
      <PageHeader
        title="Projects"
        description="All your projects in one place."
        action={
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex gap-1.5">
          {FILTERS.map(({ key, label }) => {
            const isActive = key === "all" ? !statusParam : statusParam === key;
            return (
              <Button
                key={key}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                asChild
              >
                <Link href={key === "all" ? "/projects" : `/projects?status=${key}`}>
                  {label}
                </Link>
              </Button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <span>{activeProjects.length} project{activeProjects.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* DB error state */}
      {dbError && (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg bg-muted/20">
          <Database className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground">{dbError}</p>
          {!process.env.DATABASE_URL && (
            <p className="text-xs text-muted-foreground mt-1">
              Set DATABASE_URL in .env and run{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded">npm run db:push &amp;&amp; npm run db:seed</code>
            </p>
          )}
        </div>
      )}

      {/* Active projects */}
      {!dbError && (
        <>
          {activeProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg bg-muted/20">
              <p className="text-sm font-medium text-muted-foreground">No projects yet.</p>
              <Button asChild className="mt-4" size="sm">
                <Link href="/projects/new">Create your first project</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-10">
              {activeProjects.map((project) => (
                <ProjectCard key={project.id} project={toProjectViewModel(project)} />
              ))}
            </div>
          )}

          {/* Archived */}
          {archivedProjects.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Archived
                </h2>
                <Badge variant="secondary">{archivedProjects.length}</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-60">
                {archivedProjects.map((project) => (
                  <ProjectCard key={project.id} project={toProjectViewModel(project)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
