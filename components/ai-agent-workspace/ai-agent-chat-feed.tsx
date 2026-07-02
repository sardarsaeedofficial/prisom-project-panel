"use client";

/**
 * components/ai-agent-workspace/ai-agent-chat-feed.tsx
 *
 * Interleaves AgentChatMessage bubbles with AgentTimelineStep action rows
 * in chronological order — the left pane's core visual.
 */

import { useEffect, useRef } from "react";
import { Bot, Loader2 } from "lucide-react";
import { AiAgentActionRow, type AgentActionRow, type ActionRowStatus } from "./ai-agent-action-row";
import type {
  AgentChatMessage,
  AgentTimelineStep,
  AgentTimelineStepStatus,
} from "@/lib/ai-import-agent/agent-run-types";

// ── Step ID → friendly label ──────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  start:               "Reading project",
  project_found:       "Project found",
  source_found:        "Located source files",
  stack_detected:      "Detected tech stack",
  api_detected:        "Detected API service",
  frontend_detected:   "Detected frontend",
  secrets_checked:     "Checked environment secrets",
  preset_applied:      "Applied deployment preset",
  deploy:              "Install, build & start",
  preview:             "Checking live preview",
  config_updated:      "Updated deployment config",
  config_verified:     "Verified deployment config",
  inspect_release:     "Inspecting release output",
  build_attempt:       "Attempted build in release",
};

function stepLabel(step: AgentTimelineStep): string {
  if (STEP_LABELS[step.id])                  return STEP_LABELS[step.id];
  if (step.id.startsWith("fix-"))            return step.title || "Applying deterministic fix";
  if (step.id.startsWith("ai-plan-"))        return `Calling Claude Sonnet (plan ${step.id.replace("ai-plan-", "")})`;
  if (step.id.startsWith("ai-action-"))      return step.title || "Executing AI action";
  if (step.id.startsWith("patch-"))          return `Reviewing patch: ${step.title}`;
  return step.title;
}

function stepStatus(s: AgentTimelineStepStatus): ActionRowStatus {
  if (s === "success") return "success";
  if (s === "fixed")   return "fixed";
  if (s === "warning") return "warning";
  if (s === "error")   return "error";
  if (s === "running") return "running";
  return "pending";
}

function toActionRow(step: AgentTimelineStep): AgentActionRow {
  return {
    id:         step.id,
    title:      stepLabel(step),
    subtitle:   step.summary,
    status:     stepStatus(step.status),
    output:     step.fullOutput ?? step.outputPreview,
    command:    step.command,
    expandable: !!(step.fullOutput || step.outputPreview || step.command),
    startedAt:  step.startedAt,
    completedAt:step.completedAt,
  };
}

// ── Merge messages + steps by timestamp ──────────────────────────────────

type FeedItem =
  | { kind: "msg";  item: AgentChatMessage;   ts: number }
  | { kind: "step"; item: AgentTimelineStep; ts: number };

function buildFeed(messages: AgentChatMessage[], steps: AgentTimelineStep[]): FeedItem[] {
  const items: FeedItem[] = [
    ...messages.map((m) => ({ kind: "msg"  as const, item: m, ts: new Date(m.createdAt).getTime() })),
    ...steps   .map((s) => ({ kind: "step" as const, item: s, ts: new Date(s.startedAt ?? s.completedAt ?? 0).getTime() })),
  ];
  return items.sort((a, b) => a.ts - b.ts);
}

// ── Message bubble ────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: AgentChatMessage }) {
  const tone = msg.tone ?? "info";
  const textClass =
    tone === "success"  ? "text-green-300" :
    tone === "warning"  ? "text-amber-300" :
    tone === "error"    ? "text-red-300"   :
    tone === "thinking" ? "text-slate-400 italic" :
    "text-slate-200";
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <div className="h-5 w-5 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="h-3 w-3 text-purple-400" />
      </div>
      <p className={`text-[13px] leading-relaxed break-words ${textClass}`}>{msg.message}</p>
    </div>
  );
}

// ── Main feed ─────────────────────────────────────────────────────────────

interface AiAgentChatFeedProps {
  messages: AgentChatMessage[];
  steps: AgentTimelineStep[];
  isWorking: boolean;
}

export function AiAgentChatFeed({ messages, steps, isWorking }: AiAgentChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = buildFeed(messages, steps);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
      {feed.length === 0 && isWorking && (
        <div className="flex items-start gap-2.5 px-3 py-2">
          <div className="h-5 w-5 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <Bot className="h-3 w-3 text-purple-400" />
          </div>
          <p className="text-[13px] text-slate-400 italic">Starting…</p>
        </div>
      )}
      {feed.length === 0 && !isWorking && (
        <p className="text-[13px] text-slate-500 px-3 py-4 text-center">
          Click <span className="text-purple-400 font-medium">Make Project Live</span> to start the agent.
        </p>
      )}
      {feed.map((item) =>
        item.kind === "msg" ? (
          <ChatBubble key={`msg-${item.item.id}`} msg={item.item} />
        ) : (
          <AiAgentActionRow key={`step-${item.item.id}`} row={toActionRow(item.item)} />
        ),
      )}
      {isWorking && feed.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-[12px]">Working…</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
