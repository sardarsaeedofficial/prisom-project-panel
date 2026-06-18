"use client";

/**
 * components/projects/project-monitoring-panel.tsx
 *
 * Sprint 14: Per-project monitoring dashboard.
 *
 * Layout:
 *  - Header (title, env selector, Refresh, timestamp, severity badge)
 *  - 6-card summary grid (overall, PM2, frontend, health, DB, failures)
 *  - Unified checks table
 *  - PM2 resource detail
 *  - Endpoint detail list
 *  - Domain/SSL section
 *  - Deployment health summary
 *  - Recent warnings/errors
 *  - Session timeline (client-state only, last 10 snapshots)
 *
 * Read-only. No write/restart/rollback actions.
 * Monitoring data is on-demand, not continuous background monitoring.
 */

import { useState, useCallback, useTransition, useEffect } from "react";
import { ProjectAlertRulesPanel } from "@/components/projects/project-alert-rules-panel";
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  Cpu,
  MemoryStick,
  Globe,
  Database,
  Shield,
  Rocket,
  RotateCcw,
  ExternalLink,
  Info,
  Zap,
  ServerCrash,
} from "lucide-react";

import {
  getProjectMonitoringSnapshotAction,
  type ProjectMonitoringSnapshot,
  type MonitorSeverity,
  type MonitorCheckStatus,
} from "@/app/actions/project-monitoring";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:   string;
  projectSlug: string;
}

interface TimelinePoint {
  timestamp:          string;
  severity:           MonitorSeverity;
  frontendLatencyMs:  number | null;
  healthLatencyMs:    number | null;
  pm2Online:          boolean | null;
}

// ── Helper formatters ─────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 ** 2)    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtUptime(startedAtMs: number | null | undefined): string {
  if (startedAtMs == null) return "—";
  // If value looks like a Unix timestamp (> year 2001 in ms = 1e12)
  const durationMs = startedAtMs > 1e12
    ? Date.now() - startedAtMs
    : startedAtMs;
  if (durationMs < 0) return "—";
  const s  = Math.floor(durationMs / 1000);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  const d  = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m % 60}m`;
  if (m > 0)  return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

type ColorSet = { bg: string; text: string; border: string };

const CHECK_COLORS: Record<MonitorCheckStatus, ColorSet> = {
  pass:    { bg: "bg-green-500/10",  text: "text-green-700",     border: "border-green-400/30"  },
  warn:    { bg: "bg-amber-500/10",  text: "text-amber-700",     border: "border-amber-400/30"  },
  fail:    { bg: "bg-red-500/10",    text: "text-red-700",       border: "border-red-400/30"    },
  unknown: { bg: "bg-muted/30",      text: "text-muted-foreground", border: "border-border"     },
};

const SEVERITY_COLORS: Record<MonitorSeverity, ColorSet & { label: string }> = {
  healthy:  { bg: "bg-green-500/10",  text: "text-green-700",        border: "border-green-400/30",  label: "Healthy"  },
  warning:  { bg: "bg-amber-500/10",  text: "text-amber-700",        border: "border-amber-400/30",  label: "Warning"  },
  critical: { bg: "bg-red-500/10",    text: "text-red-700",          border: "border-red-400/30",    label: "Critical" },
  unknown:  { bg: "bg-muted/30",      text: "text-muted-foreground", border: "border-border",        label: "Unknown"  },
};

function SeverityBadge({ severity }: { severity: MonitorSeverity }) {
  const c = SEVERITY_COLORS[severity];
  const Icon =
    severity === "healthy"  ? CheckCircle2  :
    severity === "warning"  ? AlertTriangle :
    severity === "critical" ? XCircle       : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-semibold ${c.bg} ${c.text} ${c.border}`}>
      <Icon className="h-4 w-4" />
      {c.label}
    </span>
  );
}

