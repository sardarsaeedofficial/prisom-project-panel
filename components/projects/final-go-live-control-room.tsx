"use client";

/**
 * components/projects/final-go-live-control-room.tsx
 *
 * Sprint 63: Final Go-Live Control Room panel.
 *
 * Sections:
 *  - Generate final gate (GENERATE FINAL GO LIVE GATE)
 *  - Readiness score gauge
 *  - Category matrix with links
 *  - Blockers / warnings
 *  - Final evidence checklist (14 items, client-side)
 *  - Pre-cutover command reference (display only)
 *  - Post-cutover smoke checklist (display only)
 *  - Rollback decision checklist (display only)
 *  - Export FINAL_GO_LIVE_PACK.md
 *
 * Safety: read-only, no secrets, no production mutations.
 */

import { useState, useTransition, useRef, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Rocket,
  Wrench, ChevronDown, ChevronUp, Download, Square,
  CheckSquare, ShieldCheck, Database, Globe,
} from "lucide-react";
import { Badge }               from "@/components/ui/badge";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import {
  generateFinalGoLiveGateReportAction,
  exportFinalGoLivePackAction,
} from "@/app/actions/final-go-live";
import type {
  FinalGoLiveGateReport,
  FinalGoLiveCheck,
  FinalGoLiveCategory,
} from "@/lib/go-live/final-go-live-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function checkIcon(status: FinalGoLiveCheck["status"]) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "manual":  return <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    case "pending": return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

