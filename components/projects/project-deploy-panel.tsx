"use client";

/**
 * components/projects/project-deploy-panel.tsx
 *
 * Runtime control panel for an uploaded / blank / GitHub project that has a
 * saved ProjectDeploymentConfig.
 *
 * Shows:
 *   - PM2 status badge + preview link
 *   - Deploy / Restart / Stop / PM2 Logs action buttons
 *   - Build log from the latest deployment (collapsible)
 *   - Live PM2 logs on demand
 *   - Config summary (collapsible) with an "Edit config" button
 *   - Inline edit form (via DeploymentSetupForm with existingConfig)
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Pencil,
  X,
  WrenchIcon,
  Globe,
  Copy,
  GitCommit,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import {
  DeploymentSetupForm,
  type ExistingDeployConfig,
} from "@/components/projects/deployment-setup-form";

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
  projectId:         string;
  projectSlug:       string;
  config:            DeployConfig;
  latestDeployment:  DeploymentInfo | null;
  initialPm2Status:  Pm2AppStatus | null;
  /** Hostname of the published domain, or null if no domain has been published yet. */
  activeDomain:      string | null;
}

// ── Deployment metadata parsing ────────────────────────────────────────────

type DeployMeta = {
  deploymentRef?: string;
  sourceRef?:     string;
  sourceType?:    "git" | "upload";
  releasePath?:   string;
  internalUrl?:   string;
};

function parseDeployMeta(metadata: unknown): DeployMeta {
  if (!metadata || typeof metadata !== "object") return {};
  const m = metadata as Record<string, unknown>;
  return {
    deploymentRef: typeof m.deploymentRef === "string" ? m.deploymentRef : undefined,
    sourceRef:     typeof m.sourceRef     === "string" ? m.sourceRef     : undefined,
    sourceType:    m.sourceType === "git" || m.sourceType === "upload" ? m.sourceType : undefined,
    releasePath:   typeof m.releasePath   === "string" ? m.releasePath   : undefined,
    internalUrl:   typeof m.internalUrl   === "string" ? m.internalUrl   : undefined,
  };
}

// ── PM2 status badge ───────────────────────────────────────────────────────

function Pm2Badge({ status }: { status: string | null }) {
  if (!status)
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <CircleDot className="h-3 w-3" /> Not running
      </Badge>
    );
  switch (status) {
    case "online":
      return (
        <Badge variant="success" className="gap-1 text-xs">
          <CircleDot className="h-3 w-3 fill-current" /> Online
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Square className="h-3 w-3" /> Stopped
        </Badge>
      );
    case "errored":
      return (
        <Badge variant="error" className="gap-1 text-xs">
          <XCircle className="h-3 w-3" /> Errored
        </Badge>
      );
    case "launching":
      return (
        <Badge variant="warning" className="gap-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Launching
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="h-3 w-3" /> {status}
        </Badge>
      );
  }
}

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
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
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

