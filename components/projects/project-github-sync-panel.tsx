"use client";

/**
 * components/projects/project-github-sync-panel.tsx
 *
 * Sprint 40: GitHub auto-sync settings + local git ops panel.
 *
 * Shows:
 *  - Auto-pull toggle (enabled → pulls on push webhook if worktree is clean)
 *  - Auto-deploy toggle (enabled → deploys after a successful auto-pull)
 *  - Last sync status with timestamp
 *  - Dirty worktree warning with changed files list
 *  - Manual sync button
 *  - Stage + commit UI
 *  - Push button
 */

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  RefreshCw,
  GitPullRequest,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  Upload,
  Loader2,
  ToggleLeft,
  ToggleRight,
  File,
  GitCommit,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import { cn }      from "@/lib/utils";
import {
  getSyncSettingsAction,
  updateSyncSettingsAction,
  triggerInlineSyncAction,
  getLocalGitStatusAction,
  stageAndCommitAction,
  pushToRemoteAction,
} from "@/app/actions/github-sync";
import type { GitHubSyncSettings } from "@/lib/github/github-sync-types";
import type { GitRepoStatus }       from "@/lib/projects/git-manager";

// ── Status helpers ────────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: GitHubSyncSettings["lastSyncStatus"] }) {
  if (!status) return null;
  const map: Record<string, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    synced:  { variant: "success",   label: "Synced"   },
    idle:    { variant: "secondary", label: "Idle"     },
    behind:  { variant: "warning",   label: "Behind"   },
    dirty:   { variant: "warning",   label: "Dirty"    },
    blocked: { variant: "secondary", label: "Blocked"  },
    syncing: { variant: "warning",   label: "Syncing"  },
    failed:  { variant: "error",     label: "Failed"   },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function StatusIcon({ status }: { status: GitHubSyncSettings["lastSyncStatus"] }) {
  if (status === "synced")  return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "failed")  return <XCircle      className="h-4 w-4 text-red-500"   />;
  if (status === "dirty"  ) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  if (status === "behind" ) return <GitPullRequest className="h-4 w-4 text-yellow-500" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s    = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// ── Toggle row ────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  enabled,
  loading,
  onToggle,
}: {
  label:       string;
  description: string;
  enabled:     boolean;
  loading:     boolean;
  onToggle:    () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : enabled ? (
          <ToggleRight className="h-5 w-5 text-primary" />
        ) : (
          <ToggleLeft className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectGitHubSyncPanel({ projectId }: { projectId: string }) {
  const [settings,  setSettings]  = useState<GitHubSyncSettings | null>(null);
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const [syncMsg,   setSyncMsg]   = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [pushMsg,   setPushMsg]   = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [settingsPending, startSettingsTransition] = useTransition();
  const [pushPending,     startPushTransition]     = useTransition();
  const [commitPending,   startCommitTransition]   = useTransition();

  const loadAll = useCallback(() => {
    startTransition(async () => {
      const [sResult, gResult] = await Promise.all([
        getSyncSettingsAction(projectId),
        getLocalGitStatusAction(projectId),
      ]);
      if (sResult.ok) setSettings(sResult.settings);
      else            setError(sResult.error);
      if (gResult.ok) setGitStatus(gResult.status);
    });
  }, [projectId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Toggles ──────────────────────────────────────────────────────────────

  function toggleAutoPull() {
    if (!settings) return;
    startSettingsTransition(async () => {
      const res = await updateSyncSettingsAction(projectId, {
        autoPullEnabled: !settings.autoPullEnabled,
      });
      if (res.ok) setSettings(res.settings);
      else        setError(res.error);
    });
  }

  function toggleAutoDeploy() {
    if (!settings) return;
    startSettingsTransition(async () => {
      const res = await updateSyncSettingsAction(projectId, {
        autoDeployEnabled: !settings.autoDeployEnabled,
      });
      if (res.ok) setSettings(res.settings);
      else        setError(res.error);
    });
  }

  // ── Manual sync ───────────────────────────────────────────────────────────

  function handleSync() {
    setSyncMsg(null);
    startTransition(async () => {
      const res = await triggerInlineSyncAction(projectId);
      setSyncMsg(res.ok ? res.message : res.error);
      loadAll();
    });
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  function handleCommit() {
    if (!commitMsg.trim() || !gitStatus) return;
    const paths = gitStatus.changedFiles
      .filter((f) => f.safeToStage)
      .map((f) => f.path);
    if (paths.length === 0) return;

    startCommitTransition(async () => {
      const res = await stageAndCommitAction(projectId, paths, commitMsg.trim());
      if (res.ok) {
        setCommitMsg("");
        setSyncMsg(`Committed: ${res.hash}`);
        loadAll();
      } else {
        setSyncMsg(res.error);
      }
    });
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  function handlePush() {
    if (!gitStatus?.branch) return;
    const confirmed = window.confirm(
      `Push branch "${gitStatus.branch}" to origin?\n\nThis will publish your local commits to GitHub.`,
    );
    if (!confirmed) return;

    startPushTransition(async () => {
      const res = await pushToRemoteAction(projectId, gitStatus.branch!, true);
      setPushMsg(res.ok ? `Pushed to origin/${gitStatus.branch}` : res.error);
      loadAll();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isLoading = isPending && !settings;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error && !settings) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const isDirty   = gitStatus && !gitStatus.clean;
  const isBehind  = gitStatus && gitStatus.behind > 0;
  const safeFiles = gitStatus?.changedFiles.filter((f) => f.safeToStage) ?? [];

  return (
    <div className="space-y-4">

      {/* ── Sync settings ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            GitHub Auto-Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {settings && (
            <div className="divide-y divide-border">
              <ToggleRow
                label="Auto-Pull"
                description="On each GitHub push, fetch and fast-forward pull if the worktree is clean."
                enabled={settings.autoPullEnabled}
                loading={settingsPending}
                onToggle={toggleAutoPull}
              />
              <ToggleRow
                label="Auto-Deploy"
                description="After a successful auto-pull, trigger a deployment automatically."
                enabled={settings.autoDeployEnabled}
                loading={settingsPending}
                onToggle={toggleAutoDeploy}
              />
            </div>
          )}

          {/* Last sync status */}
          {settings?.lastSyncStatus && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-sm">
              <StatusIcon status={settings.lastSyncStatus} />
              <span className="text-muted-foreground flex-1 truncate">
                {settings.lastSyncMessage ?? settings.lastSyncStatus}
              </span>
              <SyncStatusBadge status={settings.lastSyncStatus} />
              {settings.lastSyncedAt && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDate(settings.lastSyncedAt)}
                </span>
              )}
            </div>
          )}

          {/* SHA info */}
          {(settings?.lastLocalSha || settings?.lastRemoteSha) && (
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              {settings.lastLocalSha && (
                <span className="flex items-center gap-1">
                  <GitCommit className="h-3 w-3" />
                  local: <code className="font-mono">{settings.lastLocalSha.slice(0, 7)}</code>
                </span>
              )}
              {settings.lastWebhookAt && (
                <span>webhook: {formatDate(settings.lastWebhookAt)}</span>
              )}
            </div>
          )}

          {/* Manual sync button */}
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={isPending}
              className="h-7 text-xs gap-1.5"
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Sync Now
            </Button>
            {syncMsg && (
              <span className="text-xs text-muted-foreground truncate">{syncMsg}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Dirty worktree warning ── */}
      {isDirty && (
        <Card className="border-yellow-500/40 bg-yellow-50/30 dark:bg-yellow-950/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              Uncommitted Changes
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              The local worktree has changes. Auto-pull is blocked until these are committed or resolved.
            </p>
            <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
              {gitStatus!.changedFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-xs">
                  <File className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <code className={cn("flex-1 font-mono truncate", !f.safeToStage && "text-muted-foreground line-through")}>
                    {f.path}
                  </code>
                  <Badge variant="secondary" className="text-[9px] h-4 shrink-0">
                    {f.status}
                  </Badge>
                  {!f.safeToStage && (
                    <span className="text-[9px] text-muted-foreground shrink-0">blocked</span>
                  )}
                </div>
              ))}
            </div>

            {safeFiles.length > 0 && (
              <div className="space-y-2">
                <input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message…"
                  maxLength={500}
                  className={cn(
                    "w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || commitPending}
                  className="h-7 text-xs gap-1.5"
                >
                  {commitPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <GitCommit className="h-3 w-3" />
                  )}
                  Commit {safeFiles.length} file{safeFiles.length !== 1 ? "s" : ""}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Behind remote notice ── */}
      {!isDirty && isBehind && !settings?.autoPullEnabled && (
        <Card className="border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/10">
          <CardContent className="py-4 flex items-start gap-3">
            <GitPullRequest className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {gitStatus!.behind} commit{gitStatus!.behind !== 1 ? "s" : ""} behind remote
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable auto-pull above to pull automatically, or click Sync Now.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Push panel ── */}
      {gitStatus?.isRepo && gitStatus.ahead > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Push to GitHub
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                <span>{gitStatus.branch}</span>
                <Badge variant="secondary">{gitStatus.ahead} ahead</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              You have {gitStatus.ahead} local commit{gitStatus.ahead !== 1 ? "s" : ""} not yet pushed to GitHub.
              A confirmation prompt will appear before push.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePush}
              disabled={pushPending}
              className="h-7 text-xs gap-1.5"
            >
              {pushPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Push to origin/{gitStatus.branch}
            </Button>
            {pushMsg && (
              <p className="mt-2 text-xs text-muted-foreground">{pushMsg}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Auto-deploy notice ── */}
      {settings?.autoDeployEnabled && (
        <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Rocket className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
          <span>Auto-deploy is enabled — a deployment will trigger after each successful pull.</span>
        </div>
      )}

    </div>
  );
}
