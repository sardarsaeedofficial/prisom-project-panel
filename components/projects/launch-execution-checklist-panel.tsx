"use client";

/**
 * components/projects/launch-execution-checklist-panel.tsx
 *
 * Sprint 78: Launch Execution Checklist panel.
 * Read-only — launch execution documentation only. No production mutation.
 */

import { useState, useTransition, useRef }               from "react";
import {
  generateLaunchExecutionChecklistAction,
  exportLaunchExecutionChecklistAction,
}                                                         from "@/app/actions/launch-execution";
import { CopyDownloadButton }                             from "@/components/common/copy-download-button";
import { ActionLoadingButton }                           from "@/components/common/action-loading-button";
import { Badge }                                          from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                         from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock,
  Rocket, ChevronDown, ChevronUp, ShieldCheck,
}                                                         from "lucide-react";
import type {
  LaunchExecutionChecklist,
  LaunchExecutionStep,
  LaunchExecutionStatus,
} from "@/lib/launch-execution/launch-execution-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: LaunchExecutionStep["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Clock className={`${cls} text-blue-500`} />;
    case "pending": return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: LaunchExecutionStatus) {
  const map: Record<LaunchExecutionStatus, { variant: "error" | "warning" | "success" | "secondary"; label: string }> = {
    not_started:  { variant: "secondary", label: "Not Started" },
    ready:        { variant: "success",   label: "Ready to Launch" },
    blocked:      { variant: "error",     label: "Blocked" },
    in_progress:  { variant: "warning",   label: "In Progress" },
    complete:     { variant: "success",   label: "Complete" },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const PHASE_LABELS: Record<LaunchExecutionStep["phase"], string> = {
  freeze:     "Launch Freeze",
  backup:     "Backup",
  preflight:  "Preflight",
  cutover:    "Cutover",
  smoke:      "Smoke Tests",
  ecommerce:  "Ecommerce",
  monitoring: "Monitoring",
  handover:   "Handover",
  rollback:   "Rollback",
};

const PHASE_ORDER: LaunchExecutionStep["phase"][] = [
  "freeze", "backup", "preflight", "cutover", "smoke",
  "ecommerce", "monitoring", "handover", "rollback",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface LaunchExecutionChecklistPanelProps {
  projectId: string;
  compact?: boolean;
}

type TabType = "phases" | "commands" | "gonogo" | "evidence";

// ── Main component ────────────────────────────────────────────────────────────

export function LaunchExecutionChecklistPanel({ projectId, compact }: LaunchExecutionChecklistPanelProps) {
  const [checklist,  setChecklist]  = useState<LaunchExecutionChecklist | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [activeTab,  setActiveTab]  = useState<TabType>("phases");

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  function togglePhase(phase: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  }

  function handleGenerate() {
    if (genFlight.current) return;
    genFlight.current = true;
    setError("");
    setChecklist(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateLaunchExecutionChecklistAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setChecklist(result.data);
        // Default expand first phase + any blocked phases
        const toExpand = new Set(
          result.data.steps
            .filter((s) => s.status === "blocked" || s.status === "warning")
            .map((s) => s.phase),
        );
        toExpand.add("freeze");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportLaunchExecutionChecklistAction({ projectId });
            if (exp.ok) setExportData(exp.data.markdown ?? "");
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
          <p className="text-sm font-medium">Launch Execution Checklist</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Final launch execution phases, smoke commands, rollback commands, go/no-go questions, evidence checklist.
            Export LAUNCH_EXECUTION_CHECKLIST.md.{" "}
            <span className="italic">Read-only. Launch checklist only. No production mutation.</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  const TABS: { id: TabType; label: string }[] = [
    { id: "phases",   label: "Launch Phases" },
    { id: "commands", label: "Commands" },
    { id: "gonogo",   label: "Go / No-Go" },
    { id: "evidence", label: "Evidence" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Rocket className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Launch Execution Checklist</CardTitle>
          {checklist && statusBadge(checklist.status)}
        </div>
        <CardDescription>
          Final launch execution: freeze → backup → preflight → cutover → smoke → monitoring → handover.
          Operator commands, smoke commands, rollback commands, go/no-go questions, evidence checklist.
          Export LAUNCH_EXECUTION_CHECKLIST.md.{" "}
          <span className="italic">Read-only — launch execution documentation only. No production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Blockers */}
        {checklist && checklist.blockers.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
              {checklist.blockers.length} Blocker{checklist.blockers.length > 1 ? "s" : ""} — Do not proceed
            </p>
            {checklist.blockers.map((b, i) => (
              <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {b}
              </p>
            ))}
          </div>
        )}

        {/* Safety note */}
        {checklist && checklist.status === "ready" && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-2.5 flex items-center gap-2 text-xs text-green-800 dark:text-green-300">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Ready to launch — work through each phase in order. All server commands must be run manually by an operator.
          </div>
        )}

        {/* Tabs */}
        {checklist && (
          <div className="flex gap-1 border rounded-lg p-1 flex-wrap">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "text-xs px-3 py-1.5 rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Phases tab */}
        {checklist && activeTab === "phases" && (
          <div className="space-y-2">
            {PHASE_ORDER.map((phase) => {
              const phaseSteps = checklist.steps.filter((s) => s.phase === phase);
              if (phaseSteps.length === 0) return null;
              const isOpen    = expanded.has(phase);
              const hasIssue  = phaseSteps.some((s) => s.status === "blocked" || s.status === "warning");
              const passCount = phaseSteps.filter((s) => s.status === "pass").length;
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
                        {passCount}/{phaseSteps.length} confirmed
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
                        <div key={s.id} className="px-3 py-2.5 space-y-1">
                          <div className="flex items-start gap-2">
                            <StepIcon status={s.status} />
                            <p className="text-xs font-medium leading-tight">{s.label}</p>
                          </div>
                          <p className="text-xs text-muted-foreground pl-5">{s.description}</p>
                          {s.operator && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 pl-5">Operator: {s.operator}</p>
                          )}
                          {s.command && (
                            <div className="pl-5">
                              <code className="text-xs font-mono bg-muted px-2 py-1 rounded block whitespace-pre-wrap">
                                {s.command}
                              </code>
                            </div>
                          )}
                          {s.evidence && (
                            <p className="text-xs text-green-700 dark:text-green-300 pl-5">Evidence: {s.evidence}</p>
                          )}
                          {s.safetyNote && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 pl-5 italic">Safety: {s.safetyNote}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Commands tab */}
        {checklist && activeTab === "commands" && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Operator Commands (run manually via SSH)
              </p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {checklist.operatorCommands.join("\n")}
              </pre>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Smoke Commands
              </p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {checklist.smokeCommands.join("\n")}
              </pre>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Rollback Commands (contingency — run manually)
              </p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {checklist.rollbackCommands.join("\n")}
              </pre>
            </div>
          </div>
        )}

        {/* Go/No-Go tab */}
        {checklist && activeTab === "gonogo" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Go / No-Go Questions — answer YES before proceeding to cutover
            </p>
            {checklist.goNoGoQuestions.map((q, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                {q}
              </p>
            ))}
          </div>
        )}

        {/* Evidence tab */}
        {checklist && activeTab === "evidence" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence Checklist — complete before declaring launch success
            </p>
            {checklist.evidenceChecklist.map((ev, i) => (
              <p key={i} className="text-xs font-mono text-foreground">
                {ev}
              </p>
            ))}
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
            loadingLabel="Generating…"
            variant="outline"
            size="sm"
          >
            Generate Launch Checklist
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="LAUNCH_EXECUTION_CHECKLIST.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — launch execution documentation only. No production mutation.
          All server commands must be run manually by a named operator via SSH.
        </p>
      </CardContent>
    </Card>
  );
}
