"use client";

/**
 * components/projects/ai-import-agent-console.tsx
 *
 * Sprint 89: Replit-style live AI Import Agent console.
 * Sprint 90: Two-panel layout — Agent Chat (left/top) + Live Actions (right/below).
 *            Chat fills in live as each orchestration step runs. Fix with Agent
 *            shows an optimistic message immediately on click.
 * Sprint 92: Poll loop replaced with step-executor calls — each tick calls
 *            runNextAiImportAgentStepAction which both advances the machine
 *            AND returns the latest run state. Watchdog (timed_out) UI added.
 * Sprint 93: AI status badge, PlanCard, PatchApprovalCard.
 *            Approve/Reject patch actions. AI provider badge.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Loader2, Clock,
  ChevronDown, ChevronUp, Download, Eye, Wrench, ExternalLink, RefreshCw,
  Bot, MessageSquare, Activity, Sparkles, WifiOff, FileCode, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
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
} from "@/app/actions/ai-import-agent";
import { getAgentFixStartMessage } from "@/lib/ai-import-agent/agent-step-builder";
import {
  ACTIVE_STATUSES,
  WAITING_STATUSES,
  TERMINAL_STATUSES,
  type AgentRun,
  type AgentRunStatus,
  type AgentTimelineStep,
  type AgentTimelineStepStatus,
  type AgentChatMessage,
  type AiImportPlan,
  type PendingPatch,
} from "@/lib/ai-import-agent/agent-run-types";

const POLL_INTERVAL_MS = 2000;

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Partial<Record<AgentRunStatus, string>> & { default: string } = {
  // Sprint 92 canonical
  not_started:                "Not started",
  queued:                     "Queued…",
  running:                    "Working…",
  deploying:                  "Deploying…",
  verifying:                  "Verifying…",
  fixing:                     "Applying fix…",
  // Sprint 93
  planning:                   "Planning with AI…",
  waiting_for_patch_approval: "Awaiting patch approval",
  // Waiting
  waiting_for_user_input:     "Needs your input",
  waiting_for_fix_approval:   "Fix available",
  // Terminal
  preview_live:               "Preview live",
  failed:                     "Failed",
  timed_out:                  "Timed out",
  blocked:                    "Blocked",
  // Legacy
  idle:                       "Not started",
  waiting_for_user:           "Needs your input",
  fix_available:              "Fix available",
  retrying:                   "Retrying…",
  default:                    "Working…",
};

function getStatusLabel(status: AgentRunStatus): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? STATUS_LABEL.default;
}

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const variant: "success" | "warning" | "destructive" | "secondary" =
    status === "preview_live"                                                                          ? "success" :
    status === "failed" || status === "timed_out" || status === "blocked"                             ? "destructive" :
    status === "waiting_for_user_input"  || status === "waiting_for_fix_approval"   ||
    status === "waiting_for_patch_approval" ||
    status === "waiting_for_user"        || status === "fix_available"                                ? "warning" :
    "secondary";
  return <Badge variant={variant}>{getStatusLabel(status)}</Badge>;
}

// ── AI provider badge (Sprint 93) ──────────────────────────────────────────────

function AiStatusBadge({ available }: { available: boolean | null }) {
  if (available === null) return null;
  return available ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
      <Sparkles className="h-3 w-3" /> Sonnet connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <WifiOff className="h-3 w-3" /> AI provider not configured — rule-based fixes only
    </span>
  );
}

// ── Step icon ──────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: AgentTimelineStepStatus }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "fixed")   return <Wrench       className="h-4 w-4 text-blue-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (status === "error")   return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "running") return <Loader2      className="h-4 w-4 animate-spin text-primary shrink-0" />;
  if (status === "skipped") return <ChevronDown  className="h-4 w-4 text-muted-foreground shrink-0" />;
  return                           <Clock        className="h-4 w-4 text-muted-foreground shrink-0" />;
}

// ── Misc helpers ───────────────────────────────────────────────────────────────

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

// ── Chat bubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: AgentChatMessage }) {
  const tone = msg.tone ?? "info";
  const textClass =
    tone === "success"  ? "text-green-700 dark:text-green-400" :
    tone === "warning"  ? "text-amber-700 dark:text-amber-300" :
    tone === "error"    ? "text-destructive" :
    tone === "thinking" ? "text-muted-foreground italic" :
    "text-foreground";

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="h-3 w-3 text-primary" />
      </div>
      <p className={`text-sm leading-relaxed break-words ${textClass}`}>{msg.message}</p>
    </div>
  );
}

// ── Chat panel ─────────────────────────────────────────────────────────────────

function ChatPanel({
  messages, isWorking,
}: { messages: AgentChatMessage[]; isWorking: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="rounded-md border flex flex-col min-h-[200px]">
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5 shrink-0">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent</p>
      </div>
      <div className="flex-1 px-3 py-2 overflow-y-auto max-h-64 space-y-0.5">
        {messages.length === 0 && isWorking && (
          <div className="flex items-start gap-2.5 py-1.5">
            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3 w-3 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground italic">Starting…</p>
          </div>
        )}
        {messages.length === 0 && !isWorking && (
          <p className="text-xs text-muted-foreground py-2">No messages yet.</p>
        )}
        {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
        {isWorking && messages.length > 0 && (
          <div className="flex items-center gap-1.5 py-1 pl-7">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Working…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Timeline step row (with collapsible output) ────────────────────────────────

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

// ── Actions panel ─────────────────────────────────────────────────────────────

function ActionsPanel({ steps, isWorking }: { steps: AgentTimelineStep[]; isWorking: boolean }) {
  return (
    <div className="rounded-md border flex flex-col min-h-[200px]">
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5 shrink-0">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live Actions</p>
      </div>
      <div className="flex-1 px-3 overflow-y-auto max-h-64">
        {steps.length === 0 && isWorking && (
          <p className="text-xs text-muted-foreground py-3 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading project files…
          </p>
        )}
        {steps.length === 0 && !isWorking && (
          <p className="text-xs text-muted-foreground py-3">No actions yet.</p>
        )}
        {steps.map((step, i) => <StepRow key={`${step.id}-${i}`} step={step} />)}
      </div>
    </div>
  );
}

// ── AI Plan card (Sprint 93) ──────────────────────────────────────────────────

function PlanCard({ plan }: { plan: AiImportPlan }) {
  const [open, setOpen] = useState(true);

  const confidenceColor =
    plan.confidence === "high"   ? "text-green-600 dark:text-green-400" :
    plan.confidence === "medium" ? "text-amber-600 dark:text-amber-400" :
    "text-muted-foreground";

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm font-medium">AI Fix Plan</p>
        </div>
        <span className={`text-[11px] font-medium ${confidenceColor}`}>
          {plan.confidence} confidence
        </span>
      </div>

      <p className="text-xs text-foreground">{plan.summary}</p>
      <p className="text-xs text-muted-foreground">{plan.diagnosis}</p>

      {plan.recommendedActions.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {open ? "Hide" : "Show"} {plan.recommendedActions.length} action{plan.recommendedActions.length !== 1 ? "s" : ""}
          </button>

          {open && (
            <ol className="space-y-1.5">
              {plan.recommendedActions.map((action, i) => (
                <li key={action.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <span className="font-medium">{action.title}</span>
                    {action.filePath && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        ({action.filePath})
                      </span>
                    )}
                    <p className="text-muted-foreground mt-0.5">{action.reason}</p>
                  </div>
                  <Badge
                    variant={action.safety === "safe" ? "secondary" : action.safety === "needs_approval" ? "warning" : "destructive"}
                    className="shrink-0 text-[10px]"
                  >
                    {action.kind === "edit_file" ? "needs approval" : action.safety}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {plan.stopReason && (
        <p className="text-xs text-destructive">Blocked: {plan.stopReason}</p>
      )}
    </div>
  );
}

// ── Patch approval card (Sprint 93) ───────────────────────────────────────────

function PatchApprovalCard({
  patch,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  patch: PendingPatch;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [showFull, setShowFull] = useState(false);

  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <FileCode className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">AI proposes a file change</p>
          <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{patch.filePath}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{patch.reason}</p>

      {patch.unifiedDiff && (
        <>
          <button
            type="button"
            onClick={() => setShowDiff((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {showDiff ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDiff ? "Hide diff" : "Show diff"}
          </button>
          {showDiff && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/70 rounded p-2 max-h-64 overflow-y-auto">
              {patch.unifiedDiff}
            </pre>
          )}
        </>
      )}

      {patch.proposedContent && (
        <>
          <button
            type="button"
            onClick={() => setShowFull((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {showFull ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showFull ? "Hide" : "Show"} full file content
          </button>
          {showFull && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/70 rounded p-2 max-h-64 overflow-y-auto">
              {patch.proposedContent}
            </pre>
          )}
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          disabled={approving || rejecting}
          onClick={onApprove}
          className="h-8"
        >
          {approving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Applying…</>
            : <><ThumbsUp className="h-3.5 w-3.5 mr-1.5" /> Approve patch</>
          }
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={approving || rejecting}
          onClick={onReject}
          className="h-8"
        >
          {rejecting
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Skipping…</>
            : <><ThumbsDown className="h-3.5 w-3.5 mr-1.5" /> Reject</>
          }
        </Button>
      </div>
    </div>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────

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
      <div>
        {err.safeFixAvailable && (
          <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">Fix available</p>
        )}
        <p className="text-sm font-medium">
          {err.title ?? run.steps[run.steps.length - 1]?.title ?? "Issue found"}
        </p>
      </div>

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

// ── Main console ───────────────────────────────────────────────────────────────

interface AiImportAgentConsoleProps {
  projectId: string;
}

export function AiImportAgentConsole({ projectId }: AiImportAgentConsoleProps) {
  const [run,             setRun]             = useState<AgentRun | null>(null);
  const [starting,        setStarting]        = useState(false);
  const [fixing,          setFixing]          = useState(false);
  const [retrying,        setRetrying]        = useState(false);
  const [exporting,       setExporting]       = useState(false);
  const [approvingPatch,  setApprovingPatch]  = useState(false);
  const [rejectingPatch,  setRejectingPatch]  = useState(false);
  const [aiAvailable,     setAiAvailable]     = useState<boolean | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef    = useRef<AgentRun | null>(null);
  runRef.current  = run;

  // Fetch AI provider status once on mount
  useEffect(() => {
    void checkAiProviderStatusAction().then((res) => {
      if (res.ok) setAiAvailable(res.data.available);
    });
  }, []);

  /**
   * Sprint 92: each tick calls the step executor, which advances the machine
   * by one phase AND returns the updated run. Falls back to a read-only poll
   * when the run has no runId yet or is in a terminal/waiting state.
   */
  const poll = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;

    // For active runs: call step executor so it can advance the machine.
    // For waiting/terminal: read-only poll to pick up user-driven changes.
    if (ACTIVE_STATUSES.includes(current.status)) {
      const res = await runNextAiImportAgentStepAction({
        projectId,
        runId: current.id,
      });
      if (res.ok) setRun(res.data);
    } else {
      const res = await getAiImportAgentRunAction({ projectId });
      if (res.ok && res.data) setRun(res.data);
    }
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
      // Stop auto-polling once the run is terminal (timed_out, failed,
      // preview_live) — the user must take an explicit action to continue.
      if (current && TERMINAL_STATUSES.includes(current.status)) {
        stopPolling();
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);
  }, [poll, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  // Recover an in-progress run on mount (refresh resilience).
  useEffect(() => {
    void (async () => {
      const res = await getAiImportAgentRunAction({ projectId });
      if (res.ok && res.data) {
        setRun(res.data);
        // Start polling for active or waiting states; terminal states need
        // a user action (retry/fix) to continue.
        if (!TERMINAL_STATUSES.includes(res.data.status)) startPolling();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function makeProjectLive() {
    setStarting(true);
    setError(null);
    const res = await startAiImportAgentRunAction({ projectId });
    setStarting(false);
    if (res.ok) {
      setRun(res.data);
      startPolling();
    } else {
      setError(res.error);
    }
  }

  async function applyFix(fixId: string) {
    if (!run) return;
    setFixing(true);
    setError(null);

    const optimisticMsg: AgentChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: "agent",
      tone: "thinking",
      message: getAgentFixStartMessage(fixId),
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? {
      ...prev,
      status: "fixing",
      chatMessages: [...(prev.chatMessages ?? []), optimisticMsg],
    } : null);

    const res = await fixAiImportAgentIssueAction({ projectId, runId: run.id, fixId });
    setFixing(false);
    if (res.ok) {
      setRun(res.data);
      startPolling();
    } else {
      setError(res.error);
    }
  }

  async function retry() {
    if (!run) return;
    setRetrying(true);
    setError(null);

    const optimisticMsg: AgentChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: "agent",
      tone: "thinking",
      message: "I'm retrying from where I left off.",
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? {
      ...prev,
      status: "retrying",
      chatMessages: [...(prev.chatMessages ?? []), optimisticMsg],
    } : null);

    const res = await retryAiImportAgentRunAction({ projectId, runId: run.id });
    setRetrying(false);
    if (res.ok) {
      setRun(res.data);
      startPolling();
    } else {
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

  // Sprint 93: approve AI-proposed patch
  async function approvePatch() {
    if (!run) return;
    setApprovingPatch(true);
    setError(null);
    const res = await approveAiImportAgentPatchAction({ projectId, runId: run.id });
    setApprovingPatch(false);
    if (res.ok) {
      setRun(res.data);
      startPolling();
    } else {
      setError(res.error);
    }
  }

  // Sprint 93: reject AI-proposed patch
  async function rejectPatch() {
    if (!run) return;
    setRejectingPatch(true);
    setError(null);
    const res = await rejectAiImportAgentPatchAction({ projectId, runId: run.id });
    setRejectingPatch(false);
    if (res.ok) {
      setRun(res.data);
      startPolling();
    } else {
      setError(res.error);
    }
  }

  const isWorking = starting || (run ? ACTIVE_STATUSES.includes(run.status) : false);
  const showConsole = !!run;

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
                {run
                  ? run.summary
                  : "One button. I read your project, run the commands, fix errors, and verify preview."
                }
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {run && <StatusBadge status={run.status} />}
            <AiStatusBadge available={aiAvailable} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Start button — shown only before any run exists */}
        {!showConsole && (
          <Button
            size="default"
            className="w-full sm:w-auto"
            onClick={makeProjectLive}
            disabled={starting}
          >
            {starting
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Starting…</>
              : <><Zap className="h-4 w-4 mr-2" /> Make Project Live</>
            }
          </Button>
        )}

        {/* Action-level error (not the same as run.lastError) */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</div>
        )}

        {showConsole && (
          <>
            {/* ── Live indicator ─────────────────────────────────────────── */}
            {isWorking && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                You can leave this page open while I work. I&apos;ll show every step here.
              </p>
            )}

            {/* ── Two-panel: Chat | Actions ──────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChatPanel
                messages={run.chatMessages ?? []}
                isWorking={isWorking}
              />
              <ActionsPanel
                steps={run.steps}
                isWorking={isWorking}
              />
            </div>

            {/* ── Sprint 93: AI plan card ────────────────────────────────── */}
            {run.aiPlan && (
              <PlanCard plan={run.aiPlan} />
            )}

            {/* ── Sprint 93: Patch approval card ────────────────────────── */}
            {run.pendingPatch && run.status === "waiting_for_patch_approval" && (
              <PatchApprovalCard
                patch={run.pendingPatch}
                onApprove={approvePatch}
                onReject={rejectPatch}
                approving={approvingPatch}
                rejecting={rejectingPatch}
              />
            )}

            {/* ── Error card with Fix with Agent ─────────────────────────── */}
            {run.lastError && (
              run.status === "failed" ||
              run.status === "waiting_for_fix_approval" ||
              run.status === "fix_available"
            ) && (
              <ErrorCard
                run={run}
                onFix={applyFix}
                onRetry={retry}
                fixing={fixing}
                retrying={retrying}
              />
            )}

            {/* ── Timed out — run was stuck, watchdog caught it ───────────── */}
            {run.status === "timed_out" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-2">
                <p className="font-medium text-destructive">The last action stopped responding.</p>
                <p className="text-muted-foreground">
                  The agent timed out while waiting for a response. Click Retry to resume safely — no
                  duplicate deploys will run.
                </p>
                <Button size="sm" variant="outline" disabled={retrying} onClick={retry} className="h-8">
                  {retrying
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Resuming…</>
                    : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>
                  }
                </Button>
              </div>
            )}

            {/* ── Waiting for user (missing secrets) ─────────────────────── */}
            {(run.status === "waiting_for_user_input" || run.status === "waiting_for_user") && (
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

            {/* ── Preview / domain links ──────────────────────────────────── */}
            {(run.previewUrl || run.publicUrl) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {run.previewUrl && isBrowserSafe(run.previewUrl) && (
                  <a
                    href={run.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" /> Panel preview
                  </a>
                )}
                {run.publicUrl && isBrowserSafe(run.publicUrl) && (
                  <a
                    href={run.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:underline"
                  >
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

            {/* ── Footer actions ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={exporting}
                onClick={exportRunbook}
                className="h-8 text-xs"
              >
                {exporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Download className="h-3.5 w-3.5 mr-1.5" />
                }
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
              No secrets shown. Only this project&apos;s PM2 process is managed. No automatic go-live.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
