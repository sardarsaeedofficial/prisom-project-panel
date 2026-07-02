"use client";

/**
 * components/ai-agent-workspace/ai-agent-composer.tsx
 * Bottom composer bar — currently a placeholder for future user→agent messaging.
 * Shown only while the agent is active; hidden in terminal states.
 */

import { Send, Loader2 } from "lucide-react";

interface AiAgentComposerProps {
  disabled: boolean;
  placeholder?: string;
}

export function AiAgentComposer({
  disabled,
  placeholder = "Message the agent… (coming soon)",
}: AiAgentComposerProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 bg-slate-900 shrink-0">
      <input
        type="text"
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 bg-slate-800 text-[13px] text-slate-300 placeholder-slate-600 rounded px-3 py-1.5 border border-white/10 focus:outline-none focus:border-purple-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        disabled={disabled}
        className="p-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        title="Send (coming soon)"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
