import Link from "next/link";
import { Lock, Globe, GitBranch, ExternalLink } from "lucide-react";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-400",
  Python: "bg-green-500",
  Go: "bg-cyan-500",
  Rust: "bg-orange-500",
  Ruby: "bg-red-500",
  Java: "bg-orange-600",
  "C++": "bg-pink-500",
  Shell: "bg-gray-500",
  Other: "bg-gray-400",
};

type GitHubRepositoryCardProps = {
  fullName: string;
  name?: string;
  description?: string | null;
  isPrivate?: boolean;
  language?: string | null;
  defaultBranch?: string;
  htmlUrl?: string;
  /** For imported repos: the linked project's id */
  linkedProjectId?: string;
  /** For imported repos: the linked project's name */
  linkedProjectName?: string;
  /** Action buttons / forms rendered inline in the card header row */
  actions?: React.ReactNode;
  /**
   * Optional footer content rendered below the main row, separated by a
   * border. Useful for expanded forms (e.g. link-to-project).
   */
  footer?: React.ReactNode;
};

export function GitHubRepositoryCard({
  fullName,
  name,
  description,
  isPrivate = false,
  language,
  defaultBranch = "main",
  htmlUrl,
  linkedProjectId,
  linkedProjectName,
  actions,
  footer,
}: GitHubRepositoryCardProps) {
  const displayName = name ?? fullName.split("/")[1] ?? fullName;
  const owner = fullName.split("/")[0] ?? "";
  const langColor = language
    ? (LANG_COLORS[language] ?? LANG_COLORS.Other)
    : null;

  return (
    <div>
      {/* Main content row */}
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-medium text-sm">{displayName}</span>
            {owner && (
              <span className="text-xs text-muted-foreground">by {owner}</span>
            )}
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              {isPrivate ? (
                <>
                  <Lock className="h-3 w-3" />
                  Private
                </>
              ) : (
                <>
                  <Globe className="h-3 w-3" />
                  Public
                </>
              )}
            </span>
            {htmlUrl && (
              <a
                href={htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Open on GitHub"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Description */}
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-1 mb-1">
              {description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {language && langColor && (
              <span className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${langColor}`} />
                {language}
              </span>
            )}
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {defaultBranch}
            </span>
            {linkedProjectId && linkedProjectName && (
              <Link
                href={`/projects/${linkedProjectId}`}
                className="text-green-600 dark:text-green-400 font-medium hover:underline"
              >
                → {linkedProjectName}
              </Link>
            )}
          </div>
        </div>

        {/* Action slot */}
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>

      {/* Optional footer (e.g. link-to-project form) */}
      {footer && (
        <div className="border-t px-5 py-3 bg-muted/20">{footer}</div>
      )}
    </div>
  );
}
