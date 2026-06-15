"use client";

/**
 * components/projects/project-deploy-panel.tsx
 *
 * Runtime control panel for an uploaded / blank / GitHub project that has a
 * saved ProjectDeploymentConfig.
 *
 * Shows:
 *   - Current PM2 status badge + preview link
 *   - Deploy / Restart / Stop action buttons
 *   - Collapsible build log from the latest deployment
 *   - On-demand PM2 live logs
 *   - Config summary (port, pm2Name, commands)
 */

import { useState, useTransition } from "react";
import {
  Rocket,
  RefreshCw,
  Square,
  Terminal,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Settings,
  AlertCircle,
  Activity,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  deployProjectAction,
  restartProjectRuntimeAction,
  stopProjectRuntimeAction,
  refreshDeploymentStatusAction,
  getProjectRuntimeLogsAction,
  type DeployActionResult,
} from "@/app/actions/project-deployments";
import { DeploymentStatus } from "@prisma/client";
import type { Pm2AppStatus } from "@/lib/projects/project-deploy-runner";

// ── Types ──────────────────────────────────────────────────────────────────

type DeploymentInfo = {
  id: string;
  status: DeploymentStatus;
  startedAt: Date;
  finishedAt: Date | null;
  duration: number | null;
  errorMessage: string | null;
  url: string | null;
  metadata: unknown;
};

type DeployConfig = {
  id: string;
  port: number;
  pm2Name: string;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string;
  rootDirectory: string;
  healthPath: string;
  nodeEnv: string;
};

interface Props {
  projectId: string;
  config: DeployConfig;
  latestDeployment: DeploymentInfo | null;
  initialPm2Status: Pm2AppStatus | null;
}

// ── PM2 status badge ───────────────────────────────────────────────────────

function Pm2Badge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <CircleDot className="h-3 w-3" />
        Not running
      </Badge>
    );
  }
  switch (status) {
    case "online":
      return (
        <Badge variant="success" className="gap-1 text-xs">
          <CircleDot className="h-3 w-3 fill-current" />
          Online
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Square className="h-3 w-3" />
          Stopped
        </Badge>
      );
    case "errored":
      return (
        <Badge variant="error" className="gap-1 text-xs">
          <XCircle className="h-3 w-3" />
          Errored
        </Badge>
      );
    case "launching":
      return (
        <Badge variant="warning" className="gap-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          Launching
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="h-3 w-3" />
          {status}
        </Badge>
      );
  }
}

// ── Deploy status badge ────────────────────────────────────────────────────

