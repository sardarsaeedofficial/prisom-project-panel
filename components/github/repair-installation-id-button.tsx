"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { backfillGitHubInstallationIdsAction } from "@/app/actions/github";
import { Button } from "@/components/ui/button";
import { Wrench, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Props = {
  /**
   * When provided, repairs only the repo linked to this project.
   * When omitted, repairs all repos with missing installation IDs in the workspace.
   */
  projectId?: string;
  /** Visual variant — "inline" shows next to an existing warning, "button" stands alone */
  variant?: "inline" | "button";
};

type State =
  | { status: "idle" }
  | { status: "ok"; updated: number; skipped: number }
  | { status: "error"; message: string };

export function RepairInstallationIdButton({ projectId, variant = "button" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ status: "idle" });
  const router = useRouter();

  const handleRepair = () => {
    setState({ status: "idle" });
    startTransition(async () => {
      const result = await backfillGitHubInstallationIdsAction(projectId);
      if (result.error) {
        setState({ status: "error", message: result.error });
      } else {
        setState({ status: "ok", updated: result.updated, skipped: result.skipped });
        if (result.updated > 0) {
          router.refresh();
        }
      }
    });
  };

  const label = projectId ? "Repair installation ID" : "Repair missing installation IDs";

  return (
    <div className={variant === "inline" ? "flex items-center gap-2 flex-wrap" : "space-y-1.5"}>
      <Button
        onClick={handleRepair}
        disabled={isPending}
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wrench className="h-3.5 w-3.5" />
        )}
        {isPending ? "Repairing…" : label}
      </Button>

      {state.status === "ok" && (
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {state.updated === 0
            ? "No IDs could be recovered — push a commit or reinstall the GitHub App."
            : `Repaired ${state.updated} repo${state.updated !== 1 ? "s" : ""}.${
                state.skipped > 0 ? ` (${state.skipped} still missing)` : ""
              }`}
        </span>
      )}

      {state.status === "error" && (
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {state.message}
        </span>
      )}
    </div>
  );
}
