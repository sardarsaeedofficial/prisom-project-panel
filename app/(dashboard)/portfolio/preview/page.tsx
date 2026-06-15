import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Github, Star, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio Preview" };
export const dynamic = "force-dynamic";

/**
 * Public-style preview of the portfolio.
 * Shows how the portfolio would look to a visitor.
 * Opened in a new tab from the Portfolio management page.
 */
export default async function PortfolioPreviewPage() {
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
    imageUrl: string | null;
  }> = [];

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
        imageUrl: true,
      },
    });
  } catch {
    // silently fail — show empty state
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Preview banner */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-muted/80 backdrop-blur px-6 py-2 text-sm">
        <Badge variant="secondary" className="text-xs">Preview</Badge>
        <span className="text-muted-foreground">
          This is how your portfolio looks to visitors.
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href="/portfolio">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to manage
          </Link>
        </Button>
      </div>

      {/* Portfolio content */}
      <div className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-12">
          <h1 className="text-3xl font-bold mb-2">Portfolio</h1>
          <p className="text-muted-foreground">
            {items.length === 0
              ? "No published items yet."
              : `${items.length} project${items.length !== 1 ? "s" : ""}`}
          </p>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Nothing here yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Add portfolio items from the{" "}
              <Link href="/portfolio" className="underline underline-offset-2 hover:text-foreground">
                Portfolio
              </Link>{" "}
              page.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {items.map((item) => (
              <article key={item.id} className="group">
                {/* Thumbnail */}
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="h-52 w-full rounded-xl object-cover border mb-5"
                  />
                ) : (
                  <div className="h-52 w-full rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-background border mb-5 flex items-center justify-center">
                    <span className="text-5xl font-black text-primary/20 select-none">
                      {item.title.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}

                {/* Meta */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-semibold">{item.title}</h2>
                      {item.featured && (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
                      )}
                    </div>
                    {item.description && (
                      <p className="text-muted-foreground leading-relaxed mb-3">
                        {item.description}
                      </p>
                    )}
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.publishedAt)}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 shrink-0">
                    {item.liveUrl && (
                      <Button size="sm" asChild>
                        <a href={item.liveUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Live
                        </a>
                      </Button>
                    )}
                    {item.githubUrl && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={item.githubUrl} target="_blank" rel="noopener noreferrer">
                          <Github className="h-3.5 w-3.5 mr-1.5" />
                          Code
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Divider between items */}
                <hr className="mt-10 border-border/50" />
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
