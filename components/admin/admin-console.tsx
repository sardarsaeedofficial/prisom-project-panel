"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { cn }                         from "@/lib/utils";
import { refreshAdminHealthAction }   from "@/app/actions/admin-health";
import type {
  AdminHealthReport,
  AdminSystemWarning,
  AdminPm2Process,
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
  if (s < 60)                 return `${s}s`;
  if (s < 3600)               return `${Math.floor(s / 60)}m`;
  if (s < 86400)              return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 60_000)           return "just now";
  if (ms < 3_600_000)        return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)       return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
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

function OverallBanner({ status }: { status: AdminHealthReport["overallStatus"] }) {
  const cfg = {
    healthy:  { bg: "bg-green-50  border-green-200",  icon: CheckCircle2,   color: "text-green-700",  label: "All systems healthy" },
    warning:  { bg: "bg-yellow-50 border-yellow-200", icon: AlertTriangle,  color: "text-yellow-700", label: "Attention required" },
    critical: { bg: "bg-red-50    border-red-200",    icon: AlertCircle,    color: "text-red-700",    label: "Critical issues detected" },
  }[status];

  const Icon = cfg.icon;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", cfg.bg)}>
      <Icon className={cn("h-5 w-5 shrink-0", cfg.color)} />
      <p className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</p>
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
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  href?: string;
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

// ── Scheduler card ────────────────────────────────────────────────────────────

function SchedulerRow({
  name,
  label,
  s,
}: {
  name: string;
  label: string;
  s: AdminHealthReport["schedulers"]["alerts"];
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
        {s.lastHeartbeatAt && (
          <span className="text-xs text-muted-foreground">
            Last tick: {fmtRelative(s.lastHeartbeatAt)}
            {s.tickCount !== undefined && ` · ${s.tickCount} ticks`}
          </span>
        )}
        {!s.lastHeartbeatAt && (
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

function AuditEventRow({ ev }: { ev: AdminHealthReport["recentAuditEvents"][number] }) {
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

function FailedDeployRow({ d }: { d: AdminHealthReport["deployments"]["latestFailures"][number] }) {
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

// ── Main component ────────────────────────────────────────────────────────────

export function AdminConsole({
  initialReport,
  actorEmail,
  actorRole,
}: {
  initialReport: AdminHealthReport | null;
  actorEmail?:   string;
  actorRole?:    string;
}) {
  const [report, setReport]       = useState<AdminHealthReport | null>(initialReport);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(async () => {
      const res = await refreshAdminHealthAction();
      if (res.ok) {
        setReport(res.report);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }

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
          {report && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last updated: {fmtRelative(report.generatedAt)}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!report && !error && (
        <div className="text-sm text-muted-foreground">Loading health report…</div>
      )}

      {report && (
        <>
          {/* Overall status */}
          <OverallBanner status={report.overallStatus} />

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <StatCard
              label="Projects"
              value={report.totals.projects}
              sub={`${report.totals.publishedProjects} published`}
              icon={Layers}
              href="/projects"
              accent={report.totals.projects === 0 ? undefined : "green"}
            />
            <StatCard
              label="Failed Deploys (24h)"
              value={report.deployments.failed24h}
              sub={`${report.deployments.success24h} succeeded`}
              icon={Activity}
              accent={report.deployments.failed24h > 0 ? "red" : "green"}
            />
            <StatCard
              label="Active Operations"
              value={report.operations.active}
              sub={`${report.operations.stale} stale`}
              icon={Clock}
              accent={report.operations.stale > 0 ? "yellow" : undefined}
            />
            <StatCard
              label="Disk Usage"
              value={report.disk.usagePct !== undefined ? `${report.disk.usagePct}%` : "—"}
              sub={report.disk.usedBytes !== undefined && report.disk.totalBytes !== undefined
                ? `${fmtBytes(report.disk.usedBytes)} / ${fmtBytes(report.disk.totalBytes)}`
                : undefined}
              icon={HardDrive}
              accent={
                report.disk.status === "critical" ? "red"
              : report.disk.status === "warning"  ? "yellow"
              : report.disk.status === "healthy"  ? "green"
              : undefined
              }
            />
            <StatCard
              label="Scheduled Backups"
              value={report.backups.scheduledEnabled}
              sub={report.backups.projectsWithoutRecentBackup > 0
                ? `${report.backups.projectsWithoutRecentBackup} projects need backup`
                : "All projects backed up"}
              icon={Archive}
              accent={report.backups.scheduledFailed24h > 0 ? "red"
                    : report.backups.projectsWithoutRecentBackup > 0 ? "yellow"
                    : undefined}
            />
          </div>

          {/* Warnings */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              System Warnings
              {report.warnings.length > 0 && (
                <span className="ml-1 rounded-full bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 font-medium border border-yellow-200">
                  {report.warnings.length}
                </span>
              )}
            </h2>
            <WarningList warnings={report.warnings} />
          </section>

          {/* Two-column: PM2 + Disk */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* PM2 */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  PM2 Processes
                </span>
                <StatusBadge status={report.pm2.status} />
              </h2>
              <Pm2Table processes={report.pm2.processes} />
            </section>

            {/* Disk */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Disk Usage
                </span>
                <StatusBadge status={report.disk.status} />
              </h2>
              <div className="space-y-2 text-sm">
                {report.disk.usagePct !== undefined && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>System disk</span>
                      <span>{report.disk.usagePct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          report.disk.usagePct >= 90 ? "bg-red-500"
                        : report.disk.usagePct >= 70 ? "bg-yellow-500"
                        : "bg-green-500",
                        )}
                        style={{ width: `${Math.min(report.disk.usagePct, 100)}%` }}
                      />
                    </div>
                    {report.disk.freeBytes !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {fmtBytes(report.disk.freeBytes)} free
                      </p>
                    )}
                  </div>
                )}
                {report.disk.usagePct === undefined && (
                  <p className="text-muted-foreground text-xs">System disk info unavailable (df may not be installed).</p>
                )}
                <div className="pt-2 border-t space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Projects storage</span>
                    <span>{report.disk.projectStorageBytes !== undefined ? fmtBytes(report.disk.projectStorageBytes) : "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Releases storage</span>
                    <span>{report.disk.releaseStorageBytes !== undefined ? fmtBytes(report.disk.releaseStorageBytes) : "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Backups storage</span>
                    <span>{report.disk.backupStorageBytes !== undefined ? fmtBytes(report.disk.backupStorageBytes) : "—"}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Two-column: Schedulers + Domains/Backups */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Schedulers */}
            <section className="rounded-lg border bg-card p-4 space-y-1">
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <CalendarClock className="h-4 w-4" />
                Background Schedulers
              </h2>
              <SchedulerRow name="alerts"  label="Alert scheduler"  s={report.schedulers.alerts} />
              <SchedulerRow name="backups" label="Backup scheduler" s={report.schedulers.backups} />
            </section>

            {/* Domains + Backups summary */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Domains &amp; Backups
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Total domains</span>
                  <span>{report.domains.total}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Active domains</span>
                  <span className="text-green-700">{report.domains.active}</span>
                </div>
                {report.domains.errored > 0 && (
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Errored domains</span>
                    <span className="text-red-600">{report.domains.errored}</span>
                  </div>
                )}
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Ready backups</span>
                  <span>{report.totals.backups}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="text-muted-foreground">Scheduled enabled</span>
                  <span>{report.backups.scheduledEnabled}</span>
                </div>
                {report.backups.scheduledFailed24h > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Backup failures (24h)</span>
                    <span className="text-red-600">{report.backups.scheduledFailed24h}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Failed deployments */}
          {report.deployments.latestFailures.length > 0 && (
            <section className="rounded-lg border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-red-500" />
                Recent Failed Deployments
              </h2>
              <div>
                {report.deployments.latestFailures.map((d) => (
                  <FailedDeployRow key={d.deploymentId} d={d} />
                ))}
              </div>
            </section>
          )}

          {/* Recent audit events */}
          {report.recentAuditEvents.length > 0 && (
            <section className="rounded-lg border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Recent Audit Events
              </h2>
              <div>
                {report.recentAuditEvents.slice(0, 10).map((ev) => (
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
                { label: "Manage Users",    href: "/admin/users" },
                { label: "All Projects",    href: "/projects"   },
                { label: "Published Sites", href: "/published"  },
                { label: "Security",        href: "/security"   },
                { label: "Portfolio",       href: "/portfolio"  },
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
