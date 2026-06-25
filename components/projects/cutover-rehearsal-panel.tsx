"use client";

/**
 * components/projects/cutover-rehearsal-panel.tsx
 *
 * Sprint 75: Production cutover rehearsal panel.
 * Read-only — rehearsal and verification only. No production mutation.
 */

import { useState, useTransition, useRef }        from "react";
import {
  generateCutoverRehearsalReportAction,
  exportCutoverRehearsalReportAction,
}                                                 from "@/app/actions/cutover-rehearsal";
import { CopyDownloadButton }                     from "@/components/common/copy-download-button";
import { ActionLoadingButton }                   from "@/components/common/action-loading-button";
import { Badge }                                  from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                 from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Wrench,
  Rocket, ChevronDown, ChevronUp, Terminal,
}                                                 from "lucide-react";
import type {
  CutoverRehearsalReport,
  CutoverRehearsalStep,
  CutoverRehearsalPhase,
} from "@/lib/cutover-rehearsal/cutover-rehearsal-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: CutoverRehearsalStep["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Wrench className={`${cls} text-blue-500`} />;
    default:        return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: CutoverRehearsalReport["status"]) {
  const map = {
    not_started:      { variant: "secondary" as const, label: "Not Started" },
    needs_review:     { variant: "warning"   as const, label: "Needs Review" },
    blocked:          { variant: "error"     as const, label: "Blocked" },
    ready_for_launch: { variant: "success"   as const, label: "Ready for Launch" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const PHASE_LABELS: Record<CutoverRehearsalPhase, string> = {
  pre_launch: "Pre-Launch Checks",
  backup:     "Backup & Recovery",
  routing:    "Route Application",
  smoke_test: "Smoke Tests",
  ecommerce:  "Ecommerce Checks",
  monitoring: "Monitoring Setup",
  rollback:   "Rollback Readiness",
  handover:   "Client Handover",
};

const PHASE_ORDER: CutoverRehearsalPhase[] = [
  "pre_launch", "backup", "routing", "smoke_test",
  "ecommerce", "monitoring", "rollback", "handover",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface CutoverRehearsalPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CutoverRehearsalPanel({ projectId, compact }: CutoverRehearsalPanelProps) {
  const [report,     setReport]     = useState<CutoverRehearsalReport | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [showCmds,   setShowCmds]   = useState(false);
  const [showTree,   setShowTree]   = useState(false);

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  function togglePhase(phase: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function handleGenerate() {
    if (genFlight.current) return;
    genFlight.current = true;
    setError("");
    setReport(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateCutoverRehearsalReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        // Auto-expand phases with issues
        const toExpand = new Set(
          result.data.steps
            .filter((s) => s.status === "blocked" || s.status === "warning")
            .map((s) => s.phase),
        );
        if (toExpand.size === 0) toExpand.add("pre_launch");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportCutoverRehearsalReportAction({ projectId });
            if (exp.ok) setExportData(exp.data.markdown);
          } finally {
            expFlight.current = false;
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unexpected error.");
      } finally {
        genFlight.current = false;
      }
    });
  }

  // ── Compact card ──────────────────────────────────────────────────────────

  if (compact) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
        <Rocket className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Production Cutover Rehearsal</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run a final rehearsal across all pre-launch checks before production cutover.
            Export FINAL_CUTOVER_REHEARSAL.md.{" "}
            <span className="italic">Read-only. No production mutation.</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Production Cutover Rehearsal</CardTitle>
          {report && statusBadge(report.status)}
        </div>
        <CardDescription>
          Step-by-step rehearsal across pre-launch, backup, routing, smoke tests, and rollback.
          Export FINAL_CUTOVER_REHEARSAL.md with operator commands and rollback decision tree.{" "}
          <span className="italic">Read-only — no production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Score bar */}
        {report && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Required steps passed</span>
              <span className="font-medium text-foreground">{report.score}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  report.score === 100 ? "bg-green-500" : report.score >= 60 ? "bg-yellow-500" : "bg-red-500",
                ].join(" ")}
                style={{ width: `${report.score}%` }}
              />
            </div>
          </div>
        )}

        {/* Blockers */}
        {report && report.blockers.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
              {report.blockers.length} Blocker{report.blockers.length > 1 ? "s" : ""}
            </p>
            {report.blockers.map((b, i) => (
              <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {b}
              </p>
            ))}
          </div>
        )}

        {/* Warnings */}
        {report && report.warnings.length > 0 && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">
              {report.warnings.length} Warning{report.warnings.length > 1 ? "s" : ""}
            </p>
            {report.warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {w}
              </p>
            ))}
          </div>
        )}

        {/* Rehearsal steps by phase */}
        {report && (
          <div className="space-y-2">
            {PHASE_ORDER.map((phase) => {
              const phaseSteps = report.steps.filter((s) => s.phase === phase);
              if (phaseSteps.length === 0) return null;
              const isOpen   = expanded.has(phase);
              const hasIssue = phaseSteps.some((s) => s.status === "blocked" || s.status === "warning");
              const passed   = phaseSteps.filter((s) => s.status === "pass").length;
              return (
                <div key={phase} className="rounded-lg border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => togglePhase(phase)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {hasIssue && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                      {PHASE_LABELS[phase]}
                      <span className="text-xs text-muted-foreground font-normal">
                        {passed}/{phaseSteps.length} passed
                      </span>
                    </span>
                    {isOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                  {isOpen && (
                    <div className="divide-y border-t">
                      {phaseSteps.map((s) => (
                        <div key={s.id} className="px-3 py-2.5 flex items-start gap-2.5">
                          <StepIcon status={s.status} />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-xs font-medium">
                              {s.label}
                              {s.required && (
                                <span className="ml-1.5 text-xs text-muted-foreground font-normal">required</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{s.description}</p>
                            {s.command && (
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded block mt-0.5 font-mono">
                                {s.command}
                              </code>
                            )}
                            {s.evidence && (
                              <p className="text-xs text-muted-foreground">
                                Evidence: <code className="text-xs">{s.evidence}</code>
                              </p>
                            )}
                            {s.safetyNote && s.status !== "pass" && (
                              <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                {s.safetyNote}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Operator commands */}
        {report && report.operatorCommands.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCmds((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                Operator Commands ({report.operatorCommands.length})
              </span>
              {showCmds ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {showCmds && (
              <div className="border-t p-3 space-y-1">
                {report.operatorCommands.map((cmd, i) => (
                  <code key={i} className="text-xs bg-muted px-2 py-1 rounded block font-mono text-foreground">
                    {cmd}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rollback decision tree */}
        {report && report.rollbackDecisionTree.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTree((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              <span className="font-medium">Rollback Decision Tree</span>
              {showTree ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {showTree && (
              <div className="border-t p-3 space-y-1">
                {report.rollbackDecisionTree.map((line, i) => (
                  <p key={i} className="text-xs text-foreground">{line}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Final go/no-go questions */}
        {report && report.finalGoNoGoQuestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Final Go / No-Go Questions
            </p>
            <div className="space-y-1">
              {report.finalGoNoGoQuestions.map((q, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground shrink-0">•</span>
                  {q}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <ActionLoadingButton
            type="button"
            onClick={handleGenerate}
            loading={genPending}
            loadingLabel="Running rehearsal…"
            variant="outline"
            size="sm"
          >
            Generate Rehearsal Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="FINAL_CUTOVER_REHEARSAL.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — rehearsal and verification only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
