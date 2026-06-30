"use client";

/**
 * components/projects/ai-import-agent-console.tsx
 *
 * Sprint 89: Replit-style live AI Import Agent console. Polls the persisted
 * AgentRun every 2 seconds while running/fixing/retrying so the timeline
 * fills in step by step instead of showing a static card.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Loader2, Clock,
  ChevronDown, ChevronUp, Download, Eye, Wrench, ExternalLink, RefreshCw,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  startAiImportAgentRunAction,
  getAiImportAgentRunAction,
  fixAiImportAgentIssueAction,
  retryAiImportAgentRunAction,
  exportAiImportAgentRunAction,
} from "@/app/actions/ai-import-agent";
import {
  POLLING_STATUSES,
  type AgentRun,
  type AgentRunStatus,
  type AgentTimelineStep,
  type AgentTimelineStepStatus,
} from "@/lib/ai-import-agent/agent-run-types";

const POLL_INTERVAL_MS = 2000;

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  idle:              "Not started",
  running:           "Working…",
  waiting_for_user:  "Needs your input",
  fix_available:     "Fix available",
  fixing:            "Applying fix…",
  retrying:          "Retrying…",
  preview_live:      "Preview live",
  failed:            "Failed",
};

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const variant: "success" | "warning" | "destructive" | "secondary" =
    status === "preview_live"                                          ? "success" :
    status === "failed"                                                 ? "destructive" :
    status === "waiting_for_user" || status === "fix_available"         ? "warning" :
    "secondary";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function StepIcon({ status }: { status: AgentTimelineStepStatus }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "fixed")   return <Wrench className="h-4 w-4 text-blue-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (status === "error")   return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function isBrowserSafe(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const { hostname } = new URL(url);
    return hostname !== "127.0.0.1" && hostname !== "localhost";
  } catch {
    return false;
  }
}

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Timeline step row with collapsible output ─────────────────────────────────

function StepRow({ step }: { step: AgentTimelineStep }) {
  const [open, setOpen] = useState(false);
  const hasOutput = !!(step.outputPreview || step.fullOutput);

  return (
    <div className="py-2 border-b border-border/50 last:border-0">
      <div className="flex items-start gap-2">
        <StepIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{step.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">{step.summary}</p>
          {step.command && (
            <p className="text-xs font-mono text-muted-foreground mt-1 bg-muted/50 rounded px-2 py-1 break-all">
              {step.command}
            </p>
          )}
          {hasOutput && (
            <button
              type="button"
              onClick={() => setOpen((s) => !s)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {open ? "Hide output" : "Show output"}
            </button>
          )}
          {open && hasOutput && (
            <pre className="mt-1.5 text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/50 rounded p-2 max-h-56 overflow-y-auto">
              {step.outputPreview ?? step.fullOutput}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Error card ─────────────────────────────────────────────────────────────────

function ErrorCard({
  run, onFix, onRetry, fixing, retrying,
}: {
  run: AgentRun;
  onFix: (fixId: string) => void;
  onRetry: () => void;
  fixing: boolean;
  retrying: boolean;
}) {
  const [showTech, setShowTech] = useState(false);
  const err = run.lastError;
  if (!err) return null;

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-2.5">
      <p className="text-sm font-medium">{run.steps[run.steps.length - 1]?.title ?? "Issue found"}</p>

      <div className="space-y-1.5 text-xs">
        <p><span className="font-medium text-foreground">What happened: </span><span className="text-muted-foreground">{err.whatHappened}</span></p>
        <p><span className="font-medium text-foreground">Why: </span><span className="text-muted-foreground">{err.why}</span></p>
        <p><span className="font-medium text-foreground">Recommended fix: </span><span className="text-muted-foreground">{err.whatICanDo}</span></p>
      </div>

      {err.manualInstructions && (
        <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/50 rounded p-2">
          {err.manualInstructions}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {err.safeFixAvailable && err.safeFixId && (
          <Button size="sm" disabled={fixing} onClick={() => onFix(err.safeFixId!)} className="h-8">
            {fixing
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Fixing…</>
              : <><Wrench className="h-3.5 w-3.5 mr-1.5" /> Fix with Agent</>
            }
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry} className="h-8">
          {retrying
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Retrying…</>
            : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>
          }
        </Button>
        <button
          type="button"
          onClick={() => setShowTech((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1"
        >
          {showTech ? "Hide" : "Show"} technical details
        </button>
      </div>

      {showTech && (
        <div className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
          <div>kind: {err.kind}</div>
          <div>safety: {err.fixSafetyLevel}</div>
          <div>reason: {err.technicalReason}</div>
        </div>
      )}
    </div>
  );
}

// ── Main console ────────────────────────────────────────────────────────────────

interface AiImportAgentConsoleProps {
  projectId: string;
}

export function AiImportAgentConsole({ projectId }: AiImportAgentConsoleProps) {
  const [run,        setRun]       = useState<AgentRun | null>(null);
  const [starting,   setStarting]  = useState(false);
  const [fixing,     setFixing]    = useState(false);
  const [retrying,   setRetrying]  = useState(false);
  const [exporting,  setExporting] = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef    = useRef<AgentRun | null>(null);
  runRef.current = run;

  const poll = useCallback(async () => {
    const res = await getAiImportAgentRunAction({ projectId });
    if (res.ok && res.data) setRun(res.data);
  }, [projectId]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = setInterval(() => {
      const current = runRef.current;
      if (!current || POLLING_STATUSES.includes(current.status)) {
        void poll();
      } else {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [poll, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  // Recover an in-progress run on mount (refresh resilience).
  useEffect(() => {
    void (async () => {
      const res = await getAiImportAgentRunAction({ projectId });
      if (res.ok && res.data) {
        setRun(res.data);
        if (POLLING_STATUSES.includes(res.data.status)) startPolling();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function makeProjectLive() {
    setStarting(true);
    setError(null);
    startPolling(); // begin polling immediately — the run row is created before the long work starts
    const res = await startAiImportAgentRunAction({ projectId });
    setStarting(false);
    if (res.ok) {
      setRun(res.data);
      if (!POLLING_STATUSES.includes(res.data.status)) stopPolling();
    } else {
      stopPolling();
      setError(res.error);
    }
  }

  async function applyFix(fixId: string) {
    if (!run) return;
    setFixing(true);
    setError(null);
    startPolling();
    const res = await fixAiImportAgentIssueAction({ projectId, runId: run.id, fixId });
    setFixing(false);
    if (res.ok) {
      setRun(res.data);
      if (!POLLING_STATUSES.includes(res.data.status)) stopPolling();
    } else {
      stopPolling();
      setError(res.error);
    }
  }

  async function retry() {
    if (!run) return;
    setRetrying(true);
    setError(null);
    startPolling();
    const res = await retryAiImportAgentRunAction({ projectId, runId: run.id });
    setRetrying(false);
    if (res.ok) {
      setRun(res.data);
      if (!POLLING_STATUSES.includes(res.data.status)) stopPolling();
    } else {
      stopPolling();
      setError(res.error);
    }
  }

  async function exportRunbook() {
    if (!run) return;
    setExporting(true);
    const res = await exportAiImportAgentRunAction({ projectId, runId: run.id });
    setExporting(false);
    if (res.ok) {
      downloadMarkdown(res.data.markdown, res.data.filename);
    } else {
      setError(res.error);
    }
  }

  const showTimeline = !!run;
  const isWorking = starting || (run ? POLLING_STATUSES.includes(run.status) : false);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Import Agent</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                One button. I read your project, run the commands, fix errors, and verify preview.
              </CardDescription>
            </div>
          </div>
          {run && <StatusBadge status={run.status} />}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {!showTimeline && (
          <Button size="default" className="w-full sm:w-auto" onClick={makeProjectLive} disabled={starting}>
            {starting
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Starting…</>
              : <><Zap className="h-4 w-4 mr-2" /> Make Project Live</>
            }
          </Button>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</div>
        )}

        {run && (
          <>
            <div className="rounded-md bg-muted/50 px-4 py-3">
              <p className="text-sm leading-relaxed">{run.summary}</p>
              {isWorking && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Live progress — updating every {POLL_INTERVAL_MS / 1000}s
                </p>
              )}
            </div>

            {/* ── Timeline ─────────────────────────────────────────────────── */}
            <div className="rounded-md border px-3">
              {run.steps.map((step, i) => <StepRow key={`${step.id}-${i}`} step={step} />)}
              {run.steps.length === 0 && (
                <p className="text-xs text-muted-foreground py-3 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Reading project files…
                </p>
              )}
            </div>

            {/* ── Error card with Fix with Agent ───────────────────────────── */}
            {run.lastError && (run.status === "fix_available" || run.status === "failed") && (
              <ErrorCard run={run} onFix={applyFix} onRetry={retry} fixing={fixing} retrying={retrying} />
            )}

            {/* ── Waiting for user (missing secrets) ───────────────────────── */}
            {run.status === "waiting_for_user" && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 p-3 text-xs">
                Add the missing values in the Environment tab, then click Retry.
                <div className="mt-2">
                  <Button size="sm" variant="outline" disabled={retrying} onClick={retry} className="h-8">
                    {retrying
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking…</>
                      : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>
                    }
                  </Button>
                </div>
              </div>
            )}

            {/* ── Preview / domain links ───────────────────────────────────── */}
            {(run.previewUrl || run.publicUrl) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {run.previewUrl && isBrowserSafe(run.previewUrl) && (
                  <a href={run.previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    <Eye className="h-3.5 w-3.5" /> Panel preview
                  </a>
                )}
                {run.publicUrl && isBrowserSafe(run.publicUrl) && (
                  <a href={run.publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:underline">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Live domain
                  </a>
                )}
              </div>
            )}
            {!run.publicUrl && run.status === "preview_live" && (
              <p className="text-xs text-muted-foreground">
                No public domain attached yet. Use panel preview until domain is connected.
              </p>
            )}

            {/* ── Footer actions ────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" variant="ghost" disabled={exporting} onClick={exportRunbook} className="h-8 text-xs">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Export Runbook
              </Button>
              <a
                href={`/projects/${projectId}/operations`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View in Operations
              </a>
            </div>

            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              No secrets shown. Only this project's PM2 process is managed. No automatic go-live.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
