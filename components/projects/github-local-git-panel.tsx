"use client";

/**
 * components/projects/github-local-git-panel.tsx
 *
 * Three-step UI for initialising a local git repo, connecting it to GitHub,
 * and pushing the first commit.  Also allows changing or disconnecting an
 * existing remote connection.
 *
 * Shown on /projects/[projectId]/github when the project has files in
 * storage/projects/<slug>/ (regardless of whether a GitHubRepository row exists).
 *
 * Steps:
 *   1. Init local repo (git init → .gitignore → git add -A → git commit)
 *   2. Connect / Change / Disconnect GitHub repo
 *   3. Push (git push -u origin <branch>)
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
  //
  // "connected" = a remote origin + GitHubRepository row exist.
  // This is true when either the page passed initialRepo OR the git status
  // already has a remote (covers the case of init already having been run
  // but with a lost DB row).

  const alreadyConnected =
    initialRepo !== null || initialGitStatus.hasRemote;

  // ── State ─────────────────────────────────────────────────────────────────

  const [gitStatus, setGitStatus] = useState<LocalGitStatus>(initialGitStatus);

  // Step 2 state
  const [connected, setConnected] = useState(alreadyConnected);
  // When true, show the URL+branch form (either first connection or "Change" mode)
  const [step2Editing, setStep2Editing] = useState(!alreadyConnected);
  // Form field values — prefilled from existing connection if present
  const [repoUrl, setRepoUrl] = useState(
    initialRepo?.htmlUrl ?? initialGitStatus.remoteUrl ?? ""
  );
  const [branch, setBranch] = useState(
    initialRepo?.defaultBranch ?? initialGitStatus.branch ?? "main"
  );

  // Step 3 state
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

  // Pending transitions
  const [initPending, startInitTransition] = useTransition();
  const [connectPending, startConnectTransition] = useTransition();
  const [disconnectPending, startDisconnectTransition] = useTransition();
  const [pushPending, startPushTransition] = useTransition();

  // ── Derived state ──────────────────────────────────────────────────────────

  const step1Done = gitStatus.initialized;
  // Step 2 is "done" (fully connected, not in editing mode) when:
  const step2Done = connected && !step2Editing;
  const step3Done = pushed;

  const activeStep = step3Done ? 3 : step2Done ? 3 : step1Done ? 2 : 1;

  // The URL that is currently wired to git origin (for display + blocklist)
  const currentRemoteUrl = gitStatus.remoteUrl ?? (connected ? repoUrl : "");
  const currentBranch = gitStatus.branch ?? branch;
  const remotIsBlocked = isBlockedUrl(currentRemoteUrl);

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

    // Client-side blocklist guard
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
    // Only valid when we still have a connection to fall back to
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
        setGitStatus((prev) => ({ ...prev, hasRemote: false, remoteUrl: null }));
        // Keep repoUrl so the user can re-connect to the same repo easily
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
      if (res.ok) setPushed(true);
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
            <StepBadge step={2} active={activeStep === 2} done={step2Done && !remotIsBlocked} />
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
          {/* ── Connected view (not editing) ── */}
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

              {/* Current connection info */}
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
              </div>

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
            /* ── Connect / Change form ── */
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

                {/* Cancel — only shown when we have an existing connection */}
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

          {/* Show output from a completed connect/change even in view mode */}
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
          <div className="flex items-center gap-2.5">
            <StepBadge step={3} active={activeStep === 3} done={step3Done} />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">Push Initial Commit</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Pushes the local commit to GitHub using{" "}
                <code className="font-mono text-xs">
                  git push -u origin &lt;branch&gt;
                </code>
                .
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {step3Done ? (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Pushed to GitHub successfully.{" "}
                <a
                  href={currentRemoteUrl.replace(/\.git$/, "") || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  View on GitHub
                </a>
              </span>
            </div>
          ) : (
            <>
              {/* Blocked-URL error overrides the normal warning */}
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
                /* Normal pre-push warning */
                step2Done && (
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
                    <p className="font-medium mb-0.5">Authentication failed</p>
                    <p>Git could not authenticate with GitHub. Make sure:</p>
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
            </>
          )}

          <TerminalOutput output={pushOutput} />

          {/* Credential reminder */}
          {!step3Done && step2Done && !remotIsBlocked && (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
              <Terminal className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                The push runs on the server using the system git credential
                store. If you are pushing via HTTPS, ensure a PAT is saved in
                the server&apos;s git config or credential helper. For SSH, the
                server&apos;s private key must be authorised on your GitHub
                account.
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
            Your project is now on GitHub. Set up the{" "}
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
        from the Integrations page to link it directly (skips manual git setup).
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
