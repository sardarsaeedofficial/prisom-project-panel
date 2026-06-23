"use client";

/**
 * components/admin/admin-section-status-card.tsx
 *
 * Sprint 42: Reusable wrapper for Admin Console async sections.
 * Handles loading, slow, error, stale, success, and empty states.
 *
 * Shows inline messages — no toast-only errors.
 */

import { AlertTriangle, Loader2, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminAsyncSectionState } from "./admin-async-section-state";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 w-full  bg-muted rounded" />
      <div className="h-3 w-3/4  bg-muted rounded" />
      <div className="h-3 w-5/6  bg-muted rounded" />
      <div className="h-3 w-2/3  bg-muted rounded" />
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export type AdminSectionStatusCardProps = {
  title:        string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state:        AdminAsyncSectionState<any>;
  onRetry?:     () => void;
  children?:    React.ReactNode;
  icon?:        React.ElementType;
  badge?:       React.ReactNode;
  /** Override padding / outer class */
  className?:   string;
};

// ── Performance badge ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PerfBadge({ state }: { state: AdminAsyncSectionState<any> }) {
  if (state.status === "success") {
    const parts: string[] = [`Loaded in ${fmtDuration(state.durationMs)}`];
    if (state.cacheStatus === "hit")   parts.push("cached");
    if (state.cacheStatus === "stale") parts.push("stale");
    return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>;
  }
  if (state.status === "error" && state.data != null && state.generatedAt) {
    const age = Date.now() - new Date(state.generatedAt).getTime();
    return (
      <span className="text-xs text-amber-600">
        Showing stale data · {fmtAge(age)}
      </span>
    );
  }
  if (state.status === "error") {
    return <span className="text-xs text-red-500">Timed out after {fmtDuration(state.durationMs)}</span>;
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminSectionStatusCard({
  title,
  description,
  state,
  onRetry,
  children,
  icon:  Icon,
  badge,
  className,
}: AdminSectionStatusCardProps) {
  const isLoading = state.status === "loading" || state.status === "idle";
  const isSlow    = state.status === "loading" && state.slow;
  const isError   = state.status === "error";
  const hasStale  = (state.status === "error" || state.status === "loading") && state.data != null;

  return (
    <section className={cn("rounded-lg border bg-card p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {title}
            {badge}
            {isLoading && (
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
            )}
          </h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
          <PerfBadge state={state} />
        </div>

        {/* Retry / refresh button */}
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={isLoading}
            title={isError ? "Retry" : "Refresh this section"}
            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 transition-colors shrink-0 ml-2"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            {isError ? "Retry" : ""}
          </button>
        )}
      </div>

      {/* Slow warning */}
      {isSlow && !hasStale && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 py-1.5 px-2 rounded bg-muted/40">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Still checking {title.toLowerCase()}… this can take a few seconds.
        </div>
      )}

      {/* Stale data notice (shown while loading or on error) */}
      {hasStale && (
        <div className="flex items-center gap-2 text-xs text-amber-600 mb-2 py-1.5 px-2 rounded border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/10">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {state.status === "loading"
            ? "Refreshing…"
            : "Showing cached data because refresh failed."
          }
          {state.status === "error" && state.generatedAt && (
            <span className="ml-1 opacity-75">
              ({fmtAge(Date.now() - new Date(state.generatedAt).getTime())})
            </span>
          )}
        </div>
      )}

      {/* Error state (no stale data to show) */}
      {isError && !hasStale && (
        <div className="rounded-md border border-red-200/60 bg-red-50/40 dark:bg-red-950/10 px-3 py-2 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-red-700 dark:text-red-400 font-medium text-sm">
              {state.error}
            </p>
            {state.canRetry && onRetry && (
              <button
                onClick={onRetry}
                className="mt-1.5 text-xs text-primary underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading skeleton (first load, no stale data) */}
      {isLoading && !hasStale && (
        <LoadingSkeleton />
      )}

      {/* Data content — shown when loaded, or shown under stale/error notice */}
      {(state.status === "success" || hasStale) && children}
    </section>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────

export function AdminSectionEmpty({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      <CheckCircle2 className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      {message}
    </div>
  );
}
