"use client";

/**
 * components/projects/project-operations-panel.tsx
 *
 * Sprint 27: Operation history panel with filters and pagination.
 * Sprint 27 Hotfix: Fixed initial-load race (moved to useEffect), hardened
 * optional-field access, added missing-DB-table detection.
 */

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Ban,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  ScrollText,
  DatabaseZap,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { listOperationHistoryAction, clearStaleOperationsAction } from "@/app/actions/project-operations";
import type {
  ProjectOperationDTO,
  OperationStatus,
  OperationType,
}                   from "@/lib/operations/project-operation-types";
import {
  OPERATION_TYPE_LABELS,
  OPERATION_STATUS_LABELS,
  OPERATION_TYPES,
}                   from "@/lib/operations/project-operation-types";
import { cn }       from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(start: string, end: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs   = end ? new Date(end).getTime() : Date.now();
  const ms      = endMs - startMs;
  const s       = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m       = Math.floor(s / 60);
  if (m < 60)  return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/** True if the error message indicates the ProjectOperation table is missing. */
function isMissingTableError(error: string): boolean {
  return (
    error.includes("does not exist") ||
    error.includes("ProjectOperation") ||
    error.includes("project_operation") ||
    error.includes("P2021")
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_ICON: Record<OperationStatus, React.ElementType> = {
  running:   Clock,
  success:   CheckCircle2,
  failed:    XCircle,
  cancelled: Ban,
  stale:     AlertCircle,
};

const STATUS_CLASS: Record<OperationStatus, string> = {
  running:   "text-amber-600 bg-amber-50  border-amber-200",
  success:   "text-green-600  bg-green-50   border-green-200",
  failed:    "text-red-600    bg-red-50     border-red-200",
  cancelled: "text-gray-500   bg-gray-50    border-gray-200",
  stale:     "text-orange-600 bg-orange-50  border-orange-200",
};

function StatusBadge({ status }: { status: OperationStatus }) {
  const Icon  = STATUS_ICON[status]  ?? Clock;
  const cls   = STATUS_CLASS[status] ?? "";
  const label = OPERATION_STATUS_LABELS[status] ?? status;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── Operation row ─────────────────────────────────────────────────────────────

function OperationRow({
  op,
  projectId,
}: {
  op:        ProjectOperationDTO;
  projectId: string;
}) {
  // Safe access for all optional fields
  const typeLabel         = OPERATION_TYPE_LABELS[op.operationType] ?? op.operationType ?? "Unknown";
  const initiatedByName   = op.initiatedByName ?? null;
  const lastError         = op.lastError ?? null;
  const completedAt       = op.completedAt ?? null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      {/* Status */}
      <div className="shrink-0 pt-0.5">
        <StatusBadge status={op.status} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{op.title ?? "Unnamed operation"}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{typeLabel}</span>
          {initiatedByName && <span>by {initiatedByName}</span>}
          <span>started {formatDate(op.startedAt)}</span>
          <span>duration {formatDuration(op.startedAt, completedAt)}</span>
        </div>
        {lastError && (
          <p className="mt-1 text-xs text-red-600 line-clamp-2">{lastError}</p>
        )}
      </div>

      {/* View logs link */}
      <a
        href={`/projects/${projectId}/logs?source=operation:${op.id}`}
        className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start pt-0.5"
        title="View operation logs in the Logs Center"
      >
        <ScrollText className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Logs</span>
      </a>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type PanelState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; ops: ProjectOperationDTO[]; total: number; page: number; pageSize: number; totalPages: number }
  | { phase: "error"; error: string };

export function ProjectOperationsPanel({ projectId }: { projectId: string }) {
  const [statusFilter, setStatusFilter] = useState<OperationStatus | "all">("all");
  const [typeFilter,   setTypeFilter]   = useState<OperationType   | "all">("all");
  const [page, setPage]                 = useState(1);
  const [panelState, setPanelState]     = useState<PanelState>({ phase: "idle" });
  const [isPending, startTransition]    = useTransition();

  const load = useCallback(
    (p: number, sf: OperationStatus | "all", tf: OperationType | "all") => {
      setPanelState({ phase: "loading" });
      startTransition(async () => {
        try {
          const r = await listOperationHistoryAction({
            projectId,
            page:         p,
            pageSize:     20,
            statusFilter: sf,
            typeFilter:   tf,
          });
          if (!r.ok) {
            setPanelState({ phase: "error", error: r.error });
            return;
          }
          setPanelState({
            phase:      "loaded",
            ops:        r.data.operations,
            total:      r.data.total,
            page:       r.data.page,
            pageSize:   r.data.pageSize,
            totalPages: r.data.totalPages,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setPanelState({ phase: "error", error: msg });
        }
      });
    },
    [projectId],
  );

  // Initial load on mount (NOT during render — avoids startTransition-in-render issues)
  useEffect(() => {
    load(1, "all", "all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(sf: OperationStatus | "all", tf: OperationType | "all") {
    setPage(1);
    load(1, sf, tf);
  }

  function goToPage(p: number) {
    setPage(p);
    load(p, statusFilter, typeFilter);
  }

  const [clearing, startClearTransition] = useTransition();
  function handleClearStale() {
    startClearTransition(async () => {
      try {
        await clearStaleOperationsAction(projectId);
        load(page, statusFilter, typeFilter);
      } catch {
        // non-fatal
      }
    });
  }

  const isLoading = panelState.phase === "loading" || isPending;

  // ── Detected missing-table error ───────────────────────────────────────────
  if (
    panelState.phase === "error" &&
    isMissingTableError(panelState.error)
  ) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 flex gap-3">
        <DatabaseZap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-900">
            Operations table not ready
          </p>
          <p className="text-xs text-amber-700">
            The ProjectOperation database table does not exist yet on this server.
            Run&nbsp;
            <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">
              pnpm prisma db push
            </code>
            &nbsp;on the VPS, then restart the process.
          </p>
          <button
            onClick={() => load(1, statusFilter, typeFilter)}
            className="mt-1 text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            const sf = e.target.value as OperationStatus | "all";
            setStatusFilter(sf);
            applyFilters(sf, typeFilter);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="success">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="stale">Stale</option>
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => {
            const tf = e.target.value as OperationType | "all";
            setTypeFilter(tf);
            applyFilters(statusFilter, tf);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All types</option>
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {OPERATION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearStale}
            disabled={clearing || isLoading}
            className="h-8 text-xs"
          >
            {clearing ? <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> : null}
            Clear stale
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(page, statusFilter, typeFilter)}
            disabled={isLoading}
            className="h-8 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* General error state */}
      {panelState.phase === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
          <span className="flex-1">{panelState.error}</span>
          <button
            onClick={() => load(page, statusFilter, typeFilter)}
            className="text-xs text-red-600 underline underline-offset-2 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {(panelState.phase === "loading" || panelState.phase === "idle") && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin mb-2 text-muted-foreground/50" />
          Loading operations…
        </div>
      )}

      {/* Loaded state */}
      {panelState.phase === "loaded" && (
        <>
          {panelState.ops.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No operations found for the selected filters.
            </div>
          ) : (
            <div className="space-y-2">
              {panelState.ops.map((op) => (
                <OperationRow key={op.id} op={op} projectId={projectId} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {panelState.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {panelState.total} total · page {panelState.page} of {panelState.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={panelState.page <= 1 || isLoading}
                  onClick={() => goToPage(panelState.page - 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={panelState.page >= panelState.totalPages || isLoading}
                  onClick={() => goToPage(panelState.page + 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
