import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  ExternalLink,
  Github,
  Star,
  Plus,
  Eye,
  Database,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  let items: Array<{
    id: string;
    title: string;
    description: string | null;
    slug: string;
    tags: string[];
    liveUrl: string | null;
    githubUrl: string | null;
    featured: boolean;
    publishedAt: Date;
  }> = [];
  let dbError = false;

  try {
    const workspaceId = await getCurrentWorkspaceId();
    items = await db.portfolioItem.findMany({
      where: { workspaceId },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { publishedAt: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        slug: true,
        tags: true,
        liveUrl: true,
        githubUrl: true,
        featured: true,
        publishedAt: true,
      },
    });
  } catch {
    dbError = true;
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Portfolio"
        description="Showcase your best projects to the world."
        action={
          <Button variant="outline" asChild>
            <a href="/portfolio/preview" target="_blank">
              <Eye className="h-4 w-4 mr-1.5" />
              Preview
            </a>
          </Button>
        }
      />

      {dbError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 mb-6 text-sm text-destructive">
          <Database className="h-4 w-4 shrink-0" />
          Could not load portfolio items from the database.
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="text-center py-20">
          <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
            <BookOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No portfolio items yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Portfolio items are managed directly in the database for now. A UI
            for adding items is coming soon.
          </p>
          <Button asChild variant="outline">
            <Link href="/projects">Browse Projects</Link>
          </Button>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.id} className="group">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  {/* Thumbnail placeholder */}
                  <div className="h-16 w-24 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border shrink-0 flex items-center justify-center">
                    <BookOpen className="h-6 w-6 text-primary/40" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/portfolio/${item.slug}`}
                        className="font-semibold hover:text-primary transition-colors"
                      >
                        {item.title}
                      </Link>
                      {item.featured && (
                        <Badge variant="default" className="text-xs">
                          <Star className="h-2.5 w-2.5 mr-1" />
                          Featured
                        </Badge>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {item.description}
                      </p>
                    )}
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs px-1.5">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      {item.liveUrl && (
                        <a
                          href={item.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Live
                        </a>
                      )}
                      {item.githubUrl && (
                        <a
                          href={item.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Github className="h-3 w-3" />
                          Source
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        Published {formatDate(item.publishedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          <p className="text-xs text-muted-foreground text-center pt-2">
            Portfolio item management UI coming soon. Items can be added directly via the database.
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
