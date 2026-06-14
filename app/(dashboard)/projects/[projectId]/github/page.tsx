import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Github,
  GitBranch,
  GitCommit,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Hash,
  Files,
  Link2Off,
  Activity,
  FileText,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SyncButton } from "@/components/github/sync-button";
import { RepairInstallationIdButton } from "@/components/github/repair-installation-id-button";
import { db } from "@/lib/db";
import { getProjectGitHubData } from "@/lib/data/github";
import { unlinkGitHubRepositoryAction } from "@/app/actions/github";
import type { GitSyncStatus, LogLevel } from "@prisma/client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "GitHub" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const SYNC_STATUS_ICON: Record<GitSyncStatus, React.ReactNode> = {
  PENDING: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  RUNNING: <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  SUCCESS: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  FAILED: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  SKIPPED: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
};

const SYNC_STATUS_LABEL: Record<GitSyncStatus, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCESS: "Success",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

const LOG_LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "text-muted-foreground",
  INFO: "text-blue-500",
  WARN: "text-yellow-500",
  ERROR: "text-destructive",
  FATAL: "text-destructive",
};

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm py-1.5 border-b last:border-0">
      <span className="text-muted-foreground shrink-0 w-4">{icon}</span>
      <span className="text-muted-foreground text-xs w-36 shrink-0">{label}</span>
      <span className="text-xs flex-1">{value}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProjectGithubPage({ params }: Props) {
  const { projectId } = await params;

  // Load full GitHub data. On any DB error, verify the project actually
  // exists before propagating so a schema/connection issue never silently
  // becomes a 404 for a project that IS in the database.
  let project: Awaited<ReturnType<typeof getProjectGitHubData>>;
  try {
    project = await getProjectGitHubData(projectId);
  } catch (err) {
    const exists = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) notFound();
    throw err; // project exists but query failed — surface as 500, not 404
  }
  if (!project) notFound();

  const repo = project.githubRepository;
  const latestSyncRun = project.syncRuns[0] ?? null;
  const latestLog = project.logs[0] ?? null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="GitHub"
          description="Manage your repository connection and view commit history."
        />

        {repo ? (
          <div className="space-y-6 max-w-2xl">
            {/* ── Repository info + sync health ── */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Github className="h-4 w-4 shrink-0" />
                      <span className="font-semibold text-sm truncate">
                        {repo.fullName}
                      </span>
                      <Badge variant="success">Connected</Badge>
                      {repo.private && (
                        <Badge variant="secondary">Private</Badge>
                      )}
                    </div>
                    {repo.htmlUrl && (
                      <a
                        href={repo.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors w-fit"
                      >
                        Open on GitHub
                        <ExternalLink className="h-3 w-3 ml-0.5" />
                      </a>
                    )}
                  </div>

                  {/* Unlink button */}
                  <form action={unlinkGitHubRepositoryAction.bind(null, projectId)}>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive gap-1.5 text-xs"
                      title="Unlink repository — commit and file history is kept"
                    >
                      <Link2Off className="h-3.5 w-3.5" />
                      Unlink Repo
                    </Button>
                  </form>
                </div>

                <div className="mt-3">
                  <SyncButton projectId={projectId} />
                </div>
              </CardHeader>

              {/* ── Sync health detail table ── */}
              <CardContent className="pt-0 pb-4">
                <div className="rounded-lg border bg-muted/10 px-4 py-2">
                  <StatRow
                    icon={<Hash className="h-3.5 w-3.5" />}
                    label="Installation ID"
                    value={
                      repo.installationId ? (
                        <code className="font-mono">{repo.installationId}</code>
                      ) : (
                        <span className="text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Missing — install the GitHub App on this repo
                        </span>
                      )
                    }
                  />
                  <StatRow
                    icon={<GitBranch className="h-3.5 w-3.5" />}
                    label="Default branch"
                    value={
                      <code className="font-mono text-xs">{repo.defaultBranch}</code>
                    }
                  />
                  <StatRow
                    icon={<GitCommit className="h-3.5 w-3.5" />}
                    label="Latest commit"
                    value={
                      repo.latestCommitSha ? (
                        <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                          {repo.latestCommitSha.slice(0, 7)}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                  />
                  <StatRow
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Last synced"
                    value={timeAgo(repo.syncedAt)}
                  />
                  <StatRow
                    icon={<GitCommit className="h-3.5 w-3.5" />}
                    label="Total commits"
                    value={`${project._count.commits} stored`}
                  />
                  <StatRow
                    icon={<Files className="h-3.5 w-3.5" />}
                    label="Files in tree"
                    value={`${project._count.files} files`}
                  />
                  <StatRow
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="Latest sync run"
                    value={
                      latestSyncRun ? (
                        <span className="flex items-center gap-1.5">
                          {SYNC_STATUS_ICON[latestSyncRun.status]}
                          <span>
                            {SYNC_STATUS_LABEL[latestSyncRun.status]}
                          </span>
                          <span className="text-muted-foreground">
                            · {latestSyncRun.source} · {timeAgo(latestSyncRun.startedAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No runs yet</span>
                      )
                    }
                  />
                  <StatRow
                    icon={<FileText className="h-3.5 w-3.5" />}
                    label="Latest log"
                    value={
                      latestLog ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`font-medium ${LOG_LEVEL_COLOR[latestLog.level]}`}
                          >
                            {latestLog.level}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {latestLog.message}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            · {timeAgo(latestLog.timestamp)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Missing installation ID warning + repair button */}
            {!repo.installationId && (
              <div className="flex gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm flex-1 min-w-0">
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-0.5">
                    Installation ID not recorded
                  </p>
                  <p className="text-amber-700 dark:text-amber-300 text-xs mb-3">
                    The GitHub App installation ID is required for API sync. Push
                    a commit to this repo to capture it automatically — or click
                    the button below to recover it from previous webhook deliveries.
                  </p>
                  <RepairInstallationIdButton
                    projectId={projectId}
                    variant="inline"
                  />
                </div>
              </div>
            )}

            {/* Commits */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Recent Commits
                  <span className="text-muted-foreground font-normal ml-1.5">
                    (showing {project.commits.length} of {project._count.commits})
                  </span>
                </CardTitle>
                {project.commits.length === 0 && (
                  <CardDescription>
                    No commits synced yet — click &ldquo;Sync from GitHub&rdquo; to fetch them.
                  </CardDescription>
                )}
              </CardHeader>
              {project.commits.length > 0 && (
                <CardContent className="p-0">
                  <div className="divide-y">
                    {project.commits.map((commit) => (
                      <div
                        key={commit.id}
                        className="flex items-start gap-3 px-6 py-3"
                      >
                        <GitCommit className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{commit.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {commit.authorName} &middot; {timeAgo(commit.committedAt)}
                          </p>
                        </div>
                        {commit.url ? (
                          <a
                            href={commit.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono hover:text-foreground transition-colors shrink-0">
                              {commit.sha.slice(0, 7)}
                            </code>
                          </a>
                        ) : (
                          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">
                            {commit.sha.slice(0, 7)}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Sync history */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Sync History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {project.syncRuns.length === 0 ? (
                  <div className="px-6 pb-4 text-sm text-muted-foreground">
                    No sync runs yet.
                  </div>
                ) : (
                  <div className="divide-y">
                    {project.syncRuns.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center gap-3 px-6 py-2.5 text-sm"
                      >
                        <span className="shrink-0">
                          {SYNC_STATUS_ICON[run.status]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">
                            {SYNC_STATUS_LABEL[run.status]}
                          </span>
                          <span className="text-muted-foreground text-xs ml-2">
                            {run.source} · {run.branch}
                            {run.changedFiles > 0 &&
                              ` · ${run.changedFiles} files`}
                          </span>
                          {run.errorMessage && (
                            <p className="text-xs text-destructive mt-0.5 truncate">
                              {run.errorMessage}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {timeAgo(run.startedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-center text-center p-8 gap-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Github className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">No repository connected</h3>
                <p className="text-sm text-muted-foreground">
                  Import a GitHub repository from the{" "}
                  <a
                    href="/integrations/github"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Integrations
                  </a>{" "}
                  page, or link one from a detected repository.
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href="/integrations/github">
                  <Github className="h-4 w-4 mr-2" />
                  GitHub Integrations
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </DashboardShell>
    </div>
  );
}
