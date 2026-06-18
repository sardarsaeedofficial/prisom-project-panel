"use client";

/**
 * components/projects/deployment-history-panel.tsx
 *
 * Sprint 13 (patched): Deployment history timeline with rollback support.
 *
 * Features:
 *  - Auto-loads on mount
 *  - Status filters: All / Success / Failed / Rollback / Active
 *  - Client-side pagination (10 / 20 / 50 rows, newest first)
 *  - Active deployment clearly marked with "Current release" label
 *  - No-active-deployment warning with optional backfill helper button
 *  - Rollback unavailability reason shown in detail drawer
 *  - Rollback confirmation modal with explicit safety warnings
 *  - Post-rollback readiness result
 *
 * Safety: all writes go through server actions; rollback requires confirm=true;
 *         protected PM2 processes are blocked server-side.
 */

import {
  useState,
  useCallback,
  useTransition,
  useEffect,
  useMemo,
} from "react";
import {
  History,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  RotateCcw,
  Clock,
  GitCommit,
  Terminal,
  X,
  Info,
  AlertCircle,
  Zap,
  ChevronLeft,
} from "lucide-react";

import {
  getProjectDeploymentHistoryAction,
  getProjectDeploymentDetailAction,
  rollbackProjectDeploymentAction,
  backfillActiveDeploymentAction,
  type DeploymentHistoryResponse,
  type DeploymentHistoryItem,
  type DeploymentHistoryDetail,
  type RollbackResult,
  type BackfillResult,
} from "@/app/actions/project-deployment-history";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:   string;
  projectSlug: string;
  pm2Name?:    string | null;
}

type FilterStatus = "all" | "success" | "failed" | "rollback" | "active";

