"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Server,
  HardDrive,
  Shield,
  Activity,
  Clock,
  Layers,
  Globe,
  Archive,
  CalendarClock,
  ChevronRight,
  ExternalLink,
  Users,
  Loader2,
} from "lucide-react";
import { cn }                                    from "@/lib/utils";
import {
  getAdminPm2SectionAction,
  getAdminDiskSectionAction,
  getAdminSchedulersSectionAction,
  getAdminStorageSectionAction,
  getAdminJobsSectionAction,
}                                                from "@/app/actions/admin-health";
import { useAdminAsyncSection }                  from "./use-admin-async-section";
import { AdminSectionStatusCard }                from "./admin-section-status-card";
import type {
  AdminFastSummary,
  AdminPm2Section,
  AdminDiskSection,
  AdminSchedulersSection,
  AdminStorageSection,
  AdminJobsSection,
  AdminSystemWarning,
  AdminPm2Process,
  AdminCacheStatus,
  AdminOverallStatus,
} from "@/lib/admin/admin-health-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024)             return `${bytes} B`;
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)        return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtUptime(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60)     return `${s}s`;
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)      return "just now";
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ── Overall status computation ────────────────────────────────────────────────

function computeOverall(
  fastSummary:  AdminFastSummary | null,
  pm2:          AdminPm2Section | null | undefined,
  disk:         AdminDiskSection | null | undefined,
  schedulers:   AdminSchedulersSection | null | undefined,
  pm2Loading:   boolean,
  diskLoading:  boolean,
  schLoading:   boolean,
): { status: AdminOverallStatus; warnings: AdminSystemWarning[]; isPartial: boolean } {
  const allWarnings: AdminSystemWarning[] = [
    ...(fastSummary?.fastWarnings ?? []),
    ...(pm2?.warnings ?? []),
    ...(disk?.warnings ?? []),
    ...(schedulers?.warnings ?? []),
  ];

  const isPartial = pm2Loading || diskLoading || schLoading;

  let status: AdminOverallStatus = "healthy";
  if (allWarnings.some((w) => w.severity === "critical")) status = "critical";
  else if (allWarnings.some((w) => w.severity === "warning")) status = "warning";

  return { status, warnings: allWarnings, isPartial };
}

// ── Status chips ──────────────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: "healthy" | "warning" | "critical" | "unknown";
}) {
  const map: Record<string, string> = {
    healthy:  "bg-green-100  text-green-800  border-green-200",
    warning:  "bg-yellow-100 text-yellow-800 border-yellow-200",
    critical: "bg-red-100    text-red-800    border-red-200",
    unknown:  "bg-gray-100   text-gray-600   border-gray-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
      map[status] ?? map.unknown,
    )}>
      {status}
    </span>
  );
}

function OverallBanner({
  status,
  isPartial,
}: {
  status:    AdminOverallStatus;
  isPartial: boolean;
}) {
  const cfg = {
    healthy:  { bg: "bg-green-50  border-green-200",  icon: CheckCircle2,  color: "text-green-700",  label: "All systems healthy" },
    warning:  { bg: "bg-yellow-50 border-yellow-200", icon: AlertTriangle, color: "text-yellow-700", label: "Attention required" },
    critical: { bg: "bg-red-50    border-red-200",    icon: AlertCircle,   color: "text-red-700",    label: "Critical issues detected" },
  }[status];

  const Icon = cfg.icon;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", cfg.bg)}>
      <Icon className={cn("h-5 w-5 shrink-0", cfg.color)} />
      <div className="flex-1">
        <p className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</p>
        {isPartial && (
          <p className="text-xs text-muted-foreground mt-0.5">Checking system health…</p>
        )}
      </div>
    </div>
  );
}

// ── Warning list ──────────────────────────────────────────────────────────────

function WarningSeverityIcon({ severity }: { severity: AdminSystemWarning["severity"] }) {
  if (severity === "critical") return <AlertCircle   className="h-4 w-4 text-red-500    shrink-0" />;
  if (severity === "warning")  return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
}

