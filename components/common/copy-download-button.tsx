"use client";

/**
 * components/common/copy-download-button.tsx
 *
 * Sprint 56: Copy-to-clipboard / download button with fallback UX.
 *
 * Features:
 *  - primary: download as file via Blob URL
 *  - fallback: copy to clipboard (navigator.clipboard)
 *  - fallback-of-fallback: expand a textarea showing the content
 *  - success/error feedback
 *  - exact filename shown in success message
 */

import { useState, useCallback } from "react";
import { Download, Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";

type Props = Omit<ButtonProps, "onClick" | "children"> & {
  content:    string;
  filename:   string;
  label?:     string;
  mimeType?:  string;
};

export function CopyDownloadButton({
  content,
  filename,
  label,
  mimeType = "text/markdown",
  disabled,
  ...props
}: Props) {
  const [status,       setStatus]       = useState<"idle" | "success" | "error" | "copied">("idle");
  const [showFallback, setShowFallback] = useState(false);
  const [statusMsg,    setStatusMsg]    = useState<string | null>(null);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("success");
      setStatusMsg(`Downloaded ${filename}`);
    } catch {
      // Download failed — try clipboard
      handleCopy();
    }
  }, [content, filename, mimeType]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("copied");
      setStatusMsg("Copied to clipboard");
    } catch {
      // Clipboard also failed — show fallback textarea
      setStatus("error");
      setStatusMsg("Download failed — expand below to copy manually");
      setShowFallback(true);
    }
  }, [content]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          onClick={handleDownload}
          disabled={disabled}
          {...props}
        >
          <Download className="h-4 w-4" />
          {label ?? `Download ${filename}`}
        </Button>

        {status === "success" && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />{statusMsg}
          </span>
        )}
        {status === "copied" && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />{statusMsg}
          </span>
        )}
        {status === "error" && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" />{statusMsg}
          </span>
        )}

        {/* Clipboard copy fallback */}
        {status !== "copied" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="text-xs h-8"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        )}
      </div>

      {/* Textarea fallback for when both download and clipboard fail */}
      {showFallback && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowFallback((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showFallback ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showFallback ? "Hide" : "Show"} content
          </button>
          <textarea
            readOnly
            value={content}
            rows={10}
            className="w-full rounded border bg-muted px-3 py-2 text-xs font-mono resize-y"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <p className="text-xs text-muted-foreground">Click inside to select all, then Ctrl+C / Cmd+C.</p>
        </div>
      )}
    </div>
  );
}
