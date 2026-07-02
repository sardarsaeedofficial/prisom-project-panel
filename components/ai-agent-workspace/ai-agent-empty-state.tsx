"use client";

/**
 * components/ai-agent-workspace/ai-agent-empty-state.tsx
 * Shown in the chat pane before any run has started.
 */

import { Zap, Loader2 } from "lucide-react";

interface AiAgentEmptyStateProps {
  onStart: () => void;
  starting: boolean;
  modelLabel: string;
  aiAvailable: boolean;
}

const CAPABILITIES = [
  "Reads your package.json, env vars, and build config",
  "Runs install, build, and PM2 start automatically",
  "Checks preview routes and API health",
  "Calls Claude Sonnet for complex fixes",
  "Asks for your approval before editing files",
];

export function AiAgentEmptyState({
  onStart, starting, modelLabel, aiAvailable,
}: AiAgentEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center space-y-5">
      <div className="h-12 w-12 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
        <Zap className="h-6 w-6 text-purple-400" />
      </div>
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-slate-100">AI Import Agent</h3>
        <p className="text-[12px] text-slate-500 max-w-xs">
          One click. I analyze, deploy, fix, and verify your project.
        </p>
      </div>

      <ul className="space-y-1.5 text-left">
        {CAPABILITIES.map((c) => (
          <li key={c} className="flex items-start gap-2 text-[12px] text-slate-400">
            <span className="text-purple-400 mt-0.5 shrink-0">•</span>
            {c}
          </li>
        ))}
      </ul>

      {aiAvailable && (
        <p className="text-[11px] text-green-400">
          {modelLabel} connected — AI-powered fixes enabled
        </p>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[13px] font-semibold transition-colors"
      >
        {starting
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
          : <><Zap className="h-4 w-4" /> Make Project Live</>
        }
      </button>
    </div>
  );
}
