"use client";

/**
 * components/ai-agent-workspace/ai-agent-action-row.tsx
 *
 * Single expandable action row — visual equivalent of Replit's
 * "Ran cd /path/to/project   ✓  3 actions" chips.
 */

import { useState } from "react";
import {
  ChevronRight, ChevronDown,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Clock,
  Wrench, Cpu,
} from "lucide-react";
import { AiAgentCommandOutput } from "./ai-agent-command-output";

export type ActionRowStatus = "pending" | "running" | "success" | "warning" | "error" | "fixed";

export interface AgentActionRow {
  id: string;
  title: string;
  subtitle?: string;
  status: ActionRowStatus;
  actionCount?: number;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  command?: string;
  expandable?: boolean;
}

function StatusIcon({ status }: { status: ActionRowStatus }) {
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (status === "fixed")   return <Wrench       className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (status === "error")   return <XCircle       className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (status === "running") return <Loader2       className="h-3.5 w-3.5 text-purple-400 animate-spin shrink-0" />;
  return                           <Clock         className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
}

export function AiAgentActionRow({ row }: { row: AgentActionRow }) {
  const [open, setOpen] = useState(false);
  const hasOutput = !!(row.output || row.command);
  const canExpand  = row.expandable !== false && hasOutput;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => canExpand && setOpen((s) => !s)}
        disabled={!canExpand}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-white/5 transition-colors text-left disabled:hover:bg-transparent"
      >
        {/* expand chevron */}
        <span className="text-slate-600 w-3 shrink-0">
          {canExpand
            ? open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            : null
          }
        </span>

        <StatusIcon status={row.status} />

        <span className="flex-1 text-[13px] text-slate-200 truncate">{row.title}</span>

        {row.subtitle && (
          <span className="text-[11px] text-slate-500 shrink-0 hidden sm:block">{row.subtitle}</span>
        )}

        {row.actionCount !== undefined && row.actionCount > 0 && (
          <span className="text-[11px] text-slate-400 shrink-0 flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {row.actionCount} action{row.actionCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && hasOutput && (
        <div className="px-3 pb-2">
          <AiAgentCommandOutput
            output={row.output ?? ""}
            command={row.command}
          />
        </div>
      )}
    </div>
  );
}
