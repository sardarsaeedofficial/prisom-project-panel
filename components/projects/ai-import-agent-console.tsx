"use client";

/**
 * components/projects/ai-import-agent-console.tsx
 *
 * Sprint 89: Replit-style live AI Import Agent console.
 * Sprint 90: Two-panel chat + actions layout.
 * Sprint 92: Step-executor poll model; watchdog (timed_out) UI.
 * Sprint 93: AI status badge, PlanCard, PatchApprovalCard, approve/reject.
 * Sprint 94: Stop/Resume/Clear controls; exact model badge; phase-specific
 *            status text; stuck detection; phase-grouped live actions;
 *            Status panel (right column with preview + phase info).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Loader2, Clock,
  ChevronDown, ChevronUp, Download, Eye, Wrench, ExternalLink, RefreshCw,
  Bot, MessageSquare, Activity, Sparkles, WifiOff, FileCode, ThumbsUp,
  ThumbsDown, Square, Play, Trash2, Globe,
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
  type AgentTimelineStep,
  type AgentTimelineStepStatus,
  type AgentChatMessage,
  type AiImportPlan,
  type PendingPatch,
} from "@/lib/ai-import-agent/agent-run-types";

const POLL_INTERVAL_MS = 2_000;
const STUCK_WARNING_MS = 30_000;

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> & { default: string } = {
  not_started:                "Not started",
  queued:                     "Queued…",
  running:                    "Working…",
  deploying:                  "Deploying…",
  verifying:                  "Verifying…",
  fixing:                     "Applying fix…",
  planning:                   "Planning…",
  waiting_for_user_input:     "Needs your input",
  waiting_for_fix_approval:   "Fix available",
  waiting_for_patch_approval: "Awaiting patch approval",
  preview_live:               "Preview live",
  failed:                     "Failed",
  timed_out:                  "Timed out",
  stopped:                    "Stopped",
  blocked:                    "Blocked",
  idle:                       "Not started",
  waiting_for_user:           "Needs your input",
  fix_available:              "Fix available",
  retrying:                   "Retrying…",
  default:                    "Working…",
};

function getStatusLabel(status: AgentRunStatus): string {
  return STATUS_LABEL[status] ?? STATUS_LABEL.default;
}

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const variant: "success" | "warning" | "destructive" | "secondary" =
    status === "preview_live"                                              ? "success"     :
    status === "failed"  || status === "timed_out" || status === "blocked" ? "destructive" :
    status === "stopped"                                                    ? "secondary"   :
    status === "waiting_for_user_input"  || status === "waiting_for_fix_approval"   ||
    status === "waiting_for_patch_approval" ||
    status === "waiting_for_user"        || status === "fix_available"               ? "warning"    :
    "secondary";
  return <Badge variant={variant}>{getStatusLabel(status)}</Badge>;
}

// ── Phase text (context-aware, not generic "Working...") ──────────────────────

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

// ── Model badge (Sprint 94) ────────────────────────────────────────────────────

type AiStatus = { available: boolean; modelLabel: string; exactModel: string };

function ModelBadge({ status }: { status: AiStatus | null }) {
  if (!status) return null;
  return status.available ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 font-medium">
      <Sparkles className="h-3 w-3" />
      {status.modelLabel} connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <WifiOff className="h-3 w-3" />
      AI provider not configured — rule-based mode only
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
  if (status === "skipped") return <ChevronDown  className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
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
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Phase grouping for Live Actions ───────────────────────────────────────────

const PHASE_STEP_IDS: Record<string, string[]> = {
  "Analyze":      ["start", "project_found", "source_found", "stack_detected", "api_detected", "frontend_detected", "secrets_checked"],
  "Setup":        ["preset_applied"],
  "Build & Deploy": ["deploy", "build_attempt"],
  "Verify":       ["preview", "inspect_release", "config_updated", "config_verified"],
};

function getStepGroup(id: string): string {
  for (const [group, ids] of Object.entries(PHASE_STEP_IDS)) {
    if (ids.includes(id)) return group;
  }
  if (id.startsWith("fix-"))      return "Fix";
  if (id.startsWith("ai-plan-"))  return "AI Planning";
  if (id.startsWith("ai-action-") || id.startsWith("patch-")) return "AI Actions";
  return "Other";
}

function groupSteps(steps: AgentTimelineStep[]): Array<{ group: string; steps: AgentTimelineStep[] }> {
  const ordered: string[] = [];
  const map = new Map<string, AgentTimelineStep[]>();
  for (const step of steps) {
    const g = getStepGroup(step.id);
    if (!map.has(g)) { map.set(g, []); ordered.push(g); }
    map.get(g)!.push(step);
  }
  return ordered.map((g) => ({ group: g, steps: map.get(g)! }));
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

function ChatPanel({ messages, isWorking }: { messages: AgentChatMessage[]; isWorking: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  return (
    <div className="rounded-md border flex flex-col h-full min-h-[220px]">
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5 shrink-0">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent</p>
      </div>
      <div className="flex-1 px-3 py-2 overflow-y-auto max-h-72 space-y-0.5">
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

// ── Status panel (right column) ────────────────────────────────────────────────

function StatusPanel({
  run, isWorking, phaseText, modelLabel,
}: {
  run: AgentRun;
  isWorking: boolean;
  phaseText: string;
  modelLabel: string;
}) {
  return (
    <div className="rounded-md border flex flex-col min-h-[220px]">
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5 shrink-0">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
      </div>
      <div className="flex-1 px-3 py-3 space-y-3 overflow-y-auto max-h-72">
        {/* Current phase */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Current phase
          </p>
          <div className="flex items-start gap-1.5">
            {isWorking && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0 mt-0.5" />}
            <p className="text-sm">{phaseText}</p>
          </div>
        </div>

        {/* Preview links */}
        {(run.previewUrl || run.publicUrl) && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Endpoints
            </p>
            <div className="space-y-1">
              {run.previewUrl && isBrowserSafe(run.previewUrl) && (
                <a
                  href={run.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                  Panel preview
                </a>
              )}
              {run.publicUrl && isBrowserSafe(run.publicUrl) ? (
                <a
                  href={run.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 hover:underline"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  {run.publicUrl}
                </a>
              ) : run.status === "preview_live" ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  No public domain — panel preview only
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* Model info */}
        {modelLabel && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Model
            </p>
            <p className="text-xs text-muted-foreground">{modelLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step row (collapsible output) ──────────────────────────────────────────────

function StepRow({ step }: { step: AgentTimelineStep }) {
  const [open, setOpen] = useState(false);
  const hasOutput = !!(step.outputPreview || step.fullOutput);
  return (
    <div className="py-1.5 border-b border-border/40 last:border-0">
      <div className="flex items-start gap-2">
        <StepIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{step.title}</p>
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
              {open ? "Hide" : "Show"} output
            </button>
          )}
          {open && hasOutput && (
            <pre className="mt-1.5 text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/50 rounded p-2 max-h-48 overflow-y-auto">
              {step.outputPreview ?? step.fullOutput}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live Actions panel (phase-grouped) ────────────────────────────────────────

function LiveActionsPanel({ steps, isWorking }: { steps: AgentTimelineStep[]; isWorking: boolean }) {
  const groups = groupSteps(steps);
  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live Actions</p>
      </div>
      <div className="px-3 py-1 max-h-72 overflow-y-auto">
        {steps.length === 0 && isWorking && (
          <p className="text-xs text-muted-foreground py-3 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading project files…
          </p>
        )}
        {steps.length === 0 && !isWorking && (
          <p className="text-xs text-muted-foreground py-3">No actions yet.</p>
        )}
        {groups.map(({ group, steps: gSteps }) => (
          <div key={group} className="py-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pb-1 pt-2 first:pt-1">
              {group}
            </p>
            {gSteps.map((step, i) => <StepRow key={`${step.id}-${i}`} step={step} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI Plan card ───────────────────────────────────────────────────────────────

function PlanCard({ plan, modelLabel }: { plan: AiImportPlan; modelLabel: string }) {
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
          <p className="text-sm font-medium">AI Fix Plan from {modelLabel}</p>
        </div>
        <span className={`text-[11px] font-medium ${confidenceColor}`}>{plan.confidence} confidence</span>
      </div>
      <p className="text-xs text-foreground">{plan.summary}</p>
      <p className="text-xs text-muted-foreground">{plan.diagnosis}</p>
      {plan.recommendedActions.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {open ? "Hide" : "Show"} {plan.recommendedActions.length} action{plan.recommendedActions.length !== 1 ? "s" : ""}
          </button>
          {open && (
            <ol className="space-y-1.5">
              {plan.recommendedActions.map((action, i) => (
                <li key={action.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-medium">{i + 1}</span>
                  <div className="min-w-0">
                    <span className="font-medium">{action.title}</span>
                    {action.filePath && <span className="ml-1 font-mono text-[10px] text-muted-foreground">({action.filePath})</span>}
                    <p className="text-muted-foreground mt-0.5">{action.reason}</p>
                  </div>
                  <Badge variant={action.kind === "edit_file" ? "warning" : action.safety === "safe" ? "secondary" : "warning"}
                    className="shrink-0 text-[10px]">
                    {action.kind === "edit_file" ? "needs approval" : action.safety}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {plan.stopReason && <p className="text-xs text-destructive">Blocked: {plan.stopReason}</p>}
    </div>
  );
}

// ── Patch approval card ────────────────────────────────────────────────────────

function PatchApprovalCard({
  patch, modelLabel, onApprove, onReject, approving, rejecting,
}: {
  patch: PendingPatch; modelLabel: string;
  onApprove: () => void; onReject: () => void;
  approving: boolean; rejecting: boolean;
}) {
  const [showDiff, setShowDiff]   = useState(false);
  const [showFull, setShowFull]   = useState(false);
  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <FileCode className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{modelLabel} recommends editing:</p>
          <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{patch.filePath}</p>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Reason</p>
        <p className="text-xs text-muted-foreground">{patch.reason}</p>
      </div>
      {patch.unifiedDiff && (
        <>
          <button type="button" onClick={() => setShowDiff((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline">
            {showDiff ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDiff ? "Hide diff" : "View patch"}
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
          <button type="button" onClick={() => setShowFull((s) => !s)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline">
            {showFull ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showFull ? "Hide" : "Show"} full file
          </button>
          {showFull && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/70 rounded p-2 max-h-64 overflow-y-auto">
              {patch.proposedContent}
            </pre>
          )}
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={approving || rejecting} onClick={onApprove} className="h-8">
          {approving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Applying…</>
            : <><ThumbsUp className="h-3.5 w-3.5 mr-1.5" /> Approve patch</>
          }
        </Button>
        <Button size="sm" variant="outline" disabled={approving || rejecting} onClick={onReject} className="h-8">
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
}: { run: AgentRun; onFix: (fixId: string) => void; onRetry: () => void; fixing: boolean; retrying: boolean; }) {
  const [showTech, setShowTech] = useState(false);
  const err = run.lastError;
  if (!err) return null;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-2.5">
      <div>
        {err.safeFixAvailable && (
          <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">Fix available</p>
        )}
        <p className="text-sm font-medium">{err.title ?? "Issue found"}</p>
      </div>
      <div className="space-y-1.5 text-xs">
        <p><span className="font-medium">What happened: </span><span className="text-muted-foreground">{err.whatHappened}</span></p>
        <p><span className="font-medium">Why: </span><span className="text-muted-foreground">{err.why}</span></p>
        <p><span className="font-medium">Recommended fix: </span><span className="text-muted-foreground">{err.whatICanDo}</span></p>
      </div>
      {err.manualInstructions && (
        <pre className="text-[10px] font-mono whitespace-pre-wrap bg-muted/50 rounded p-2">{err.manualInstructions}</pre>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {err.safeFixAvailable && err.safeFixId && (
          <Button size="sm" disabled={fixing} onClick={() => onFix(err.safeFixId!)} className="h-8">
            {fixing ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Fixing…</> : <><Wrench className="h-3.5 w-3.5 mr-1.5" /> Fix with Agent</>}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry} className="h-8">
          {retrying ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Retrying…</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>}
        </Button>
        <button type="button" onClick={() => setShowTech((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1">
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
  const [error,          setError]          = useState<string | null>(null);
  const [, setTick]                         = useState(0); // drives stuck-detection re-render

  const pollTimer         = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef            = useRef<AgentRun | null>(null);
  const lastProgressMs    = useRef<number>(Date.now());
  const lastUpdatedAtRef  = useRef<string | null>(null);
  runRef.current = run;

  // Tick every 10 s so stuck-detection labels update even with no new data
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // Track when run.updatedAt last changed to detect stuck runs
  useEffect(() => {
    if (run?.updatedAt && run.updatedAt !== lastUpdatedAtRef.current) {
      lastUpdatedAtRef.current = run.updatedAt;
      lastProgressMs.current   = Date.now();
    }
  }, [run?.updatedAt]);

  // Fetch AI provider status once on mount
  useEffect(() => {
    void checkAiProviderStatusAction().then((res) => {
      if (res.ok) setAiStatus(res.data);
    });
  }, []);

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

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function makeProjectLive() {
    setStarting(true); setError(null);
    const res = await startAiImportAgentRunAction({ projectId });
    setStarting(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function stopAgent() {
    if (!run) return;
    setStopping(true); setError(null);
    setRun((prev) => prev ? { ...prev, status: "stopped" } : null);
    stopPolling();
    const res = await stopAiImportAgentRunAction({ projectId });
    setStopping(false);
    if (res.ok) setRun(res.data);
    else { setError(res.error); setRun((prev) => runRef.current ?? prev); }
  }

  async function resumeAgent() {
    if (!run) return;
    setResuming(true); setError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: "I'm resuming from the last safe step.",
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "queued", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await resumeAiImportAgentRunAction({ projectId });
    setResuming(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function clearStaleRun() {
    if (!run) return;
    setClearing(true); setError(null);
    const res = await clearStaleAiImportAgentRunAction({ projectId });
    setClearing(false);
    if (res.ok) { setRun(res.data); stopPolling(); }
    else setError(res.error);
  }

  async function applyFix(fixId: string) {
    if (!run) return;
    setFixing(true); setError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: getAgentFixStartMessage(fixId),
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "fixing", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await fixAiImportAgentIssueAction({ projectId, runId: run.id, fixId });
    setFixing(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function retry() {
    if (!run) return;
    setRetrying(true); setError(null);
    const optimistic: AgentChatMessage = {
      id: `opt-${Date.now()}`, role: "agent", tone: "thinking",
      message: "I'm retrying from where I left off.",
      createdAt: new Date().toISOString(),
    };
    setRun((prev) => prev ? { ...prev, status: "retrying", chatMessages: [...(prev.chatMessages ?? []), optimistic] } : null);
    const res = await retryAiImportAgentRunAction({ projectId, runId: run.id });
    setRetrying(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function approvePatch() {
    if (!run) return;
    setApprovingPatch(true); setError(null);
    const res = await approveAiImportAgentPatchAction({ projectId, runId: run.id });
    setApprovingPatch(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function rejectPatch() {
    if (!run) return;
    setRejectingPatch(true); setError(null);
    const res = await rejectAiImportAgentPatchAction({ projectId, runId: run.id });
    setRejectingPatch(false);
    if (res.ok) { setRun(res.data); startPolling(); }
    else setError(res.error);
  }

  async function exportRunbook() {
    if (!run) return;
    setExporting(true);
    const res = await exportAiImportAgentRunAction({ projectId, runId: run.id });
    setExporting(false);
    if (res.ok) downloadMarkdown(res.data.markdown, res.data.filename);
    else setError(res.error);
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const isWorking    = starting || (run ? ACTIVE_STATUSES.includes(run.status) : false);
  const showConsole  = !!run;
  const modelLabel   = aiStatus?.modelLabel ?? "AI assistant";
  const phaseText    = run ? getPhaseText(run, modelLabel) : "";
  const idleMs       = Date.now() - lastProgressMs.current;
  const isStuck      = isWorking && idleMs > STUCK_WARNING_MS;
  const timeoutMs    = run ? (STATUS_TIMEOUT_MS[run.status] ?? 300_000) : 300_000;
  const isTimedOut   = isWorking && idleMs > timeoutMs;
  const idleSecs     = Math.floor(idleMs / 1_000);

  const showStopBtn   = isWorking && !stopping;
  const showResumeBtn = run && (run.status === "stopped" || run.status === "timed_out" || run.status === "failed");
  const showClearBtn  = run && (run.status === "stopped" || run.status === "timed_out" || run.status === "failed" || isTimedOut);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        {/* ── Top row: title + badges + controls ─────────────────────── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Import Agent</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {run ? run.summary : "One button. I read, deploy, fix, and verify."}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {run && <StatusBadge status={run.status} />}
            <ModelBadge status={aiStatus} />
          </div>
        </div>

        {/* ── Phase text (animated when working) ─────────────────────── */}
        {showConsole && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
            {isWorking && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
            {phaseText}
          </p>
        )}

        {/* ── Control bar ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {!showConsole && (
            <Button size="sm" onClick={makeProjectLive} disabled={starting} className="h-8">
              {starting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Starting…</>
                : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Make Project Live</>
              }
            </Button>
          )}
          {showStopBtn && (
            <Button size="sm" variant="destructive" onClick={stopAgent} disabled={stopping} className="h-8">
              {stopping
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Stopping…</>
                : <><Square className="h-3.5 w-3.5 mr-1.5" /> Stop Agent</>
              }
            </Button>
          )}
          {showResumeBtn && (
            <Button size="sm" onClick={resumeAgent} disabled={resuming} className="h-8">
              {resuming
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Resuming…</>
                : <><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</>
              }
            </Button>
          )}
          {showConsole && run && !isWorking && !showResumeBtn && (
            <Button size="sm" variant="outline" onClick={retry} disabled={retrying} className="h-8">
              {retrying
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Retrying…</>
                : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>
              }
            </Button>
          )}
          {showClearBtn && (
            <Button size="sm" variant="ghost" onClick={clearStaleRun} disabled={clearing} className="h-8 text-muted-foreground hover:text-foreground">
              {clearing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Clearing…</>
                : <><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear stale run</>
              }
            </Button>
          )}
          {showConsole && !showResumeBtn && run && (
            <Button size="sm" variant="ghost" onClick={makeProjectLive} disabled={starting || isWorking} className="h-8 text-muted-foreground hover:text-foreground">
              <Zap className="h-3.5 w-3.5 mr-1.5" /> Start Fresh
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Action-level error */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</div>
        )}

        {showConsole && run && (
          <>
            {/* ── Stuck / timed-out warning ──────────────────────────── */}
            {isTimedOut && !isStuck && null}
            {isStuck && (
              <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2">
                {isTimedOut ? (
                  <>
                    <p className="font-medium text-amber-900 dark:text-amber-200">This run appears stuck.</p>
                    <p className="text-muted-foreground">No progress for {Math.floor(idleMs / 60_000)} minute(s). Click Resume to retry from the last safe step.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={resumeAgent} disabled={resuming} className="h-8">
                        {resuming ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Resuming…</> : <><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={clearStaleRun} disabled={clearing} className="h-8 text-muted-foreground">
                        {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear stale run</>}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Still working. Last update {idleSecs}s ago.
                  </p>
                )}
              </div>
            )}

            {/* ── Timed out state ────────────────────────────────────── */}
            {run.status === "timed_out" && !isWorking && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-2">
                <p className="font-medium text-destructive">The last action stopped responding.</p>
                <p className="text-muted-foreground">Click Resume to retry safely — no duplicate deploys will run.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={resumeAgent} disabled={resuming} className="h-8">
                    {resuming ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Resuming…</> : <><Play className="h-3.5 w-3.5 mr-1.5" /> Resume</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearStaleRun} disabled={clearing} className="h-8 text-muted-foreground">
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear stale run</>}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Stopped state ──────────────────────────────────────── */}
            {run.status === "stopped" && (
              <div className="rounded-md border border-border p-3 text-xs space-y-2">
                <p className="font-medium">Agent stopped.</p>
                <p className="text-muted-foreground">Click Resume to continue from where I left off.</p>
              </div>
            )}

            {/* ── Main two-column: Chat | Status ─────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Left: Chat + AI cards */}
              <div className="space-y-3">
                <ChatPanel messages={run.chatMessages ?? []} isWorking={isWorking} />
                {run.aiPlan && <PlanCard plan={run.aiPlan} modelLabel={modelLabel} />}
                {run.pendingPatch && run.status === "waiting_for_patch_approval" && (
                  <PatchApprovalCard
                    patch={run.pendingPatch}
                    modelLabel={modelLabel}
                    onApprove={approvePatch}
                    onReject={rejectPatch}
                    approving={approvingPatch}
                    rejecting={rejectingPatch}
                  />
                )}
              </div>
              {/* Right: Status panel */}
              <StatusPanel run={run} isWorking={isWorking} phaseText={phaseText} modelLabel={modelLabel} />
            </div>

            {/* ── Error card with Fix with Agent ─────────────────────── */}
            {run.lastError && (run.status === "failed" || run.status === "waiting_for_fix_approval" || run.status === "fix_available") && (
              <ErrorCard run={run} onFix={applyFix} onRetry={retry} fixing={fixing} retrying={retrying} />
            )}

            {/* ── Waiting for user (missing secrets) ─────────────────── */}
            {(run.status === "waiting_for_user_input" || run.status === "waiting_for_user") && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 p-3 text-xs">
                Add the missing values in the Environment tab, then click Retry.
                <div className="mt-2">
                  <Button size="sm" variant="outline" disabled={retrying} onClick={retry} className="h-8">
                    {retrying ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Checking…</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</>}
                  </Button>
                </div>
              </div>
            )}

            {/* ── AI not configured hint ─────────────────────────────── */}
            {aiStatus && !aiStatus.available && (
              <div className="rounded-md border border-muted p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{modelLabel} is available if deterministic fixes fail. Configure ANTHROPIC_API_KEY to enable AI-powered fixes.</span>
              </div>
            )}

            {/* ── Phase-grouped Live Actions ─────────────────────────── */}
            <LiveActionsPanel steps={run.steps} isWorking={isWorking} />

            {/* ── Footer ────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" variant="ghost" disabled={exporting} onClick={exportRunbook} className="h-8 text-xs">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Export Runbook
              </Button>
              <a href={`/projects/${projectId}/operations`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
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
