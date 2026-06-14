"use client";

import { useTransition, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manualRefreshGitHubStatusAction } from "@/app/actions/github";

type RefreshResult = {
  ok: boolean;
  message: string;
  count?: number;
};

export function ManualRefreshButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const handleClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await manualRefreshGitHubStatusAction();
      setResult(r);
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
        type="button"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 mr-1.5 ${isPending ? "animate-spin" : ""}`}
        />
        {isPending ? "Refreshing…" : "Refresh"}
      </Button>

      {result && (
        <span
          className={`text-xs flex items-center gap-1.5 ${
            result.ok
              ? "text-green-600 dark:text-green-400"
              : "text-destructive"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          )}
          {result.message}
        </span>
      )}
    </div>
  );
}
