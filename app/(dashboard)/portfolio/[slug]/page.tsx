import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Github, Calendar } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await db.portfolioItem.findUnique({
    where: { slug },
    select: { title: true },
  });
  return { title: item?.title ?? "Portfolio Item" };
}

export default async function PortfolioItemPage({ params }: Props) {
  const { slug } = await params;

  const item = await db.portfolioItem.findUnique({
    where: { slug },
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

  if (!item) notFound();

  return (
    <DashboardShell>
      <Button
        variant="ghost"
        size="sm"
        className="mb-6 -ml-2 text-muted-foreground"
        asChild
      >
        <Link href="/portfolio">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to portfolio
        </Link>
      </Button>

      <div className="max-w-2xl">
        {/* Hero */}
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-48 w-full rounded-xl object-cover border mb-6"
          />
        ) : (
          <div className="h-48 w-full rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-background border mb-6 flex items-center justify-center">
            <span className="text-4xl font-bold text-primary/20">
              {item.title.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">{item.title}</h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Published {formatDate(item.publishedAt)}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {item.liveUrl && (
              <Button asChild>
                <a href={item.liveUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  Live Demo
                </a>
              </Button>
            )}
            {item.githubUrl && (
              <Button variant="outline" asChild>
                <a href={item.githubUrl} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4 mr-1.5" />
                  Source
                </a>
              </Button>
            )}
          </div>
        </div>

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <Separator className="mb-6" />

        {item.description ? (
          <div className="prose prose-sm max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description provided.
          </p>
        )}

        <Card className="mt-8 bg-muted/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground text-center">
              Full portfolio item editor (screenshots, detailed writeups, metrics) coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
