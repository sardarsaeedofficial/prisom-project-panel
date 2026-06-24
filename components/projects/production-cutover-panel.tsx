"use client";

/**
 * components/projects/production-cutover-panel.tsx
 *
 * Sprint 55: Production Cutover Assistant UI panel.
 *
 * Safety rules:
 *  - no secrets displayed
 *  - all confirmations are user-typed phrase gates
 *  - no automatic PM2/nginx/DB/DNS changes
 *  - step marks are client-side for this sprint
 */

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Flag,
  ChevronDown, ChevronRight, RotateCcw, Globe,
  Download, Loader2, ShieldCheck, Rocket,
} from "lucide-react";
import { RequiredPermissionNote } from "@/components/projects/required-permission-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import {
  generateProductionCutoverPlanAction,
  runProductionCutoverSmokeChecksAction,
  exportProductionCutoverPlanAction,
  markProductionCutoverCompleteAction,
} from "@/app/actions/production-cutover";
import type {
  ProductionCutoverPlan,
  ProductionCutoverSmokeReport,
  ProductionCutoverStage,
  ProductionCutoverStatus,
  ProductionCutoverStep,
} from "@/lib/cutover/production-cutover-types";

// ── Stage ordering ─────────────────────────────────────────────────────────────

const STAGE_ORDER: ProductionCutoverStage[] = [
  "preflight", "freeze", "backup", "database", "services",
  "routing", "external_services", "smoke_checks", "monitoring",
  "rollback", "post_go_live",
];

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusBadge(status: ProductionCutoverStatus) {
  const map: Record<ProductionCutoverStatus, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    not_started: { variant: "secondary", label: "Not Started" },
    ready:       { variant: "success",   label: "Ready" },
    warning:     { variant: "warning",   label: "Warnings" },
    blocked:     { variant: "error",     label: "Blocked" },
    in_progress: { variant: "warning",   label: "In Progress" },
    complete:    { variant: "success",   label: "Complete" },
    failed:      { variant: "error",     label: "Failed" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function stepIcon(status: ProductionCutoverStep["status"]) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "manual":  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:        return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function stageStatusIcon(status: ProductionCutoverStatus) {
  switch (status) {
    case "ready":   return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "blocked": return <XCircle className="h-4 w-4 text-red-500" />;
    default:        return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

// ── Stage row ─────────────────────────────────────────────────────────────────

function StageSection({
  stage,
  completedIds,
  onToggle,
}: {
  stage:        { stage: ProductionCutoverStage; title: string; status: ProductionCutoverStatus; steps: ProductionCutoverStep[] };
  completedIds: Set<string>;
  onToggle:     (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const manualCount  = stage.steps.filter((s) => s.status === "manual").length;
  const doneCount    = stage.steps.filter((s) => s.status === "pass" || completedIds.has(s.id)).length;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        {stageStatusIcon(stage.status)}
        <span className="flex-1 text-sm font-medium">{stage.title}</span>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{stage.steps.length} done
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t divide-y divide-border bg-muted/20">
          {stage.steps.map((step) => {
            const isDone = step.status === "pass" || completedIds.has(step.id);
            const isManual = step.status === "manual" || step.status === "pending";
            return (
              <div key={step.id} className="px-4 py-3 flex items-start gap-3">
                {isManual ? (
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => onToggle(step.id)}
                    className="mt-0.5 h-4 w-4 rounded border-border cursor-pointer shrink-0"
                  />
                ) : (
                  <div className="mt-0.5">{stepIcon(step.status)}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                    {step.title}
                    {step.required && step.status === "fail" && (
                      <span className="ml-1 text-xs text-red-600 font-normal">(required)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  {step.warning && (
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      {step.warning}
                    </p>
                  )}
                  {step.command && (
                    <code className="text-xs bg-muted px-2 py-1 rounded block mt-1.5 font-mono break-all">
                      {step.command}
                    </code>
                  )}
                  {step.evidence?.map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground font-mono mt-0.5">{e}</p>
                  ))}
                  {step.confirmationRequired && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Requires: <code className="bg-muted px-1 rounded">{step.confirmationRequired}</code>
                    </p>
                  )}
                  {step.linkHref && (
                    <Link href={step.linkHref} className="text-xs text-primary hover:underline mt-1 inline-block">
                      Open panel →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Smoke results ─────────────────────────────────────────────────────────────

function SmokeResultRow({ r }: { r: ProductionCutoverSmokeReport["results"][number] }) {
  return (
    <div className="flex items-start gap-2 py-2 text-sm">
      {r.status === "pass"
        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
        : r.status === "fail"
        ? <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
        : <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <span className="font-medium">{r.label}</span>
        {r.httpStatus && <span className="ml-1.5 text-muted-foreground text-xs">HTTP {r.httpStatus}</span>}
        <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>
      </div>
    </div>
  );
}

// ── Compact variant ───────────────────────────────────────────────────────────

function CompactPanel({ projectId }: { projectId: string }) {
  const [loading, setLoading]   = useState(false);
  const [plan,    setPlan]       = useState<ProductionCutoverPlan | null>(null);
  const [error,   setError]      = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    const result = await generateProductionCutoverPlanAction(projectId);
    if (result.ok) {
      setPlan(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  const status = plan?.status ?? "not_started";

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-3">
          <Flag className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Production Cutover Assistant</span>
              {statusBadge(status)}
            </div>
            {plan && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {plan.blockers.length > 0
                  ? `${plan.blockers.length} blocker(s) — resolve before cutover`
                  : plan.warnings.length > 0
                  ? `${plan.warnings.length} warning(s)`
                  : "Plan ready — complete manual checklist"}
              </p>
            )}
            {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline" size="sm"
              onClick={generate}
              disabled={loading}
              className="text-xs h-7"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Generate"}
            </Button>
            <Link href={`/projects/${projectId}/releases`}>
              <Button variant="ghost" size="sm" className="text-xs h-7">
                View →
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Full panel ────────────────────────────────────────────────────────────────

function FullPanel({ projectId }: { projectId: string }) {
  const [plan,             setPlan]             = useState<ProductionCutoverPlan | null>(null);
  const [smoke,            setSmoke]            = useState<ProductionCutoverSmokeReport | null>(null);
  const [completedIds,     setCompletedIds]     = useState<Set<string>>(new Set());
  const [loadingPlan,      setLoadingPlan]      = useState(false);
  const [loadingSmoke,     setLoadingSmoke]     = useState(false);
  const [loadingExport,    setLoadingExport]    = useState(false);
  const [loadingComplete,  setLoadingComplete]  = useState(false);
  const [planError,        setPlanError]        = useState<string | null>(null);
  const [smokeError,       setSmokeError]       = useState<string | null>(null);
  const [exportError,      setExportError]      = useState<string | null>(null);
  const [completeError,    setCompleteError]    = useState<string | null>(null);
  const [smokeConfirm,     setSmokeConfirm]     = useState("");
  const [completeConfirm,  setCompleteConfirm]  = useState("");
  const [completeSuccess,  setCompleteSuccess]  = useState(false);
  const [lastAction,       setLastAction]       = useState<string | null>(null);

  function toggleStep(id: string) {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function generatePlan() {
    setLoadingPlan(true);
    setPlanError(null);
    const result = await generateProductionCutoverPlanAction(projectId);
    if (result.ok) {
      setPlan(result.data);
      setLastAction("Cutover plan generated");
    } else {
      setPlanError(result.error);
    }
    setLoadingPlan(false);
  }

  async function runSmokeChecks() {
    if (smokeConfirm.trim() !== "RUN SMOKE CHECKS") return;
    setLoadingSmoke(true);
    setSmokeError(null);
    const result = await runProductionCutoverSmokeChecksAction({
      projectId,
      confirmation: "RUN SMOKE CHECKS",
    });
    if (result.ok) {
      setSmoke(result.data);
      setLastAction(`Smoke checks ${result.data.overallPass ? "passed" : "had failures"}`);
    } else {
      setSmokeError(result.error);
    }
    setSmokeConfirm("");
    setLoadingSmoke(false);
  }

  async function exportPlan() {
    setLoadingExport(true);
    setExportError(null);
    const result = await exportProductionCutoverPlanAction(projectId);
    if (result.ok) {
      const blob = new Blob([result.data.markdown], { type: "text/markdown" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "PRODUCTION_CUTOVER_PLAN.md";
      a.click();
      URL.revokeObjectURL(url);
      setLastAction("Exported PRODUCTION_CUTOVER_PLAN.md");
    } else {
      setExportError(result.error);
    }
    setLoadingExport(false);
  }

  async function markComplete() {
    if (completeConfirm.trim() !== "MARK CUTOVER COMPLETE") return;
    setLoadingComplete(true);
    setCompleteError(null);
    const result = await markProductionCutoverCompleteAction({
      projectId,
      confirmation: "MARK CUTOVER COMPLETE",
    });
    if (result.ok) {
      setCompleteSuccess(true);
      setLastAction("Production cutover marked complete");
    } else {
      setCompleteError(result.error);
    }
    setCompleteConfirm("");
    setLoadingComplete(false);
  }

  const overallStatus = plan?.status ?? "not_started";
  const orderedStages = plan
    ? STAGE_ORDER.map((s) => plan.stages.find((ps) => ps.stage === s)).filter(Boolean)
    : [];

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flag className="h-4 w-4" />
              Production Cutover Assistant
            </CardTitle>
            <div className="flex items-center gap-2">
              {statusBadge(overallStatus)}
              {lastAction && (
                <span className="text-xs text-muted-foreground">{lastAction}</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground mb-4">
            Guided checklist for production cutover. All production-changing actions require explicit confirmation.
            No routes, services, DNS, or DB migrations are changed automatically.
          </p>
          <Button
            type="button"
            onClick={generatePlan}
            disabled={loadingPlan}
            className="w-full sm:w-auto"
          >
            {loadingPlan ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
            ) : (
              <><Rocket className="h-4 w-4 mr-2" />Generate Cutover Plan</>
            )}
          </Button>
          {planError && (
            <p className="text-sm text-destructive mt-2">{planError}</p>
          )}
        </CardContent>
      </Card>

      {plan && (
        <>
          {/* ── Summary grid ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Stages",
                value: plan.stages.length,
                icon:  <Flag className="h-3.5 w-3.5 text-muted-foreground" />,
              },
              {
                label: "Blockers",
                value: plan.blockers.length,
                icon:  plan.blockers.length > 0
                  ? <XCircle className="h-3.5 w-3.5 text-red-500" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
              },
              {
                label: "Warnings",
                value: plan.warnings.length,
                icon:  plan.warnings.length > 0
                  ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
              },
              {
                label: "Manual Steps",
                value: plan.stages.reduce(
                  (n, s) => n + s.steps.filter((step) => step.status === "manual").length, 0,
                ),
                icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
              },
            ].map(({ label, value, icon }) => (
              <div key={label} className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  {icon}
                  {label}
                </div>
                <div className="text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </div>

          {/* ── Blockers ── */}
          {plan.blockers.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  {plan.blockers.length} Blocker{plan.blockers.length > 1 ? "s" : ""} — resolve before cutover
                </span>
              </div>
              <ul className="space-y-1">
                {plan.blockers.map((b, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">•</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Warnings ── */}
          {plan.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {plan.warnings.length} Warning{plan.warnings.length > 1 ? "s" : ""}
                </span>
              </div>
              <ul className="space-y-1">
                {plan.warnings.slice(0, 6).map((w, i) => (
                  <li key={i} className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Next steps ── */}
          {plan.nextSteps.length > 0 && (
            <div className="rounded-xl border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Next Steps</p>
              <ol className="space-y-1">
                {plan.nextSteps.map((ns, i) => (
                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                    <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                    {ns}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Stage checklist ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stage Checklist</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {orderedStages.map((stage) =>
                stage ? (
                  <StageSection
                    key={stage.stage}
                    stage={stage}
                    completedIds={completedIds}
                    onToggle={toggleStep}
                  />
                ) : null,
              )}
            </CardContent>
          </Card>

          {/* ── Smoke checks ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Smoke Checks
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Runs HTTP GET/HEAD checks only. No Stripe charges, no webhook mutations, no DB changes.
              </p>
              {smoke && (
                <div className="rounded-lg border bg-muted/20 divide-y divide-border">
                  <div className="px-3 py-2 flex items-center gap-2">
                    {smoke.overallPass
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <XCircle className="h-4 w-4 text-red-500" />}
                    <span className="text-sm font-medium">
                      {smoke.overallPass ? "All checks passed" : "Some checks failed"}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(smoke.runAt).toLocaleString("en-GB")}
                    </span>
                  </div>
                  <div className="px-3 divide-y divide-border">
                    {smoke.results.map((r) => (
                      <SmokeResultRow key={r.id} r={r} />
                    ))}
                  </div>
                </div>
              )}
              <RequiredPermissionNote permission="deploy.trigger or project.edit" description="Operators, Developers, Admins, and Owners can run smoke checks." />
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder='Type "RUN SMOKE CHECKS" to confirm'
                  value={smokeConfirm}
                  onChange={(e) => setSmokeConfirm(e.target.value)}
                  className="text-sm font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={runSmokeChecks}
                  disabled={loadingSmoke || smokeConfirm.trim() !== "RUN SMOKE CHECKS"}
                  className="shrink-0"
                >
                  {loadingSmoke ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</>
                  ) : (
                    <><Globe className="h-4 w-4 mr-2" />Run Smoke Checks</>
                  )}
                </Button>
              </div>
              {smokeError && <p className="text-sm text-destructive">{smokeError}</p>}
            </CardContent>
          </Card>

          {/* ── Rollback readiness ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                Rollback Readiness
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {(() => {
                const rollbackStage = plan.stages.find((s) => s.stage === "rollback");
                if (!rollbackStage) return null;
                return (
                  <>
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2">
                      <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200 flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        Application rollback does NOT automatically rollback database schema/data.
                        If your cutover included a DB migration, restore from a pre-cutover backup instead.
                      </p>
                    </div>
                    <div className="space-y-1">
                      {rollbackStage.steps.map((step) => (
                        <div key={step.id} className="flex items-start gap-2 text-sm py-1">
                          <div className="mt-0.5">{stepIcon(step.status)}</div>
                          <div>
                            <span className="font-medium">{step.title}</span>
                            <p className="text-xs text-muted-foreground">{step.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* ── Final confirmations ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Final Confirmations
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {completeSuccess ? (
                <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 px-4 py-3 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Production cutover marked complete
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                      Continue monitoring logs and metrics for 24 hours post-cutover.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Only mark cutover complete after all smoke checks pass and the system is stable.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder='Type "MARK CUTOVER COMPLETE" to confirm'
                      value={completeConfirm}
                      onChange={(e) => setCompleteConfirm(e.target.value)}
                      className="text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="default"
                      onClick={markComplete}
                      disabled={loadingComplete || completeConfirm.trim() !== "MARK CUTOVER COMPLETE"}
                      className="shrink-0"
                    >
                      {loadingComplete ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Marking…</>
                      ) : (
                        "Mark Complete"
                      )}
                    </Button>
                  </div>
                  {completeError && <p className="text-sm text-destructive">{completeError}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Export ── */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium">Export Cutover Plan</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Download PRODUCTION_CUTOVER_PLAN.md — no secrets included.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={exportPlan}
                  disabled={loadingExport}
                >
                  {loadingExport ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exporting…</>
                  ) : (
                    <><Download className="h-4 w-4 mr-2" />Export PRODUCTION_CUTOVER_PLAN.md</>
                  )}
                </Button>
              </div>
              {exportError && <p className="text-sm text-destructive mt-2">{exportError}</p>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function ProductionCutoverPanel({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?:  boolean;
}) {
  if (compact) return <CompactPanel projectId={projectId} />;
  return <FullPanel projectId={projectId} />;
}
