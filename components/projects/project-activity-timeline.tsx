"use client";

/**
 * components/projects/project-activity-timeline.tsx
 *
 * Sprint 37: Unified activity timeline for a single project.
 */

import { useState, useEffect, useCallback } from "react";
import Link                                 from "next/link";
import {
  Rocket, Database, Activity, HardDrive, Globe, Shield,
  ShieldCheck, Clock, AlertTriangle, CheckCircle2, Info,
  RefreshCw, Search, Loader2, ChevronRight, Filter,
  ListChecks, ArchiveRestore,
} from "lucide-react";
import { cn }                              from "@/lib/utils";
import { getProjectActivityAction }        from "@/app/actions/project-activity";
import type {
  ActivityItem,
  ActivityCategory,
  ActivitySeverity,
} from "@/lib/activity/activity-types";

// ── Icons per category ────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<ActivityCategory, React.ElementType> = {
  deployment:     Rocket,
  operation:      ListChecks,
  background_job: Activity,
  backup:         ArchiveRestore,
  domain:         Globe,
  storage:        HardDrive,
  alert:          AlertTriangle,
  audit:          ShieldCheck,
  security:       Shield,
  system:         Database,
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  deployment:     "Deployment",
  operation:      "Operation",
  background_job: "Background Job",
  backup:         "Backup",
  domain:         "Domain",
  storage:        "Storage",
  alert:          "Alert",
  audit:          "Audit",
  security:       "Security",
  system:         "System",
};

const SEVERITY_CLASSES: Record<ActivitySeverity, string> = {
  info:    "bg-blue-50   text-blue-700   border-blue-200",
  success: "bg-green-50  text-green-700  border-green-200",
  warning: "bg-yellow-50 text-yellow-700 border-yellow-200",
  error:   "bg-red-50    text-red-700    border-red-200",
};

const ICON_BG: Record<ActivitySeverity, string> = {
  info:    "bg-blue-100   text-blue-600",
  success: "bg-green-100  text-green-600",
  warning: "bg-yellow-100 text-yellow-600",
  error:   "bg-red-100    text-red-600",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)     return "just now";
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Activity row ──────────────────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = CATEGORY_ICONS[item.category] ?? Activity;

  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      {/* Icon */}
      <div className={cn("shrink-0 rounded-full p-2 mt-0.5", ICON_BG[item.severity])}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug truncate">
              {item.href
                ? <Link href={item.href} className="hover:underline">{item.title}</Link>
                : item.title
              }
            </p>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {item.description}
              </p>
            )}
            {item.actorEmail && (
              <p className="text-xs text-muted-foreground mt-0.5">
                by {item.actorEmail}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-xs border",
              SEVERITY_CLASSES[item.severity],
            )}>
              {item.severity}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {fmtRelative(item.occurredAt)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            {CATEGORY_LABELS[item.category]}
          </span>
          {item.href && (
            <Link
              href={item.href}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Open <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const CATEGORIES: { key: ActivityCategory | "all"; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "deployment",   label: "Deployments" },
  { key: "operation",    label: "Operations" },
  { key: "backup",       label: "Backups" },
  { key: "background_job", label: "Jobs" },
  { key: "audit",        label: "Audit" },
  { key: "alert",        label: "Alerts" },
];

const SEVERITIES: { key: ActivitySeverity | "all"; label: string }[] = [
  { key: "all",     label: "All" },
  { key: "error",   label: "Error" },
  { key: "warning", label: "Warning" },
  { key: "success", label: "Success" },
  { key: "info",    label: "Info" },
];

export function ProjectActivityTimeline({ projectId }: { projectId: string }) {
  const [items,       setItems]       = useState<ActivityItem[]>([]);
  const [total,       setTotal]       = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  const [category,    setCategory]    = useState<ActivityCategory | "all">("all");
  const [severity,    setSeverity]    = useState<ActivitySeverity | "all">("all");
  const [search,      setSearch]      = useState("");
  const [searchInput, setSearchInput] = useState("");

  const load = useCallback(async (
    cat: ActivityCategory | "all",
    sev: ActivitySeverity | "all",
    q:   string,
    p:   number,
  ) => {
    setLoading(true);
    setError(null);
    const res = await getProjectActivityAction(projectId, {
      category:  cat !== "all" ? cat : undefined,
      severity:  sev !== "all" ? sev : undefined,
      search:    q || undefined,
      page:      p,
      pageSize:  30,
    }).catch(() => null);

    if (!res || !res.ok) {
      setError(res?.error ?? "Failed to load activity");
    } else {
      setItems(res.result.items);
      setTotal(res.result.total);
      setTotalPages(res.result.totalPages);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(category, severity, search, page); }, [load, category, severity, search, page]);

  function handleCategoryChange(cat: ActivityCategory | "all") {
    setCategory(cat);
    setPage(1);
  }
  function handleSeverityChange(sev: ActivitySeverity | "all") {
    setSeverity(sev);
    setPage(1);
  }
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category tabs */}
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => handleCategoryChange(c.key as ActivityCategory | "all")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                category === c.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-1 ml-auto">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <select
            value={severity}
            onChange={(e) => handleSeverityChange(e.target.value as ActivitySeverity | "all")}
            className="rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {SEVERITIES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search…"
              className="rounded border bg-background pl-7 pr-2 py-1 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent transition-colors"
          >
            Go
          </button>
          {(search || searchInput) && (
            <button
              type="button"
              onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </form>

        <button
          onClick={() => load(category, severity, search, page)}
          disabled={loading}
          className="rounded border bg-background p-1 hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Timeline list */}
      <div className="rounded-lg border bg-card">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading activity…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 px-4 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
            <Info className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No activity found.</p>
          </div>
        ) : (
          <div className="px-4 divide-y-0">
            {loading && (
              <div className="flex items-center justify-end gap-1 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
              </div>
            )}
            {items.map((item) => <ActivityRow key={item.id} item={item} />)}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-xs text-muted-foreground">
              {total} event{total !== 1 ? "s" : ""} · page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >Prev</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
