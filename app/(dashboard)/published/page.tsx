import type { Metadata } from "next";
import Link from "next/link";
import { Globe, ExternalLink, Eye, Plus, Database } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { Visibility } from "@prisma/client";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Published" };
export const dynamic = "force-dynamic";

export default async function PublishedPage() {
  let publishedProjects: Array<{
    id: string;
    name: string;
    description: string | null;
    liveUrl: string | null;
    lastDeployedAt: Date | null;
    domains: Array<{ hostname: string; isPrimary: boolean }>;
  }> = [];
  let dbError = false;

  try {
    const workspaceId = await getCurrentWorkspaceId();
    publishedProjects = await db.project.findMany({
      where: { workspaceId, visibility: Visibility.PUBLIC },
      orderBy: { lastDeployedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        liveUrl: true,
        lastDeployedAt: true,
        domains: {
          select: { hostname: true, isPrimary: true },
          orderBy: { isPrimary: "desc" },
          take: 1,
        },
      },
    });
  } catch {
    dbError = true;
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Published Projects"
        description="Projects set to Public visibility."
        action={
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        }
      />

      {dbError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 mb-6 text-sm text-destructive">
          <Database className="h-4 w-4 shrink-0" />
          Could not load projects from the database.
        </div>
      )}

      {!dbError && publishedProjects.length === 0 && (
        <div className="text-center py-20">
          <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No published projects yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Set a project&apos;s visibility to <strong>Public</strong> in its Settings to make it appear here.
          </p>
          <Button asChild>
            <Link href="/projects">Go to Projects</Link>
          </Button>
        </div>
      )}

      {publishedProjects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publishedProjects.map((project) => {
            const liveUrl =
              project.liveUrl ??
              (project.domains[0]
                ? `https://${project.domains[0].hostname}`
                : null);

            return (
              <Card
                key={project.id}
                className="group hover:shadow-md transition-shadow"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="h-4 w-4 text-primary shrink-0" />
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-semibold text-sm hover:text-primary transition-colors truncate"
                      >
                        {project.name}
                      </Link>
                    </div>
                    <Badge variant="success" className="shrink-0">
                      Live
                    </Badge>
                  </div>

                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
                      {project.description}
                    </p>
                  )}

                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Public
                    </span>
                    {project.lastDeployedAt && (
                      <span className="ml-auto">
                        {formatDate(project.lastDeployedAt)}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {liveUrl ? (
                      <a
                        href={liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs"
                        >
                          <ExternalLink className="h-3 w-3 mr-1.5" />
                          View Live
                        </Button>
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        disabled
                      >
                        No URL set
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-xs" asChild>
                      <Link href={`/projects/${project.id}/publishing`}>
                        Manage
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}