const FILTERS: { value: FilterStatus; label: string }[] = [
  { value: "all",      label: "All"      },
  { value: "success",  label: "Success"  },
  { value: "failed",   label: "Failed"   },
  { value: "rollback", label: "Rollback" },
  { value: "active",   label: "Active"   },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelTime(date: Date | string): string {
  const d    = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function rollbackBlockReason(
  item:     DeploymentHistoryItem,
  isActive: boolean,
  hasPm2:   boolean,
): string | null {
  if (!hasPm2)           return "No PM2 config — deploy the project first.";
  if (isActive)          return "Already the current active deployment.";
  if (item.status === "FAILED")    return "Cannot roll back to a failed deployment.";
  if (item.status === "CANCELLED") return "Cannot roll back to a cancelled deployment.";
  if (!item.releaseExists)         return "Release folder is missing from disk.";
  if (!item.deploymentRef)         return "No deployment ref recorded — cannot locate release.";
  return null;
}

// ── Status badge ──────────────────────────────────────────────────────────────

type StatusColor = { bg: string; text: string; label: string };

function getStatusColor(
  status:        string,
  source:        string,
  isActive:      boolean,
  releaseExists: boolean,
): StatusColor {
  if (isActive)
    return { bg: "bg-green-500/15 border-green-500/30",   text: "text-green-600",       label: "ACTIVE"          };
  if (!releaseExists && status === "SUCCESS")
    return { bg: "bg-amber-500/15 border-amber-500/30",   text: "text-amber-600",       label: "MISSING RELEASE" };
  if (source === "ROLLBACK")
    return { bg: "bg-blue-500/15 border-blue-500/30",     text: "text-blue-600",        label: "ROLLBACK"        };
  if (status === "SUCCESS")
    return { bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-600",   label: "SUCCESS"         };
  if (status === "FAILED")
    return { bg: "bg-red-500/15 border-red-500/30",       text: "text-red-600",         label: "FAILED"          };
  if (status === "BUILDING" || status === "QUEUED")
    return { bg: "bg-yellow-500/15 border-yellow-500/30", text: "text-yellow-600",      label: status            };
  return   { bg: "bg-muted/50 border-border",             text: "text-muted-foreground", label: status           };
}

function StatusBadge({ item }: { item: DeploymentHistoryItem }) {
  const c = getStatusColor(item.status, item.source, item.isActive, item.releaseExists);
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

// ── Pagination bar ────────────────────────────────────────────────────────────

function PaginationBar({
  page, totalPages, pageSize, totalItems,
  onPageChange, onPageSizeChange,
}: {
  page:              number;
  totalPages:        number;
  pageSize:          number;
  totalItems:        number;
  onPageChange:      (p: number) => void;
  onPageSizeChange:  (s: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between gap-3 pt-2 border-t text-xs text-muted-foreground flex-wrap">
      <span>
        {totalItems === 0
          ? "No deployments"
          : `Showing ${start}–${end} of ${totalItems} deployment${totalItems === 1 ? "" : "s"}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="h-3 w-3" /> Previous
        </button>
        <span className="tabular-nums">Page {page} of {totalPages}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
        >
          Next <ChevronRight className="h-3 w-3" />
        </button>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border border-border rounded px-1 py-0.5 text-xs bg-background focus:outline-none"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} rows
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DeploymentDetailDrawer({
  detail,
  isActive,
  pm2Name,
  onClose,
  onRollback,
}: {
  detail:     DeploymentHistoryDetail;
  isActive:   boolean;
  pm2Name?:   string | null;
  onClose:    () => void;
  onRollback: (id: string) => void;
}) {
  const dep        = detail.deployment;
  const blockReason = rollbackBlockReason(dep, isActive, !!pm2Name);
  const canRollback = blockReason === null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="relative bg-background border rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Deployment Detail</span>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge item={dep} />
            {isActive && (
              <span className="text-[10px] text-green-600 font-semibold bg-green-500/10 border border-green-400/20 rounded-full px-2 py-0.5">
                Current release
              </span>
            )}
            {dep.source === "ROLLBACK" && (
              <span className="text-xs text-muted-foreground">Rollback event</span>
            )}
            {!detail.releaseExists && dep.status === "SUCCESS" && !isActive && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                <AlertTriangle className="h-3 w-3" /> Release folder missing
              </span>
            )}
          </div>

          {/* Metadata grid */}
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-xs">
            <MetaRow label="Deployment ref" value={dep.deploymentRef ?? "—"} mono />
            <MetaRow label="Source type"    value={dep.sourceType ?? dep.source} />
            <MetaRow label="Source ref"     value={dep.sourceRef ?? "—"} mono />
            <MetaRow label="PM2 process"    value={pm2Name ?? dep.pm2Name ?? "—"} mono />
            <MetaRow label="Port"           value={dep.port ? String(dep.port) : "—"} />
            <MetaRow label="Health path"    value={dep.healthPath ?? "—"} />
            <MetaRow label="Status"         value={dep.status} />
            <MetaRow label="Started"        value={dep.startedAt ? dep.startedAt.toLocaleString() : "—"} />
            <MetaRow label="Finished"       value={dep.finishedAt ? dep.finishedAt.toLocaleString() : "—"} />
            <MetaRow label="Duration"       value={formatDuration(dep.durationMs) ?? "—"} />
            {dep.releasePathDisplay && (
              <MetaRow label="Release folder" value={dep.releasePathDisplay} mono />
            )}
            {dep.errorMessage && (
              <MetaRow label="Error" value={dep.errorMessage} error />
            )}
          </dl>

          {/* Logs */}
          {detail.logs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Logs
              </p>
              <div className="bg-muted/30 rounded border overflow-y-auto max-h-48 p-2 space-y-0.5 font-mono text-[11px]">
                {detail.logs.map((l) => (
                  <div
                    key={l.id}
                    className={`flex gap-2 ${
                      l.level === "ERROR" || l.level === "FATAL" ? "text-red-500" :
                      l.level === "WARN"  ? "text-amber-600" :
                      "text-foreground/80"
                    }`}
                  >
                    <span className="text-muted-foreground/50 shrink-0 tabular-nums">
                      {new Date(l.createdAt).toLocaleTimeString()}
                    </span>
                    <span className="break-all">{l.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {!canRollback && (
              <span className="text-xs text-muted-foreground italic">
                Rollback unavailable: {blockReason}
              </span>
            )}
            {canRollback && (
              <button
                onClick={() => onRollback(dep.id)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Roll back to this release
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label, value, mono, error,
}: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground font-medium">{label}</dt>
      <dd className={`break-all ${mono ? "font-mono" : ""} ${error ? "text-destructive" : ""}`}>
        {value}
      </dd>
    </>
  );
}

// ── Rollback confirmation modal ───────────────────────────────────────────────

function RollbackConfirmModal({
  target,
  pm2Name,
  isLoading,
  onCancel,
  onConfirm,
}: {
  target:    DeploymentHistoryItem;
  pm2Name:   string;
  isLoading: boolean;
  onCancel:  () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="font-semibold text-sm">Confirm Rollback</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm">
            Roll back to deployment{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">
              {target.deploymentRef ?? target.id.slice(0, 12)}
            </code>?
          </p>

          <div className="bg-muted/40 border rounded p-3 text-xs space-y-1 text-foreground/80">
            <p>This will restart only <strong className="font-mono">{pm2Name}</strong> using release:</p>
            <p className="font-mono text-muted-foreground">{target.releasePathDisplay ?? "unknown"}</p>
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {[
              "Rollback does not change your Git branch.",
              "Rollback does not undo database migrations.",
              "Rollback does not remove package changes.",
              "Rollback restarts only this project's PM2 process.",
              "Current deployment will remain in history and can be re-activated.",
            ].map((w) => (
              <div key={w} className="flex items-start gap-1.5">
                <Info className="h-3 w-3 shrink-0 mt-0.5 text-blue-500" />
                <span>{w}</span>
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Type <strong>Rollback</strong> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Rollback"
              className="w-full border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-3 py-1.5 rounded border border-border text-sm hover:bg-muted transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={typed !== "Rollback" || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-40 transition-colors"
          >
            {isLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RotateCcw className="h-3.5 w-3.5" />}
            Rollback
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rollback result banner ────────────────────────────────────────────────────

function RollbackResultBanner({ result }: { result: RollbackResult }) {
  const allOk = result.readiness?.ok !== false;
  return (
    <div className={`flex items-start gap-2 p-3 rounded border text-xs ${
      allOk
        ? "bg-green-500/10 border-green-500/20 text-green-700"
        : "bg-amber-500/10 border-amber-500/20 text-amber-700"
    }`}>
      {allOk
        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
      <div className="flex-1 space-y-1">
        <p className="font-semibold">
          {allOk
            ? "Rollback completed and readiness passed."
            : "Rollback completed, but some readiness checks failed."}
        </p>
        <p>PM2 process: <code className="font-mono">{result.pm2ProcessName}</code></p>
        {result.readiness && (
          <ul className="mt-1 space-y-0.5">
            {result.readiness.checks.map((c) => (
              <li key={c.name} className="flex items-center gap-1">
                {c.ok
                  ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                  : <XCircle      className="h-3 w-3 text-red-500" />}
                <span>{c.name}: {c.message ?? (c.ok ? "OK" : "Failed")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DeploymentHistoryPanel({ projectId, projectSlug, pm2Name }: Props) {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [history,        setHistory]        = useState<DeploymentHistoryResponse | null>(null);
  const [historyError,   setHistoryError]   = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [detail,        setDetail]        = useState<DeploymentHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError,   setDetailError]   = useState<string | null>(null);

  const [rollbackTarget,  setRollbackTarget]  = useState<DeploymentHistoryItem | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError,   setRollbackError]   = useState<string | null>(null);
  const [rollbackResult,  setRollbackResult]  = useState<RollbackResult | null>(null);

  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillError,   setBackfillError]   = useState<string | null>(null);
  const [backfillResult,  setBackfillResult]  = useState<BackfillResult | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [page,         setPage]         = useState(1);
  const [pageSize,     setPageSize]     = useState<number>(10);

  const [, startTransition] = useTransition();

  // ── Load history ────────────────────────────────────────────────────────────

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(null);
    startTransition(async () => {
      const res = await getProjectDeploymentHistoryAction(projectId);
      setHistoryLoading(false);
      if (res.ok) setHistory(res.data);
      else setHistoryError(res.error);
    });
  }, [projectId]);

  // Auto-load on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── Filtering + pagination ─────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!history) return [];
    switch (filterStatus) {
      case "success":  return history.items.filter((i) => i.status === "SUCCESS");
      case "failed":   return history.items.filter((i) => i.status === "FAILED" || i.status === "CANCELLED");
      case "rollback": return history.items.filter((i) => i.source === "ROLLBACK");
      case "active":   return history.items.filter((i) => i.id === history.activeDeploymentId || i.isActive);
      default:         return history.items;
    }
  }, [history, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  // Clamp page when filter/pageSize changes
  const safePage = Math.min(page, totalPages);

  function handleFilterChange(f: FilterStatus) {
    setFilterStatus(f);
    setPage(1);
  }

  function handlePageSizeChange(s: number) {
    setPageSize(s);
    setPage(1);
  }

  // ── Open detail ─────────────────────────────────────────────────────────────

  const handleDetail = useCallback((deploymentId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    startTransition(async () => {
      const res = await getProjectDeploymentDetailAction({ projectId, deploymentId });
      setDetailLoading(false);
      if (res.ok) setDetail(res.data);
      else setDetailError(res.error);
    });
  }, [projectId]);

  // ── Rollback ────────────────────────────────────────────────────────────────

  const handleRollback = useCallback(() => {
    if (!rollbackTarget) return;
    setRollbackLoading(true);
    setRollbackError(null);
    setRollbackResult(null);
    startTransition(async () => {
      const res = await rollbackProjectDeploymentAction({
        projectId,
        targetDeploymentId: rollbackTarget.id,
        confirm: true,
      });
      setRollbackLoading(false);
      if (res.ok) {
        setRollbackResult(res.data);
        setRollbackTarget(null);
        setDetail(null);
        // Reload history after rollback
        const fresh = await getProjectDeploymentHistoryAction(projectId);
        if (fresh.ok) { setHistory(fresh.data); setPage(1); }
      } else {
        setRollbackError(res.error);
      }
    });
  }, [projectId, rollbackTarget]);

  // ── Backfill ────────────────────────────────────────────────────────────────

  const handleBackfill = useCallback(() => {
    setBackfillLoading(true);
    setBackfillError(null);
    setBackfillResult(null);
    startTransition(async () => {
      const res = await backfillActiveDeploymentAction(projectId);
      setBackfillLoading(false);
      if (res.ok) {
        setBackfillResult(res.data);
        // Reload history so the active marker updates
        const fresh = await getProjectDeploymentHistoryAction(projectId);
        if (fresh.ok) setHistory(fresh.data);
      } else {
        setBackfillError(res.error);
      }
    });
  }, [projectId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasHistory = !!history;
  const hasNoActive = hasHistory && history.items.length > 0 && !history.activeDeploymentId;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Deployment History</h2>
          {history && (
            <span className="text-xs text-muted-foreground tabular-nums">
              ({history.items.length})
            </span>
          )}
        </div>
        <button
          onClick={loadHistory}
          disabled={historyLoading}
          className="flex items-center gap-1 text-xs border border-border rounded px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40"
        >
          {historyLoading
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          {hasHistory ? "Refresh" : "Load history"}
        </button>
      </div>

      {/* ── Rollback result ── */}
      {rollbackResult && <RollbackResultBanner result={rollbackResult} />}

      {/* ── Rollback error ── */}
      {rollbackError && (
        <div className="flex items-start gap-2 p-3 rounded border bg-destructive/10 text-destructive border-destructive/20 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{rollbackError}</span>
        </div>
      )}

      {/* ── Detail error ── */}
      {detailError && (
        <div className="text-xs text-destructive">{detailError}</div>
      )}

      {/* ── History load error ── */}
      {historyError && (
        <div className="text-xs text-destructive">{historyError}</div>
      )}

      {/* ── No-active warning + backfill ── */}
      {hasNoActive && !backfillResult && (
        <div className="flex items-start gap-2 p-3 rounded border bg-amber-500/10 border-amber-400/20 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 space-y-1.5">
            <p className="font-semibold text-amber-800">No active deployment marker found.</p>
            <p className="text-muted-foreground">
              The current PM2 process may be online, but no deployment is marked as active in the history.
              You can backfill by setting the latest successful release as active.
            </p>
            <button
              onClick={handleBackfill}
              disabled={backfillLoading}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              {backfillLoading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckCircle2 className="h-3 w-3" />}
              Set latest successful release as active
            </button>
            {backfillError && (
              <p className="text-destructive font-medium">{backfillError}</p>
            )}
          </div>
        </div>
      )}

      {backfillResult && (
        <div className="flex items-center gap-2 p-2 rounded border bg-green-500/10 border-green-400/20 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            Marked <code className="font-mono">{backfillResult.deploymentRef}</code> as the active deployment.
          </span>
        </div>
      )}

      {/* ── Loading ── */}
      {historyLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      )}

      {/* ── Empty state ── */}
      {hasHistory && history.items.length === 0 && (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No deployments recorded yet.
        </div>
      )}

      {/* ── Filters + timeline ── */}
      {hasHistory && history.items.length > 0 && (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {FILTERS.map((f) => {
              // Count for each filter
              const count =
                f.value === "all"      ? history.items.length :
                f.value === "success"  ? history.items.filter((i) => i.status === "SUCCESS").length :
                f.value === "failed"   ? history.items.filter((i) => i.status === "FAILED" || i.status === "CANCELLED").length :
                f.value === "rollback" ? history.items.filter((i) => i.source === "ROLLBACK").length :
                /* active */             history.items.filter((i) => i.id === history.activeDeploymentId || i.isActive).length;

              const isActive = filterStatus === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => handleFilterChange(f.value)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {f.label}
                  <span className={`text-[10px] tabular-nums ${isActive ? "opacity-75" : "opacity-60"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Timeline */}
          {filteredItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No deployments match this filter.
            </p>
          ) : (
            <div className="space-y-2">
              {pagedItems.map((item, idx) => {
                const isActiveDep  = item.id === history.activeDeploymentId || item.isActive;
                const blockReason  = rollbackBlockReason(item, isActiveDep, !!pm2Name);
                const canRollback  = blockReason === null;
                const globalIdx    = (safePage - 1) * pageSize + idx;
                const isLast       = globalIdx === filteredItems.length - 1;

                return (
                  <div
                    key={item.id}
                    className={`relative flex items-start gap-3 px-3 py-2.5 rounded border transition-colors ${
                      isActiveDep
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-border bg-background hover:bg-muted/30"
                    }`}
                  >
                    {/* Timeline connector */}
                    {!isLast && (
                      <div className="absolute left-6 top-full w-px h-2 bg-border" />
                    )}

                    {/* Icon */}
                    <div className={`mt-0.5 shrink-0 h-5 w-5 rounded-full flex items-center justify-center border-2 ${
                      isActiveDep                    ? "border-green-500 bg-green-500/20"   :
                      item.status === "FAILED"       ? "border-red-400 bg-red-400/10"       :
                      item.source === "ROLLBACK"     ? "border-blue-400 bg-blue-400/10"     :
                      item.status === "SUCCESS"      ? "border-emerald-400 bg-emerald-400/10" :
                                                       "border-border bg-muted"
                    }`}>
                      {isActiveDep               ? <Zap        className="h-2.5 w-2.5 text-green-600"  /> :
                       item.status === "FAILED"  ? <XCircle    className="h-2.5 w-2.5 text-red-500"    /> :
                       item.source === "ROLLBACK"? <RotateCcw  className="h-2.5 w-2.5 text-blue-500"   /> :
                                                   <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge item={{ ...item, isActive: isActiveDep }} />
                        {isActiveDep && (
                          <span className="text-[10px] text-green-600 font-semibold">
                            Current release
                          </span>
                        )}
                        {item.deploymentRef && (
                          <code className="text-[10px] font-mono text-muted-foreground">
                            {item.deploymentRef.slice(0, 24)}
                          </code>
                        )}
                        {!item.releaseExists && item.status === "SUCCESS" && !isActiveDep && (
                          <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                            <AlertCircle className="h-2.5 w-2.5" /> missing release
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelTime(item.createdAt)}
                        </span>
                        {item.durationMs && (
                          <span className="flex items-center gap-0.5">
                            <Terminal className="h-2.5 w-2.5" />
                            {formatDuration(item.durationMs)}
                          </span>
                        )}
                        {item.sourceRef && item.sourceType !== "rollback" && (
                          <span className="flex items-center gap-0.5 font-mono">
                            <GitCommit className="h-2.5 w-2.5" />
                            {item.sourceRef.slice(0, 8)}
                          </span>
                        )}
                        {item.errorMessage && (
                          <span className="text-destructive truncate max-w-[200px]">
                            {item.errorMessage.slice(0, 80)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDetail(item.id)}
                        disabled={detailLoading}
                        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      >
                        <ChevronRight className="h-3 w-3" /> Detail
                      </button>

                      {canRollback && (
                        <button
                          onClick={() => setRollbackTarget(item)}
                          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" /> Rollback
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {filteredItems.length > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </>
      )}

      {/* ── Detail loading overlay ── */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-background border rounded p-4 flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading detail…</span>
          </div>
        </div>
      )}

      {/* ── Detail drawer ── */}
      {detail && !detailLoading && (
        <DeploymentDetailDrawer
          detail={detail}
          isActive={detail.deployment.id === history?.activeDeploymentId || detail.deployment.isActive}
          pm2Name={pm2Name}
          onClose={() => { setDetail(null); setDetailError(null); }}
          onRollback={(id) => {
            const item = history?.items.find((i) => i.id === id);
            if (item) { setDetail(null); setRollbackTarget(item); }
          }}
        />
      )}

      {/* ── Rollback confirm modal ── */}
      {rollbackTarget && pm2Name && (
        <RollbackConfirmModal
          target={rollbackTarget}
          pm2Name={pm2Name}
          isLoading={rollbackLoading}
          onCancel={() => { setRollbackTarget(null); setRollbackError(null); }}
          onConfirm={handleRollback}
        />
      )}

      {/* ── No PM2 name warning ── */}
      {rollbackTarget && !pm2Name && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-xl p-5 max-w-sm mx-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Cannot roll back
            </p>
            <p className="text-xs text-muted-foreground">
              No PM2 process name is configured for this project.
              Deploy the project first to set up the deployment config.
            </p>
            <button
              onClick={() => setRollbackTarget(null)}
              className="text-sm px-3 py-1.5 rounded border hover:bg-muted transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
