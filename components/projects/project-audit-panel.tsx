"use client";

/**
 * components/projects/project-audit-panel.tsx
 *
 * Sprint 18: Project audit log center UI.
 * Sprint 20: Added quick-filter tabs, copy buttons in detail modal,
 *             redaction badge, better formatted metadata, Denied shortcut.
 *
 * Security:
 *  - All data comes from getProjectAuditEventsAction which enforces audit.view
 *  - Metadata is pre-sanitised at write time — displayed as-is
 *  - No delete / edit controls exposed
 */

import { useState, useCallback, useEffect, useTransition } from "react";
import {
  getProjectAuditEventsAction,
  getProjectAuditEventDetailAction,
} from "@/app/actions/project-audit";
import type {
  ProjectAuditEventDTO,
  AuditActor,
  GetAuditEventsOutput,
} from "@/lib/audit/project-audit-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ShieldCheck,
  X,
  Copy,
  Check,
  BadgeAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
};

type Filters = {
  query: string;
  category: string;
  result: string;
  actorUserId: string;
  from: string;
  to: string;
  pageSize: number;
};

// ── Quick-filter tab definitions ──────────────────────────────────────────────

type QuickFilter = {
  label: string;
  category?: string;
  result?: string;
};

const QUICK_FILTERS: QuickFilter[] = [
  { label: "All" },
  { label: "Security",  category: "auth" },
  { label: "Deploys",   category: "publishing" },
  { label: "Team",      category: "team" },
  { label: "Env",       category: "env" },
  { label: "Terminal",  category: "terminal" },
  { label: "Database",  category: "database" },
  { label: "Alerts",    category: "alerts" },
  { label: "Denied",    result:   "denied" },
];

const ALL_CATEGORIES = [
  "auth", "team", "permissions", "files", "terminal", "git",
  "packages", "ai", "preview", "publishing", "rollback", "domains",
  "env", "database", "logs", "monitoring", "alerts", "settings", "system",
];

const RESULTS = ["success", "failed", "denied", "skipped"];
const PAGE_SIZES = [25, 50, 100];

