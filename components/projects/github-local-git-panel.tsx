"use client";

/**
 * components/projects/github-local-git-panel.tsx
 *
 * Three-step UI for initialising a local git repo, connecting it to GitHub,
 * and pushing the first commit.  Also allows changing or disconnecting an
 * existing remote connection, and refreshing git status to detect pushes
 * performed outside the panel (e.g. manually from the VPS).
 *
 * Steps:
 *   1. Init local repo (git init → .gitignore → git add -A → git commit)
 *   2. Connect / Change / Disconnect GitHub repo
 *   3. Push (git push -u origin <branch>)
 *
 * Step 3 is considered "done" when either:
 *   a) The push action succeeded in this session, OR
 *   b) `gitStatus.upstreamBranch` is non-null (upstream tracking was set
 *      by any push -u, including a manual push from the VPS).
 */

import { useState, useTransition } from "react";
import {
  GitBranch,
  GitCommit,
  Github,
  Terminal,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Lock,
  ChevronRight,
  Link2,
  Link2Off,
  Upload,
  Pencil,
  XCircle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  initLocalGitRepoAction,
  connectGitHubRepoAction,
  disconnectGitHubRepoAction,
  pushToGitHubAction,
  refreshGitStatusAction,
} from "@/app/actions/project-git";
import type { LocalGitStatus } from "@/lib/projects/storage-git";

// ── Blocklist (mirrors server constant — kept in sync manually) ───────────────

const BLOCKED_SLUG = "sardarsaeedofficial/prisom-project-panel";

function clientNormalizeSlug(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");
}

function isBlockedUrl(url: string): boolean {
  return !!url && clientNormalizeSlug(url) === BLOCKED_SLUG;
}

/** Convert any GitHub remote URL to a browser-friendly HTTPS URL. */
function toBrowserUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("https://")) return url.replace(/\.git$/, "");
  const m = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (m) return `https://github.com/${m[1]}`;
  return url;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InitialRepo {
  htmlUrl: string;
  defaultBranch: string;
}