function DeployBadge({ status }: { status: DeploymentStatus | null }) {
  if (!status) return null;
  switch (status) {
    case "SUCCESS":
      return (
        <Badge variant="success" className="gap-1 text-xs">
          <CheckCircle2 className="h-3 w-3" /> Deployed
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="error" className="gap-1 text-xs">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    case "BUILDING":
      return (
        <Badge variant="warning" className="gap-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Building…
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          {status}
        </Badge>
      );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatUptime(ms: number | null) {
  if (!ms) return null;
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ProjectDeployPanel({
  projectId,
  config,
  latestDeployment: initialLatest,
  initialPm2Status,
}: Props) {
  const [, startTransition] = useTransition();

  // Runtime state
  const [pm2Status, setPm2Status]         = useState<Pm2AppStatus | null>(initialPm2Status);
  const [latest, setLatest]               = useState<DeploymentInfo | null>(initialLatest);
  const [deployOutput, setDeployOutput]   = useState<string>("");
  const [pm2Logs, setPm2Logs]             = useState<string>("");
  const [showBuildLog, setShowBuildLog]   = useState(false);
  const [showPm2Logs, setShowPm2Logs]     = useState(false);
  const [showConfig, setShowConfig]       = useState(false);

  // Action states
  const [isDeploying, setIsDeploying]     = useState(false);
  const [isRestarting, setIsRestarting]   = useState(false);
  const [isStopping, setIsStopping]       = useState(false);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);

  // Feedback
  const [actionError, setActionError]     = useState("");
  const [actionOk, setActionOk]           = useState("");

  const previewUrl = `http://178.105.105.59:${config.port}`;
  const anyBusy = isDeploying || isRestarting || isStopping;

  // ── Status refresh ─────────────────────────────────────────────────────

  async function handleRefresh() {
    setIsRefreshing(true);
    setActionError("");
    setActionOk("");
    try {
      const res = await refreshDeploymentStatusAction(projectId);
      if (res.ok) {
        setPm2Status(res.pm2Status);
        if (res.latestDeployment) setLatest(res.latestDeployment as DeploymentInfo);
      } else {
        setActionError(res.error);
      }
    } catch {
      setActionError("Failed to refresh status.");
    } finally {
      setIsRefreshing(false);
    }
  }

  // ── Deploy ─────────────────────────────────────────────────────────────

  async function handleDeploy() {
    setActionError("");
    setActionOk("");
    setDeployOutput("");
    setIsDeploying(true);

    try {
      const res: DeployActionResult = await deployProjectAction(projectId);
      setDeployOutput(res.output);
      setShowBuildLog(true);

      if (res.ok) {
        setActionOk("Deployment successful! App is live.");
        // Refresh PM2 status after deploy
        startTransition(async () => {
          const status = await refreshDeploymentStatusAction(projectId);
          if (status.ok) {
            setPm2Status(status.pm2Status);
            if (status.latestDeployment) setLatest(status.latestDeployment as DeploymentInfo);
          }
        });
      } else {
        setActionError(res.error || "Deployment failed — see build log below.");
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unexpected error during deploy.");
    } finally {
      setIsDeploying(false);
    }
  }

  // ── Restart ────────────────────────────────────────────────────────────

  async function handleRestart() {
    setActionError("");
    setActionOk("");
    setIsRestarting(true);

    try {
      const res = await restartProjectRuntimeAction(projectId);
      if (res.ok) {
        setActionOk("Process restarted.");
        await handleRefresh();
      } else {
        setActionError(res.error);
        setDeployOutput(res.output);
        setShowBuildLog(true);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Restart failed.");
    } finally {
      setIsRestarting(false);
    }
  }

  // ── Stop ───────────────────────────────────────────────────────────────

  async function handleStop() {
    setActionError("");
    setActionOk("");
    setIsStopping(true);

    try {
      const res = await stopProjectRuntimeAction(projectId);
      if (res.ok) {
        setActionOk("Process stopped.");
        await handleRefresh();
      } else {
        setActionError(res.error);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Stop failed.");
    } finally {
      setIsStopping(false);
    }
  }

  // ── PM2 logs ───────────────────────────────────────────────────────────

  async function handleFetchLogs() {
    setIsFetchingLogs(true);
    try {
      const res = await getProjectRuntimeLogsAction(projectId);
      if (res.ok) {
        setPm2Logs(res.logs);
        setShowPm2Logs(true);
      } else {
        setActionError(res.error);
      }
    } catch {
      setActionError("Failed to fetch logs.");
    } finally {
      setIsFetchingLogs(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const buildOutput = deployOutput || (
    latest?.metadata &&
    typeof latest.metadata === "object" &&
    "output" in latest.metadata
      ? String((latest.metadata as Record<string, unknown>).output ?? "")
      : ""
  );

  return (
    <Card>
      {/* ── Header ── */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Deployment</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Pm2Badge status={pm2Status?.status ?? null} />
            <DeployBadge status={latest?.status ?? null} />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || anyBusy}
              className="h-7 px-2 gap-1 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Preview link + meta */}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline font-mono"
          >
            {previewUrl}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {pm2Status?.memoryMb != null && (
            <span className="text-xs text-muted-foreground">
              {pm2Status.memoryMb} MB
            </span>
          )}
          {pm2Status?.cpu != null && (
            <span className="text-xs text-muted-foreground">
              {pm2Status.cpu}% CPU
            </span>
          )}
          {pm2Status?.uptimeMs != null && (
            <span className="text-xs text-muted-foreground">
              up {formatUptime(pm2Status.uptimeMs)}
            </span>
          )}
          {latest?.duration && (
            <span className="text-xs text-muted-foreground">
              last build: {formatDuration(latest.duration)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Feedback banners ── */}
        {actionError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{actionError}</p>
          </div>
        )}
        {actionOk && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-700 dark:text-green-400">{actionOk}</p>
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleDeploy}
            disabled={anyBusy}
            className="gap-2"
          >
            {isDeploying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deploying…
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Deploy
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleRestart}
            disabled={anyBusy || pm2Status?.status !== "online"}
            className="gap-2"
          >
            {isRestarting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Restarting…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Restart
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleStop}
            disabled={anyBusy || pm2Status?.status !== "online"}
            className="gap-2 text-red-600 hover:text-red-600 dark:text-red-500"
          >
            {isStopping ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Stopping…
              </>
            ) : (
              <>
                <Square className="h-4 w-4" />
                Stop
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={handleFetchLogs}
            disabled={isFetchingLogs || anyBusy}
            className="gap-2"
          >
            {isFetchingLogs ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Terminal className="h-4 w-4" />
                PM2 Logs
              </>
            )}
          </Button>
        </div>

        {/* ── Warning: deploy blocks the request ── */}
        {isDeploying && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Deploying… This may take several minutes for install + build. Do not close the tab.
          </div>
        )}

        {/* ── Build log (from latest deploy action or DB) ── */}
        {buildOutput && (
          <div>
            <button
              type="button"
              onClick={() => setShowBuildLog((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              {showBuildLog ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Build log
            </button>
            {showBuildLog && (
              <pre className="text-xs font-mono leading-relaxed bg-zinc-950 dark:bg-zinc-900 text-zinc-200 rounded-lg p-4 overflow-auto max-h-80 whitespace-pre-wrap">
                {buildOutput}
              </pre>
            )}
          </div>
        )}

        {/* ── PM2 live logs ── */}
        {pm2Logs && (
          <div>
            <button
              type="button"
              onClick={() => setShowPm2Logs((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              {showPm2Logs ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              PM2 runtime logs
            </button>
            {showPm2Logs && (
              <pre className="text-xs font-mono leading-relaxed bg-zinc-950 dark:bg-zinc-900 text-zinc-200 rounded-lg p-4 overflow-auto max-h-80 whitespace-pre-wrap">
                {pm2Logs || "(no output)"}
              </pre>
            )}
          </div>
        )}

        {/* ── Latest deployment error ── */}
        {latest?.status === "FAILED" && latest.errorMessage && !actionError && (
          <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
            <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">
              Last deployment failed:
            </p>
            <pre className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
              {latest.errorMessage.slice(0, 300)}
            </pre>
          </div>
        )}

        {/* ── Config summary (collapsible) ── */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            {showConfig ? "Hide" : "Show"} deployment config
            {showConfig ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
          {showConfig && (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Port</span>
                <span className="ml-2 font-mono font-medium">{config.port}</span>
              </div>
              <div>
                <span className="text-muted-foreground">PM2 name</span>
                <span className="ml-2 font-mono font-medium">{config.pm2Name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Root dir</span>
                <span className="ml-2 font-mono font-medium">{config.rootDirectory}</span>
              </div>
              <div>
                <span className="text-muted-foreground">NODE_ENV</span>
                <span className="ml-2 font-mono font-medium">{config.nodeEnv}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Health path</span>
                <span className="ml-2 font-mono font-medium">{config.healthPath}</span>
              </div>
              <div />
              {config.installCommand && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Install</span>
                  <code className="ml-2 font-mono font-medium">{config.installCommand}</code>
                </div>
              )}
              {config.buildCommand && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Build</span>
                  <code className="ml-2 font-mono font-medium">{config.buildCommand}</code>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-muted-foreground">Start</span>
                <code className="ml-2 font-mono font-medium">{config.startCommand}</code>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
