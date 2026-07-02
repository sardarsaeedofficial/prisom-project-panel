"use client";

/**
 * components/ai-agent-workspace/ai-agent-preview-pane.tsx
 * Live iframe preview with URL bar and refresh.
 */

import { useState } from "react";
import { RefreshCw, ExternalLink, Globe, Monitor } from "lucide-react";

interface AiAgentPreviewPaneProps {
  previewUrl?: string;
  publicUrl?: string;
  isLive: boolean;
}

export function AiAgentPreviewPane({ previewUrl, publicUrl, isLive }: AiAgentPreviewPaneProps) {
  const activeUrl = previewUrl || publicUrl;
  const [key, setKey]         = useState(0);
  const [loading, setLoading] = useState(false);

  function isBrowserSafe(url: string): boolean {
    if (url.startsWith("/")) return true;
    try {
      const { hostname } = new URL(url);
      return hostname !== "127.0.0.1" && hostname !== "localhost";
    } catch { return false; }
  }

  const canEmbed = !!activeUrl && isBrowserSafe(activeUrl);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0 bg-slate-900">
        <Monitor className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0 bg-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-400 truncate">
          {activeUrl ?? "—"}
        </div>
        {canEmbed && (
          <>
            <button
              type="button"
              title="Refresh preview"
              onClick={() => { setLoading(true); setKey((k) => k + 1); }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <a
              href={activeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              className="text-slate-500 hover:text-purple-400 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {canEmbed ? (
          <iframe
            key={key}
            src={activeUrl}
            title="Project preview"
            className="absolute inset-0 w-full h-full border-0 bg-white"
            onLoad={() => setLoading(false)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-3">
            <Globe className="h-8 w-8 text-slate-600" />
            {isLive ? (
              <>
                <p className="text-[13px] text-slate-400">Preview available in new tab</p>
                {activeUrl && (
                  <a
                    href={activeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-purple-400 hover:underline"
                  >
                    {activeUrl}
                  </a>
                )}
              </>
            ) : (
              <>
                <p className="text-[13px] text-slate-500">Preview will appear here</p>
                <p className="text-[11px] text-slate-600">once the deploy completes</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
