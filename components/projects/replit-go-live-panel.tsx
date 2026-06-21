"use client";

/**
 * components/projects/replit-go-live-panel.tsx
 *
 * Sprint 26: Go-Live Readiness panel for the Migration Assistant.
 *
 * Shows a full production-readiness checklist for an imported Replit project:
 *   - Pass/fail/warning/manual checks per category
 *   - Per-service readiness table
 *   - External tasks (Stripe, email, DNS)
 *   - Copyable go-live report (no secret values)
 *
 * Safety:
 *  - No secret values are shown anywhere
 *  - No automated external changes (Stripe/DNS/email)
 *  - No automatic deploy triggers
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Database,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Package,
  RefreshCw,
  Server,
  Shield,
  Wrench,
  XCircle,
  Info,
  CreditCard,
  Image,
  Rocket,
  CircleDot,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  checkGoLiveReadinessAction,
  recordGoLiveReportCopiedAction,
} from "@/app/actions/project-go-live";
import type {
  GoLiveReadinessReport,
  GoLiveCheck,
  GoLiveCheckStatus,
  GoLiveCheckCategory,
  GoLiveServiceCheck,
  GoLiveExternalTask,
} from "@/lib/migration/go-live-types";

// ── Status indicators ─────────────────────────────────────────────────────────

function StatusIcon({ status, size = 4 }: { status: GoLiveCheckStatus; size?: number }) {
  const cls = `h-${size} w-${size} shrink-0`;
  if (status === "pass")    return <CheckCircle2 className={`${cls} text-emerald-500`} />;
  if (status === "fail")    return <XCircle      className={`${cls} text-destructive`} />;
  if (status === "warning") return <AlertTriangle className={`${cls} text-amber-500`} />;
  if (status === "manual")  return <Info          className={`${cls} text-blue-500`} />;
  return <CircleDot className={`${cls} text-muted-foreground`} />;
}

function StatusBadge({ status }: { status: GoLiveCheckStatus }) {
  if (status === "pass")    return <Badge variant="outline" className="text-xs border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">Pass</Badge>;
  if (status === "fail")    return <Badge variant="destructive" className="text-xs">Fail</Badge>;
  if (status === "warning") return <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">Warning</Badge>;
  if (status === "manual")  return <Badge variant="outline" className="text-xs border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400">Manual</Badge>;
  return <Badge variant="secondary" className="text-xs text-muted-foreground">Skip</Badge>;
}

function OverallBadge({ status }: { status: GoLiveReadinessReport["overallStatus"] }) {
  if (status === "ready") return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <div>
        <p className="font-semibold text-emerald-700 dark:text-emerald-400">Ready to go live</p>
        <p className="text-xs text-emerald-600 dark:text-emerald-400/80">All required checks passed. Review manual tasks before deploying.</p>
      </div>
    </div>
  );
  if (status === "blocked") return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
      <XCircle className="h-5 w-5 text-destructive shrink-0" />
      <div>
        <p className="font-semibold text-destructive">Blocked — cannot go live yet</p>
        <p className="text-xs text-destructive/80">Fix all failing checks before deploying.</p>
      </div>
    </div>
  );
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-400">Needs attention before go-live</p>
        <p className="text-xs text-amber-600 dark:text-amber-400/80">Review warnings and complete manual tasks.</p>
      </div>
    </div>
  );
}

// ── Category icon ─────────────────────────────────────────────────────────────

function CategoryIcon({ cat }: { cat: GoLiveCheckCategory }) {
  const cls = "h-3.5 w-3.5 text-muted-foreground shrink-0";
  switch (cat) {
    case "backup":   return <Shield    className={cls} />;
    case "patches":  return <Wrench    className={cls} />;
    case "secrets":  return <KeyRound  className={cls} />;
    case "database": return <Database  className={cls} />;
    case "services": return <Server    className={cls} />;
    case "build":    return <Terminal  className={cls} />;
    case "domain":   return <Globe     className={cls} />;
    case "email":    return <Mail      className={cls} />;
    case "payments": return <CreditCard className={cls} />;
    case "media":    return <Image     className={cls} />;
    default:         return <Info      className={cls} />;
  }
}

// ── Single check row ──────────────────────────────────────────────────────────

function CheckRow({ c, projectId }: { c: GoLiveCheck; projectId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className={`border-b last:border-0 ${c.status === "skip" ? "opacity-50" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 py-2.5 px-1 text-left hover:bg-muted/20 transition-colors"
      >
        <StatusIcon status={c.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{c.title}</span>
            <StatusBadge status={c.status} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <CategoryIcon cat={c.category} />
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="pb-3 pl-8 pr-2 space-y-2">
          <p className="text-sm text-muted-foreground">{c.details}</p>
          {c.action && (
            <div className="flex items-center gap-2 flex-wrap">
              {c.action.href && (
                <a href={c.action.href}>
                  <Button size="sm" variant="outline" className="h-7 text-xs">{c.action.label}</Button>
                </a>
              )}
              {c.action.copyText && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs font-mono"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(c.action!.copyText!).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }).catch(() => null);
                  }}
                >
                  {copied ? <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />Copied!</> : <><ClipboardCopy className="h-3 w-3 mr-1" />{c.action.label}</>}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Checks grouped by category ────────────────────────────────────────────────

const CATEGORY_LABELS: Record<GoLiveCheckCategory, string> = {
  backup:   "Backup",
  patches:  "Portability patches",
  secrets:  "Secrets vault",
  database: "Database",
  services: "Services",
  build:    "Build validation",
  domain:   "Domain",
  email:    "Email provider",
  payments: "Payments",
  media:    "Media",
};

const CATEGORY_ORDER: GoLiveCheckCategory[] = [
  "backup", "patches", "secrets", "database",
  "services", "build", "domain", "email", "payments", "media",
];

function CheckGroup({ category, checks, projectId }: {
  category:  GoLiveCheckCategory;
  checks:    GoLiveCheck[];
  projectId: string;
}) {
  const [open, setOpen] = useState(true);
  const visible = checks.filter((c) => c.status !== "skip");
  if (visible.length === 0) return null;

  const failCount    = visible.filter((c) => c.status === "fail").length;
  const warnCount    = visible.filter((c) => c.status === "warning").length;
  const passCount    = visible.filter((c) => c.status === "pass").length;
  const manualCount  = visible.filter((c) => c.status === "manual").length;

  const groupStatus: GoLiveCheckStatus =
    failCount > 0    ? "fail" :
    warnCount > 0    ? "warning" :
    manualCount > 0  ? "manual" :
    passCount > 0    ? "pass" : "skip";

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <StatusIcon status={groupStatus} size={4} />
        <span className="text-sm font-semibold flex-1 text-left">
          {CATEGORY_LABELS[category]}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {failCount   > 0 && <span className="text-destructive">{failCount} fail</span>}
          {warnCount   > 0 && <span className="text-amber-600 dark:text-amber-400">{warnCount} warn</span>}
          {passCount   > 0 && <span className="text-emerald-600 dark:text-emerald-400">{passCount} pass</span>}
          {manualCount > 0 && <span className="text-blue-600 dark:text-blue-400">{manualCount} manual</span>}
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 divide-y-0">
          {visible.map((c) => <CheckRow key={c.id} c={c} projectId={projectId} />)}
        </div>
      )}
    </div>
  );
}

// ── Service readiness table ───────────────────────────────────────────────────

function ServiceTable({ services }: { services: GoLiveServiceCheck[] }) {
  if (services.length === 0) return null;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-muted/30 px-3 py-2 flex items-center gap-2">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Service readiness</span>
      </div>
      <div className="divide-y">
        {services.map((svc) => {
          const hasIssues = svc.issues.length > 0;
          const status: GoLiveCheckStatus =
            !svc.isEnabled ? "skip" :
            hasIssues ? (svc.lastStatus === "success" ? "warning" : "warning") :
            svc.lastStatus === "success" ? "pass" : "warning";
          return (
            <div key={svc.serviceId} className="px-3 py-2.5 flex items-start gap-3">
              <StatusIcon status={status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{svc.serviceName}</span>
                  <Badge variant={svc.serviceType === "node" ? "outline" : "secondary"} className="text-xs">
                    {svc.serviceType}
                  </Badge>
                  {svc.internalPort && (
                    <span className="text-xs text-muted-foreground">:{svc.internalPort}</span>
                  )}
                  {!svc.isEnabled && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{svc.pm2Name}</p>
                {svc.lastStatus && (
                  <span className={`text-xs ${svc.lastStatus === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    Last: {svc.lastStatus}
                  </span>
                )}
                {hasIssues && (
                  <div className="mt-1 space-y-0.5">
                    {svc.issues.map((issue, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400">• {issue}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── External tasks ────────────────────────────────────────────────────────────

function ExternalTaskCard({ task }: { task: GoLiveExternalTask }) {
  const [open, setOpen] = useState(false);

  const providerIcon: Record<string, React.ReactNode> = {
    stripe:     <CreditCard className="h-4 w-4 text-violet-500 shrink-0" />,
    email:      <Mail       className="h-4 w-4 text-blue-500 shrink-0" />,
    dns:        <Globe      className="h-4 w-4 text-emerald-500 shrink-0" />,
    database:   <Database   className="h-4 w-4 text-orange-500 shrink-0" />,
    cloudinary: <Image      className="h-4 w-4 text-pink-500 shrink-0" />,
    manual:     <Info       className="h-4 w-4 text-muted-foreground shrink-0" />,
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/20 transition-colors"
      >
        {providerIcon[task.provider]}
        <span className="text-sm font-medium flex-1 text-left">{task.title}</span>
        <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 shrink-0">
          Manual required
        </Badge>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 space-y-1.5 border-t bg-muted/10">
          <ol className="pt-2 space-y-1.5">
            {task.instructions.map((instr, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="shrink-0 font-mono text-muted-foreground/60 text-xs mt-0.5">{i + 1}.</span>
                <span className="text-muted-foreground">{instr}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Report text builder ───────────────────────────────────────────────────────

function buildGoLiveReportText(report: GoLiveReadinessReport): string {
  const lines: string[] = [
    `Go-Live Readiness Report — ${report.projectName}`,
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    `Overall: ${report.overallStatus.toUpperCase()} (${report.failCount} fail, ${report.warningCount} warn, ${report.passCount} pass)`,
    "",
    "=== CHECKS ===",
  ];

  for (const c of report.checks) {
    if (c.status === "skip") continue;
    lines.push(`[${c.status.toUpperCase().padEnd(7)}] ${c.title}`);
    lines.push(`          ${c.details}`);
    if (c.action?.copyText) lines.push(`          Command: ${c.action.copyText}`);
  }

  if (report.services.length > 0) {
    lines.push("", "=== SERVICES ===");
    for (const svc of report.services) {
      const status = svc.issues.length > 0 ? "WARN" : (svc.lastStatus === "success" ? "OK" : "PENDING");
      lines.push(`[${status.padEnd(7)}] ${svc.serviceName} (${svc.pm2Name})`);
      for (const issue of svc.issues) lines.push(`          ⚠ ${issue}`);
    }
  }

  if (report.externalTasks.length > 0) {
    lines.push("", "=== MANUAL TASKS ===");
    for (const task of report.externalTasks) {
      lines.push(`• ${task.title}`);
      task.instructions.forEach((instr, i) => lines.push(`  ${i + 1}. ${instr}`));
    }
  }

  if (report.nextCommands.length > 0) {
    lines.push("", "=== NEXT COMMANDS ===");
    report.nextCommands.forEach((cmd) => lines.push(cmd));
  }

  lines.push("", "--- Report contains no secret values ---");
  return lines.join("\n");
}

// ── Main panel ────────────────────────────────────────────────────────────────

type PanelPhase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error";  error: string }
  | { phase: "ready";  report: GoLiveReadinessReport };

export function ReplitGoLivePanel({ projectId }: { projectId: string }) {
  const [state,    setState]   = useState<PanelPhase>({ phase: "idle" });
  const [copied,   setCopied]  = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCheck() {
    setState({ phase: "loading" });
    startTransition(async () => {
      const res = await checkGoLiveReadinessAction(projectId);
      if (!res.ok) { setState({ phase: "error", error: res.error }); return; }
      setState({ phase: "ready", report: res.data });
    });
  }

  function handleCopy(report: GoLiveReadinessReport) {
    const text = buildGoLiveReportText(report);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      void recordGoLiveReportCopiedAction(projectId, report.overallStatus);
    }).catch(() => null);
  }

  if (state.phase === "idle") {
    return (
      <div className="rounded-lg border bg-muted/20 p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Rocket className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold">Go-Live Readiness Check</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Verifies backups, secrets, services, domain, API health, and external integrations before your first production deployment.
          </p>
        </div>
        <Button onClick={handleCheck} disabled={isPending}>
          {isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking…</>
            : <><Rocket className="h-4 w-4 mr-2" />Check readiness</>
          }
        </Button>
        <p className="text-xs text-muted-foreground">No secrets are read or shown. No changes are made.</p>
      </div>
    );
  }

  if (state.phase === "loading") {
    return (
      <div className="rounded-lg border bg-muted/20 p-8 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Running readiness checks…</p>
        <p className="text-xs text-muted-foreground/70">Checking services, secrets, health endpoints…</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
        <Button size="sm" variant="outline" onClick={handleCheck} disabled={isPending}>
          {isPending ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Retrying…</> : "Retry"}
        </Button>
      </div>
    );
  }

  const { report } = state;

  // Group checks by category
  const byCategory = new Map<GoLiveCheckCategory, GoLiveCheck[]>();
  for (const c of report.checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Go-Live Readiness</span>
          <span className="text-xs text-muted-foreground">
            {new Date(report.generatedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            onClick={handleCheck} disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => handleCopy(report)}
          >
            {copied
              ? <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />Copied!</>
              : <><ClipboardCopy className="h-3 w-3 mr-1" />Copy report</>
            }
          </Button>
        </div>
      </div>

      {/* Overall status */}
      <OverallBadge status={report.overallStatus} />

      {/* Summary stats */}
      <div className="flex gap-4 text-sm">
        {report.failCount > 0 && (
          <span className="flex items-center gap-1.5 text-destructive">
            <XCircle className="h-4 w-4" />{report.failCount} blocking
          </span>
        )}
        {report.warningCount > 0 && (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />{report.warningCount} warning
          </span>
        )}
        {report.passCount > 0 && (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />{report.passCount} pass
          </span>
        )}
      </div>

      {/* Checks by category */}
      <div className="space-y-2">
        {CATEGORY_ORDER.map((cat) => {
          const catChecks = byCategory.get(cat);
          if (!catChecks) return null;
          return (
            <CheckGroup
              key={cat}
              category={cat}
              checks={catChecks}
              projectId={projectId}
            />
          );
        })}
      </div>

      {/* Service table */}
      {report.services.length > 0 && (
        <ServiceTable services={report.services} />
      )}

      {/* External tasks */}
      {report.externalTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Manual tasks required outside Prisom
          </p>
          {report.externalTasks.map((task) => (
            <ExternalTaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Next commands */}
      {report.nextCommands.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recommended next commands</p>
          <div className="space-y-1">
            {report.nextCommands.map((cmd, i) => (
              <p key={i} className={`text-xs font-mono ${cmd.startsWith("#") ? "text-muted-foreground" : "text-foreground"}`}>
                {cmd}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Publishing shortcut */}
      <div className="flex gap-2 flex-wrap pt-1">
        <a href={`/projects/${projectId}/publishing`}>
          <Button variant="outline" size="sm" className="text-xs">
            <Rocket className="h-3.5 w-3.5 mr-1.5" />Open Publishing
          </Button>
        </a>
        <a href={`/projects/${projectId}/env`}>
          <Button variant="outline" size="sm" className="text-xs">
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />Open Secrets Vault
          </Button>
        </a>
        <a href={`/projects/${projectId}/backups`}>
          <Button variant="outline" size="sm" className="text-xs">
            <Shield className="h-3.5 w-3.5 mr-1.5" />Open Backups
          </Button>
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        Report generated on demand. No secret values are stored or shown. Refresh to re-check.
      </p>
    </div>
  );
}
