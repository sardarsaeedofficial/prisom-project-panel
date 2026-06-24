"use client";

/**
 * components/common/action-result-banner.tsx
 *
 * Sprint 56: Shared status banner for loading/success/error/idle states.
 * Renders nothing when idle unless a lastMessage is passed.
 */

import { CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import type { ActionState } from "./use-action-state";

type Props<T> = {
  state:        ActionState<T>;
  /** Override the success message */
  successLabel?: string;
  /** Extra detail line shown below the message */
  details?:     string;
  className?:   string;
};

export function ActionResultBanner<T>({
  state,
  successLabel,
  details,
  className = "",
}: Props<T>) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>{state.actionName ?? "Working…"}</span>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className={`flex items-start gap-2 text-sm text-green-700 dark:text-green-400 ${className}`}>
        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <span>{successLabel ?? state.message ?? state.actionName ?? "Done"}</span>
          {details && <p className="text-xs text-muted-foreground mt-0.5">{details}</p>}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={`flex items-start gap-2 text-sm text-destructive ${className}`}>
        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <span>{state.error ?? "An error occurred."}</span>
          {details && <p className="text-xs text-muted-foreground mt-0.5">{details}</p>}
        </div>
      </div>
    );
  }

  return null;
}

/** Inline version: just a short text in muted color, used after a last action */
export function LastActionLabel({ label, className = "" }: { label: string | null | undefined; className?: string }) {
  if (!label) return null;
  return (
    <span className={`text-xs text-muted-foreground ${className}`}>
      ✓ {label}
    </span>
  );
}

/** Compact error pill — use inline next to buttons */
export function InlineError({ error, className = "" }: { error: string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-destructive ${className}`}>
      <AlertTriangle className="h-3 w-3 shrink-0" />
      {error}
    </span>
  );
}
