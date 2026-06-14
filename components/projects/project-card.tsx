import Link from "next/link";
import {
  GitBranch,
  Globe,
  Clock,
  MoreHorizontal,
  ExternalLink,
  Archive,
  Trash2,
} from "lucide-react";
import { type Project } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_BADGE: Record<
  Project["status"],
  { label: string; variant: "success" | "warning" | "error" | "secondary" }
> = {
  active: { label: "Active", variant: "success" },
  building: { label: "Building", variant: "warning" },
  error: { label: "Error", variant: "error" },
  archived: { label: "Archived", variant: "secondary" },
  draft: { label: "Draft", variant: "secondary" },
};

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-400",
  Python: "bg-green-500",
  Go: "bg-cyan-500",
  Rust: "bg-orange-500",
  Other: "bg-gray-400",
};

type ProjectCardProps = {
  project: Project;
};

export function ProjectCard({ project }: ProjectCardProps) {
  const status = STATUS_BADGE[project.status];
  const langColor = LANGUAGE_COLORS[project.language] ?? LANGUAGE_COLORS.Other;

  return (
    <Card className="group hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor}`} />
            <Link
              href={`/projects/${project.id}`}
              className="font-semibold text-sm truncate hover:text-primary transition-colors"
            >
              {project.name}
            </Link>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={status.variant}>{status.label}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/projects/${project.id}`}>Open workspace</Link>
                </DropdownMenuItem>
                {project.url && (
                  <DropdownMenuItem asChild>
                    <a href={project.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View live site
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Archive className="mr-2 h-4 w-4" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
          {project.description}
        </p>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {project.githubRepo && (
            <span className="flex items-center gap-1 truncate">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{project.githubRepo}</span>
            </span>
          )}
          {project.url && (
            <span className="flex items-center gap-1 shrink-0">
              <Globe className="h-3 w-3" />
              Live
            </span>
          )}
          {project.lastDeployed && (
            <span className="flex items-center gap-1 ml-auto shrink-0">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(project.lastDeployed)}
            </span>
          )}
        </div>

        {project.framework && (
          <div className="mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">
              {project.language} · {project.framework}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