// ── Result badge ──────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result: string }) {
  const variants: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    failed:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    denied:  "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    skipped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variants[result] ?? variants.skipped,
      )}
    >
      {result}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title={label}
      className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function AuditDetailModal({
  projectId,
  eventId,
  onClose,
}: {
  projectId: string;
  eventId: string;
  onClose: () => void;
}) {
  const [event, setEvent] = useState<ProjectAuditEventDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getProjectAuditEventDetailAction({ projectId, eventId }).then((res) => {
      if (res.ok) {
        setEvent(res.data);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }, [projectId, eventId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const summary = event
    ? `[${event.category}] ${event.action} — ${event.result} (${new Date(event.createdAt).toLocaleString()})`
    : "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Audit Event Detail</span>
          </div>
          <div className="flex items-center gap-2">
            {event && (
              <CopyButton text={summary} label="Copy summary" />
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 text-sm">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-destructive">{error}</p>
          )}

          {event && (
            <>
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Event ID</p>
                  <div className="flex items-center gap-1.5">
                    <p className="font-mono text-xs break-all">{event.id}</p>
                    <CopyButton text={event.id} label="Copy event ID" />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Timestamp</p>
                  <p className="text-xs">{new Date(event.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Action</p>
                  <div className="flex items-center gap-1.5">
                    <p className="font-mono text-xs">{event.action}</p>
                    <CopyButton text={event.action} label="Copy action" />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Result</p>
                  <ResultBadge result={event.result} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Category</p>
                  <Badge variant="outline" className="text-xs">{event.category}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Actor Role</p>
                  <p className="text-xs">{event.actorRole ?? "—"}</p>
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Summary</p>
                  <CopyButton text={event.summary} label="Copy summary" />
                </div>
                <p className="text-sm">{event.summary}</p>
              </div>

              {/* Actor */}
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Actor</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Name</p>
                    <p className="font-medium">{event.actorName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Email (masked)</p>
                    <p className="font-mono">{event.actorEmail ?? "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground">User ID</p>
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono">{event.actorUserId ?? "—"}</p>
                      {event.actorUserId && (
                        <CopyButton text={event.actorUserId} label="Copy user ID" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Target */}
              {(event.targetType || event.targetId || event.targetLabel) && (
                <div className="rounded-lg border p-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Target</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {event.targetType && (
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p>{event.targetType}</p>
                      </div>
                    )}
                    {event.targetLabel && (
                      <div>
                        <p className="text-muted-foreground">Label</p>
                        <p>{event.targetLabel}</p>
                      </div>
                    )}
                    {event.targetId && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">ID</p>
                        <div className="flex items-center gap-1.5">
                          <p className="font-mono break-all">{event.targetId}</p>
                          <CopyButton text={event.targetId} label="Copy target ID" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Request context */}
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Request Context</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">IP Address</p>
                    <p className="font-mono">{event.ipAddress ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">User Agent</p>
                    <p className="break-all line-clamp-2 text-muted-foreground">{event.userAgent ?? "—"}</p>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              {event.metadata && Object.keys(event.metadata).length > 0 && (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground">Metadata</p>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">
                        <BadgeAlert className="h-2.5 w-2.5" />
                        sanitized at write time
                      </span>
                      <CopyButton
                        text={JSON.stringify(event.metadata, null, 2)}
                        label="Copy metadata JSON"
                      />
                    </div>
                  </div>
                  <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Native select helper ──────────────────────────────────────────────────────

function NativeSelect({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-sm ring-offset-background",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        className,
      )}
    >
      {children}
    </select>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectAuditPanel({ projectId }: Props) {
  const [filters, setFilters] = useState<Filters>({
    query: "",
    category: "",
    result: "",
    actorUserId: "",
    from: "",
    to: "",
    pageSize: 25,
  });
  const [activeQuick, setActiveQuick] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<GetAuditEventsOutput | null>(null);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [detailEventId, setDetailEventId] = useState<string | null>(null);

  const load = useCallback(
    (overridePage?: number, overrideFilters?: Filters) => {
      const p = overridePage ?? page;
      const f = overrideFilters ?? filters;
      startTransition(async () => {
        setLoadError(null);
        const res = await getProjectAuditEventsAction({
          projectId,
          page: p,
          pageSize: f.pageSize,
          category: f.category || undefined,
          result: f.result || undefined,
          actorUserId: f.actorUserId || undefined,
          query: f.query || undefined,
          from: f.from || undefined,
          to: f.to || undefined,
        });
        if (res.ok) {
          setData(res.data);
          setActors(res.data.actors);
        } else {
          setLoadError(res.error);
        }
      });
    },
    [projectId, page, filters],
  );

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Quick filter handler ──────────────────────────────────────────────────

  function applyQuickFilter(qf: QuickFilter) {
    setActiveQuick(qf.label);
    const next: Filters = {
      ...filters,
      category: qf.category ?? "",
      result: qf.result ?? "",
    };
    setFilters(next);
    setPage(1);
    load(1, next);
  }

  const applyFilters = () => {
    setActiveQuick("All");
    setPage(1);
    load(1);
  };

  const resetFilters = () => {
    const defaultFilters: Filters = {
      query: "", category: "", result: "", actorUserId: "", from: "", to: "", pageSize: 25,
    };
    setFilters(defaultFilters);
    setActiveQuick("All");
    setPage(1);
    load(1, defaultFilters);
  };

  const goToPage = (p: number) => {
    setPage(p);
    load(p);
  };

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Log</h2>
          <p className="text-sm text-muted-foreground">
            Complete record of who did what, when, and whether it succeeded.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* ── Quick-filter tabs ── */}
      <div className="flex flex-wrap gap-1">
        {QUICK_FILTERS.map((qf) => (
          <button
            key={qf.label}
            onClick={() => applyQuickFilter(qf)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              activeQuick === qf.label
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
          >
            {qf.label}
          </button>
        ))}
      </div>

      {/* ── Advanced Filters ── */}
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Advanced filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Search */}
          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <Input
              placeholder="Action, summary, actor..."
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <NativeSelect
              value={filters.category || ""}
              onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
              className="w-full"
            >
              <option value="">All categories</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>

          {/* Result */}
          <div className="space-y-1">
            <Label className="text-xs">Result</Label>
            <NativeSelect
              value={filters.result || ""}
              onChange={(v) => setFilters((f) => ({ ...f, result: v }))}
              className="w-full"
            >
              <option value="">All results</option>
              {RESULTS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </NativeSelect>
          </div>

          {/* Actor */}
          <div className="space-y-1">
            <Label className="text-xs">Actor</Label>
            <NativeSelect
              value={filters.actorUserId || ""}
              onChange={(v) => setFilters((f) => ({ ...f, actorUserId: v }))}
              className="w-full"
            >
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a.actorUserId ?? "unknown"} value={a.actorUserId ?? ""}>
                  {a.actorName ?? a.actorEmail ?? a.actorUserId ?? "Unknown"}
                </option>
              ))}
            </NativeSelect>
          </div>

          {/* From date */}
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>

          {/* To date */}
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Page size + actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Per page:</Label>
            <NativeSelect
              value={String(filters.pageSize)}
              onChange={(v) => setFilters((f) => ({ ...f, pageSize: Number(v) }))}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={String(s)}>{s}</option>
              ))}
            </NativeSelect>
          </div>

          <Button size="sm" onClick={applyFilters} disabled={isPending} className="h-7 text-xs">
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={resetFilters} disabled={isPending} className="h-7 text-xs">
            Reset
          </Button>
        </div>
      </div>

      {/* ── Error ── */}
      {loadError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-lg border overflow-hidden">
        {isPending && !data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {activeQuick !== "All"
                ? `No "${activeQuick}" events found`
                : "No audit events found"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              {activeQuick !== "All"
                ? "Try a different filter or clear the selection."
                : "Sensitive project actions will appear here as your team performs them."}
            </p>
            {activeQuick !== "All" && (
              <button
                onClick={() => applyQuickFilter(QUICK_FILTERS[0])}
                className="mt-3 text-xs text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">Timestamp</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Result</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Actor</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Summary</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.map((event) => (
                  <AuditEventRow
                    key={event.id}
                    event={event}
                    onDetail={() => setDetailEventId(event.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-xs text-muted-foreground">
            Showing {((page - 1) * filters.pageSize) + 1}–
            {Math.min(page * filters.pageSize, total)} of {total} events
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || isPending}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-xs">{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || isPending}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Detail modal ── */}
      {detailEventId && (
        <AuditDetailModal
          projectId={projectId}
          eventId={detailEventId}
          onClose={() => setDetailEventId(null)}
        />
      )}
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function AuditEventRow({
  event,
  onDetail,
}: {
  event: ProjectAuditEventDTO;
  onDetail: () => void;
}) {
  const ts = new Date(event.createdAt);
  const formatted = ts.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const actorLabel = event.actorName ?? event.actorEmail ?? event.actorUserId ?? "system";

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
        {formatted}
      </td>
      <td className="py-2 px-3">
        <ResultBadge result={event.result} />
      </td>
      <td className="py-2 px-3">
        <Badge variant="outline" className="text-xs font-normal">{event.category}</Badge>
      </td>
      <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">{event.action}</td>
      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
        {actorLabel}
        {event.actorRole && (
          <span className="ml-1 opacity-60">({event.actorRole})</span>
        )}
      </td>
      <td className="py-2 px-3 text-xs max-w-xs truncate text-muted-foreground">
        {event.targetLabel && (
          <span className="text-foreground mr-1">{event.targetLabel}:</span>
        )}
        {event.summary}
      </td>
      <td className="py-2 px-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onDetail}
        >
          Details
        </Button>
      </td>
    </tr>
  );
}