function WarningList({ warnings }: { warnings: AdminSystemWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        No warnings
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <WarningSeverityIcon severity={w.severity} />
          <div className="min-w-0">
            <span className="font-medium">{w.title}</span>
            {" — "}
            <span className="text-muted-foreground">{w.description}</span>
            {w.href && (
              <Link href={w.href} className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                View <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
  accent,
}: {
  label:   string;
  value:   string | number;
  sub?:    string;
  icon:    React.ElementType;
  href?:   string;
  accent?: "red" | "yellow" | "green";
}) {
  const accentCls =
    accent === "red"    ? "border-l-red-500"
  : accent === "yellow" ? "border-l-yellow-500"
  : accent === "green"  ? "border-l-green-500"
  : "border-l-border";

  const inner = (
    <div className={cn("rounded-lg border border-l-4 bg-card p-4 flex flex-col gap-1", accentCls)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );

  if (href) {
    return <Link href={href} className="block hover:opacity-80 transition-opacity">{inner}</Link>;
  }
  return inner;
}

// ── Section header with refresh button + cache age ───────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  badge,
  generatedAt,
  cacheStatus,
  onRefresh,
  loading,
}: {
  icon:          React.ElementType;
  title:         string;
  badge?:        React.ReactNode;
  generatedAt?:  string;
  cacheStatus?:  AdminCacheStatus;
  onRefresh:     () => void;
  loading:       boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
          {badge}
        </h2>
        {generatedAt && (
          <p className="text-xs text-muted-foreground">
            Updated {fmtRelative(generatedAt)}
            {cacheStatus === "fresh" && " · cached"}
          </p>
        )}
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        title="Refresh this section"
        className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 transition-colors"
      >
        <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
      </button>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex justify-between items-center">
        <div className="h-4 w-1/3 bg-muted rounded" />
        <div className="h-6 w-6 bg-muted rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full  bg-muted rounded" />
        <div className="h-3 w-3/4  bg-muted rounded" />
        <div className="h-3 w-5/6  bg-muted rounded" />
        <div className="h-3 w-2/3  bg-muted rounded" />
      </div>
    </div>
  );
}

// ── PM2 table ─────────────────────────────────────────────────────────────────

function Pm2StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    online:    "bg-green-100  text-green-800",
    stopped:   "bg-gray-100   text-gray-600",
    errored:   "bg-red-100    text-red-700",
    launching: "bg-blue-100   text-blue-700",
    unknown:   "bg-gray-100   text-gray-500",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
      map[status] ?? map.unknown,
    )}>
      {status}
    </span>
  );
}

