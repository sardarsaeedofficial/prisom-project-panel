"use client";

/**
 * components/admin/admin-jobs-panel.tsx
 *
 * Sprint 35: Admin Background Jobs dashboard.
 *
 * Safety rules:
 *  - Retry button is disabled for storage_cleanup jobs (tooltip explains why)
 *  - Cancel only appears for queued/retrying jobs
 *  - No raw env values or secrets are rendered
 *  - All actions require OWNER/ADMIN (enforced server-side)
 */

import { useState, useEffect, useCallback } from "react";
import Link                                 from "next/link";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Activity,
  XCircle,
  RotateCcw,
  Trash2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { cn }                from "@/lib/utils";
import {
  listAdminJobsAction,
  retryAdminJobAction,
  cancelAdminJobAction,
  markStaleJobsAction,
  pruneOldJobsAction,
} from "@/app/actions/admin-jobs";
import type {
  BackgroundJobDTO,
  JobStatus,
} from "@/lib/jobs/background-job-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "all" | "running" | "queued" | "failed" | "stale" | "success";

const TABS: { key: Tab; label: string }[] = [
  { key: "all",     label: "All" },
  { key: "running", label: "Running" },
  { key: "queued",  label: "Queued" },
  { key: "failed",  label: "Failed" },
  { key: "stale",   label: "Stale" },
  { key: "success", label: "Recent Success" },
];

const TAB_STATUSES: Record<Tab, JobStatus[]> = {
  all:     [],
  running: ["running"],
  queued:  ["queued", "retrying"],
  failed:  ["failed"],
  stale:   ["stale"],
  success: ["success"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0)           return "just now";
  if (ms < 60_000)      return "just now";
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtJobType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Status badge ──────────────────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: JobStatus }) {
  const map: Record<string, string> = {
    queued:    "bg-blue-50    text-blue-700   border-blue-200",
    running:   "bg-purple-50  text-purple-700 border-purple-200",
    retrying:  "bg-orange-50  text-orange-700 border-orange-200",
    success:   "bg-green-50   text-green-700  border-green-200",
    failed:    "bg-red-50     text-red-700    border-red-200",
    cancelled: "bg-gray-50    text-gray-500   border-gray-200",
    stale:     "bg-yellow-50  text-yellow-700 border-yellow-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border",
      map[status] ?? "bg-gray-50 text-gray-500 border-gray-200",
    )}>
      {status}
    </span>
  );
}

// ── Overview cards ────────────────────────────────────────────────────────────

function OverviewCard({
  label,
  value,
  accent,
  onClick,
}: {
  label:   string;
  value:   number;
  accent?: "red" | "yellow" | "green" | "blue" | "purple";
  onClick?: () => void;
}) {
  const accentCls =
    accent === "red"    ? "border-l-red-500"    :
    accent === "yellow" ? "border-l-yellow-500" :
    accent === "green"  ? "border-l-green-500"  :
    accent === "blue"   ? "border-l-blue-500"   :
    accent === "purple" ? "border-l-purple-500" :
    "border-l-border";

  const inner = (
    <div className={cn(
      "rounded-lg border border-l-4 bg-card p-3 flex flex-col gap-0.5",
      accentCls,
      onClick && "cursor-pointer hover:bg-accent/50 transition-colors",
    )}>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );

  return onClick ? <button className="text-left w-full" onClick={onClick}>{inner}</button> : inner;
}

// ── Job table ─────────────────────────────────────────────────────────────────

