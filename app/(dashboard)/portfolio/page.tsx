import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ExternalLink, Github, Star, Plus, Eye } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MOCK_PORTFOLIO_PROJECTS } from "@/lib/mock-data";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <DashboardShell>
      <PageHeader
        title="Portfolio"
        description="Showcase your best projects to the world."
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href="/portfolio/preview" target="_blank">
                <Eye className="h-4 w-4 mr-1.5" />
                Preview
              </a>
            </Button>
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Project
            </Button>
          </div>
        }
      />

      {/* Portfolio visibility toggle */}
      <Card className="mb-6">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Portfolio visibility</p>
            <p className="text-xs text-muted-foreground">
              Your portfolio is publicly accessible at{" "}
              <code className="font-mono bg-muted px-1 rounded">prisom.dev/u/alexrivera</code>
            </p>
          </div>
          <Switch defaultChecked />
        </CardContent>
      </Card>

      {MOCK_PORTFOLIO_PROJECTS.length === 0 ? (
        <div className="text-center py-20">
          <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
            <BookOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No portfolio items yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add published projects to your portfolio to showcase your work.
          </p>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Project
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {MOCK_PORTFOLIO_PROJECTS.map((item) => (
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
                        {item.name}
                      </Link>
                      {item.featured && (
                        <Badge variant="default" className="text-xs">
                          <Star className="h-2.5 w-2.5 mr-1" />
                          Featured
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {item.description}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs px-1.5">
                          {tag}
                        </Badge>
                      ))}
                    </div>
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

                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button variant="outline" size="sm" className="text-xs">Edit</Button>
                    <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive">
                      Remove
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
