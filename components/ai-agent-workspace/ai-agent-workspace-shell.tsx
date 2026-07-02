"use client";

/**
 * components/ai-agent-workspace/ai-agent-workspace-shell.tsx
 *
 * Sprint 95: Replit-style dark split workspace.
 * Left: chat feed + plan/patch cards + error cards.
 * Right: live preview iframe + status panel.
 * Replaces the "two-column" layout inside AiImportAgentConsole.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Zap, Loader2, Square, Play, RefreshCw, Trash2,
  Download, ExternalLink, CheckCircle2, WifiOff,
  Wrench, AlertTriangle,
} from "lucide-react";
import {
  startAiImportAgentRunAction,
  getAiImportAgentRunAction,
  runNextAiImportAgentStepAction,
  fixAiImportAgentIssueAction,
  retryAiImportAgentRunAction,
  exportAiImportAgentRunAction,
  approveAiImportAgentPatchAction,
  rejectAiImportAgentPatchAction,
  checkAiProviderStatusAction,
  stopAiImportAgentRunAction,
  resumeAiImportAgentRunAction,
  clearStaleAiImportAgentRunAction,
} from "@/app/actions/ai-import-agent";
import { getAgentFixStartMessage } from "@/lib/ai-import-agent/agent-step-builder";
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  STATUS_TIMEOUT_MS,
  type AgentRun,
  type AgentRunStatus,
  type AgentChatMessage,
} from "@/lib/ai-import-agent/agent-run-types";
import { AiAgentChatFeed }          from "./ai-agent-chat-feed";
import { AiAgentPlanCard }           from "./ai-agent-plan-card";
import { AiAgentPatchApprovalCard }  from "./ai-agent-patch-approval-card";
import { AiAgentStatusPanel }        from "./ai-agent-status-panel";
import { AiAgentPreviewPane }        from "./ai-agent-preview-pane";
import { AiAgentComposer }           from "./ai-agent-composer";
import { AiAgentEmptyState }         from "./ai-agent-empty-state";

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000;
const STUCK_WARNING_MS = 30_000;

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  not_started:                "Not started",
  queued:                     "Queued…",
  running:                    "Working…",
  deploying:                  "Deploying…",
  verifying:                  "Verifying…",
  fixing:                     "Applying fix…",
  planning:                   "Planning…",
  waiting_for_user_input:     "Needs your input",
  waiting_for_fix_approval:   "Fix available",
  waiting_for_patch_approval: "Patch approval needed",
  preview_live:               "Preview live",
  failed:                     "Failed",
  timed_out:                  "Timed out",
  stopped:                    "Stopped",
  blocked:                    "Blocked",
  idle:                       "Not started",
  waiting_for_user:           "Needs your input",
  fix_available:              "Fix available",
  retrying:                   "Retrying…",
};

function getStatusLabel(status: AgentRunStatus): string {
  return STATUS_LABEL[status] ?? "Working…";
}

function getPhaseText(run: AgentRun, modelLabel: string): string {
  switch (run.status) {
    case "queued":                     return "Queued for the next step…";
    case "running":                    return "Analyzing project files…";
    case "deploying":                  return "Running install, build, and PM2 start…";
    case "verifying":                  return "Checking API health and preview routes…";
    case "fixing":                     return "Applying fix and reinspecting…";
    case "planning":                   return `${modelLabel} is planning a fix…`;
    case "waiting_for_user_input":     return "Add missing secrets in the Environment tab, then click Retry.";
    case "waiting_for_fix_approval":   return "A safe fix is ready — review the details below.";
    case "waiting_for_patch_approval": return `${modelLabel} recommends a code change — review the patch below.`;
    case "preview_live":               return "Preview is live.";
    case "failed":                     return "Agent stopped — see the error card below.";
    case "timed_out":                  return "Agent timed out — click Resume or Start Fresh.";
    case "stopped":                    return "Agent stopped by you — click Resume to continue.";
    case "blocked":                    return "Manual action required — see below.";
    default:                           return "Working…";
  }
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentRunStatus }) {
  const color =
    status === "preview_live"                             ? "bg-green-400" :
    status === "failed" || status === "timed_out" ||
    status === "blocked"                                  ? "bg-red-400"   :
    status === "stopped"                                  ? "bg-slate-500" :
    status === "waiting_for_user_input" ||
    status === "waiting_for_fix_approval" ||
    status === "waiting_for_patch_approval" ||
    status === "waiting_for_user" ||
    status === "fix_available"                            ? "bg-amber-400" :
    ACTIVE_STATUSES.includes(status)                     ? "bg-purple-400 animate-pulse" :
    "bg-slate-600";
  return <span className={`h-2 w-2 rounded-full inline-block ${color}`} />;
}

// ── Error card ────────────────────────────────────────────────────────────────

function ErrorCard({
  run, onFix, onRetry, fixing, retrying,
}: { run: AgentRun; onFix: (id: string) => void; onRetry: () => void; fixing: boolean; retrying: boolean }) {
  const [showTech, setShowTech] = useState(false);
  const err = run.lastError;
  if (!err) return null;
  return (
    <div className="mx-3 mb-2 rounded-lg border border-red-500/30 bg-red-950/20 p-4 space-y-2.5">
      <div>
        {err.safeFixAvailable && (
          <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-widest mb-1">Fix available</p>
        )}
        <p className="text-[13px] font-semibold text-slate-100">{err.title ?? "Issue found"}</p>
      </div>
      <div className="space-y-1 text-[12px]">
        <p><span className="font-medium text-slate-300">What happened: </span><span className="text-slate-400">{err.whatHappened}</span></p>
        <p><span className="font-medium text-slate-300">Why: </span><span className="text-slate-400">{err.why}</span></p>
        <p><span className="font-medium text-slate-300">Recommended fix: </span><span className="text-slate-400">{err.whatICanDo}</span></p>
      </div>
      {err.manualInstructions && (
        <pre className="text-[10px] font-mono whitespace-pre-wrap bg-black/30 rounded p-2 text-slate-400">{err.manualInstructions}</pre>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {err.safeFixAvailable && err.safeFixId && (
          <button
            type="button"
            disabled={fixing}
            onClick={() => onFix(err.safeFixId!)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[12px] font-medium"
          >
            {fixing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fixing…</> : <><Wrench className="h-3.5 w-3.5" /> Fix with Agent</>}
          </button>
        )}
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-300 text-[12px] font-medium"
        >
          {retrying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Retrying…</> : <><RefreshCw className="h-3.5 w-3.5" /> Retry</>}
        </button>
        <button
          type="button"
          onClick={() => setShowTech((s) => !s)}
          className="text-[11px] text-slate-500 hover:text-slate-300 underline"
        >
          {showTech ? "Hide" : "Show"} technical details
        </button>
      </div>
      {showTech && (
        <div className="text-[10px] font-mono text-slate-500 bg-black/30 rounded p-2 space-y-0.5">
          <div>kind: {err.kind}</div>
          <div>safety: {err.fixSafetyLevel}</div>
          <div>reason: {err.technicalReason}</div>
        </div>
      )}
    </div>
  );
}

// ── Main workspace shell ──────────────────────────────────────────────────────

interface AiAgentWorkspaceShellProps {
  projectId: string;
}

type AiStatus = { available: boolean; modelLabel: string; exactModel: string };

export function AiAgentWorkspaceShell({ projectId }: AiAgentWorkspaceShellProps) {
  const [run,            setRun]            = useState<AgentRun | null>(null);
  const [starting,       setStarting]       = useState(false);
  const [stopping,       setStopping]       = useState(false);
  const [resuming,       setResuming]       = useState(false);
  const [fixing,         setFixing]         = useState(false);
  const [retrying,       setRetrying]       = useState(false);
  const [clearing,       setClearing]       = useState(false);
  const [exporting,      setExporting]      = useState(false);
  const [approvingPatch, setApprovingPatch] = useState(false);
  const [rejectingPatch, setRejectingPatch] = useState(false);
  const [aiStatus,       setAiStatus]       = useState<AiStatus | null>(null);
  const [actionError,    setActionError]    = useState<string | null>(null);
  const [, setTick]                         = useState(0);

  const pollTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef           = useRef<AgentRun | null>(null);
  const lastProgressMs   = useRef<number>(Date.now());
  const lastUpdatedAtRef = useRef<string | null>(null);
  runRef.current = run;

  // Tick every 10 s for stuck detection
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (run?.updatedAt && run.updatedAt !== lastUpdatedAtRef.current) {
      lastUpdatedAtRef.current = run.updatedAt;
      lastProgressMs.current   = Date.now();
    }
  }, [run?.updatedAt]);

  useEffect(() => {
    void checkAiProviderStatusAction().then((res) => {
      if (res.ok) setAiStatus(res.data);
    });
  }, []);

  // ── Polling ──────────────────────────────────────────────────────────────

  const poll = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    if (ACTIVE_STATUSES.includes(current.status)) {
      const res = await runNextAiImportAgentStepAction({ projectId, runId: current.id });
      if (res.ok) setRun(res.data);
    } else {
      const res = await getAiImportAgentRunAction({ projectId });
      if (res.ok && res.data) setRun(res.data);
    }
  }, [projectId]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = setInterval(() => {
      const current = runRef.current;
      if (current && TERMINAL_STATUSES.includes(current.status)) { stopPolling(); return; }
      void poll();
    }, POLL_INTERVAL_MS);
  }, [poll, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    void (async () => {
      const res = await getAiImportAgentRunAction({ projectId });
      if (res.ok && res.data) {
        setRun(res.data);
        if (!TERMINAL_STATUSES.includes(res.data.status)) startPolling();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function makeProjectLive() {
    setStarting(true); setActionError(null);
    const res = await startAiImportAgentRunAction({ projectId });
    setStarting(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function stopAgent() {
    if (!run) return;
    setStopping(true); setActionError(null);
    setRun((prev) => prev ? { ...prev, status: "stopped" } : null);
    stopPolling();
    const res = await stopAiImportAgentRunAction({ projectId });
    setStopping(false);
    if (res.ok) setRun(res.data);
    else { setActionError(res.error); setRun(runRef.current); }
  }

  async function resumeAgent() {
    if (!run) return;
    setResuming(true); setActionError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: "I'm resuming from the last safe step.",
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "queued", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await resumeAiImportAgentRunAction({ projectId });
    setResuming(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function clearStaleRun() {
    if (!run) return;
    setClearing(true); setActionError(null);
    const res = await clearStaleAiImportAgentRunAction({ projectId });
    setClearing(false);
    if (res.ok) { setRun(res.data); stopPolling(); }
    else setActionError(res.error);
  }

  async function applyFix(fixId: string) {
    if (!run) return;
    setFixing(true); setActionError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: getAgentFixStartMessage(fixId),
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "fixing", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await fixAiImportAgentIssueAction({ projectId, runId: run.id, fixId });
    setFixing(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function retry() {
    if (!run) return;
    setRetrying(true); setActionError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: "I'm retrying from where I left off.",
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "retrying", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await retryAiImportAgentRunAction({ projectId, runId: run.id });
    setRetrying(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function approvePatch() {
    if (!run) return;
    setApprovingPatch(true); setActionError(null);
    const res = await approveAiImportAgentPatchAction({ projectId, runId: run.id });
    setApprovingPatch(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function rejectPatch() {
    if (!run) return;
    setRejectingPatch(true); setActionError(null);
    const res = await rejectAiImportAgentPatchAction({ projectId, runId: run.id });
    setRejectingPatch(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setActionError(res.error);
  }

  async function exportRunbook() {
    if (!run) return;
    setExporting(true);
    const res = await exportAiImportAgentRunAction({ projectId, runId: run.id });
    setExporting(false);
    if (!res.ok) { setActionError(res.error); return; }
    const blob = new Blob([res.data.markdown], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = res.data.filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const isWorking  = starting || (run ? ACTIVE_STATUSES.includes(run.status) : false);
  const modelLabel = aiStatus?.modelLabel ?? "AI assistant";
  const exactModel = aiStatus?.exactModel;
  const phaseText  = run ? getPhaseText(run, modelLabel) : "";
  const idleMs     = Date.now() - lastProgressMs.current;
  const isStuck    = isWorking && idleMs > STUCK_WARNING_MS;
  const timeoutMs  = run ? (STATUS_TIMEOUT_MS[run.status] ?? 300_000) : 300_000;
  const isTimedOut = isWorking && idleMs > timeoutMs;
  const idleSecs   = Math.floor(idleMs / 1_000);

  const showStopBtn   = isWorking && !stopping;
  const showResumeBtn = !!run && (run.status === "stopped" || run.status === "timed_out" || run.status === "failed");
  const showClearBtn  = !!run && (run.status === "stopped" || run.status === "timed_out" || run.status === "failed" || isTimedOut);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-950 rounded-xl border border-white/10 overflow-hidden">

      {/* ── Workspace header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-slate-900 shrink-0 flex-wrap">
        {/* Left: icon + title + phase */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-7 w-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0">
            <Zap className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-100 truncate">AI Import Agent</p>
            {run && (
              <div className="flex items-center gap-1.5">
                <StatusDot status={run.status} />
                <p className="text-[11px] text-slate-400 truncate">{getStatusLabel(run.status)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: control bar */}
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {!run && !starting && (
            <button
              type="button"
              onClick={makeProjectLive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[12px] font-medium transition-colors"
            >
              <Zap className="h-3.5 w-3.5" /> Make Project Live
            </button>
          )}
          {showStopBtn && (
            <button
              type="button"
              onClick={stopAgent}
              disabled={stopping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
            >
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              {stopping ? "Stopping…" : "Stop Agent"}
            </button>
          )}
          {showResumeBtn && (
            <button
              type="button"
              onClick={resumeAgent}
              disabled={resuming}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
            >
              {resuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {resuming ? "Resuming…" : "Resume"}
            </button>
          )}
          {run && !isWorking && !showResumeBtn && (
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-300 text-[12px] font-medium transition-colors"
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          {run && !isWorking && !showResumeBtn && (
            <button
              type="button"
              onClick={makeProjectLive}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-400 text-[12px] font-medium transition-colors"
            >
              <Zap className="h-3.5 w-3.5" /> Start Fresh
            </button>
          )}
          {showClearBtn && (
            <button
              type="button"
              onClick={clearStaleRun}
              disabled={clearing}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/5 disabled:opacity-50 text-slate-500 hover:text-slate-300 text-[12px] transition-colors"
              title="Clear stale run"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Phase text bar ────────────────────────────────────────── */}
      {run && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 bg-slate-900/60 shrink-0">
          {isWorking && <Loader2 className="h-3 w-3 animate-spin text-purple-400 shrink-0" />}
          <p className="text-[11px] text-slate-500">{phaseText}</p>
          {aiStatus && !aiStatus.available && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
              <WifiOff className="h-3 w-3" /> AI not configured
            </span>
          )}
          {aiStatus?.available && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-green-500">
              ✦ {modelLabel}
            </span>
          )}
        </div>
      )}

      {/* ── Body: left feed | right preview+status ────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: chat feed + cards ──────────────────────────── */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 border-r border-white/10">
          {/* Error banner */}
          {actionError && (
            <div className="mx-3 mt-2 rounded-lg bg-red-950/30 border border-red-500/30 px-3 py-2 text-[12px] text-red-400 shrink-0">
              {actionError}
            </div>
          )}

          {/* Stuck warning */}
          {isStuck && (
            <div className="mx-3 mt-2 rounded-lg bg-amber-950/20 border border-amber-500/30 px-3 py-2 text-[12px] shrink-0 space-y-1.5">
              {isTimedOut ? (
                <>
                  <p className="flex items-center gap-1.5 font-medium text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> This run appears stuck
                  </p>
                  <p className="text-slate-400">No progress for {Math.floor(idleMs / 60_000)} min. Click Resume to retry safely.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={resumeAgent} disabled={resuming}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px]">
                      {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
                    </button>
                    <button type="button" onClick={clearStaleRun} disabled={clearing}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-400 text-[11px]">
                      <Trash2 className="h-3 w-3" /> Clear
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-slate-500">Still working. Last update {idleSecs}s ago.</p>
              )}
            </div>
          )}

          {/* Stopped card */}
          {run?.status === "stopped" && !isWorking && (
            <div className="mx-3 mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-slate-400 shrink-0 space-y-1">
              <p className="font-medium text-slate-300">Agent stopped</p>
              <p>Click Resume to continue from where I left off.</p>
            </div>
          )}

          {/* Timed-out card */}
          {run?.status === "timed_out" && !isWorking && (
            <div className="mx-3 mt-2 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-[12px] shrink-0 space-y-1.5">
              <p className="font-medium text-red-300">The last action stopped responding.</p>
              <p className="text-slate-400">Click Resume to retry safely — no duplicate deploys.</p>
              <div className="flex gap-2">
                <button type="button" onClick={resumeAgent} disabled={resuming}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px]">
                  {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
                </button>
              </div>
            </div>
          )}

          {/* Waiting for secrets */}
          {(run?.status === "waiting_for_user_input" || run?.status === "waiting_for_user") && (
            <div className="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[12px] shrink-0 space-y-1.5">
              <p className="font-medium text-amber-300">Action required</p>
              <p className="text-slate-400">Add missing secrets in the Environment tab, then click Retry.</p>
              <button type="button" onClick={retry} disabled={retrying}
                className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-300 text-[11px]">
                {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Retry
              </button>
            </div>
          )}

          {/* Chat feed or empty state */}
          {run ? (
            <AiAgentChatFeed
              messages={run.chatMessages ?? []}
              steps={run.steps ?? []}
              isWorking={isWorking}
            />
          ) : (
            <AiAgentEmptyState
              onStart={makeProjectLive}
              starting={starting}
              modelLabel={modelLabel}
              aiAvailable={aiStatus?.available ?? false}
            />
          )}

          {/* Plan card */}
          {run?.aiPlan && (
            <AiAgentPlanCard
              plan={run.aiPlan}
              modelLabel={modelLabel}
              currentActionIndex={run.aiPlanActionIndex}
            />
          )}

          {/* Patch approval */}
          {run?.pendingPatch && run.status === "waiting_for_patch_approval" && (
            <AiAgentPatchApprovalCard
              patch={run.pendingPatch}
              modelLabel={modelLabel}
              onApprove={approvePatch}
              onReject={rejectPatch}
              approving={approvingPatch}
              rejecting={rejectingPatch}
            />
          )}

          {/* Error card */}
          {run?.lastError && (run.status === "failed" || run.status === "waiting_for_fix_approval" || run.status === "fix_available") && (
            <ErrorCard
              run={run}
              onFix={applyFix}
              onRetry={retry}
              fixing={fixing}
              retrying={retrying}
            />
          )}

          {/* Footer */}
          {run && (
            <div className="flex items-center gap-3 px-3 py-2 border-t border-white/10 shrink-0">
              <button
                type="button"
                onClick={exportRunbook}
                disabled={exporting}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Export Runbook
              </button>
              <a
                href={`/projects/${projectId}/operations`}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <ExternalLink className="h-3 w-3" /> Operations
              </a>
              <p className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                No secrets shown
              </p>
            </div>
          )}

          {/* Composer */}
          <AiAgentComposer disabled={!run || !isWorking} />
        </div>

        {/* ── Right: preview + status ──────────────────────────── */}
        <div className="flex flex-col w-80 shrink-0 min-h-0 overflow-hidden">
          {/* Preview pane (top half) */}
          <div className="flex-1 min-h-0 border-b border-white/10">
            <AiAgentPreviewPane
              previewUrl={run?.previewUrl}
              publicUrl={run?.publicUrl}
              isLive={run?.status === "preview_live"}
            />
          </div>

          {/* Status panel (bottom half) */}
          <div className="overflow-y-auto" style={{ maxHeight: "340px" }}>
            {run ? (
              <AiAgentStatusPanel
                run={run}
                isWorking={isWorking}
                phaseText={phaseText}
                modelLabel={modelLabel}
                exactModel={exactModel}
              />
            ) : (
              <div className="p-4 text-[11px] text-slate-600 text-center">
                Status will appear here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
