"use client";

import { useTransition, useState, useRef } from "react";
import { recordInstallationIdAction } from "@/app/actions/github";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type State =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

/**
 * Development / setup form for manually recording a GitHub App installation ID.
 * Saves it to the GITHUB Integration record so the Refresh button can call the
 * GitHub API to list repositories.
 *
 * Find your installation ID at:
 *   GitHub.com → Settings → Applications → Installed GitHub Apps → Configure
 *   The URL contains the installation ID: .../installations/<id>
 */
export function RecordInstallationIdForm() {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = inputRef.current?.value?.trim();
    const id = raw ? parseInt(raw, 10) : NaN;

    if (!raw || isNaN(id) || id <= 0 || !Number.isInteger(id)) {
      setState({ status: "error", message: "Enter a valid positive integer (e.g. 139364146)." });
      return;
    }

    setState({ status: "idle" });
    startTransition(async () => {
      const result = await recordInstallationIdAction(id);
      if (result.success) {
        setState({ status: "ok" });
        if (inputRef.current) inputRef.current.value = "";
      } else {
        setState({ status: "error", message: result.error ?? "Unknown error." });
      }
    });
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
        <Input
          ref={inputRef}
          type="number"
          placeholder="e.g. 139364146"
          className="h-8 text-xs w-44 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          min={1}
          step={1}
          disabled={isPending}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          disabled={isPending}
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isPending ? "Saving…" : "Save Installation ID"}
        </Button>
      </form>

      {state.status === "ok" && (
        <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Saved — click <strong>Refresh Repositories</strong> above to pull your real repos.
        </p>
      )}

      {state.status === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {state.message}
        </p>
      )}
    </div>
  );
}
