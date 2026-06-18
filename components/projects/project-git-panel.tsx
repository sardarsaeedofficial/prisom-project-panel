"use client";

/**
 * components/projects/project-git-panel.tsx
 *
 * Sprint 8 — Full Git operations panel for projects that have a local git repo
 * in storage/projects/<slug>/.
 *
 * Features:
 *   • Status header (branch, upstream, ahead/behind, clean/dirty)
 *   • Fetch / Pull (--ff-only) / Push (with confirmation dialog)
 *   • Staged and unstaged file lists with per-file Stage / Unstage buttons
 *   • "Stage All Safe Files" / "Unstage All" convenience buttons
 *   • Commit message textarea + Commit button (disabled if nothing staged)
 *   • Inline diff viewer (per-file, staged or unstaged)
 *   • Recent commits list
 *
 * Safety:
 *   • Blocked files (*.env, *.pem, *.key, …) shown with a lock icon
 *   • Push requires an explicit "I understand" confirmation dialog
 *   • Pull blocked if working tree is dirty (server-side check)
 *   • No destructive operations exposed in this panel
 */

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  Upload,
  Download,
  ArrowUpFromLine,
  ArrowDownToLine,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Lock,
  Minus,
  Plus,
  ChevronsUp,
  ChevronsDown,
  ChevronRight,
  ChevronDown,
  Loader2,
  Info,
} from "lucide-react";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Textarea }   from "@/components/ui/textarea";
import { Separator }  from "@/components/ui/separator";
import {
  getProjectGitStatusAction,
  getProjectGitDiffAction,
  stageProjectFilesAction,
  unstageProjectFilesAction,
  commitProjectChangesAction,
  fetchProjectRepoAction,
  pullProjectRepoAction,
  pushProjectRepoAction,
} from "@/app/actions/project-git";
import type {
  GitRepoStatus,
  GitChangedFile,
  GitCommitSummary,
} from "@/lib/projects/git-manager";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ── Diff viewer state ─────────────────────────────────────────────────────────

interface DiffState {
  path:      string;
  staged:    boolean;
  content:   string | null;
  loading:   boolean;
  truncated: boolean;
}

// ── Feedback ──────────────────────────────────────────────────────────────────

interface Feedback {
  message: string;
  ok:      boolean;
}

// ── Helper: diff line coloring ────────────────────────────────────────────────

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return (
      <span className="text-muted-foreground">{line}{"\n"}</span>
    );
  }
  if (line.startsWith("+")) {
    return (
      <span className="text-green-600 dark:text-green-400">{line}{"\n"}</span>
    );
  }
  if (line.startsWith("-")) {
    return (
      <span className="text-red-600 dark:text-red-400">{line}{"\n"}</span>
    );
  }
  if (line.startsWith("@@")) {
    return (
      <span className="text-blue-500 dark:text-blue-400">{line}{"\n"}</span>
    );
  }
  return <span>{line}{"\n"}</span>;
}

