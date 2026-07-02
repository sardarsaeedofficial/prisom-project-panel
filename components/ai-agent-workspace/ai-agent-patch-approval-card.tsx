"use client";

/**
 * components/ai-agent-workspace/ai-agent-patch-approval-card.tsx
 * Code-review style patch approval panel.
 */

import { useState } from "react";
import { FileCode, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import type { PendingPatch } from "@/lib/ai-import-agent/agent-run-types";

interface AiAgentPatchApprovalCardProps {
  patch: PendingPatch;
  modelLabel: string;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
}

export function AiAgentPatchApprovalCard({
  patch, modelLabel, onApprove, onReject, approving, rejecting,
}: AiAgentPatchApprovalCardProps) {
  const [showDiff, setShowDiff]   = useState(true);
  const [showFull, setShowFull]   = useState(false);

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-500/40 bg-amber-950/20 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <FileCode className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-100">
            {modelLabel} wants to edit a file
          </p>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">{patch.filePath}</p>
        </div>
      </div>

      <div className="px-4 pb-3 space-y-3 border-t border-white/10 pt-3">
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Why</p>
          <p className="text-[12px] text-slate-300">{patch.reason}</p>
        </div>

        {/* Diff toggle */}
        {patch.unifiedDiff && (
          <div>
            <button
              type="button"
              onClick={() => setShowDiff((s) => !s)}
              className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300"
            >
              {showDiff ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showDiff ? "Hide diff" : "View diff"}
            </button>
            {showDiff && (
              <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words rounded border border-white/10 bg-black/50 p-3 max-h-56 overflow-y-auto leading-5">
                {patch.unifiedDiff.split("\n").map((line, i) => (
                  <span key={i} className={`block ${
                    line.startsWith("+") ? "text-green-400" :
                    line.startsWith("-") ? "text-red-400" :
                    line.startsWith("@@") ? "text-purple-400" :
                    "text-slate-400"
                  }`}>{line || " "}</span>
                ))}
              </pre>
            )}
          </div>
        )}

        {/* Full file toggle */}
        {patch.proposedContent && (
          <div>
            <button
              type="button"
              onClick={() => setShowFull((s) => !s)}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
            >
              {showFull ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showFull ? "Hide full file" : "Show full file"}
            </button>
            {showFull && (
              <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words rounded border border-white/10 bg-black/50 p-3 max-h-56 overflow-y-auto leading-5 text-slate-300">
                {patch.proposedContent}
              </pre>
            )}
          </div>
        )}

        {/* Approval controls */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={approving || rejecting}
            onClick={onApprove}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
          >
            {approving
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</>
              : <><ThumbsUp className="h-3.5 w-3.5" /> Approve patch</>
            }
          </button>
          <button
            type="button"
            disabled={approving || rejecting}
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 hover:bg-white/5 disabled:opacity-50 text-slate-300 text-[12px] font-medium transition-colors"
          >
            {rejecting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Skipping…</>
              : <><ThumbsDown className="h-3.5 w-3.5" /> Reject</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
