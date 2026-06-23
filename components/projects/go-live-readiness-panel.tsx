"use client";

/**
 * components/projects/go-live-readiness-panel.tsx
 *
 * Sprint 49: Unified go-live readiness panel.
 * Groups all readiness checks by category with status summary,
 * smoke check runner, and client-side manual check tracking.
 *
 * Safety:
 *  - no secrets exposed
 *  - no auto-promotion
 *  - manual marks are client-only (no DB schema change)
 */

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, Loader2,
  Play, ChevronDown, ChevronRight, ExternalLink, CheckSquare, Square,
  Rocket, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import {
  generateGoLiveReadinessAction,
  runGoLiveSmokeChecksAction,
  markManualGoLiveCheckAction,
}                                                   from "@/app/actions/project-go-live";
import type {
  GoLiveReadinessReport,
  GoLiveReadinessCheck,
  GoLiveCheckCategory,
  GoLiveSmokeReport,
  GoLiveReadinessStatus,
} from "@/lib/go-live/go-live-readiness-types";

// ── Status helpers ────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<GoLiveCheckCategory, string> = {
  deployment: "Deployment",
  release:    "Release",
  env:        "Secrets",
  database:   "Database",
  domain:     "Domain",
  routing:    "Routing",
  github:     "GitHub",
  backup:     "Backup",
  monitoring: "Monitoring",
  manual:     "Manual",
};

const CATEGORY_ORDER: GoLiveCheckCategory[] = [
  "deployment", "release", "env", "database",
  "domain", "routing", "github", "backup", "monitoring", "manual",
];