function CheckBadge({ status }: { status: MonitorCheckStatus }) {
  const c = CHECK_COLORS[status];
  const Icon =
    status === "pass"    ? CheckCircle2  :
    status === "warn"    ? AlertTriangle :
    status === "fail"    ? XCircle       : AlertCircle;
  const label =
    status === "pass" ? "Pass" :
    status === "warn" ? "Warn" :
    status === "fail" ? "Fail" : "—";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${c.bg} ${c.text} ${c.border}`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function LatencyBadge({ ms }: { ms: number | null | undefined }) {
  if (ms == null) return <span className="text-muted-foreground text-xs">—</span>;
  const color =
    ms < 500   ? "text-green-600" :
    ms < 1500  ? "text-amber-600" :
    "text-red-600";
  return <span className={`text-xs font-mono tabular-nums ${color}`}>{fmtLatency(ms)}</span>;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  title,
  value,
  sub,
  status,
}: {
  icon:   React.ElementType;
  title:  string;
  value:  string;
  sub?:   string;
  status: MonitorCheckStatus | "active" | "offline";
}) {
  const effectiveStatus: MonitorCheckStatus =
    status === "active"  ? "pass"    :
    status === "offline" ? "fail"    : status;
  const c = CHECK_COLORS[effectiveStatus];

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-1 ${c.border} ${c.bg}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{title}</span>
      </div>
      <p className={`text-sm font-semibold ${c.text} leading-tight`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Session timeline ──────────────────────────────────────────────────────────

function SessionTimeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No session history yet — refresh to add the first point.
      </p>
    );
  }

  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1">
      {points.map((pt, i) => {
        const c = SEVERITY_COLORS[pt.severity];
        return (
          <div key={i} className="flex flex-col items-center gap-1 min-w-[40px]">
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {pt.frontendLatencyMs != null ? fmtLatency(pt.frontendLatencyMs) : "—"}
            </span>
            <div
              title={`${fmtRelTime(pt.timestamp)} · ${c.label} · frontend: ${fmtLatency(pt.frontendLatencyMs)} · health: ${fmtLatency(pt.healthLatencyMs)}`}
              className={`h-6 w-6 rounded-full border-2 flex items-center justify-center cursor-default ${c.bg} ${c.border}`}
            >
              {pt.pm2Online === false
                ? <ServerCrash className={`h-3 w-3 ${c.text}`} />
                : <Zap          className={`h-3 w-3 ${c.text}`} />}
            </div>
            <span className="text-[9px] text-muted-foreground">
              {new Date(pt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── No-config state ───────────────────────────────────────────────────────────

function NoConfigState() {
  return (
    <div className="flex flex-col items-center text-center py-10 gap-3">
      <Rocket className="h-8 w-8 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium">Monitoring needs a deployment config.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Configure Publishing first to enable monitoring.
        </p>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectMonitoringPanel({ projectId, projectSlug }: Props) {
  const [snapshot,  setSnapshot]  = useState<ProjectMonitoringSnapshot | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [env,       setEnv]       = useState<"production" | "preview" | "development">("production");
  const [timeline,  setTimeline]  = useState<TimelinePoint[]>([]);
  const [, startTransition] = useTransition();

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadSnapshot = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const res = await getProjectMonitoringSnapshotAction({ projectId, environment: env });
      setLoading(false);
      if (res.ok) {
        setSnapshot(res.data);
        // Append to session timeline (max 10 points)
        const healthEp  = res.data.endpoints.find((e) => e.name === "health" || e.name === "internal-health");
        const frontendEp = res.data.endpoints.find((e) => e.name === "frontend");
        const pt: TimelinePoint = {
          timestamp:         res.data.generatedAt,
          severity:          res.data.severity,
          frontendLatencyMs: frontendEp?.latencyMs ?? null,
          healthLatencyMs:   healthEp?.latencyMs   ?? null,
          pm2Online:         res.data.pm2.configured ? res.data.pm2.online : null,
        };
        setTimeline((prev) => [...prev.slice(-9), pt]);
      } else {
        setError(res.error);
      }
    });
  }, [projectId, env]);

  // Auto-load on mount + when env changes
  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // ── Render ────────────────────────────────────────────────────────────────

  const s = snapshot;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Monitoring</h2>
          {s && <SeverityBadge severity={s.severity} />}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value as typeof env)}
            className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none"
          >
            <option value="production">Production</option>
            <option value="preview">Preview</option>
            <option value="development">Development</option>
          </select>
          <button
            onClick={loadSnapshot}
            disabled={loading}
            className="flex items-center gap-1 text-xs border border-border rounded px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40"
          >
            {loading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Timestamp + summary */}
      {s && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">
            Updated {fmtRelTime(s.generatedAt)}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{s.summary}</span>
          <span className="text-[10px] text-muted-foreground/50 italic ml-auto">
            On-demand snapshot — not continuous monitoring.
          </span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && !s && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Running checks…
        </div>
      )}

      {/* ── No config ── */}
      {!loading && !s && !error && <NoConfigState />}

      {s && (
        <>
          {/* ── 6-card summary grid ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <SummaryCard
              icon={Activity}
              title="Overall status"
              value={SEVERITY_COLORS[s.severity].label}
              sub={s.summary.slice(0, 60)}
              status={
                s.severity === "healthy"  ? "pass"    :
                s.severity === "warning"  ? "warn"    :
                s.severity === "critical" ? "fail"    : "unknown"
              }
            />
            <SummaryCard
              icon={Zap}
              title="PM2 process"
              value={s.pm2.configured ? (s.pm2.online ? "Online" : "Offline") : "Not configured"}
              sub={s.pm2.processName ?? undefined}
              status={
                !s.pm2.configured         ? "unknown" :
                s.pm2.online              ? "pass"    : "fail"
              }
            />
            <SummaryCard
              icon={Globe}
              title="Frontend"
              value={(() => {
                const ep = s.endpoints.find((e) => e.name === "frontend");
                if (!ep || !ep.url) return "No public URL";
                if (ep.httpStatus) return `HTTP ${ep.httpStatus}`;
                if (ep.error)      return "Unreachable";
                return "Checked";
              })()}
              sub={fmtLatency(s.endpoints.find((e) => e.name === "frontend")?.latencyMs)}
              status={s.endpoints.find((e) => e.name === "frontend")?.status ?? "unknown"}
            />
            <SummaryCard
              icon={Activity}
              title="Health endpoint"
              value={(() => {
                const ep = s.endpoints.find((e) => e.name === "health" || e.name === "internal-health");
                if (!ep) return "Not checked";
                if (ep.httpStatus) return `HTTP ${ep.httpStatus}`;
                if (ep.error)      return "Unreachable";
                return "Checked";
              })()}
              sub={fmtLatency(s.endpoints.find((e) => e.name === "health" || e.name === "internal-health")?.latencyMs)}
              status={s.endpoints.find((e) => e.name === "health" || e.name === "internal-health")?.status ?? "unknown"}
            />
            <SummaryCard
              icon={Database}
              title="Database"
              value={
                !s.database.configured ? "Not configured" :
                s.database.status === "pass" ? "Connected" : "Failed"
              }
              sub={s.database.latencyMs ? fmtLatency(s.database.latencyMs) : undefined}
              status={s.database.status}
            />
            <SummaryCard
              icon={Rocket}
              title="Recent failures"
              value={`${s.deployments.recentFailureCount} failure${s.deployments.recentFailureCount !== 1 ? "s" : ""}`}
              sub={s.deployments.lastDeploymentAt ? `Last deploy ${fmtRelTime(s.deployments.lastDeploymentAt)}` : undefined}
              status={s.deployments.recentFailureCount > 0 ? "warn" : "pass"}
            />
          </div>

          {/* ── Checks table ── */}
          {s.checks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                All Checks
              </p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Check</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Message</th>
                      <th className="text-right px-3 py-2 font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.checks.map((c) => (
                      <tr key={c.key} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium">{c.label}</td>
                        <td className="px-3 py-2"><CheckBadge status={c.status} /></td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{c.message}</td>
                        <td className="px-3 py-2 text-right"><LatencyBadge ms={c.latencyMs} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── PM2 resource detail ── */}
          {s.pm2.configured && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                PM2 Process — {s.pm2.processName}
              </p>
              <div className={`rounded border p-3 ${s.pm2.online ? "border-green-400/20 bg-green-500/5" : "border-red-400/20 bg-red-500/5"}`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Metric icon={Zap}        label="Status"      value={s.pm2.status ?? "—"} />
                  <Metric icon={Clock}      label="Uptime"      value={fmtUptime(s.pm2.uptimeStartedAt)} />
                  <Metric icon={RotateCcw}  label="Restarts"    value={s.pm2.restartCount != null ? String(s.pm2.restartCount) : "—"} />
                  <Metric icon={Info}       label="PID"         value={s.pm2.pid != null ? String(s.pm2.pid) : "—"} />
                  <Metric icon={Cpu}        label="CPU"         value={s.pm2.cpuPercent != null ? `${s.pm2.cpuPercent.toFixed(1)}%` : "—"} />
                  <Metric icon={MemoryStick} label="Memory"     value={fmtBytes(s.pm2.memoryBytes)} />
                  <Metric icon={Globe}      label="Port"        value={s.pm2.port != null ? String(s.pm2.port) : "—"} />
                </div>
                {s.pm2.message && (
                  <p className="mt-2 text-xs text-muted-foreground">{s.pm2.message}</p>
                )}
              </div>
            </div>
          )}

          {/* ── Endpoint detail ── */}
          {s.endpoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Endpoint Checks
              </p>
              <div className="space-y-2">
                {s.endpoints.map((ep) => (
                  <div key={ep.name} className={`flex items-center gap-3 p-2.5 rounded border ${CHECK_COLORS[ep.status].border} ${CHECK_COLORS[ep.status].bg}`}>
                    <CheckBadge status={ep.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium capitalize">{ep.name.replace("-", " ")}</span>
                        {ep.url && (
                          <a
                            href={ep.url.startsWith("http") ? ep.url : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-mono text-muted-foreground hover:text-foreground truncate max-w-[220px] flex items-center gap-0.5"
                          >
                            {ep.url.replace(/^https?:\/\//, "").slice(0, 50)}
                            {ep.url.startsWith("http") && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
                          </a>
                        )}
                      </div>
                      {ep.error && (
                        <p className="text-[11px] text-destructive mt-0.5 truncate">{ep.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {ep.httpStatus && (
                        <span className={`font-mono tabular-nums ${
                          ep.httpStatus < 300 ? "text-green-600" :
                          ep.httpStatus < 500 ? "text-amber-600" : "text-red-600"
                        }`}>
                          {ep.httpStatus}
                        </span>
                      )}
                      <LatencyBadge ms={ep.latencyMs} />
                      <span className="text-muted-foreground/50">{ep.method}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Domain/SSL ── */}
          {s.domains.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Domains & SSL
              </p>
              <div className="space-y-1.5">
                {s.domains.map((d) => {
                  const sslOk  = d.sslStatus === "ACTIVE";
                  const active = d.status    === "ACTIVE";
                  const status: MonitorCheckStatus =
                    !active         ? "unknown" :
                    sslOk           ? "pass"    : "warn";
                  return (
                    <div
                      key={d.hostname}
                      className={`flex items-center gap-3 px-3 py-2 rounded border ${CHECK_COLORS[status].border} ${CHECK_COLORS[status].bg}`}
                    >
                      <CheckBadge status={status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono">{d.hostname}</code>
                          {d.isPrimary && (
                            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-1.5 py-0">Primary</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs shrink-0">
                        <span className={sslOk ? "text-green-600 font-medium" : "text-amber-600"}>
                          {d.sslStatus ?? "SSL unknown"}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className={active ? "text-green-600" : "text-muted-foreground"}>
                          {d.status ?? "unknown"}
                        </span>
                        {d.url && (
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── DB detail ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Database
            </p>
            <div className={`flex items-center gap-3 px-3 py-2.5 rounded border ${CHECK_COLORS[s.database.status].border} ${CHECK_COLORS[s.database.status].bg}`}>
              <CheckBadge status={s.database.status} />
              <div className="flex-1 text-xs">
                {!s.database.configured
                  ? <span className="text-muted-foreground">Database check skipped — no DATABASE_URL configured.</span>
                  : s.database.status === "pass"
                  ? <span>Connected{s.database.provider ? ` (${s.database.provider})` : ""}</span>
                  : <span className="text-destructive">{s.database.error ?? "Connection failed"}</span>}
              </div>
              {s.database.latencyMs != null && (
                <LatencyBadge ms={s.database.latencyMs} />
              )}
            </div>
          </div>

          {/* ── Secrets (key names only, no values) ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Environment Variables
            </p>
            <div className={`px-3 py-2.5 rounded border text-xs ${CHECK_COLORS[s.secrets.status].border} ${CHECK_COLORS[s.secrets.status].bg}`}>
              <div className="flex items-center gap-3">
                <CheckBadge status={s.secrets.status} />
                <span>
                  {s.secrets.totalCount} variable{s.secrets.totalCount !== 1 ? "s" : ""} configured
                  {s.secrets.presentCount > 0 && ` (${s.secrets.presentCount} of ${s.secrets.requiredCount} common keys present)`}
                </span>
                <Shield className="h-3 w-3 text-muted-foreground ml-auto" />
              </div>
              {s.secrets.missingKeys.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.secrets.missingKeys.map((k) => (
                    <span key={k} className="font-mono text-[10px] bg-background border border-border px-1.5 py-0.5 rounded">
                      {k}
                    </span>
                  ))}
                  <span className="text-[11px] text-muted-foreground self-center">not configured</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Deployment health ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Deployment Health
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric icon={Rocket}   label="Active ref"     value={s.deployments.activeDeploymentRef?.slice(0, 16) ?? "—"} mono />
              <Metric icon={Activity} label="Last status"    value={s.deployments.lastDeploymentStatus ?? "—"} />
              <Metric icon={Clock}    label="Last deploy"    value={fmtRelTime(s.deployments.lastDeploymentAt)} />
              <Metric icon={XCircle}  label="Recent failures" value={String(s.deployments.recentFailureCount)} />
              {s.deployments.lastRollbackAt && (
                <Metric icon={RotateCcw} label="Last rollback" value={fmtRelTime(s.deployments.lastRollbackAt)} />
              )}
            </div>
          </div>

          {/* ── Recent logs ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Recent Warnings & Errors
            </p>
            {s.logs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No recent warnings or errors.</p>
            ) : (
              <div className="rounded border bg-muted/20 overflow-y-auto max-h-48 divide-y divide-border/50">
                {s.logs.map((l) => (
                  <div key={l.id} className="flex gap-2 px-3 py-2 text-[11px]">
                    <span className={`shrink-0 font-semibold tabular-nums ${
                      l.level === "ERROR" || l.level === "FATAL" ? "text-red-500" : "text-amber-600"
                    }`}>{l.level}</span>
                    <span className="text-muted-foreground/70 shrink-0">{fmtRelTime(l.createdAt)}</span>
                    <span className="text-muted-foreground/50 shrink-0">[{l.source}]</span>
                    <span className="break-all text-foreground/80">{l.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Session timeline ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Session Timeline
              <span className="ml-2 text-muted-foreground/50 normal-case font-normal">
                ({timeline.length}/10 snapshot{timeline.length !== 1 ? "s" : ""} this session)
              </span>
            </p>
            <SessionTimeline points={timeline} />
          </div>
        </>
      )}

      {/* ── Alert Rules (Sprint 15) — always rendered; has its own empty state ── */}
      <div className="border-t border-border/50 pt-5">
        <ProjectAlertRulesPanel projectId={projectId} />
      </div>
    </div>
  );
}

// ── Metric tile (reusable) ────────────────────────────────────────────────────

function Metric({
  icon: Icon, label, value, mono,
}: {
  icon:  React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 p-2 rounded border border-border bg-background">
      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" />{label}
      </span>
      <span className={`text-xs font-semibold ${mono ? "font-mono" : ""} truncate`}>{value}</span>
    </div>
  );
}