function overallBadge(status: FinalGoLiveGateReport["status"]) {
  const map: Record<string, string> = {
    ready:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    blocked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    unknown: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] ?? map.unknown}`}>
      {status.toUpperCase()}
    </span>
  );
}

const CATEGORY_LABELS: Record<FinalGoLiveCategory, string> = {
  source:            "Source",
  staging:           "Staging",
  ecommerce:         "Ecommerce",
  env:               "Env / Secrets",
  database:          "Database",
  external_services: "External Services",
  routing:           "Routing",
  domains:           "Domains",
  deployment:        "Deployment",
  backup:            "Backup",
  permissions:       "Permissions",
  monitoring:        "Monitoring",
  rollback:          "Rollback",
  manual:            "Manual Sign-Off",
};

const CATEGORY_ORDER: FinalGoLiveCategory[] = [
  "source", "staging", "ecommerce", "env", "database",
  "external_services", "routing", "domains", "deployment",
  "backup", "permissions", "monitoring", "rollback", "manual",
];

// ── Evidence items ─────────────────────────────────────────────────────────────

const EVIDENCE_ITEMS = [
  { id: "e1",  label: "Source intake reviewed" },
  { id: "e2",  label: "Staging trial migration reviewed (MARK TRIAL COMPLETE)" },
  { id: "e3",  label: "Ecommerce proof reviewed (MARK ECOMMERCE PROOF COMPLETE)" },
  { id: "e4",  label: "Backup/restore drill reviewed (MARK DRILL COMPLETE)" },
  { id: "e5",  label: "Team permissions reviewed" },
  { id: "e6",  label: "Env/secrets reviewed (no placeholders, no localhost)" },
  { id: "e7",  label: "Database readiness reviewed (connection test passed)" },
  { id: "e8",  label: "External services reviewed (Stripe/Cloudinary/email on staging)" },
  { id: "e9",  label: "Routing plan reviewed (nginx preview approved)" },
  { id: "e10", label: "Domain/SSL health reviewed" },
  { id: "e11", label: "Build dry run reviewed" },
  { id: "e12", label: "Rollback plan reviewed" },
  { id: "e13", label: "Debug/logs page checked" },
  { id: "e14", label: "Owner sign-off obtained" },
];

// ── Score gauge ────────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-green-600 dark:text-green-400" :
    score >= 50 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-600 dark:text-red-400";
  const bg =
    score >= 80 ? "bg-green-100 dark:bg-green-900/20" :
    score >= 50 ? "bg-yellow-100 dark:bg-yellow-900/20" :
    "bg-red-100 dark:bg-red-900/20";
  return (
    <div className={`rounded-lg ${bg} px-4 py-3 flex items-center gap-3`}>
      <div className={`text-3xl font-bold tabular-nums ${color}`}>{score}%</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Readiness Score</p>
        <p className="text-xs text-muted-foreground">
          {score >= 80 ? "Looking good — resolve manual items to reach 100%." :
           score >= 50 ? "Some required checks need attention." :
           "Multiple blockers detected — resolve before cutover."}
        </p>
      </div>
    </div>
  );
}

// ── Category row ──────────────────────────────────────────────────────────────

function CategoryRow({
  cat, checks, projectId,
}: {
  cat: FinalGoLiveCategory;
  checks: FinalGoLiveCheck[];
  projectId: string;
}) {
  const pass   = checks.filter((c) => c.status === "pass").length;
  const warn   = checks.filter((c) => c.status === "warning").length;
  const fail   = checks.filter((c) => c.status === "fail").length;
  const manual = checks.filter((c) => c.status === "manual").length;
  const [open, setOpen] = useState(false);

  const catIcon =
    fail   > 0 ? <XCircle   className="h-3.5 w-3.5 text-red-500 shrink-0" /> :
    warn   > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" /> :
    manual > 0 ? <Wrench    className="h-3.5 w-3.5 text-blue-400 shrink-0" /> :
                 <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;

  const linkHref = checks.find((c) => c.linkHref)?.linkHref;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-muted/40 transition-colors text-left"
      >
        {catIcon}
        <span className="flex-1 text-sm font-medium">{CATEGORY_LABELS[cat]}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
          {pass > 0   && <span className="text-green-600">{pass}✓</span>}
          {warn > 0   && <span className="text-yellow-600">{warn}⚠</span>}
          {fail > 0   && <span className="text-red-600">{fail}✗</span>}
          {manual > 0 && <span className="text-blue-500">{manual}M</span>}
        </div>
        {linkHref && (
          <Link
            href={linkHref}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline mr-2 whitespace-nowrap"
          >
            Open page →
          </Link>
        )}
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t divide-y divide-border">
          {checks.map((c) => (
            <div key={c.id} className="px-4 py-2.5 flex items-start gap-2">
              {checkIcon(c.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.label}</span>
                  {c.required && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">required</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>
                {c.warning && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">⚠ {c.warning}</p>
                )}
                {c.linkHref && (
                  <Link href={c.linkHref} className="text-xs text-primary hover:underline mt-0.5 inline-block">
                    → Open page
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pre/post/rollback checklists ──────────────────────────────────────────────

const PRE_CUTOVER_ITEMS = [
  "Verify live Sardar project is healthy: curl -I https://sardar-security-project.doorstepmanchester.uk/",
  "Verify panel is healthy: curl -I https://projects.doorstepmanchester.uk/login",
  "Create final backup on Backups page BEFORE cutover",
  "Review nginx config before applying routes: sudo nginx -t",
  "Check PM2 status: pm2 list",
  "Check PM2 logs: pm2 logs project-sardar-security-project --lines 20 --nostream",
  "Confirm all evidence checklist items are marked complete",
  "Team is available for cutover and rollback if needed",
];

const POST_CUTOVER_ITEMS = [
  "Production root URL returns 200",
  "Production /api/healthz returns 200",
  "SPA fallback route returns 200",
  "Product listing loads",
  "Product detail loads",
  "Cart functionality works",
  "Checkout page loads (no real payments yet)",
  "Admin login works",
  "Admin orders page accessible",
  "PM2 logs show no errors",
  "Nginx logs show no 502/503 errors",
];

const ROLLBACK_ITEMS = [
  "App rollback target selected (previous deployment ref noted)",
  "Route rollback preview reviewed (nginx .bak file confirmed)",
  "DB rollback limitation understood (schema/data NOT rolled back by app rollback)",
  "Backup location known (Backups page)",
  "Rollback owner assigned",
  "Health checks after rollback documented",
];

function OperationalChecklist({
  title, items, icon: Icon, note,
}: {
  title: string;
  items: string[];
  icon: React.FC<{ className?: string }>;
  note?: string;
}) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = useCallback((i: number) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-muted/40 transition-colors text-left"
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground mr-2">{done.size}/{items.length} done</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-1">
          {note && (
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-2 rounded bg-yellow-50 dark:bg-yellow-950/20 px-2 py-1.5">
              ⚠ {note}
            </p>
          )}
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="w-full flex items-start gap-2 py-1 text-left hover:bg-muted/30 rounded px-1 transition-colors"
            >
              {done.has(i)
                ? <CheckSquare className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                : <Square      className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
              <span className={`text-xs ${done.has(i) ? "line-through text-muted-foreground" : ""}`}>
                {item}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FinalGoLiveControlRoom({ projectId }: { projectId: string }) {
  const [report,      setReport]      = useState<FinalGoLiveGateReport | null>(null);
  const [exportData,  setExportData]  = useState<{ markdown: string; filename: string } | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [lastAction,  setLastAction]  = useState<string | null>(null);
  const [genConfirm,  setGenConfirm]  = useState("");

  const [evidenceDone, setEvidenceDone] = useState<Set<string>>(new Set());

  const [pending, start] = useTransition();
  const inFlight = useRef(false);

  // ── Generate ──────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setLastAction(null);
    const confirmation =
      genConfirm.trim().toUpperCase() === "GENERATE FINAL GO LIVE GATE"
        ? "GENERATE FINAL GO LIVE GATE"
        : undefined;
    start(async () => {
      try {
        const res = await generateFinalGoLiveGateReportAction({ projectId, confirmation });
        if (!res.ok) { setError(res.error); return; }
        setReport(res.data);
        setExportData(null);
        setGenConfirm("");
        setLastAction("Gate report generated.");
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId, genConfirm]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        const res = await exportFinalGoLivePackAction({ projectId });
        if (!res.ok) { setError(res.error); return; }
        setExportData(res.data);
        setLastAction("FINAL_GO_LIVE_PACK.md ready to download.");
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId]);

  // ── Evidence toggle ───────────────────────────────────────────────────────

  const toggleEvidence = useCallback((id: string) => {
    setEvidenceDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allEvidenceDone = EVIDENCE_ITEMS.every((e) => evidenceDone.has(e.id));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Final Go-Live Control Room</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aggregate readiness gate — Sprints 50–62. All checks must pass before production cutover.
          </p>
        </div>
        {report && overallBadge(report.status)}
      </div>

      {/* ── Safety banner ── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-200">
          <strong>Safe assessment only.</strong> Generating this report does not modify nginx, DNS, PM2, databases, or Stripe.
          Production cutover requires separate confirmation steps with your team.
        </p>
      </div>

      {/* ── Generate gate ── */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Type <code className="font-mono bg-muted px-1 rounded">GENERATE FINAL GO LIVE GATE</code> to run a full readiness assessment.
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 h-8 text-xs border rounded px-2 font-mono bg-background"
            placeholder="GENERATE FINAL GO LIVE GATE"
            value={genConfirm}
            onChange={(e) => setGenConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
            disabled={pending}
          />
          <ActionLoadingButton
            loading={pending}
            loadingLabel="Generating…"
            onClick={handleGenerate}
            size="sm"
            disabled={pending}
          >
            Generate Gate
          </ActionLoadingButton>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* ── Last action ── */}
      {lastAction && !error && (
        <p className="text-xs text-green-700 dark:text-green-400">{lastAction}</p>
      )}

      {/* ── Gate report ── */}
      {report && (
        <div className="space-y-4">
          {/* Score */}
          <ScoreGauge score={report.readinessScore} />

          {/* Summary counts */}
          <div className="grid grid-cols-5 gap-2 text-center">
            {[
              { label: "Pass",    val: report.summary.passed,   cls: "text-green-600 dark:text-green-400" },
              { label: "Warn",    val: report.summary.warnings, cls: "text-yellow-600 dark:text-yellow-400" },
              { label: "Fail",    val: report.summary.failed,   cls: "text-red-600 dark:text-red-400" },
              { label: "Manual",  val: report.summary.manual,   cls: "text-blue-500" },
              { label: "Total",   val: report.summary.total,    cls: "text-muted-foreground" },
            ].map(({ label, val, cls }) => (
              <div key={label} className="rounded-lg border px-2 py-1.5">
                <p className={`text-base font-bold tabular-nums ${cls}`}>{val}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Blockers */}
          {report.blockers.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                {report.blockers.length} Blocker{report.blockers.length > 1 ? "s" : ""} — Resolve Before Go-Live
              </p>
              {report.blockers.map((b, i) => (
                <p key={i} className="text-xs text-red-700 dark:text-red-300">• {b}</p>
              ))}
            </div>
          )}

          {/* Warnings */}
          {report.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {report.warnings.length} Warning{report.warnings.length > 1 ? "s" : ""}
              </p>
              {report.warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">• {w}</p>
              ))}
            </div>
          )}

          {/* Category matrix */}
          <div>
            <p className="text-xs font-medium mb-2">Category Readiness Matrix</p>
            <div className="space-y-1.5">
              {CATEGORY_ORDER.map((cat) => {
                const catChecks = report.checks.filter((c) => c.category === cat);
                if (catChecks.length === 0) return null;
                return (
                  <CategoryRow key={cat} cat={cat} checks={catChecks} projectId={projectId} />
                );
              })}
            </div>
          </div>

          {/* Final evidence checklist */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-medium">Final Evidence Checklist</p>
              <span className="text-xs text-muted-foreground">
                ({evidenceDone.size}/{EVIDENCE_ITEMS.length} complete)
              </span>
              {allEvidenceDone && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">All items complete ✓</span>
              )}
            </div>
            <div className="border rounded-lg divide-y divide-border">
              {EVIDENCE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleEvidence(item.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                >
                  {evidenceDone.has(item.id)
                    ? <CheckSquare className="h-4 w-4 text-green-500 shrink-0" />
                    : <Square      className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className={`text-xs ${evidenceDone.has(item.id) ? "line-through text-muted-foreground" : ""}`}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Operational checklists */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Cutover Operations</p>
            <OperationalChecklist
              title="Pre-Cutover Checklist"
              items={PRE_CUTOVER_ITEMS}
              icon={Rocket}
            />
            <OperationalChecklist
              title="Post-Cutover Smoke Checklist"
              items={POST_CUTOVER_ITEMS}
              icon={Globe}
              note="Do not place real production orders until Stripe live keys are confirmed."
            />
            <OperationalChecklist
              title="Rollback Decision Checklist"
              items={ROLLBACK_ITEMS}
              icon={Database}
              note="App rollback does NOT rollback DB schema/data. DB rollback requires restoring from a pg_dump."
            />
          </div>

          {/* Export */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Export</p>
            <div className="flex flex-wrap gap-2">
              <ActionLoadingButton
                loading={pending}
                loadingLabel="Generating pack…"
                onClick={handleExport}
                size="sm"
                variant="outline"
                disabled={pending}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Generate FINAL_GO_LIVE_PACK.md
              </ActionLoadingButton>
              {exportData && (
                <CopyDownloadButton
                  content={exportData.markdown}
                  filename={exportData.filename}
                  label="Download FINAL_GO_LIVE_PACK.md"
                />
              )}
            </div>
            {exportData && (
              <p className="text-xs text-green-700 dark:text-green-400">
                FINAL_GO_LIVE_PACK.md ready — click Download above.
              </p>
            )}
          </div>

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            Gate generated: {new Date(report.generatedAt).toLocaleString("en-GB", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
