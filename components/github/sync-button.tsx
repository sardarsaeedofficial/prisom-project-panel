"use client";

import { useTransition, useState } from "react";
import { syncGitHubProjectAction } from "@/app/actions/github";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { SyncResult } from "@/lib/data/github";

export function SyncButton({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  const handleSync = () => {
    setResult(null);
    startTransition(async () => {
      const r = await syncGitHubProjectAction(projectId);
      setResult(r);
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button onClick={handleSync} disabled={isPending} variant="outline" size="sm">
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        )}
        {isPending ? "Syncing…" : "Sync from GitHub"}
      </Button>

      {result?.success && (
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Synced {result.commits} commit{result.commits !== 1 ? "s" : ""},{" "}
          {result.files} file{result.files !== 1 ? "s" : ""}
          {result.framework ? ` · ${result.framework} detected` : ""}
        </span>
      )}

      {result?.error && (
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {result.error}
        </span>
      )}
    </div>
  );
}
