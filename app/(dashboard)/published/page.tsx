import type { Metadata } from "next";
import Link from "next/link";
import { Globe, ExternalLink, Star, Eye, Plus } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MOCK_PROJECTS } from "@/lib/mock-data";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Published" };

export default function PublishedPage() {
  const publishedProjects = MOCK_PROJECTS.filter((p) => p.isPublished);

  return (
    <DashboardShell>
      <PageHeader
        title="Published Projects"
        description="Projects that are publicly live and accessible."
        action={
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        }
      />

      {publishedProjects.length === 0 ? (
        <div className="text-center py-20">
          <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No published projects</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Publish a project to make it publicly accessible.
          </p>
          <Button asChild>
            <Link href="/projects">Go to Projects</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publishedProjects.map((project) => (
            <Card key={project.id} className="group hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary shrink-0" />
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-semibold text-sm hover:text-primary transition-colors"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <Badge variant="success">Live</Badge>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
                  {project.description}
                </p>

                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                  {project.stars !== undefined && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      {project.stars}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    Portfolio
                  </span>
                  {project.lastDeployed && (
                    <span className="ml-auto">{formatDate(project.lastDeployed)}</span>
                  )}
                </div>

                {project.url && (
                  <div className="flex gap-2">
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        View Live
                      </Button>
                    </a>
                    <Button variant="ghost" size="sm" className="text-xs" asChild>
                      <Link href={`/projects/${project.id}/publishing`}>
                        Manage
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