function JobRow({
  job,
  onRetry,
  onCancel,
  retrying,
  cancelling,
}: {
  job:        BackgroundJobDTO;
  onRetry:    (id: string) => void;
  onCancel:   (id: string) => void;
  retrying:   Set<string>;
  cancelling: Set<string>;
}) {
  const canRetry  = ["failed", "stale", "cancelled"].includes(job.status) && job.jobType !== "storage_cleanup";
  const canCancel = ["queued", "retrying"].includes(job.status);

  return (
    <tr className="border-b hover:bg-muted/30 transition-colors">
      <td className="px-3 py-2 text-xs text-muted-foreground font-mono truncate max-w-[120px]">
        {job.jobRef.slice(-12)}
      </td>
      <td className="px-3 py-2">
        <div className="text-sm font-medium truncate max-w-[200px]">{job.title}</div>
        <div className="text-xs text-muted-foreground">{fmtJobType(job.jobType)}</div>
      </td>
      <td className="px-3 py-2">
        <JobStatusBadge status={job.status} />
        {job.attempts > 1 && (
          <span className="ml-1 text-xs text-muted-foreground">×{job.attempts}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {job.projectName
          ? <Link href={`/projects/${job.projectId}`} className="hover:underline text-foreground">{job.projectName}</Link>
          : <span className="italic">global</span>
        }
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {job.startedAt ? fmtRelative(job.startedAt) : fmtRelative(job.createdAt)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {fmtDuration(job.durationMs)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[160px]">
        {job.lastError && (
          <span className="text-red-600" title={job.lastError}>
            {job.lastError.slice(0, 80)}
          </span>
        )}
        {!job.lastError && job.lastLogLine && (
          <span>{job.lastLogLine.slice(0, 80)}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          {canRetry && (
            <button
              onClick={() => onRetry(job.id)}
              disabled={retrying.has(job.id)}
              title={job.jobType === "storage_cleanup"
                ? "Storage cleanup must be re-initiated from the project Storage Center"
                : "Re-queue this job"}
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {retrying.has(job.id)
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCcw className="h-3 w-3" />}
              Retry
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => onCancel(job.id)}
              disabled={cancelling.has(job.id)}
              title="Cancel this job"
              className="inline-flex items-center gap-1 rounded border border-red-200 bg-background px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {cancelling.has(job.id)
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <XCircle className="h-3 w-3" />}
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminJobsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [page, setPage]           = useState(1);
  const [jobs, setJobs]           = useState<BackgroundJobDTO[]>([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);

  // Summary counts for overview cards
  const [summary, setSummary] = useState({ active: 0, queued: 0, failed: 0, stale: 0, success: 0 });

  // Action state
  const [retrying,   setRetrying]   = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [actionMsg,  setActionMsg]  = useState<string | null>(null);
  const [markingStale, setMarkingStale] = useState(false);
  const [pruning, setPruning]           = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async (tab: Tab = activeTab, p: number = page) => {
    setLoading(true);
    setError(null);

    const statuses = TAB_STATUSES[tab];

    try {
      // Also fetch counts for summary
      const [result, activeRes, queuedRes, failedRes, staleRes, successRes] = await Promise.all([
        listAdminJobsAction({ status: statuses.length ? statuses : undefined, page: p, pageSize: 25 }),
        listAdminJobsAction({ status: ["running"],          page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["queued","retrying"], page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["failed"],           page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["stale"],            page: 1, pageSize: 1 }),
        listAdminJobsAction({
          status: ["success"],
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          page: 1, pageSize: 1,
        }),
      ]);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setJobs(result.result.jobs);
      setTotal(result.result.total);
      setTotalPages(result.result.totalPages);
      setLastLoaded(new Date().toISOString());

      setSummary({
        active:  activeRes.ok  ? activeRes.result.total  : 0,
        queued:  queuedRes.ok  ? queuedRes.result.total  : 0,
        failed:  failedRes.ok  ? failedRes.result.total  : 0,
        stale:   staleRes.ok   ? staleRes.result.total   : 0,
        success: successRes.ok ? successRes.result.total : 0,
      });
    } catch {
      setError("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    loadJobs(activeTab, page);
  }, [activeTab, page, loadJobs]);

  // Auto-refresh every 15s when there are active/queued jobs
  useEffect(() => {
    const timer = setInterval(() => {
      if (summary.active > 0 || summary.queued > 0) {
        loadJobs(activeTab, page);
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [summary.active, summary.queued, activeTab, page, loadJobs]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleRetry(jobId: string) {
    setRetrying((s) => new Set(s).add(jobId));
    setActionMsg(null);

    const res = await retryAdminJobAction(jobId).catch(() => ({ ok: false, error: "Request failed" }));
    if (res.ok) {
      setActionMsg("Job re-queued successfully.");
      await loadJobs();
    } else {
      setActionMsg(`Retry failed: ${(res as { ok: false; error: string }).error}`);
    }

    setRetrying((s) => { const n = new Set(s); n.delete(jobId); return n; });
  }

  async function handleCancel(jobId: string) {
    setCancelling((s) => new Set(s).add(jobId));
    setActionMsg(null);

    const res = await cancelAdminJobAction(jobId).catch(() => ({ ok: false, error: "Request failed" }));
    if (res.ok) {
      setActionMsg("Job cancelled.");
      await loadJobs();
    } else {
      setActionMsg(`Cancel failed: ${(res as { ok: false; error: string }).error}`);
    }

    setCancelling((s) => { const n = new Set(s); n.delete(jobId); return n; });
  }

  async function handleMarkStale() {
    setMarkingStale(true);
    setActionMsg(null);

    const res = await markStaleJobsAction().catch(() => ({ ok: false, error: "Request failed" }));
    if (res.ok) {
      setActionMsg(`Marked ${(res as { ok: true; markedStale: number }).markedStale} job(s) as stale.`);
      await loadJobs();
    } else {
      setActionMsg(`Failed: ${(res as { ok: false; error: string }).error}`);
    }
    setMarkingStale(false);
  }

  async function handlePrune() {
    if (!confirm("Delete all old completed job records? This cannot be undone.")) return;
    setPruning(true);
    setActionMsg(null);

    const res = await pruneOldJobsAction().catch(() => ({ ok: false, error: "Request failed" }));
    if (res.ok) {
      setActionMsg(`Pruned ${(res as { ok: true; pruned: number }).pruned} old job record(s).`);
      await loadJobs();
    } else {
      setActionMsg(`Failed: ${(res as { ok: false; error: string }).error}`);
    }
    setPruning(false);
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setPage(1);
  }

  return (
    <div className="space-y-5">

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <OverviewCard label="Active"       value={summary.active}  accent="purple" onClick={() => handleTabChange("running")} />
        <OverviewCard label="Queued"       value={summary.queued}  accent="blue"   onClick={() => handleTabChange("queued")} />
        <OverviewCard label="Failed (24h)" value={summary.failed}  accent="red"    onClick={() => handleTabChange("failed")} />
        <OverviewCard label="Stale"        value={summary.stale}   accent="yellow" onClick={() => handleTabChange("stale")} />
        <OverviewCard label="Success (24h)" value={summary.success} accent="green" onClick={() => handleTabChange("success")} />
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className="flex items-center gap-2 rounded border bg-muted/50 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          {actionMsg}
          <button onClick={() => setActionMsg(null)} className="ml-auto text-muted-foreground hover:text-foreground">×</button>
        </div>
      )}

      {/* Table header */}
      <div className="rounded-lg border bg-card">
        {/* Controls row */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <div className="flex items-center gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  activeTab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {lastLoaded && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {fmtRelative(lastLoaded)}
              </span>
            )}
            <button
              onClick={() => loadJobs(activeTab, page)}
              disabled={loading}
              title="Refresh"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </button>
            <button
              onClick={handleMarkStale}
              disabled={markingStale}
              title="Force-expire running jobs that have missed their heartbeat"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              {markingStale ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
              Mark Stale
            </button>
            <button
              onClick={handlePrune}
              disabled={pruning}
              title="Delete old completed job records per retention policy"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-50"
            >
              {pruning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Prune
            </button>
          </div>
        </div>

        {/* Table */}
        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading jobs…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 px-4 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex items-center gap-2 py-8 px-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            No jobs in this category.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Ref</th>
                  <th className="px-3 py-2 text-left font-medium">Job</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Last Output</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onRetry={handleRetry}
                    onCancel={handleCancel}
                    retrying={retrying}
                    cancelling={cancelling}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground text-xs">
              {total} job{total !== 1 ? "s" : ""} · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