function CheckStatusIcon({ status }: { status: GoLiveReadinessCheck["status"] }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  if (status === "fail")    return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function OverallBadge({ status }: { status: GoLiveReadinessStatus }) {
  if (status === "ready")   return <Badge className="bg-green-100 text-green-800 border-green-200">Ready</Badge>;
  if (status === "warning") return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Warning</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200">Blocked</Badge>;
}

function SmokeStatusIcon({ status }: { status: "pass" | "warning" | "fail" }) {
  if (status === "pass")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
}

// ── Category group ────────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  checks,
  manualDone,
  onManualToggle,
}: {
  category:       GoLiveCheckCategory;
  checks:         GoLiveReadinessCheck[];
  manualDone:     Set<string>;
  onManualToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(
    checks.some((c) => c.status === "fail" || c.status === "warning"),
  );

  const failCount    = checks.filter((c) => c.status === "fail").length;
  const warnCount    = checks.filter((c) => c.status === "warning").length;
  const manualCount  = checks.filter((c) => c.status === "manual").length;
  const manualDoneN  = checks.filter((c) => c.status === "manual" && manualDone.has(c.id)).length;
  const passCount    = checks.filter((c) => c.status === "pass").length + manualDoneN;

  const rowColor = failCount > 0
    ? "bg-red-50/50 dark:bg-red-950/10 border-red-100"
    : warnCount > 0
    ? "bg-amber-50/50 dark:bg-amber-950/10 border-amber-100"
    : "bg-green-50/50 dark:bg-green-950/10 border-green-100";

  return (
    <div className={`rounded-md border ${rowColor}`}>
      <button
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-xs font-medium">{CATEGORY_LABEL[category]}</span>
          <span className="text-[10px] text-muted-foreground">
            {passCount}/{checks.length}
            {manualCount > 0 ? ` (${manualDoneN}/${manualCount} manual)` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {failCount > 0    && <span className="rounded px-1 py-0.5 text-[10px] bg-red-100 text-red-700">{failCount} fail</span>}
          {warnCount > 0    && <span className="rounded px-1 py-0.5 text-[10px] bg-amber-100 text-amber-700">{warnCount} warn</span>}
        </div>
      </button>

      {open && (
        <div className="divide-y border-t">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 px-3 py-2.5 bg-background">
              {c.status === "manual" ? (
                <button
                  className="mt-0.5 shrink-0"
                  onClick={() => onManualToggle(c.id)}
                  title={manualDone.has(c.id) ? "Mark as not done" : "Mark as done"}
                >
                  {manualDone.has(c.id)
                    ? <CheckSquare className="h-4 w-4 text-green-500" />
                    : <Square className="h-4 w-4 text-muted-foreground" />}
                </button>
              ) : (
                <CheckStatusIcon status={c.status} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-medium leading-snug">{c.label}</p>
                  {c.severity === "required" && c.status === "fail" && (
                    <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded">Required</span>
                  )}
                  {c.status === "manual" && manualDone.has(c.id) && (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">Done</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>
                {c.evidence && c.evidence.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {c.evidence.map((e) => (
                      <code key={e} className="text-[10px] bg-muted px-1 rounded font-mono">{e}</code>
                    ))}
                  </div>
                )}
              </div>
              {c.linkHref && (
                <Link
                  href={c.linkHref}
                  className="shrink-0 text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  Fix <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Smoke results ─────────────────────────────────────────────────────────────

function SmokeResultsPanel({ report }: { report: GoLiveSmokeReport }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
        {report.overallPass
          ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />All smoke checks passed</>
          : <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />Some smoke checks need review</>
        }
        <span className="text-[10px] text-muted-foreground ml-auto">
          {new Date(report.runAt).toLocaleTimeString("en-GB")}
        </span>
      </div>
      {report.checks.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
          <SmokeStatusIcon status={c.status} />
          <div className="flex-1 min-w-0">
            <span className="font-medium">{c.label}</span>
            {c.statusCode && <span className="text-muted-foreground ml-1">HTTP {c.statusCode}</span>}
            {c.durationMs && <span className="text-muted-foreground ml-1">{c.durationMs}ms</span>}
            <p className="text-muted-foreground">{c.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type ActiveAction = "generate" | "smoke" | null;

export function GoLiveReadinessPanel({ projectId }: { projectId: string }) {
  const [report,       setReport]       = useState<GoLiveReadinessReport | null>(null);
  const [smokeReport,  setSmokeReport]  = useState<GoLiveSmokeReport | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [expanded,     setExpanded]     = useState(false);
  const [smokeOpen,    setSmokeOpen]    = useState(false);
  const [manualDone,   setManualDone]   = useState<Set<string>>(new Set());

  // ── Generate ──────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setActiveAction("generate");
    setError(null);
    try {
      const res = await generateGoLiveReadinessAction(projectId);
      if (res.ok) {
        setReport(res.report);
        setExpanded(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Readiness check failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Smoke checks ─────────────────────────────────────────────────────────

  async function handleSmoke() {
    setActiveAction("smoke");
    setError(null);
    try {
      const res = await runGoLiveSmokeChecksAction(projectId);
      if (res.ok) {
        setSmokeReport(res.report);
        setSmokeOpen(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Smoke checks failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Manual check toggle ───────────────────────────────────────────────────

  async function handleManualToggle(checkId: string) {
    const isDone = manualDone.has(checkId);
    const next   = new Set(manualDone);
    if (isDone) {
      next.delete(checkId);
    } else {
      next.add(checkId);
    }
    setManualDone(next);
    // Record audit event (fire-and-forget)
    markManualGoLiveCheckAction({
      projectId,
      checkId,
      status: isDone ? "todo" : "done",
    }).catch(() => null);
  }

  // ── Group checks ──────────────────────────────────────────────────────────

  function groupChecks() {
    if (!report) return [];
    const map = new Map<GoLiveCheckCategory, GoLiveReadinessCheck[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const c of report.checks) {
      const arr = map.get(c.category);
      if (arr) arr.push(c);
    }
    return CATEGORY_ORDER
      .filter((cat) => (map.get(cat)?.length ?? 0) > 0)
      .map((cat) => ({ category: cat, checks: map.get(cat)! }));
  }

  const groups = groupChecks();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Go-Live Readiness</CardTitle>
            {report && <OverallBadge status={report.status} />}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            disabled={activeAction !== null}
          >
            {activeAction === "generate"
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Checking…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{report ? "Re-check" : "Check Readiness"}</>
            }
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!report && !error && (
          <p className="text-xs text-muted-foreground">
            Run a go-live readiness check to verify deployment, env, domain, database, GitHub, backup, and routing before promoting.
          </p>
        )}

        {/* ── Summary cards ── */}
        {report && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
            {[
              { label: "Pass",    value: report.summary.passed,   color: "text-green-600" },
              { label: "Warning", value: report.summary.warnings, color: "text-amber-600" },
              { label: "Fail",    value: report.summary.failed,   color: "text-destructive" },
              { label: "Manual",  value: report.summary.manual,   color: "text-muted-foreground" },
              { label: "Total",   value: report.summary.total,    color: "text-foreground" },
            ].map((s) => (
              <div key={s.label} className="rounded-md border py-2">
                <p className={`text-base font-semibold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Blockers ── */}
        {report && report.blockers.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-red-700">
              {report.blockers.length} blocker{report.blockers.length > 1 ? "s" : ""}
            </p>
            {report.blockers.map((b, i) => (
              <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
              </p>
            ))}
          </div>
        )}

        {/* ── Ready state ── */}
        {report && report.status === "ready" && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
            <p className="text-xs text-green-700 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              All required checks pass — ready to promote after completing manual checks and smoke tests.
            </p>
          </div>
        )}

        {/* ── Next steps ── */}
        {report && report.nextSteps.length > 0 && (
          <div className="space-y-1">
            {report.nextSteps.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s}
              </p>
            ))}
          </div>
        )}

        {/* ── Grouped checks ── */}
        {report && (
          <>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {expanded ? "Collapse checks" : "Expand checks"} ({groups.length} categories)
            </button>

            {expanded && (
              <div className="space-y-2">
                {groups.map(({ category, checks }) => (
                  <CategoryGroup
                    key={category}
                    category={category}
                    checks={checks}
                    manualDone={manualDone}
                    onManualToggle={handleManualToggle}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Smoke checks section ── */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Play className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Smoke Checks</span>
              {smokeReport && (
                <span className={`text-[10px] ${smokeReport.overallPass ? "text-green-600" : "text-amber-600"}`}>
                  {smokeReport.overallPass ? "Passed" : "Needs Review"}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSmoke}
              disabled={activeAction !== null}
            >
              {activeAction === "smoke"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Running…</>
                : <><Play className="h-3.5 w-3.5 mr-1.5" />{smokeReport ? "Re-run" : "Run Smoke Checks"}</>
              }
            </Button>
          </div>

          {smokeReport && (
            <>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setSmokeOpen((v) => !v)}
              >
                {smokeOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {smokeOpen ? "Hide results" : "Show results"}
              </button>
              {smokeOpen && <SmokeResultsPanel report={smokeReport} />}
            </>
          )}

          <p className="text-[10px] text-muted-foreground">
            Smoke checks do not trigger rollback automatically. Review results and decide manually.
          </p>
        </div>

        {report && (
          <p className="text-[10px] text-muted-foreground text-right border-t pt-2">
            Generated {new Date(report.generatedAt).toLocaleString("en-GB")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
