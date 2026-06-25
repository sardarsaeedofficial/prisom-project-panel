"use client";

/**
 * components/projects/post-cutover-monitoring-panel.tsx
 *
 * Sprint 66: Post-Cutover Monitoring + Incident Response Control Room.
 *
 * Safety:
 *  - no automatic rollback
 *  - no nginx write/reload
 *  - no PM2 restart
 *  - no DB migration
 *  - no provider mutation
 *  - confirmation phrases required for live checks / incident review
 */

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, RotateCcw, Terminal,
  Download, ShieldAlert, Heart, Eye, FileText,
} from "lucide-react";
import { RequiredPermissionNote } from "@/components/projects/required-permission-badge";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import {
  generatePostCutoverMonitoringReportAction,
  runProductionHealthChecksAction,
  exportPostCutoverMonitoringReportAction,
  markIncidentReviewedAction,
} from "@/app/actions/post-cutover-monitoring";
import type {
  PostCutoverMonitoringReport,
  PostCutoverStatus,
  IncidentSeverity,
  MonitoringCheck,
  MonitoringCategory,
} from "@/lib/monitoring/post-cutover-monitoring-types";

// ── Ecommerce checklist items ─────────────────────────────────────────────────

const ECOMMERCE_ITEMS = [
  { id: "e1",  label: "Storefront loads" },
  { id: "e2",  label: "Product list loads" },
  { id: "e3",  label: "Product detail loads" },
  { id: "e4",  label: "Cart page loads" },
  { id: "e5",  label: "Checkout page loads" },
  { id: "e6",  label: "Admin login works" },
  { id: "e7",  label: "Orders page works" },
  { id: "e8",  label: "Stripe dashboard checked for errors" },
  { id: "e9",  label: "Webhook delivery reviewed" },
  { id: "e10", label: "Email provider dashboard checked" },
  { id: "e11", label: "Cloudinary media loads" },
  { id: "e12", label: "No customer complaints reported" },
];

const INCIDENT_ITEMS = [
  { id: "i1", label: "Incident severity confirmed" },
  { id: "i2", label: "Logs reviewed (PM2 + nginx)" },
  { id: "i3", label: "Failed checks identified" },
  { id: "i4", label: "Customer impact assessed" },
  { id: "i5", label: "Owner assigned" },
  { id: "i6", label: "Rollback criteria reviewed" },
  { id: "i7", label: "Backup location confirmed" },
  { id: "i8", label: "Communication drafted" },
  { id: "i9", label: "Post-fix smoke checks planned" },
];

// ── Category ordering ─────────────────────────────────────────────────────────

const CATEGORY_ORDER: MonitoringCategory[] = [
  "frontend", "api", "routing", "ssl", "database",
  "ecommerce", "external_services", "performance", "logs", "rollback", "manual",
];

const CATEGORY_LABELS: Record<MonitoringCategory, string> = {
  frontend:          "Frontend",
  api:               "API",
  routing:           "Routing",
  ssl:               "SSL",
  database:          "Database",
  ecommerce:         "Ecommerce",
  external_services: "External Services",
  performance:       "Performance",
  logs:              "Logs",
  rollback:          "Rollback",
  manual:            "Manual",
};

// ── Status helpers ─────────────────────────────────────────────────────────────

function overallBadge(status: PostCutoverStatus) {
  const map: Record<PostCutoverStatus, { variant: "success"|"warning"|"error"|"secondary"; label: string }> = {
    healthy:  { variant: "success",   label: "Healthy" },
    warning:  { variant: "warning",   label: "Warning" },
    incident: { variant: "error",     label: "Incident" },
    critical: { variant: "error",     label: "Critical" },
    unknown:  { variant: "secondary", label: "Unknown" },
  };
  const { variant, label } = map[status] ?? map.unknown;
  return <Badge variant={variant as never}>{label}</Badge>;
}

function severityBadge(severity: IncidentSeverity) {
  const map: Record<IncidentSeverity, { variant: "success"|"warning"|"error"|"secondary"; label: string }> = {
    none:     { variant: "success",   label: "None" },
    low:      { variant: "secondary", label: "Low" },
    medium:   { variant: "warning",   label: "Medium" },
    high:     { variant: "error",     label: "High" },
    critical: { variant: "error",     label: "Critical" },
  };
  const { variant, label } = map[severity] ?? map.none;
  return <Badge variant={variant as never}>{label}</Badge>;
}

