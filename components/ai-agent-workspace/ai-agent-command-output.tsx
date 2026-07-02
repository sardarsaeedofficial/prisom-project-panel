"use client";

/**
 * components/ai-agent-workspace/ai-agent-command-output.tsx
 * Terminal-style collapsible output block used inside action rows.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface AiAgentCommandOutputProps {
  output: string;
  command?: string;
  maxLines?: number;
}

export function AiAgentCommandOutput({ output, command, maxLines = 20 }: AiAgentCommandOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = output.trim().split("\n");
  const visible = expanded ? lines : lines.slice(-maxLines);
  const truncated = !expanded && lines.length > maxLines;

  return (
    <div className="mt-1.5 rounded border border-white/10 bg-black/40 text-[11px] font-mono overflow-hidden">
      {command && (
        <div className="px-3 py-1.5 border-b border-white/10 text-slate-400 flex items-center gap-1.5">
          <span className="text-purple-400 select-none">$</span>
          <span className="text-slate-200 break-all">{command}</span>
        </div>
      )}
      <div className="px-3 py-2 max-h-48 overflow-y-auto">
        {truncated && (
          <p className="text-slate-500 mb-1">…{lines.length - maxLines} earlier lines hidden</p>
        )}
        {visible.map((line, i) => (
          <div key={i} className={`leading-5 break-all ${
            line.startsWith("error") || line.startsWith("Error") || line.toLowerCase().includes("failed")
              ? "text-red-400"
              : line.startsWith(">") || line.startsWith("✓") || line.toLowerCase().includes("success")
              ? "text-green-400"
              : line.startsWith("warn") || line.toLowerCase().includes("warning")
              ? "text-amber-400"
              : "text-slate-300"
          }`}>
            {line || " "}
          </div>
        ))}
      </div>
      {lines.length > maxLines && (
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="w-full px-3 py-1 border-t border-white/10 text-slate-500 hover:text-slate-300 flex items-center justify-center gap-1 text-[10px] transition-colors"
        >
          {expanded
            ? <><ChevronUp className="h-3 w-3" /> Show less</>
            : <><ChevronDown className="h-3 w-3" /> Show all {lines.length} lines</>
          }
        </button>
      )}
    </div>
  );
}
