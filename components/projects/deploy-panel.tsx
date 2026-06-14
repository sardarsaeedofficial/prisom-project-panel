"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  RefreshCw,
  Rocket,
  RotateCcw,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  GitBranch,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  getDeployStatusAction,
  getPm2LogsAction,
  deployLatestAction,
  rollbackToCommitAction,
  type DeployStatusData,
} from "@/app/actions/deploy";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DeployPanelProps {
  projectId: string;
  domain: string;
  branch: string;
  pm2Apps: string[];
}

// ─── Loading state ────────────────────────────────────────────────────────────

type LoadingKey = "idle" | "status" | "deploy" | "rollback" | "logs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Pm2StatusBadge({ status }: { status: string }) {
  const online = status === "online";
  const errored = status === "errored" || status === "stopped";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
        online
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
          : errored
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          online ? "bg-green-500" : errored ? "bg-red-500" : "bg-yellow-400"
        }`}
      />
      {status}
    </span>
  );
}

function TerminalBox({
  content,
  label,
}: {
  content: string;
  label: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <pre
        ref={preRef}
        className="bg-zinc-950 dark:bg-zinc-900 text-zinc-100 text-xs font-mono rounded-md p-3 overflow-y-auto max-h-72 whitespace-pre-wrap leading-relaxed border border-zinc-800"
      >
        {content || "(empty)"}
      </pre>
    </div>
  );
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string;
  description: string;
  warning?: string;
  steps?: string[];
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

function ConfirmModal({
  title,
  description,
  warning,
  steps,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  onCancel,
  loading,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!loading ? onCancel : undefined}
      />
      {/* Panel */}
      <div className="relative bg-background border rounded-lg p-6 max-w-md w-full shadow-2xl">
        <h2 className="text-base font-semibold mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground mb-3">{description}</p>

        {steps && steps.length > 0 && (
          <div className="bg-muted/50 rounded-md p-3 mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              Steps that will run
            </p>
            <ol className="space-y-0.5">
              {steps.map((step, i) => (
                <li
                  key={i}
                  className="text-xs font-mono text-foreground/80 flex gap-2"
                >
                  <span className="text-muted-foreground shrink-0">
                    {i + 1}.
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 rounded-md px-3 py-2 mb-4">
            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-800 dark:text-yellow-300">{warning}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Running…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Deploy Panel ─────────────────────────────────────────────────────────────

const DEPLOY_STEPS = [
  "git fetch origin",
  "git pull origin master",
  "npm run db:generate",
  "npm --workspace=apps/backend run build",
  "npm --workspace=apps/manager-web run build",
  "pm2 restart prisom-backend --update-env",
  "pm2 restart prisom-manager",
  "pm2 save",
];

export function DeployPanel({
  projectId,
  domain,
  branch,
  pm2Apps,
}: DeployPanelProps) {
  const [loading, setLoading] = useState<LoadingKey>("idle");
  const [status, setStatus] = useState<DeployStatusData | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("");
  const [outputLabel, setOutputLabel] = useState<string>("");
  const [outputOk, setOutputOk] = useState<boolean | null>(null);

  // Modal state
  const [modal, setModal] = useState<"deploy" | "rollback" | null>(null);

  // Rollback commit selection
  const [selectedCommit, setSelectedCommit] = useState<string>("");

  const busy = loading !== "idle";

  // ── Status refresh ──────────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    setLoading("status");
    setStatusError(null);
    const result = await getDeployStatusAction(projectId);
    setLoading("idle");
    if (result.ok && result.data) {
      setStatus(result.data);
      // Pre-select the first commit for rollback
      if (!selectedCommit && result.data.recentCommits.length > 0) {
        const first = result.data.recentCommits[0].split(" ")[0];
        setSelectedCommit(first);
      }
    } else {
      setStatusError(result.error ?? "Unknown error");
    }
  }, [projectId, selectedCommit]);

  // ── PM2 logs ────────────────────────────────────────────────────────────────

  const viewLogs = useCallback(async () => {
    setLoading("logs");
    setOutput("");
    const result = await getPm2LogsAction(projectId);
    setLoading("idle");
    setOutputLabel("PM2 Logs");
    setOutputOk(result.ok);
    setOutput(result.ok ? (result.data ?? "") : (result.error ?? "Error"));
  }, [projectId]);

  // ── Deploy ──────────────────────────────────────────────────────────────────

  const handleDeployConfirm = useCallback(async () => {
    setLoading("deploy");
    setOutput("Starting deploy...\n");
    setOutputLabel("Deploy Output");
    setOutputOk(null);
    setModal(null);

    const result = await deployLatestAction(projectId);

    setLoading("idle");
    setOutputOk(result.ok);
    setOutput(result.data?.output ?? result.error ?? "No output");
    // Refresh status after deploy so PM2 shows updated state
    void refreshStatus();
  }, [projectId, refreshStatus]);

  // ── Rollback ─────────────────────────────────────────────────────────────────

  const handleRollbackConfirm = useCallback(async () => {
    if (!selectedCommit) return;
    setLoading("rollback");
    setOutput("Starting rollback...\n");
    setOutputLabel(`Rollback to ${selectedCommit}`);
    setOutputOk(null);
    setModal(null);

    const result = await rollbackToCommitAction(projectId, selectedCommit);

    setLoading("idle");
    setOutputOk(result.ok);
    setOutput(result.data?.output ?? result.error ?? "No output");
    void refreshStatus();
  }, [projectId, selectedCommit, refreshStatus]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Modals */}
      {modal === "deploy" && (
        <ConfirmModal
          title="Deploy Latest"
          description={`Pull master and rebuild ${domain}`}
          steps={DEPLOY_STEPS}
          warning="This will restart PM2 processes. LocalShop will be briefly unavailable during pm2 restart."
          confirmLabel="Deploy"
          onConfirm={handleDeployConfirm}
          onCancel={() => setModal(null)}
          loading={loading === "deploy"}
        />
      )}

      {modal === "rollback" && (
        <ConfirmModal
          title={`Rollback to ${selectedCommit}`}
          description="This will check out the selected commit and rebuild."
          steps={[
            `git checkout ${selectedCommit}`,
            "npm run db:generate",
            "npm --workspace=apps/backend run build",
            "npm --workspace=apps/manager-web run build",
            "pm2 restart prisom-backend --update-env",
            "pm2 restart prisom-manager",
            "pm2 save",
          ]}
          warning="The repo will be in DETACHED HEAD state after rollback. To resume normal deploys, run git checkout master on the VPS."
          confirmLabel="Rollback"
          confirmVariant="destructive"
          onConfirm={handleRollbackConfirm}
          onCancel={() => setModal(null)}
          loading={loading === "rollback"}
        />
      )}

      {/* Panel */}
      <Card className="border-2 border-primary/10">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" />
                Deploy Controls
              </CardTitle>
              <CardDescription className="mt-0.5">
                <a
                  href={domain}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs hover:underline"
                >
                  {domain.replace("https://", "")}
                </a>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {branch}
                </span>
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshStatus}
              disabled={busy}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${
                  loading === "status" ? "animate-spin" : ""
                }`}
              />
              Refresh Status
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Status not loaded yet */}
          {!status && !statusError && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Click <span className="font-medium">Refresh Status</span> to load
              live server status.
            </p>
          )}

          {/* Status error */}
          {statusError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{statusError}</span>
            </div>
          )}

          {/* Loaded status */}
          {status && (
            <>
              {/* PM2 Status */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  PM2 Processes
                </p>
                {status.pm2.error && (
                  <p className="text-xs text-destructive mb-2">
                    {status.pm2.error}
                  </p>
                )}
                {status.pm2.apps.length === 0 && !status.pm2.error && (
                  <p className="text-xs text-muted-foreground">
                    No matching PM2 apps found ({pm2Apps.join(", ")}).
                  </p>
                )}
                <div className="divide-y divide-border rounded-md border overflow-hidden">
                  {status.pm2.apps.map((app) => (
                    <div
                      key={app.name}
                      className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/20 text-xs"
                    >
                      <span className="font-mono font-medium">{app.name}</span>
                      <div className="flex items-center gap-3 flex-wrap">
                        <Pm2StatusBadge status={app.status} />
                        {app.pid && (
                          <span className="text-muted-foreground">
                            PID {app.pid}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {app.memoryMb} MB
                        </span>
                        <span className="text-muted-foreground">
                          CPU {app.cpu}%
                        </span>
                        {app.restarts > 0 && (
                          <span className="text-yellow-600">
                            {app.restarts}✕ restarts
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Git status */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Git Status
                </p>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <GitBranch className="h-3 w-3" />
                    <span className="font-mono">{status.branch || branch}</span>
                  </div>
                  {status.statusLines.length === 0 ? (
                    <p className="text-muted-foreground pl-4">
                      Working tree clean
                    </p>
                  ) : (
                    <div className="pl-4 space-y-0.5">
                      {status.statusLines.map((line, i) => (
                        <p key={i} className="font-mono text-yellow-700 dark:text-yellow-400">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent commits */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Recent Commits
                </p>
                <div className="space-y-0.5">
                  {status.recentCommits.map((commit, i) => {
                    const [hash, ...rest] = commit.split(" ");
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs"
                      >
                        <code className="font-mono text-primary/80 shrink-0">
                          {hash}
                        </code>
                        <span className="text-muted-foreground truncate">
                          {rest.join(" ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── Action buttons ── */}
          <div className="flex flex-wrap gap-2 pt-1 border-t">
            <Button
              onClick={() => setModal("deploy")}
              disabled={busy}
              size="sm"
            >
              {loading === "deploy" ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Deploying…
                </>
              ) : (
                <>
                  <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  Deploy Latest
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={viewLogs}
              disabled={busy}
            >
              {loading === "logs" ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Loading…
                </>
              ) : (
                <>
                  <Terminal className="mr-1.5 h-3.5 w-3.5" />
                  View PM2 Logs
                </>
              )}
            </Button>
          </div>

          {/* ── Rollback row ── */}
          {status && status.recentCommits.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
              <span className="text-xs text-muted-foreground font-medium shrink-0">
                Rollback to:
              </span>
              <div className="relative">
                <select
                  value={selectedCommit}
                  onChange={(e) => setSelectedCommit(e.target.value)}
                  disabled={busy}
                  className="text-xs font-mono pr-6 pl-2 py-1.5 rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer max-w-[280px] truncate"
                >
                  {status.recentCommits.map((commit) => {
                    const [hash, ...rest] = commit.split(" ");
                    return (
                      <option key={hash} value={hash}>
                        {hash} — {rest.join(" ").slice(0, 50)}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (selectedCommit) setModal("rollback");
                }}
                disabled={busy || !selectedCommit}
              >
                {loading === "rollback" ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Rolling back…
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Rollback
                  </>
                )}
              </Button>
            </div>
          )}

          {/* ── Terminal output ── */}
          {output && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                {outputOk === true && (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                )}
                {outputOk === false && (
                  <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                {outputOk === null && loading !== "idle" && (
                  <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                )}
                <span className="text-xs font-medium">
                  {outputLabel}
                  {outputOk === true && (
                    <span className="text-green-600 ml-1.5">— Success</span>
                  )}
                  {outputOk === false && (
                    <span className="text-red-600 ml-1.5">— Failed</span>
                  )}
                </span>
              </div>
              <TerminalBox content={output} label="" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