// ── Helper: status badge ──────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: GitChangedFile["status"];
}) {
  const cfg: Record<GitChangedFile["status"], { label: string; cls: string }> = {
    modified:  { label: "M", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300" },
    added:     { label: "A", cls: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"   },
    deleted:   { label: "D", cls: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"           },
    renamed:   { label: "R", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"       },
    untracked: { label: "?", cls: "bg-muted text-muted-foreground"                                         },
    unknown:   { label: "~", cls: "bg-muted text-muted-foreground"                                         },
  };
  const { label, cls } = cfg[status] ?? cfg.unknown;
  return (
    <span
      className={`inline-flex items-center justify-center h-4 w-4 rounded text-[10px] font-bold shrink-0 ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectGitPanel({ projectId }: Props) {
  const [status,       setStatus]       = useState<GitRepoStatus | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [actionBusy,   setActionBusy]   = useState<string | null>(null);
  const [feedback,     setFeedback]     = useState<Feedback | null>(null);
  const [commitMsg,    setCommitMsg]    = useState("");
  const [diff,         setDiff]         = useState<DiffState | null>(null);
  const [pushConfirm,  setPushConfirm]  = useState(false);
  const [commitOpen,   setCommitOpen]   = useState(true);
  const [commitsOpen,  setCommitsOpen]  = useState(false);

  // ── Load status ─────────────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const result = await getProjectGitStatusAction(projectId);
    if (result.ok) {
      setStatus(result.data);
    } else {
      showFeedback(result.error, false);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // ── Feedback helpers ─────────────────────────────────────────────────────────

  function showFeedback(message: string, ok: boolean) {
    setFeedback({ message, ok });
    setTimeout(() => setFeedback(null), ok ? 5_000 : 8_000);
  }

  // ── Generic action runner ────────────────────────────────────────────────────

  async function run<T>(
    key:       string,
    action:    () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    onSuccess: (data: T) => void,
    successMsg?: string,
  ) {
    setActionBusy(key);
    setFeedback(null);
    try {
      const result = await action();
      if (result.ok) {
        if (successMsg) showFeedback(successMsg, true);
        onSuccess(result.data);
        await loadStatus();
      } else {
        showFeedback(result.error, false);
      }
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : "An unexpected error occurred.", false);
    } finally {
      setActionBusy(null);
    }
  }

  // ── Stage / Unstage ──────────────────────────────────────────────────────────

  function handleStage(paths: string[]) {
    return run(
      "stage",
      () => stageProjectFilesAction({ projectId, paths }),
      (data) => {
        if (data.blocked.length > 0) {
          showFeedback(
            `Staged ${data.staged} file(s). Blocked: ${data.blocked.join(", ")}`,
            data.staged > 0,
          );
        } else {
          showFeedback(`Staged ${data.staged} file(s).`, true);
        }
      },
    );
  }

  function handleUnstage(paths: string[]) {
    return run(
      "unstage",
      () => unstageProjectFilesAction({ projectId, paths }),
      () => {},
      `Unstaged ${paths.length} file(s).`,
    );
  }

  function handleStageAll() {
    const safePaths = (status?.changedFiles ?? [])
      .filter((f) => (f.unstaged || f.status === "untracked") && f.safeToStage)
      .map((f) => f.path);
    if (safePaths.length === 0) {
      showFeedback("No safe files to stage.", false);
      return;
    }
    return handleStage(safePaths);
  }

  function handleUnstageAll() {
    const paths = (status?.changedFiles ?? [])
      .filter((f) => f.staged)
      .map((f) => f.path);
    if (paths.length === 0) {
      showFeedback("No staged files to unstage.", false);
      return;
    }
    return handleUnstage(paths);
  }

  // ── Commit ────────────────────────────────────────────────────────────────────

  function handleCommit() {
    const msg = commitMsg.trim();
    if (!msg) { showFeedback("Commit message is required.", false); return; }
    return run(
      "commit",
      () => commitProjectChangesAction({ projectId, message: msg }),
      (data) => {
        setCommitMsg("");
        showFeedback(`Committed ${data.hash}: ${msg.slice(0, 60)}`, true);
      },
    );
  }

  // ── Fetch / Pull / Push ───────────────────────────────────────────────────────

  function handleFetch() {
    return run(
      "fetch",
      () => fetchProjectRepoAction(projectId),
      () => {},
      "Fetch complete.",
    );
  }

  function handlePull() {
    return run(
      "pull",
      () => pullProjectRepoAction(projectId),
      () => {},
      "Pull complete (fast-forward).",
    );
  }

  function handlePushConfirmed() {
    setPushConfirm(false);
    return run(
      "push",
      () => pushProjectRepoAction({ projectId, confirmed: true }),
      () => {},
      "Push complete.",
    );
  }

  // ── Diff viewer ──────────────────────────────────────────────────────────────

  async function handleViewDiff(filePath: string, staged: boolean) {
    // Toggle off if already viewing the same file
    if (diff?.path === filePath && diff.staged === staged && !diff.loading) {
      setDiff(null);
      return;
    }

    setDiff({ path: filePath, staged, content: null, loading: true, truncated: false });
    const result = await getProjectGitDiffAction({ projectId, path: filePath, staged });
    if (result.ok) {
      setDiff({ path: filePath, staged, content: result.data.diff, loading: false, truncated: result.data.truncated });
    } else {
      setDiff(null);
      showFeedback(result.error, false);
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const stagedFiles   = status?.changedFiles.filter((f) => f.staged)   ?? [];
  const unstagedFiles = status?.changedFiles.filter((f) => f.unstaged || f.status === "untracked") ?? [];
  const hasStaged     = stagedFiles.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading git status…
      </div>
    );
  }

  if (!status?.isRepo) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center text-center p-8 gap-3">
          <Info className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm mb-1">Not a git repository</p>
            <p className="text-xs text-muted-foreground">
              Initialise a git repository above to enable commit, push and pull operations.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Feedback banner ── */}
      {feedback && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            feedback.ok
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/20 dark:text-green-300"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {feedback.ok
            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          }
          <span>{feedback.message}</span>
        </div>
      )}

      {/* ── Status header ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Branch / upstream info */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-sm font-medium">
                  {status.branch ?? "detached HEAD"}
                </span>
              </div>

              {status.upstream && (
                <span className="text-xs text-muted-foreground">→ {status.upstream}</span>
              )}

              {status.ahead > 0 && (
                <Badge className="gap-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 hover:bg-green-100">
                  <ArrowUpFromLine className="h-3 w-3" />
                  {status.ahead} ahead
                </Badge>
              )}
              {status.behind > 0 && (
                <Badge className="gap-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 hover:bg-orange-100">
                  <ArrowDownToLine className="h-3 w-3" />
                  {status.behind} behind
                </Badge>
              )}

              {status.clean
                ? <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 hover:bg-green-100">Clean</Badge>
                : <Badge variant="secondary" className="text-xs">{status.changedFiles.length} changed</Badge>
              }
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadStatus}
                disabled={!!actionBusy || loading}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetch}
                disabled={!!actionBusy}
                className="gap-1.5 text-xs"
              >
                {actionBusy === "fetch"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />
                }
                Fetch
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePull}
                disabled={!!actionBusy || !status.upstream}
                title={!status.upstream ? "No upstream configured" : "Pull (--ff-only)"}
                className="gap-1.5 text-xs"
              >
                {actionBusy === "pull"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ArrowDownToLine className="h-3.5 w-3.5" />
                }
                Pull
              </Button>
              {!pushConfirm ? (
                <Button
                  size="sm"
                  onClick={() => setPushConfirm(true)}
                  disabled={!!actionBusy || !status.branch || status.branch === "HEAD"}
                  className="gap-1.5 text-xs"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Push
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Confirm push?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handlePushConfirmed}
                    disabled={!!actionBusy}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    {actionBusy === "push"
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Upload className="h-3 w-3" />
                    }
                    Yes, push
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPushConfirm(false)}
                    className="h-7 px-2 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Remotes row */}
          {status.remotes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {status.remotes.map((r) => (
                <div key={r.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="font-mono truncate max-w-[320px]" title={r.fetchUrl}>
                    {r.fetchUrl}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Changed files ── */}
      {status.changedFiles.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Changed Files</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  disabled={!!actionBusy || unstagedFiles.filter((f) => f.safeToStage).length === 0}
                  onClick={handleStageAll}
                >
                  <ChevronsUp className="h-3 w-3" />
                  Stage All Safe
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  disabled={!!actionBusy || stagedFiles.length === 0}
                  onClick={handleUnstageAll}
                >
                  <ChevronsDown className="h-3 w-3" />
                  Unstage All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Staged section */}
            {stagedFiles.length > 0 && (
              <div>
                <div className="px-6 py-1.5 bg-muted/30 border-y text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Staged Changes ({stagedFiles.length})
                </div>
                <div className="divide-y">
                  {stagedFiles.map((f) => (
                    <FileRow
                      key={f.path + "-staged"}
                      file={f}
                      staged
                      diffActive={diff?.path === f.path && diff.staged}
                      onView={() => handleViewDiff(f.path, true)}
                      onAction={() => handleUnstage([f.path])}
                      actionBusy={actionBusy === "unstage"}
                      actionIcon={<Minus className="h-3 w-3" />}
                      actionLabel="Unstage"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unstaged / untracked section */}
            {unstagedFiles.length > 0 && (
              <div>
                <div className="px-6 py-1.5 bg-muted/30 border-y text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Unstaged Changes ({unstagedFiles.length})
                </div>
                <div className="divide-y">
                  {unstagedFiles.map((f) => (
                    <FileRow
                      key={f.path + "-unstaged"}
                      file={f}
                      staged={false}
                      diffActive={diff?.path === f.path && !diff.staged}
                      onView={() => handleViewDiff(f.path, false)}
                      onAction={f.safeToStage ? () => handleStage([f.path]) : undefined}
                      actionBusy={actionBusy === "stage"}
                      actionIcon={<Plus className="h-3 w-3" />}
                      actionLabel={f.safeToStage ? "Stage" : undefined}
                      blocked={!f.safeToStage}
                      blockReason={f.stageBlockReason}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Diff viewer */}
            {diff && (
              <div className="border-t">
                <div className="flex items-center justify-between px-6 py-2 bg-muted/20">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono">{diff.path}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {diff.staged ? "staged" : "unstaged"}
                    </Badge>
                    {diff.truncated && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        truncated at 100 KB
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setDiff(null)}
                  >
                    <EyeOff className="h-3.5 w-3.5 mr-1" />
                    Close
                  </Button>
                </div>
                <div
                  className="overflow-auto max-h-96 bg-muted/5 px-4 py-3"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  {diff.loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading diff…
                    </div>
                  ) : (
                    <pre className="text-xs leading-relaxed whitespace-pre">
                      {diff.content?.split("\n").map((line, i) => (
                        <DiffLine key={i} line={line} />
                      ))}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Commit section ── */}
      <Card>
        <CardHeader
          className="pb-2 cursor-pointer"
          onClick={() => setCommitOpen((o) => !o)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitCommit className="h-4 w-4" />
              Commit
              {hasStaged && (
                <Badge variant="secondary" className="text-xs">
                  {stagedFiles.length} staged
                </Badge>
              )}
            </CardTitle>
            {commitOpen
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
            }
          </div>
        </CardHeader>
        {commitOpen && (
          <CardContent className="pt-0 pb-4 space-y-3">
            {!hasStaged && (
              <p className="text-xs text-muted-foreground">
                Stage files above before committing.
              </p>
            )}
            <Textarea
              placeholder="Commit message…"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              rows={3}
              maxLength={5_000}
              className="resize-none font-mono text-sm"
              disabled={actionBusy === "commit"}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {commitMsg.trim().length}/5 000
              </span>
              <Button
                size="sm"
                onClick={handleCommit}
                disabled={!!actionBusy || !hasStaged || !commitMsg.trim()}
                className="gap-1.5"
              >
                {actionBusy === "commit"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <GitCommit className="h-3.5 w-3.5" />
                }
                Commit {hasStaged ? `(${stagedFiles.length})` : ""}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Recent commits ── */}
      {status.recentCommits.length > 0 && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer"
            onClick={() => setCommitsOpen((o) => !o)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <GitCommit className="h-4 w-4" />
                Recent Commits
                <span className="text-muted-foreground font-normal text-xs">
                  ({status.recentCommits.length})
                </span>
              </CardTitle>
              {commitsOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
              }
            </div>
          </CardHeader>
          {commitsOpen && (
            <CardContent className="p-0">
              <div className="divide-y">
                {status.recentCommits.map((commit) => (
                  <CommitRow key={commit.hash} commit={commit} />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ── FileRow sub-component ─────────────────────────────────────────────────────

function FileRow({
  file,
  staged,
  diffActive,
  onView,
  onAction,
  actionBusy,
  actionIcon,
  actionLabel,
  blocked,
  blockReason,
}: {
  file:        GitChangedFile;
  staged:      boolean;
  diffActive:  boolean | undefined;
  onView:      () => void;
  onAction:    (() => void | Promise<void>) | undefined;
  actionBusy:  boolean;
  actionIcon:  React.ReactNode;
  actionLabel: string | undefined;
  blocked?:    boolean;
  blockReason?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-6 py-2 text-sm hover:bg-muted/20 transition-colors ${
        diffActive ? "bg-muted/30" : ""
      }`}
    >
      <StatusBadge status={file.status} />

      <span
        className="flex-1 font-mono text-xs truncate min-w-0"
        title={file.path}
      >
        {file.path}
      </span>

      {blocked && (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
          title={blockReason}
        >
          <Lock className="h-3 w-3" />
        </span>
      )}

      {/* View diff button — not for staged deletions or untracked files in the unstaged area */}
      {file.status !== "deleted" && (
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 px-1.5 shrink-0 ${diffActive ? "text-primary" : "text-muted-foreground"}`}
          onClick={onView}
          title={diffActive ? "Close diff" : "View diff"}
        >
          {diffActive ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      )}

      {/* Stage / Unstage button */}
      {actionLabel ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1 shrink-0"
          onClick={onAction}
          disabled={actionBusy}
          title={actionLabel}
        >
          {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : actionIcon}
          {actionLabel}
        </Button>
      ) : blocked ? (
        <span
          className="text-xs text-muted-foreground shrink-0 px-2"
          title={blockReason}
        >
          blocked
        </span>
      ) : null}
    </div>
  );
}

// ── CommitRow sub-component ───────────────────────────────────────────────────

function CommitRow({ commit }: { commit: GitCommitSummary }) {
  return (
    <div className="flex items-start gap-3 px-6 py-3">
      <GitCommit className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{commit.message}</p>
        <p className="text-xs text-muted-foreground">
          {commit.author} · {commit.date}
        </p>
      </div>
      <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">
        {commit.shortHash}
      </code>
    </div>
  );
}