/** True if the last deploy failed and the current config uses npm (not pnpm). */
function shouldShowPnpmHint(
  latest: DeploymentInfo | null,
  config: DeployConfig
): boolean {
  if (latest?.status !== "FAILED") return false;
  const usesNpm =
    config.installCommand?.startsWith("npm") ||
    config.buildCommand?.startsWith("npm") ||
    (!config.installCommand && !config.buildCommand && config.startCommand.startsWith("npm"));
  return !!usesNpm;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ProjectDeployPanel({
  projectId,
  projectSlug,
  config,
  latestDeployment: initialLatest,
  initialPm2Status,
  activeDomain,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Runtime state
  const [pm2Status,     setPm2Status]     = useState<Pm2AppStatus | null>(initialPm2Status);
  const [latest,        setLatest]        = useState<DeploymentInfo | null>(initialLatest);
  const [deployOutput,  setDeployOutput]  = useState("");
  const [pm2Logs,       setPm2Logs]       = useState("");
  const [showBuildLog,  setShowBuildLog]  = useState(false);
  const [showPm2Logs,   setShowPm2Logs]   = useState(false);
  const [showConfig,    setShowConfig]    = useState(false);

  // Edit mode
  const [isEditing,     setIsEditing]     = useState(false);

  // Action pending states
  const [isDeploying,   setIsDeploying]   = useState(false);
  const [isRestarting,  setIsRestarting]  = useState(false);
  const [isStopping,    setIsStopping]    = useState(false);
  const [isRefreshing,  setIsRefreshing]  = useState(false);
  const [isFetchLogs,   setIsFetchLogs]   = useState(false);

  // Feedback
  const [actionError,   setActionError]   = useState("");
  const [actionOk,      setActionOk]      = useState("");

  const anyBusy    = isDeploying || isRestarting || isStopping;
  const [copiedRef, setCopiedRef] = useState(false);

  // ── onSaved callback for the inline edit form ──────────────────────────

  function handleEditSaved() {
    setIsEditing(false);
    router.refresh();
  }

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
        startTransition(async () => {
          const s = await refreshDeploymentStatusAction(projectId);
          if (s.ok) {
            setPm2Status(s.pm2Status);
            if (s.latestDeployment) setLatest(s.latestDeployment as DeploymentInfo);
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
    setIsFetchLogs(true);
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
      setIsFetchLogs(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────

  const buildOutput = deployOutput || (
    latest?.metadata &&
    typeof latest.metadata === "object" &&
    "output" in latest.metadata
      ? String((latest.metadata as Record<string, unknown>).output ?? "")
      : ""
  );

  const showPnpmHint = shouldShowPnpmHint(latest, config);
  const deployMeta   = parseDeployMeta(latest?.metadata);

  // Existing config shape for the edit form
  const existingForEdit: ExistingDeployConfig = {
    installCommand: config.installCommand,
    buildCommand:   config.buildCommand,
    startCommand:   config.startCommand,
    rootDirectory:  config.rootDirectory,
    healthPath:     config.healthPath,
    nodeEnv:        config.nodeEnv,
    port:           config.port,
    pm2Name:        config.pm2Name,
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Main panel card ── */}
      <Card>
        {/* Header — always visible */}
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
                disabled={isRefreshing || anyBusy || isEditing}
                className="h-7 px-2 gap-1 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Internal target + public domain status */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
              <Server className="h-3.5 w-3.5" />
              127.0.0.1:{config.port}
            </span>
            {activeDomain ? (
              <a
                href={`http://${activeDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {activeDomain}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : pm2Status?.status === "online" ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                Running internally — publish a domain to go public
              </span>
            ) : null}
            {pm2Status?.memoryMb != null && (
              <span className="text-xs text-muted-foreground">{pm2Status.memoryMb} MB</span>
            )}
            {pm2Status?.cpu != null && (
              <span className="text-xs text-muted-foreground">{pm2Status.cpu}% CPU</span>
            )}
            {pm2Status?.uptimeMs != null && (
              <span className="text-xs text-muted-foreground">up {formatUptime(pm2Status.uptimeMs)}</span>
            )}
            {latest?.duration && (
              <span className="text-xs text-muted-foreground">
                last build: {formatDuration(latest.duration)}
              </span>
            )}
          </div>

          {/* Deployment reference strip */}
          {deployMeta.deploymentRef && (
            <div className="flex items-center gap-2 mt-1.5 text-xs font-mono text-muted-foreground">
              <span className="text-muted-foreground/60">ref</span>
              <code className="text-foreground/80">{deployMeta.deploymentRef}</code>
              <button
                type="button"
                title="Copy deployment ref"
                className="hover:text-foreground transition-colors"
                onClick={() => {
                  void navigator.clipboard.writeText(deployMeta.deploymentRef!);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 2000);
                }}
              >
                {copiedRef ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {deployMeta.sourceRef && (
                <span className="text-muted-foreground/60 ml-1 flex items-center gap-1">
                  <GitCommit className="h-3 w-3" />
                  {deployMeta.sourceType === "git" ? "commit" : "hash"}:
                  <code className="ml-0.5">{deployMeta.sourceRef}</code>
                </span>
              )}
            </div>
          )}
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

          {/* ── pnpm hint ── */}
          {showPnpmHint && !isEditing && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
              <WrenchIcon className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                This project appears to require <strong>pnpm</strong>. Click{" "}
                <button
                  type="button"
                  className="underline font-medium"
                  onClick={() => setIsEditing(true)}
                >
                  Edit config
                </button>{" "}
                and switch to the <strong>Next.js (pnpm)</strong> or{" "}
                <strong>Node.js (pnpm)</strong> preset.
              </p>
            </div>
          )}

          {/* ── Action buttons (hidden while editing) ── */}
          {!isEditing && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleDeploy} disabled={anyBusy} className="gap-2">
                  {isDeploying ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Deploying…</>
                  ) : (
                    <><Rocket className="h-4 w-4" /> Deploy</>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleRestart}
                  disabled={anyBusy || pm2Status?.status !== "online"}
                  className="gap-2"
                >
                  {isRestarting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Restarting…</>
                  ) : (
                    <><RefreshCw className="h-4 w-4" /> Restart</>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleStop}
                  disabled={anyBusy || pm2Status?.status !== "online"}
                  className="gap-2 text-red-600 hover:text-red-600 dark:text-red-500"
                >
                  {isStopping ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Stopping…</>
                  ) : (
                    <><Square className="h-4 w-4" /> Stop</>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleFetchLogs}
                  disabled={isFetchLogs || anyBusy}
                  className="gap-2"
                >
                  {isFetchLogs ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                  ) : (
                    <><Terminal className="h-4 w-4" /> PM2 Logs</>
                  )}
                </Button>
              </div>

              {/* Deploying warning */}
              {isDeploying && (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Deploying… This may take several minutes (install + build). Do not close the tab.
                </div>
              )}

              {/* ── Build log ── */}
              {buildOutput && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowBuildLog((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1"
                  >
                    {showBuildLog ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
                    {showPm2Logs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    PM2 runtime logs
                  </button>
                  {showPm2Logs && (
                    <pre className="text-xs font-mono leading-relaxed bg-zinc-950 dark:bg-zinc-900 text-zinc-200 rounded-lg p-4 overflow-auto max-h-80 whitespace-pre-wrap">
                      {pm2Logs || "(no output)"}
                    </pre>
                  )}
                </div>
              )}

              {/* ── Last deployment error ── */}
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

              {/* ── Config summary + edit button ── */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => setShowConfig((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    {showConfig ? "Hide" : "Show"} deployment config
                    {showConfig ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setIsEditing(true); setShowConfig(false); setActionError(""); setActionOk(""); }}
                    className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit config
                  </Button>
                </div>

                {showConfig && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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
                        <code className="ml-2 font-mono font-medium break-all">{config.installCommand}</code>
                      </div>
                    )}
                    {config.buildCommand && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Build</span>
                        <code className="ml-2 font-mono font-medium break-all">{config.buildCommand}</code>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Start</span>
                      <code className="ml-2 font-mono font-medium break-all">{config.startCommand}</code>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Edit mode: Cancel button + inline form below ── */}
          {isEditing && (
            <div className="flex items-center justify-between border-t pt-3">
              <p className="text-sm font-medium text-muted-foreground">
                Editing deployment configuration…
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
                className="h-7 px-2 gap-1 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Inline edit form (shown below the panel card when editing) ── */}
      {isEditing && (
        <DeploymentSetupForm
          projectId={projectId}
          projectSlug={projectSlug}
          existingConfig={existingForEdit}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  );
}