function Pm2Table({ processes }: { processes: AdminPm2Process[] }) {
  if (processes.length === 0) {
    return <p className="text-sm text-muted-foreground">No PM2 processes found (pm2 may be unavailable).</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="py-2 pr-4 text-left">Name</th>
            <th className="py-2 pr-4 text-left">Status</th>
            <th className="py-2 pr-4 text-right">PID</th>
            <th className="py-2 pr-4 text-right">Uptime</th>
            <th className="py-2 pr-4 text-right">Memory</th>
            <th className="py-2 pr-4 text-right">CPU</th>
            <th className="py-2 text-right">Restarts</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {processes.map((p) => (
            <tr key={p.name} className={cn("", !p.isManaged && "opacity-60")}>
              <td className="py-2 pr-4 font-mono font-medium">
                {p.name}
                {!p.isManaged && (
                  <span className="ml-1 text-xs text-muted-foreground">(read-only)</span>
                )}
              </td>
              <td className="py-2 pr-4"><Pm2StatusChip status={p.status} /></td>
              <td className="py-2 pr-4 text-right text-muted-foreground font-mono">{p.pid ?? "—"}</td>
              <td className="py-2 pr-4 text-right text-muted-foreground">{fmtUptime(p.uptimeMs)}</td>
              <td className="py-2 pr-4 text-right text-muted-foreground">
                {p.memoryMb !== null ? `${p.memoryMb} MB` : "—"}
              </td>
              <td className="py-2 pr-4 text-right text-muted-foreground">
                {p.cpu !== null ? `${p.cpu}%` : "—"}
              </td>
              <td className="py-2 text-right text-muted-foreground">{p.restarts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Scheduler row ─────────────────────────────────────────────────────────────

function SchedulerRow({
  label,
  s,
}: {
  label: string;
  s:     AdminSchedulersSection["alerts"];
}) {
  const statusMap: Record<string, string> = {
    running:  "bg-green-100  text-green-800",
    stale:    "bg-yellow-100 text-yellow-800",
    unknown:  "bg-gray-100   text-gray-600",
    disabled: "bg-gray-100   text-gray-500",
  };
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {s.lastHeartbeatAt ? (
          <span className="text-xs text-muted-foreground">
            Last tick: {fmtRelative(s.lastHeartbeatAt)}
            {s.tickCount !== undefined && ` · ${s.tickCount} ticks`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No heartbeat recorded yet</span>
        )}
      </div>
      <span className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
        statusMap[s.status] ?? statusMap.unknown,
      )}>
        {s.status}
      </span>
    </div>
  );
}

// ── Recent audit events ───────────────────────────────────────────────────────

function AuditEventRow({ ev }: { ev: AdminFastSummary["recentAuditEvents"][number] }) {
  const resultColor = ev.result === "failed" || ev.result === "denied"
    ? "text-red-600"
    : "text-muted-foreground";
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-mono">{ev.action}</span>
        <p className="text-xs text-muted-foreground truncate">{ev.summary}</p>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className={cn("text-xs", resultColor)}>{ev.result}</span>
        <span className="text-xs text-muted-foreground">{fmtRelative(ev.createdAt)}</span>
      </div>
    </div>
  );
}

// ── Failed deployment row ─────────────────────────────────────────────────────

function FailedDeployRow({ d }: { d: AdminFastSummary["deployments"]["latestFailures"][number] }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${d.projectId}/publishing`}
          className="text-xs font-medium hover:underline inline-flex items-center gap-1"
        >
          {d.projectName}
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
        {d.errorMessage && (
          <p className="text-xs text-muted-foreground truncate">{d.errorMessage.slice(0, 120)}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{fmtRelative(d.startedAt)}</span>
    </div>
  );
}

// ── Section loader factory ────────────────────────────────────────────────────
// Wraps a section action to match the shape useAdminAsyncSection expects.
// forceRef is set to true before calling retry() to bypass cache on demand.

function mkSectionLoader<T extends { generatedAt: string; cacheStatus: string }>(
  action:   (force: boolean) => Promise<
    { ok: true; data: T } |
    { ok: false; error: string; staleData?: T | null; staleGeneratedAt?: string }
  >,
  forceRef: React.MutableRefObject<boolean>,
) {
  return () => {
    const force = forceRef.current;
    forceRef.current = false;
    return action(force).then((r) =>
      r.ok
        ? { ok: true  as const, data: r.data, generatedAt: r.data.generatedAt, cacheStatus: r.data.cacheStatus }
        : { ok: false as const, error: r.error, staleData: r.staleData ?? null, staleGeneratedAt: r.staleGeneratedAt },
    );
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminConsole({
  initialFastSummary,
  actorEmail,
  actorRole,
}: {
  initialFastSummary: AdminFastSummary | null;
  actorEmail?:        string;
  actorRole?:         string;
}) {
  const [fastSummary, setFastSummary] = useState<AdminFastSummary | null>(initialFastSummary);
  const [refreshing, setRefreshing] = useState(false);

  // ── Force-refresh refs (set to true before calling retry to bypass cache) ───
  const pm2Force     = useRef(false);
  const diskForce    = useRef(false);
  const schForce     = useRef(false);
  const storageForce = useRef(false);
  const jobsForce    = useRef(false);

  // ── Per-section async state via hook (timeout + slow + stale fallback) ──────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadPm2Fn     = useCallback(mkSectionLoader<AdminPm2Section>(getAdminPm2SectionAction, pm2Force), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadDiskFn    = useCallback(mkSectionLoader<AdminDiskSection>(getAdminDiskSectionAction, diskForce), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadSchFn     = useCallback(mkSectionLoader<AdminSchedulersSection>(getAdminSchedulersSectionAction, schForce), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadStorageFn = useCallback(mkSectionLoader<AdminStorageSection>(getAdminStorageSectionAction, storageForce), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadJobsFn    = useCallback(mkSectionLoader<AdminJobsSection>(getAdminJobsSectionAction, jobsForce), []);

  const pm2Section     = useAdminAsyncSection<AdminPm2Section>({ sectionName: "PM2 Processes",         load: loadPm2Fn,     timeoutMs: 12_000, slowAfterMs: 3_000 });
  const diskSection    = useAdminAsyncSection<AdminDiskSection>({ sectionName: "Disk Usage",            load: loadDiskFn,    timeoutMs: 15_000, slowAfterMs: 4_000 });
  const schSection     = useAdminAsyncSection<AdminSchedulersSection>({ sectionName: "Schedulers",     load: loadSchFn,     timeoutMs: 12_000, slowAfterMs: 3_000 });
  const storageSection = useAdminAsyncSection<AdminStorageSection>({ sectionName: "Backup Storage",    load: loadStorageFn, timeoutMs: 15_000, slowAfterMs: 4_000 });
  const jobsSection    = useAdminAsyncSection<AdminJobsSection>({ sectionName: "Background Jobs",      load: loadJobsFn,    timeoutMs: 12_000, slowAfterMs: 3_000 });

  // ── Initial load after mount (force=false → use cache if available) ─────────

  useEffect(() => {
    pm2Section.refresh();
    diskSection.refresh();
    schSection.refresh();
    storageSection.refresh();
    jobsSection.refresh();
    // Intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Per-section retry handlers (force=true → bypass cache) ─────────────────

  const handleRetryPm2 = useCallback(() => {
    pm2Force.current = true;
    pm2Section.retry();
  }, [pm2Section]);

  const handleRetryDisk = useCallback(() => {
    diskForce.current = true;
    diskSection.retry();
  }, [diskSection]);

  const handleRetrySchedulers = useCallback(() => {
    schForce.current = true;
    schSection.retry();
  }, [schSection]);

  const handleRetryStorage = useCallback(() => {
    storageForce.current = true;
    storageSection.retry();
  }, [storageSection]);

  const handleRetryJobs = useCallback(() => {
    jobsForce.current = true;
    jobsSection.retry();
  }, [jobsSection]);

  // ── Global refresh (force all sections, run in parallel) ───────────────────

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    pm2Force.current = diskForce.current = schForce.current =
      storageForce.current = jobsForce.current = true;
    // Fire all section refreshes simultaneously
    pm2Section.refresh();
    diskSection.refresh();
    schSection.refresh();
    storageSection.refresh();
    jobsSection.refresh();
    // Refresh fast summary in background
    try {
      const { getAdminFastSummaryAction } = await import("@/app/actions/admin-health");
      const res = await getAdminFastSummaryAction(true);
      if (res.ok) setFastSummary(res.summary);
    } catch { /* non-fatal */ }
    setRefreshing(false);
  }, [pm2Section, diskSection, schSection, storageSection, jobsSection]);

  // ── Derived data for display ────────────────────────────────────────────────

  // Extract data from state for computeOverall — stale or fresh, any is fine
  const pm2Data     = pm2Section.state.data;
  const diskData    = diskSection.state.data;
  const schData     = schSection.state.data;

  const { status: overallStatus, warnings, isPartial } = computeOverall(
    fastSummary,
    pm2Data,
    diskData,
    schData,
    pm2Section.state.status    === "loading",
    diskSection.state.status   === "loading",
    schSection.state.status    === "loading",
  );

  const f = fastSummary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin Console</h1>
          {actorEmail && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Signed in as <strong>{actorEmail}</strong>
              {actorRole && <> · <span className="font-mono">{actorRole}</span></>}
            </p>
          )}
          {f && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Summary updated {fmtRelative(f.generatedAt)}
              {f.cacheStatus === "fresh" && " · cached"}
            </p>
          )}
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {refreshing
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />
          }
          Refresh
        </button>
      </div>

      {!f && (
        <div className="text-sm text-muted-foreground">Loading admin summary…</div>
      )}

      {f && (
        <>
          {/* Overall status */}
          <OverallBanner status={overallStatus} isPartial={isPartial} />

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <StatCard
              label="Projects"
              value={f.totals.projects}
              sub={`${f.totals.publishedProjects} published`}
              icon={Layers}
              href="/projects"
              accent={f.totals.projects === 0 ? undefined : "green"}
            />
            <StatCard
              label="Failed Deploys (24h)"
              value={f.deployments.failed24h}
              sub={`${f.deployments.success24h} succeeded`}
              icon={Activity}
              accent={f.deployments.failed24h > 0 ? "red" : "green"}
            />
            <StatCard
              label="Active Operations"
              value={f.operations.active}
              sub={`${f.operations.stale} stale`}
              icon={Clock}
              accent={f.operations.stale > 0 ? "yellow" : undefined}
            />
            <StatCard
              label="Disk Usage"
              value={diskData?.usagePct !== undefined ? `${diskData.usagePct}%` : diskSection.state.status === "loading" ? "…" : "—"}
              sub={
                diskData?.usedBytes !== undefined && diskData.totalBytes !== undefined
                  ? `${fmtBytes(diskData.usedBytes)} / ${fmtBytes(diskData.totalBytes)}`
                  : diskSection.state.status === "loading" ? "Loading…" : undefined
              }
              icon={HardDrive}
              accent={
                diskData?.status === "critical" ? "red"
              : diskData?.status === "warning"  ? "yellow"
              : diskData?.status === "healthy"  ? "green"
              : undefined
              }
            />
            <StatCard
              label="Scheduled Backups"
              value={f.backups.scheduledEnabled}
              sub={f.backups.projectsWithoutRecentBackup > 0
                ? `${f.backups.projectsWithoutRecentBackup} projects need backup`
                : "All projects backed up"}
              icon={Archive}
              accent={
                f.backups.scheduledFailed24h > 0          ? "red"
              : f.backups.projectsWithoutRecentBackup > 0 ? "yellow"
              : undefined
              }
            />
          </div>

          {/* Warnings */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              System Warnings
              {warnings.length > 0 && (
                <span className="ml-1 rounded-full bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 font-medium border border-yellow-200">
                  {warnings.length}
                </span>
              )}
              {isPartial && (
                <span className="ml-1 text-xs text-muted-foreground font-normal">(checking…)</span>
              )}
            </h2>
            <WarningList warnings={warnings} />
          </section>

          {/* PM2 + Disk (async) */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* PM2 */}
            <AdminSectionStatusCard
              title="PM2 Processes"
              icon={Server}
              state={pm2Section.state}
              onRetry={handleRetryPm2}
              badge={pm2Data ? <StatusBadge status={pm2Data.status} /> : undefined}
            >
              <Pm2Table processes={pm2Data?.processes ?? []} />
            </AdminSectionStatusCard>

            {/* Disk */}
            <AdminSectionStatusCard
              title="Disk Usage"
              icon={HardDrive}
              state={diskSection.state}
              onRetry={handleRetryDisk}
              badge={diskData ? <StatusBadge status={diskData.status} /> : undefined}
            >
              {diskData && (
                <div className="space-y-2 text-sm">
                  {diskData.usagePct !== undefined ? (
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>System disk</span>
                        <span>{diskData.usagePct}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            diskData.usagePct >= 90 ? "bg-red-500"
                          : diskData.usagePct >= 70 ? "bg-yellow-500"
                          : "bg-green-500",
                          )}
                          style={{ width: `${Math.min(diskData.usagePct, 100)}%` }}
                        />
                      </div>
                      {diskData.freeBytes !== undefined && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {fmtBytes(diskData.freeBytes)} free
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      System disk info unavailable (df may not be installed).
                    </p>
                  )}
                  <div className="pt-2 border-t space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Projects storage</span>
                      <span>{diskData.projectStorageBytes !== undefined ? fmtBytes(diskData.projectStorageBytes) : "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Releases storage</span>
                      <span>{diskData.releaseStorageBytes !== undefined ? fmtBytes(diskData.releaseStorageBytes) : "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Backups storage</span>
                      <span>{diskData.backupStorageBytes !== undefined ? fmtBytes(diskData.backupStorageBytes) : "—"}</span>
                    </div>
                  </div>
                </div>
              )}
            </AdminSectionStatusCard>
          </div>

          {/* Schedulers (async) + Domains & Backups (fast) */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Schedulers */}
            <AdminSectionStatusCard
              title="Background Schedulers"
              icon={CalendarClock}
              state={schSection.state}
              onRetry={handleRetrySchedulers}
            >
              {schData && (
                <>
                  <SchedulerRow label="Alert scheduler"  s={schData.alerts} />
                  <SchedulerRow label="Backup scheduler" s={schData.backups} />
                </>
              )}
            </AdminSectionStatusCard>

            {/* Domains + Backups (from fast summary) */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Domains &amp; Backups
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Total domains</span>
                  <span>{f.domains.total}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Active domains</span>
                  <span className="text-green-700">{f.domains.active}</span>
                </div>
                {f.domains.errored > 0 && (
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Errored domains</span>
                    <span className="text-red-600">{f.domains.errored}</span>
                  </div>
                )}
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Ready backups</span>
                  <span>{f.totals.backups}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Scheduled enabled</span>
                  <span>{f.backups.scheduledEnabled}</span>
                </div>
                {f.backups.scheduledFailed24h > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Backup failures (24h)</span>
                    <span className="text-red-600">{f.backups.scheduledFailed24h}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Storage section (async) */}
          <AdminSectionStatusCard
            title="Backup Storage"
            icon={HardDrive}
            state={storageSection.state}
            onRetry={handleRetryStorage}
          >
            {storageSection.state.data && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm border-b pb-2">
                  <span className="text-muted-foreground">Total backup bytes</span>
                  <span className="font-semibold">{fmtBytes(storageSection.state.data.totalBackupBytes)}</span>
                </div>
                {storageSection.state.data.projectsOverRetention > 0 && (
                  <p className="text-xs text-amber-600">
                    {storageSection.state.data.projectsOverRetention} project(s) have backups exceeding retention limits.
                  </p>
                )}
                {storageSection.state.data.topProjects.length > 0 && (
                  <div className="divide-y text-xs">
                    {storageSection.state.data.topProjects.slice(0, 5).map((p) => (
                      <div key={p.projectId} className="flex items-center justify-between py-1.5 gap-2">
                        <Link
                          href={`/projects/${p.projectId}/storage`}
                          className="font-medium hover:underline truncate"
                        >
                          {p.projectName}
                        </Link>
                        <span className="shrink-0 text-muted-foreground">
                          {p.backupCount} backup(s) · {fmtBytes(p.totalBackupBytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </AdminSectionStatusCard>

          {/* Background Jobs section (async) */}
          <AdminSectionStatusCard
            title="Background Jobs"
            icon={Activity}
            state={jobsSection.state}
            onRetry={handleRetryJobs}
          >
            {jobsSection.state.data && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                  {[
                    { label: "Active",        value: jobsSection.state.data.active,    accent: jobsSection.state.data.active    > 0 ? "text-purple-600" : "text-muted-foreground" },
                    { label: "Queued",        value: jobsSection.state.data.queued,    accent: "text-muted-foreground" },
                    { label: "Failed (24h)",  value: jobsSection.state.data.failed24h, accent: jobsSection.state.data.failed24h > 0 ? "text-red-600" : "text-muted-foreground" },
                    { label: "Stale",         value: jobsSection.state.data.stale,     accent: jobsSection.state.data.stale     > 0 ? "text-yellow-600" : "text-muted-foreground" },
                    { label: "Success (24h)", value: jobsSection.state.data.success24h, accent: "text-green-600" },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className={`text-base font-semibold ${item.accent}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
                <Link
                  href="/admin/jobs"
                  className="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  View Background Jobs Dashboard
                  <ChevronRight className="h-3 w-3" />
                </Link>
                {jobsSection.state.data.warnings.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t">
                    {jobsSection.state.data.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{w.title}: {w.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </AdminSectionStatusCard>

          {/* Failed deployments (fast) */}
          {f.deployments.latestFailures.length > 0 && (
            <section className="rounded-lg border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-red-500" />
                Recent Failed Deployments
              </h2>
              <div>
                {f.deployments.latestFailures.map((d) => (
                  <FailedDeployRow key={d.deploymentId} d={d} />
                ))}
              </div>
            </section>
          )}

          {/* Recent audit events (fast) */}
          {f.recentAuditEvents.length > 0 && (
            <section className="rounded-lg border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Recent Audit Events
              </h2>
              <div>
                {f.recentAuditEvents.slice(0, 10).map((ev) => (
                  <AuditEventRow key={ev.id} ev={ev} />
                ))}
              </div>
            </section>
          )}

          {/* Quick links */}
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Quick Links
            </h2>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Manage Users",    href: "/admin/users"    },
                { label: "Background Jobs", href: "/admin/jobs"     },
                { label: "Activity Feed",   href: "/admin/activity" },
                { label: "All Projects",    href: "/projects"       },
                { label: "Published Sites", href: "/published"      },
                { label: "Security",        href: "/security"       },
                { label: "Portfolio",       href: "/portfolio"      },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  {l.label}
                  <ChevronRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