function checkIcon(status: MonitoringCheck["status"]) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />;
  if (status === "fail")    return <XCircle      className="h-4 w-4 text-red-500    shrink-0 mt-0.5" />;
  if (status === "manual")  return <Clock        className="h-4 w-4 text-blue-500   shrink-0 mt-0.5" />;
  return                           <Clock        className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CategorySection({
  category,
  checks,
  projectId,
  defaultOpen,
}: {
  category:    MonitoringCategory;
  checks:      MonitoringCheck[];
  projectId:   string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warning").length;

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-lg transition-colors"
      >
        {open
          ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="flex-1 text-left">{CATEGORY_LABELS[category]}</span>
        <span className="flex gap-1">
          {failCount > 0 && <Badge variant="error"   className="text-xs">{failCount} fail</Badge>}
          {warnCount > 0 && <Badge variant="warning" className="text-xs">{warnCount} warn</Badge>}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {checks.map((c) => (
            <div key={c.id} className="flex gap-2 text-sm">
              {checkIcon(c.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium leading-snug">{c.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{c.message}</p>
                {c.url && (
                  <p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{c.url}</p>
                )}
                {c.command && (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono mt-1 block break-all">
                    {c.command}
                  </code>
                )}
                {c.warning && <p className="text-xs text-yellow-600 mt-0.5">⚠️ {c.warning}</p>}
                {c.linkHref && (
                  <Link href={c.linkHref} className="text-xs text-primary hover:underline mt-0.5 inline-block">
                    → View
                  </Link>
                )}
              </div>
              {c.httpStatus && (
                <Badge
                  variant={(c.status === "pass" ? "success" : "error") as never}
                  className="text-xs shrink-0 self-start mt-0.5"
                >
                  {c.httpStatus}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RollbackSection({
  recommendation,
}: {
  recommendation: PostCutoverMonitoringReport["rollbackRecommendation"];
}) {
  const [open, setOpen] = useState(recommendation.shouldConsiderRollback);
  return (
    <div className={`rounded-lg border ${recommendation.shouldConsiderRollback ? "border-red-300 bg-red-50/30 dark:bg-red-950/10 dark:border-red-800" : "bg-muted/30"}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-lg transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Rollback Recommendation</span>
        {recommendation.shouldConsiderRollback
          ? <Badge variant="error"   className="text-xs">Consider rollback</Badge>
          : <Badge variant="success" className="text-xs">No rollback needed</Badge>}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t pt-2 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">{recommendation.reason}</p>
          <p className="text-xs font-medium mt-2">Rollback checklist (manual steps only):</p>
          <div className="space-y-1">
            {recommendation.checklist.map((item, i) => (
              <p key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0">•</span>{item}
              </p>
            ))}
          </div>
          <p className="text-xs text-red-600 mt-1">
            ⚠️ App rollback does NOT rollback DB schema/data. Requires EXECUTE PRODUCTION ROLLBACK confirmation.
          </p>
        </div>
      )}
    </div>
  );
}

function ManualChecklist({
  items,
  title,
  done,
  setDone,
}: {
  items:   { id: string; label: string }[];
  title:   string;
  done:    Set<string>;
  setDone: (s: Set<string>) => void;
}) {
  const total   = items.length;
  const checked = items.filter((i) => done.has(i.id)).length;
  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant={checked === total ? "success" : "secondary"} className="text-xs">
          {checked} / {total}
        </Badge>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={done.has(item.id)}
              onChange={(e) => {
                const next = new Set(done);
                if (e.target.checked) next.add(item.id); else next.delete(item.id);
                setDone(next);
              }}
              className="h-3.5 w-3.5 rounded border accent-primary"
            />
            <span className={`text-xs ${done.has(item.id) ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function OperatorCommandBlock({ domain }: { domain: string }) {
  const commands = [
    `# Production health verification`,
    `curl -I https://${domain}/`,
    `curl -I https://${domain}/api/healthz`,
    `curl -I https://${domain}/non-existent-spa-route`,
    `pm2 status`,
    ``,
    `# Log review`,
    `pm2 logs --lines 100`,
    `sudo tail -f /var/log/nginx/error.log`,
  ].join("\n");

  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Operator Commands</span>
        <span className="text-xs text-muted-foreground ml-auto">documented only — not executed</span>
      </div>
      <div className="p-3">
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto leading-relaxed whitespace-pre">
          {commands}
        </pre>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PostCutoverMonitoringPanel({ projectId }: { projectId: string }) {
  const [pending, start] = useTransition();
  const inFlight         = useRef(false);

  const [report,     setReport]     = useState<PostCutoverMonitoringReport | null>(null);
  const [exportData, setExportData] = useState<{ content: string; filename: string } | null>(null);

  const [error,       setError]       = useState<string | null>(null);
  const [lastAction,  setLastAction]  = useState<string | null>(null);
  const [reviewedAt,  setReviewedAt]  = useState<string | null>(null);

  const [healthConfirm,  setHealthConfirm]  = useState("");
  const [reviewConfirm,  setReviewConfirm]  = useState("");

  const [ecommerceDone, setEcommerceDone] = useState<Set<string>>(new Set());
  const [incidentDone,  setIncidentDone]  = useState<Set<string>>(new Set());

  function run<T>(label: string, fn: () => Promise<T>, onOk: (v: T) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        onOk(res);
        setLastAction(`${label} — ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
      }
    });
  }

  const handleGenerateReport = () =>
    run("Report generated", () => generatePostCutoverMonitoringReportAction({ projectId }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setReport(res.data);
    });

  const handleHealthChecks = () => {
    if (healthConfirm !== "RUN PRODUCTION HEALTH CHECKS") {
      setError("Type RUN PRODUCTION HEALTH CHECKS exactly to confirm.");
      return;
    }
    run("Health checks complete", () => runProductionHealthChecksAction({
      projectId,
      confirmation: "RUN PRODUCTION HEALTH CHECKS",
    }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setReport(res.data);
      setHealthConfirm("");
    });
  };

  const handleExport = () =>
    run("Report exported", () => exportPostCutoverMonitoringReportAction({ projectId }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setExportData(res.data);
    });

  const handleMarkReviewed = () => {
    if (reviewConfirm !== "MARK INCIDENT REVIEWED") {
      setError("Type MARK INCIDENT REVIEWED exactly to confirm.");
      return;
    }
    run("Incident marked reviewed", () => markIncidentReviewedAction({
      projectId,
      confirmation: "MARK INCIDENT REVIEWED",
    }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setReviewedAt(res.data.reviewedAt);
      setReviewConfirm("");
    });
  };

  const domain = report
    ? (report.checks.find((c) => c.url)?.url?.replace(/^https?:\/\//, "").split("/")[0] ?? "sardar-security-project.doorstepmanchester.uk")
    : "sardar-security-project.doorstepmanchester.uk";

  // ── Group checks by category ───────────────────────────────────────────────
  const checksByCategory = CATEGORY_ORDER.reduce<Record<string, MonitoringCheck[]>>(
    (acc, cat) => {
      const items = (report?.checks ?? []).filter((c) => c.category === cat);
      if (items.length > 0) acc[cat] = items;
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Activity className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base leading-none">
            Post-Cutover Monitoring Control Room
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Monitor production health, triage incidents, and support rollback decisions after cutover.
          </p>
        </div>
        {report && (
          <div className="flex items-center gap-1.5 shrink-0">
            {overallBadge(report.status)}
            {severityBadge(report.incidentSeverity)}
          </div>
        )}
      </div>

      {/* Safety notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2 space-y-0.5">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">Monitoring only — no automatic actions</p>
        <p className="text-xs text-blue-700 dark:text-blue-400">
          No rollback, no PM2 restart, no nginx reload, no DNS change, no DB migration, no provider mutation.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Last action */}
      {lastAction && !error && (
        <p className="text-xs text-muted-foreground">✓ {lastAction}</p>
      )}

      {/* Blockers */}
      {report && report.blockers.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 dark:bg-red-950/20 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" /> Incident Findings
          </p>
          {report.blockers.map((b, i) => <p key={i} className="text-xs text-red-600">❌ {b}</p>)}
        </div>
      )}

      {/* Warnings */}
      {report && report.warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50/60 dark:bg-yellow-950/20 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Warnings</p>
          {report.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-600">⚠️ {w}</p>)}
        </div>
      )}

      {/* Summary stats */}
      {report && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            { label: "Total",   value: report.summary.total,    color: "text-foreground" },
            { label: "Passed",  value: report.summary.passed,   color: "text-green-600" },
            { label: "Warn",    value: report.summary.warnings, color: "text-yellow-600" },
            { label: "Failed",  value: report.summary.failed,   color: "text-red-600" },
            { label: "Manual",  value: report.summary.manual,   color: "text-blue-600" },
            { label: "Pending", value: report.summary.pending,  color: "text-muted-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border bg-muted/20 px-2 py-1.5 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Generating…"
          onClick={handleGenerateReport}
          size="sm"
          variant="default"
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Generate Monitoring Report
        </ActionLoadingButton>
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Exporting…"
          onClick={handleExport}
          size="sm"
          variant="outline"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export Report
        </ActionLoadingButton>
      </div>

      {/* Export download */}
      {exportData && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-xs flex-1 font-medium">{exportData.filename} ready</span>
          <CopyDownloadButton
            content={exportData.content}
            filename={exportData.filename}
            label="Download"
          />
        </div>
      )}

      {/* Production health checks */}
      <div className="rounded-lg border bg-muted/30">
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Heart className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Production Health Checks</span>
          <span className="text-xs text-muted-foreground ml-auto">GET-only</span>
        </div>
        <div className="px-3 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Runs GET checks: root, /api/healthz, SPA fallback, /products, /shop, /api/products.
            No checkout, no orders, no Stripe calls.
          </p>
          <div className="space-y-2">
            <Input
              value={healthConfirm}
              onChange={(e) => setHealthConfirm(e.target.value)}
              placeholder='Type "RUN PRODUCTION HEALTH CHECKS" to confirm'
              className="text-xs h-8 font-mono"
            />
            <ActionLoadingButton
              loading={pending}
              loadingLabel="Running health checks…"
              onClick={handleHealthChecks}
              size="sm"
              variant="outline"
              disabled={healthConfirm !== "RUN PRODUCTION HEALTH CHECKS"}
            >
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Run Production Health Checks
            </ActionLoadingButton>
          </div>
          <RequiredPermissionNote permission="deploy.trigger" />
        </div>
      </div>

      {/* Category check sections */}
      {Object.keys(checksByCategory).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Monitoring Checks
          </p>
          {CATEGORY_ORDER.map((cat) => {
            const items = checksByCategory[cat];
            if (!items || items.length === 0) return null;
            const hasLive  = ["frontend", "api", "routing"].includes(cat);
            return (
              <CategorySection
                key={cat}
                category={cat}
                checks={items}
                projectId={projectId}
                defaultOpen={hasLive && (items.some((c) => c.status === "fail" || c.status === "warning"))}
              />
            );
          })}
        </div>
      )}

      {/* Rollback recommendation */}
      {report && (
        <RollbackSection recommendation={report.rollbackRecommendation} />
      )}

      {/* Ecommerce manual checklist */}
      <ManualChecklist
        items={ECOMMERCE_ITEMS}
        title="Ecommerce Manual Health Checklist"
        done={ecommerceDone}
        setDone={setEcommerceDone}
      />

      {/* Incident response checklist */}
      <ManualChecklist
        items={INCIDENT_ITEMS}
        title="Incident Response Checklist"
        done={incidentDone}
        setDone={setIncidentDone}
      />

      {/* Mark incident reviewed */}
      <div className="rounded-lg border bg-muted/30">
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Mark Incident Reviewed</span>
        </div>
        <div className="px-3 py-3 space-y-2">
          <RequiredPermissionNote permission="deploy.trigger" />
          {reviewedAt && (
            <div className="rounded border border-green-300 bg-green-50 dark:bg-green-950/20 px-2 py-1.5">
              <p className="text-xs text-green-700 dark:text-green-400">
                ✓ Incident marked reviewed at {new Date(reviewedAt).toLocaleString()}
              </p>
            </div>
          )}
          <Input
            value={reviewConfirm}
            onChange={(e) => setReviewConfirm(e.target.value)}
            placeholder='Type "MARK INCIDENT REVIEWED" to confirm'
            className="text-xs h-8 font-mono"
          />
          <ActionLoadingButton
            loading={pending}
            loadingLabel="Recording…"
            onClick={handleMarkReviewed}
            size="sm"
            variant="outline"
            disabled={reviewConfirm !== "MARK INCIDENT REVIEWED"}
          >
            Mark Incident Reviewed
          </ActionLoadingButton>
        </div>
      </div>

      {/* Operator commands */}
      <OperatorCommandBlock domain={domain} />

      {/* Next steps */}
      {report && report.nextSteps.length > 0 && (
        <div className="rounded-lg border bg-muted/20 px-3 py-3">
          <p className="text-xs font-semibold mb-2">Next Steps</p>
          <ol className="space-y-1">
            {report.nextSteps.map((ns, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0 font-mono">{i + 1}.</span>
                {ns}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Debug/rollback links */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href={`/projects/${projectId}/logs`}         className="text-primary hover:underline">→ Logs</Link>
        <Link href={`/projects/${projectId}/releases`}     className="text-primary hover:underline">→ Releases</Link>
        <Link href={`/projects/${projectId}/backups`}      className="text-primary hover:underline">→ Backups</Link>
        <Link href={`/projects/${projectId}/operations`}   className="text-primary hover:underline">→ Operations</Link>
        <Link href={`/projects/${projectId}/domains`}      className="text-primary hover:underline">→ Domains</Link>
      </div>
    </div>
  );
}
