"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  value: string;
  label?: string;
  /** When true, renders a full-width row with the value and a copy icon */
  block?: boolean;
}

export function CopyButton({
  value,
  label = "Copy",
  block = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — silent fallback
    }
  };

  if (block) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
        <code className="text-xs font-mono flex-1 break-all select-all">{value}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={label}
          type="button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={handleCopy}
      title={label}
      type="button"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