interface Props {
  projectId: string;
  projectSlug: string;
  initialGitStatus: LocalGitStatus;
  isGitHubConfigured: boolean;
  /** Non-null when a GitHubRepository row already exists for this project. */
  initialRepo: InitialRepo | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TerminalOutput({ output }: { output: string }) {
  if (!output.trim()) return null;
  return (
    <pre className="mt-3 rounded-md bg-zinc-950 text-zinc-100 text-xs p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
      {output}
    </pre>
  );
}

function StepBadge({
  step,
  active,
  done,
}: {
  step: number;
  active: boolean;
  done: boolean;
}) {
  if (done) {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20 text-green-500 shrink-0">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {step}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GithubLocalGitPanel({
  projectId,
  projectSlug: _slug,
  initialGitStatus,
  isGitHubConfigured,
  initialRepo,
}: Props) {
  // ── Initial connected state ───────────────────────────────────────────────

  const alreadyConnected = initialRepo !== null || initialGitStatus.hasRemote;

  // ── State ─────────────────────────────────────────────────────────────────

  const [gitStatus, setGitStatus] = useState<LocalGitStatus>(initialGitStatus);

  // Step 2 state
  const [connected, setConnected] = useState(alreadyConnected);
  const [step2Editing, setStep2Editing] = useState(!alreadyConnected);
  const [repoUrl, setRepoUrl] = useState(
    initialRepo?.htmlUrl ?? initialGitStatus.remoteUrl ?? ""
  );
  const [branch, setBranch] = useState(
    initialRepo?.defaultBranch ?? initialGitStatus.branch ?? "main"
  );

  // Step 3 state
  // `pushed` is set when the push action succeeds in THIS session.
  // `gitStatus.upstreamBranch` covers pushes that happened outside the panel.
  const [pushed, setPushed] = useState(false);
  const [pushConfirmed, setPushConfirmed] = useState(false);

  // Output + error state per step
  const [initOutput, setInitOutput] = useState("");
  const [initError, setInitError] = useState("");
  const [connectOutput, setConnectOutput] = useState("");
  const [connectError, setConnectError] = useState("");
  const [disconnectError, setDisconnectError] = useState("");
  const [pushOutput, setPushOutput] = useState("");
  const [pushError, setPushError] = useState("");
  const [pushAuthError, setPushAuthError] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  // Pending transitions
  const [initPending, startInitTransition] = useTransition();
  const [connectPending, startConnectTransition] = useTransition();
  const [disconnectPending, startDisconnectTransition] = useTransition();
  const [pushPending, startPushTransition] = useTransition();
  const [refreshPending, startRefreshTransition] = useTransition();

  // ── Derived state ──────────────────────────────────────────────────────────

  const step1Done = gitStatus.initialized;
  const step2Done = connected && !step2Editing;
  // Step 3 is done if the panel's push action succeeded, OR if the local branch
  // already tracks an upstream (detected by git rev-parse --abbrev-ref @{u}).
  const step3Done = pushed || !!gitStatus.upstreamBranch;

  const activeStep = step3Done ? 3 : step2Done ? 3 : step1Done ? 2 : 1;

  const currentRemoteUrl = gitStatus.remoteUrl ?? (connected ? repoUrl : "");
  const currentBranch = gitStatus.branch ?? branch;
  const remotIsBlocked = isBlockedUrl(currentRemoteUrl);

  // Browser URL for the "Open on GitHub" link
  const githubBrowserUrl =
    initialRepo?.htmlUrl ||
    (currentRemoteUrl ? toBrowserUrl(currentRemoteUrl) : null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleInit() {
    setInitOutput("");
    setInitError("");
    startInitTransition(async () => {
      const res = await initLocalGitRepoAction(projectId);
      setInitOutput(res.output);
      setInitError(res.error);
      if (res.ok) {
        setGitStatus((prev) => ({
          ...prev,
          initialized: true,
          branch: prev.branch ?? "main",
        }));
      }
    });
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnectOutput("");
    setConnectError("");

    if (isBlockedUrl(repoUrl)) {
      setConnectError(
        "You cannot connect an uploaded project to the Project Panel repository. " +
          "Create or choose a separate GitHub repo for this project."
      );
      return;
    }

    startConnectTransition(async () => {
      const res = await connectGitHubRepoAction(
        projectId,
        repoUrl.trim(),
        branch.trim()
      );
      setConnectOutput(res.output);
      setConnectError(res.error);
      if (res.ok) {
        setConnected(true);
        setStep2Editing(false);
        setPushConfirmed(false);
        setGitStatus((prev) => ({
          ...prev,
          hasRemote: true,
          remoteUrl: repoUrl.trim(),
        }));
      }
    });
  }

  function handleStartChange() {
    setStep2Editing(true);
    setPushConfirmed(false);
    setConnectOutput("");
    setConnectError("");
  }

  function handleCancelChange() {
    if (connected) {
      setStep2Editing(false);
      setConnectOutput("");
      setConnectError("");
    }
  }

  function handleDisconnect() {
    setDisconnectError("");
    startDisconnectTransition(async () => {
      const res = await disconnectGitHubRepoAction(projectId);
      if (res.ok) {
        setConnected(false);
        setStep2Editing(true);
        setPushConfirmed(false);
        setGitStatus((prev) => ({
          ...prev,
          hasRemote: false,
          remoteUrl: null,
          upstreamBranch: null,
        }));
      } else {
        setDisconnectError(res.error);
      }
    });
  }

  function handlePush() {
    setPushOutput("");
    setPushError("");
    setPushAuthError(false);
    startPushTransition(async () => {
      const res = await pushToGitHubAction(projectId);
      setPushOutput(res.output);
      setPushError(res.error);
      setPushAuthError(res.isAuthError ?? false);
      if (res.ok) {
        setPushed(true);
        // Refresh git status so upstreamBranch is populated
        const fresh = await refreshGitStatusAction(projectId);
        if (fresh.ok && fresh.gitStatus) {
          setGitStatus(fresh.gitStatus);
        }
      }
    });
  }

  function handleRefresh() {
    setRefreshError("");
    startRefreshTransition(async () => {
      const res = await refreshGitStatusAction(projectId);
      if (res.ok && res.gitStatus) {
        setGitStatus(res.gitStatus);
        // If upstream is now set, clear any stale push errors
        if (res.gitStatus.upstreamBranch) {
          setPushError("");
          setPushAuthError(false);
          setPushOutput("");
        }
      } else {
        setRefreshError(res.error || "Could not read git status.");
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Set Up Git &amp; GitHub</h2>
        <p className="text-xs text-muted-foreground">
          This project has uploaded files. Follow the steps below to initialise a
          local git repo, connect it to GitHub, and push.
        </p>
      </div>

      {/* ── Step 1: Init ─────────────────────────────────────────────────────── */}
      <Card
        className={
          step1Done
            ? "border-green-500/30"
            : activeStep === 1
            ? "border-primary/40"
            : ""
        }
      >
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <StepBadge step={1} active={activeStep === 1} done={step1Done} />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">Initialize Local Git Repo</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Runs git init, writes .gitignore, and creates the first commit.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {step1Done ? (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Initialized · branch:{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  {gitStatus.branch ?? "main"}
                </code>
                {gitStatus.commitSha && (
                  <>
                    {" "}
                    · commit{" "}
                    <code className="font-mono bg-muted px-1 rounded">
                      {gitStatus.commitSha.slice(0, 7)}
                    </code>
                  </>
                )}
              </span>
            </div>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleInit}
                disabled={initPending}
                className="gap-1.5"
              >
                {initPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitCommit className="h-3.5 w-3.5" />
                )}
                {initPending ? "Initializing…" : "Initialize Local Git Repo"}
              </Button>
              {initError && (
                <p className="mt-2 text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {initError}
                </p>
              )}
            </>
          )}
          <TerminalOutput output={initOutput} />
        </CardContent>
      </Card>

      {/* ── Step 2: Connect / Change / Disconnect ────────────────────────────── */}
      <Card
        className={
          step2Done
            ? remotIsBlocked
              ? "border-red-500/40"
              : "border-green-500/30"
            : activeStep === 2
            ? "border-primary/40"
            : ""
        }
      >
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <StepBadge
              step={2}
              active={activeStep === 2}
              done={step2Done && !remotIsBlocked}
            />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">Connect GitHub Repository</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {step2Done
                  ? "Repository connected. You can change or disconnect it below."
                  : "Enter your GitHub repo URL and target branch. No push yet."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {connected && !step2Editing ? (
            <div className="space-y-3">
              {/* Blocked URL warning */}
              {remotIsBlocked && (
                <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 text-xs flex gap-2">
                  <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-800 dark:text-red-200">
                    This project is connected to the Project Panel repository.
                    Disconnect it and connect a separate repository before pushing.
                  </p>
                </div>
              )}

              {/* Connection info */}
              <div className="rounded-md border bg-muted/20 px-3 py-2.5 text-xs space-y-1">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 shrink-0">Remote</span>
                  <code className="font-mono break-all text-foreground">
                    {currentRemoteUrl || "—"}
                  </code>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 shrink-0">Branch</span>
                  <code className="font-mono text-foreground">{currentBranch}</code>
                </div>
                {gitStatus.upstreamBranch && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Upstream</span>
                    <code className="font-mono text-foreground">
                      {gitStatus.upstreamBranch}
                    </code>
                  </div>
                )}
              </div>

              {/* Open on GitHub link */}
              {githubBrowserUrl && !remotIsBlocked && (
                <a
                  href={githubBrowserUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open on GitHub
                </a>
              )}

              {/* Change / Disconnect buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStartChange}
                  disabled={disconnectPending}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Change repository
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDisconnect}
                  disabled={disconnectPending}
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  {disconnectPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5" />
                  )}
                  {disconnectPending ? "Disconnecting…" : "Disconnect repository"}
                </Button>
              </div>

              {disconnectError && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {disconnectError}
                </p>
              )}
            </div>
          ) : (
            /* Connect / Change form */
            <form onSubmit={handleConnect} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="repo-url" className="text-xs">
                  GitHub Repository URL
                </Label>
                <Input
                  id="repo-url"
                  type="url"
                  placeholder="https://github.com/you/my-project"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={!step1Done || connectPending}
                  className="h-8 text-sm font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  HTTPS (https://github.com/…) or SSH (git@github.com:…)
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="branch-name" className="text-xs">
                  Branch
                </Label>
                <Input
                  id="branch-name"
                  type="text"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={!step1Done || connectPending}
                  className="h-8 text-sm font-mono w-40"
                  required
                />
              </div>

              {connectError && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {connectError}
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!step1Done || connectPending || !repoUrl}
                  className="gap-1.5"
                >
                  {connectPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {connectPending
                    ? "Connecting…"
                    : connected
                    ? "Update repository"
                    : "Connect Existing GitHub Repo"}
                </Button>

                {connected && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleCancelChange}
                    disabled={connectPending}
                  >
                    Cancel
                  </Button>
                )}

                {/* Create New Repo — disabled until GitHub App is configured */}
                <div className="relative group">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled
                    className="gap-1.5 cursor-not-allowed opacity-50"
                  >
                    <Github className="h-3.5 w-3.5" />
                    Create New GitHub Repo
                    {!isGitHubConfigured && (
                      <Lock className="h-3 w-3 ml-0.5 text-muted-foreground" />
                    )}
                  </Button>
                  <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block z-10 w-56">
                    <div className="rounded-md bg-popover border text-popover-foreground text-xs p-2 shadow-md">
                      {isGitHubConfigured
                        ? "Repo creation via the GitHub App is not yet implemented."
                        : "Requires the GitHub App to be configured. Go to Integrations → GitHub."}
                    </div>
                  </div>
                </div>
              </div>

              <TerminalOutput output={connectOutput} />
            </form>
          )}

          {connected && !step2Editing && connectOutput && (
            <TerminalOutput output={connectOutput} />
          )}
        </CardContent>
      </Card>

      {/* ── Step 3: Push ─────────────────────────────────────────────────────── */}
      <Card
        className={
          step3Done
            ? "border-green-500/30"
            : activeStep === 3
            ? "border-primary/40"
            : ""
        }
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <StepBadge step={3} active={activeStep === 3} done={step3Done} />
              <div className="flex-1 min-w-0">
                <CardTitle className="text-sm">Push Initial Commit</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {step3Done
                    ? "Repository pushed successfully."
                    : <>
                        Pushes the local commit to GitHub using{" "}
                        <code className="font-mono text-xs">
                          git push -u origin &lt;branch&gt;
                        </code>
                        .
                      </>}
                </CardDescription>
              </div>
            </div>

            {/* Refresh status button — always available when connected */}
            {step2Done && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRefresh}
                disabled={refreshPending}
                className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
                title="Re-read git status from disk — detects pushes done outside the panel"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshPending ? "animate-spin" : ""}`}
                />
                {refreshPending ? "Refreshing…" : "Refresh status"}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {step3Done ? (
            /* ── Success state ── */
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {gitStatus.upstreamBranch && !pushed
                    ? `Repository already pushed — upstream is ${gitStatus.upstreamBranch}.`
                    : "Repository pushed successfully."}
                </span>
              </div>

              {githubBrowserUrl && (
                <a
                  href={githubBrowserUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2"
                >
                  <Github className="h-3.5 w-3.5" />
                  Open GitHub Repository
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : (
            <>
              {/* Blocked-URL error overrides normal warning */}
              {step2Done && remotIsBlocked ? (
                <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 text-xs flex gap-2">
                  <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-800 dark:text-red-200">
                    Push is disabled. This project is connected to the Project
                    Panel repository. Use &quot;Change repository&quot; or
                    &quot;Disconnect repository&quot; above to fix this.
                  </p>
                </div>
              ) : (
                step2Done && (
                  /* Pre-push warning + confirmation */
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2.5">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        This will push the uploaded project root to{" "}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded break-all">
                          {currentRemoteUrl}
                        </code>{" "}
                        branch{" "}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">
                          {currentBranch}
                        </code>
                        . It will not create a subfolder.
                      </p>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={pushConfirmed}
                        onChange={(e) => setPushConfirmed(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-amber-400 accent-amber-600"
                      />
                      <span className="text-xs text-amber-800 dark:text-amber-200">
                        I understand — push project files to this repository
                      </span>
                    </label>
                  </div>
                )
              )}

              <Button
                size="sm"
                onClick={handlePush}
                disabled={
                  !step1Done ||
                  !step2Done ||
                  pushPending ||
                  !pushConfirmed ||
                  remotIsBlocked
                }
                className="gap-1.5"
              >
                {pushPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {pushPending ? "Pushing…" : "Push Initial Commit"}
              </Button>

              {pushAuthError && (
                <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 text-xs flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-red-800 dark:text-red-200">
                    <p className="font-medium mb-1">Authentication failed</p>
                    <p>
                      If you already pushed manually from the VPS, click{" "}
                      <strong>Refresh status</strong> above to update this view.
                    </p>
                    <p className="mt-1">Otherwise, make sure:</p>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      <li>
                        Your SSH key is added to the server and to your GitHub
                        account, or
                      </li>
                      <li>
                        You have configured git credential storage with a{" "}
                        <code className="font-mono">ghp_…</code> personal access
                        token.
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {pushError && !pushAuthError && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {pushError}
                </p>
              )}

              {refreshError && (
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Refresh: {refreshError}
                </p>
              )}
            </>
          )}

          <TerminalOutput output={pushOutput} />

          {/* Credential reminder */}
          {!step3Done && step2Done && !remotIsBlocked && (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
              <Terminal className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                The push runs on the server using the system git credential store.
                If you pushed manually from the VPS, use{" "}
                <strong>Refresh status</strong> to update this view without pushing
                again.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post-push hint */}
      {step3Done && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Github className="h-3.5 w-3.5 shrink-0" />
          <span>
            Set up the{" "}
            <a
              href="/integrations/github"
              className="underline underline-offset-2 hover:text-foreground"
            >
              GitHub App integration
            </a>{" "}
            for automatic sync on push.
          </span>
          <ChevronRight className="h-3.5 w-3.5 ml-auto shrink-0" />
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <p className="text-xs text-muted-foreground">
        Already have the GitHub App installed?{" "}
        <a
          href="/integrations/github"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Import an existing repo
        </a>{" "}
        from the Integrations page to link it directly.
      </p>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span>
          After pushing, the GitHub tab will refresh to show your connected
          repository.
        </span>
      </div>
    </div>
  );
}
