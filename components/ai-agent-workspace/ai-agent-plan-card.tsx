"use client";

/**
 * components/ai-agent-workspace/ai-agent-plan-card.tsx
 * Clean AI plan display replacing the old overlapping card.
 */

import { useState } from "react";
import {
  Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, Shield, FileCode, Terminal, Settings, MessageSquare, Ban,
} from "lucide-react";
import type { AiImportPlan, AiImportPlanAction } from "@/lib/ai-import-agent/agent-run-types";

const KIND_ICON: Record<AiImportPlanAction["kind"], React.ReactNode> = {
  update_deployment_config: <Settings  className="h-3.5 w-3.5" />,
  edit_file:                <FileCode  className="h-3.5 w-3.5" />,
  run_command:              <Terminal  className="h-3.5 w-3.5" />,
  inspect_file:             <FileCode  className="h-3.5 w-3.5" />,
  ask_user:                 <MessageSquare className="h-3.5 w-3.5" />,
  manual_blocker:           <Ban       className="h-3.5 w-3.5" />,
};

const CONFIDENCE_COLOR: Record<AiImportPlan["confidence"], string> = {
  high:   "text-green-400",
  medium: "text-amber-400",
  low:    "text-slate-400",
};

const SAFETY_BADGE: Record<AiImportPlanAction["safety"], string> = {
  safe:             "bg-green-500/20 text-green-400 border-green-500/30",
  needs_approval:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  blocked:          "bg-red-500/20 text-red-400 border-red-500/30",
};

interface AiAgentPlanCardProps {
  plan: AiImportPlan;
  modelLabel: string;
  currentActionIndex?: number;
}

export function AiAgentPlanCard({ plan, modelLabel, currentActionIndex }: AiAgentPlanCardProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-3 mb-2 rounded-lg border border-purple-500/30 bg-purple-950/20 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
          <span className="text-[13px] font-semibold text-slate-100">
            AI Plan from {modelLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium uppercase ${CONFIDENCE_COLOR[plan.confidence]}`}>
            {plan.confidence} confidence
          </span>
          {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10">
          {/* Summary + Diagnosis */}
          <div className="pt-3 space-y-1">
            <p className="text-[13px] text-slate-200">{plan.summary}</p>
            <p className="text-[12px] text-slate-400">{plan.diagnosis}</p>
          </div>

          {plan.stopReason && (
            <div className="rounded border border-red-500/30 bg-red-900/20 px-3 py-2">
              <p className="text-[12px] text-red-300">Blocked: {plan.stopReason}</p>
            </div>
          )}

          {/* Action list */}
          {plan.recommendedActions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                Recommended actions
              </p>
              {plan.recommendedActions.map((action, i) => {
                const isDone  = currentActionIndex !== undefined && i < currentActionIndex;
                const isNext  = currentActionIndex === i;
                return (
                  <div
                    key={action.id}
                    className={`flex items-start gap-3 rounded px-3 py-2 border ${
                      isDone ? "border-green-500/20 bg-green-900/10"
                      : isNext ? "border-purple-500/30 bg-purple-900/20"
                      : "border-white/5 bg-white/5"
                    }`}
                  >
                    <span className="shrink-0 mt-0.5">
                      {isDone
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        : <span className={`text-[11px] h-3.5 w-3.5 flex items-center justify-center ${KIND_ICON[action.kind] ? "text-slate-400" : "text-slate-500"}`}>
                            {KIND_ICON[action.kind]}
                          </span>
                      }
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-slate-200">{action.title}</p>
                      {action.filePath && (
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">{action.filePath}</p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-0.5">{action.reason}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${SAFETY_BADGE[action.safety]}`}>
                      {action.kind === "edit_file" ? "approval" : action.safety}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
