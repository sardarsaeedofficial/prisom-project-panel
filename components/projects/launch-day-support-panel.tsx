"use client";

/**
 * components/projects/launch-day-support-panel.tsx
 *
 * Sprint 76: Launch-Day Execution Support panel.
 * Read-only — evidence collection and manual operator support only.
 * No production mutation.
 */

import { useState, useTransition, useRef }         from "react";
import {
  generateLaunchDaySupportReportAction,
  exportLaunchDaySupportReportAction,
}                                                   from "@/app/actions/launch-day";
import { CopyDownloadButton }                       from "@/components/common/copy-download-button";
import { ActionLoadingButton }                     from "@/components/common/action-loading-button";
import { Badge }                                    from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                   from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Wrench,
  CalendarCheck, ChevronDown, ChevronUp, Terminal, ListChecks,
}                                                   from "lucide-react";
import type {
  LaunchDaySupportReport,
  LaunchDayTimelineItem,
  LaunchDayStatus,
} from "@/lib/launch-day/launch-day-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function TimelineIcon({ status }: { status: LaunchDayTimelineItem["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Wrench className={`${cls} text-blue-500`} />;
    default:        return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: LaunchDayStatus) {
  const map: Record<LaunchDayStatus, { variant: "secondary" | "warning" | "error" | "success"; label: string }> = {
    not_started:         { variant: "secondary", label: "Not Started" },
    pre_launch:          { variant: "warning",   label: "Pre-Launch" },
    launch_in_progress:  { variant: "warning",   label: "Launch In Progress" },
    monitoring:          { variant: "warning",   label: "Monitoring" },
    stabilizing:         { variant: "warning",   label: "Stabilizing" },
    complete:            { variant: "success",   label: "Complete" },
    blocked:             { variant: "error",     label: "Blocked" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const PHASE_LABELS: Record<LaunchDayTimelineItem["phase"], string> = {
  pre_launch:      "Pre-Launch",
  cutover:         "Cutover",
  smoke_test:      "Smoke Tests",
  ecommerce:       "Ecommerce Checks",
  monitoring:      "Monitoring",
  client_handover: "Client Handover",
  post_launch:     "Post-Launch",
};

const PHASE_ORDER: LaunchDayTimelineItem["phase"][] = [
  "pre_launch", "cutover", "smoke_test", "ecommerce",
  "monitoring", "client_handover", "post_launch",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface LaunchDaySupportPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LaunchDaySupportPanel({ projectId, compact }: LaunchDaySupportPanelProps) {
  const [report,      setReport]     = useState<LaunchDaySupportReport | null>(null);
  const [exportData,  setExportData] = useState<string>("");
  const [error,       setError]      = useState<string>("");
  const [expanded,    setExpanded]   = useState<Set<string>>(new Set());
  const [activeTab,   setActiveTab]  = useState<"timeline" | "checklist" | "smoke" | "rollback">("timeline");
  const [genPending,  startGen]      = useTransition();
  const [expPending,  startExp]      = useTransition();
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
    setReport(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateLaunchDaySupportReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        const toExpand = new Set(
          result.data.timeline
            .filter((t) => t.status === "blocked" || t.status === "warning")
            .map((t) => t.phase),
        );
        if (toExpand.size === 0) toExpand.add("pre_launch");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportLaunchDaySupportReportAction({ projectId });
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
        <CalendarCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Launch-Day Execution Support</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manual launch-day timeline, operator checklist, smoke commands, and rollback reminder.
            Export LAUNCH_DAY_SUPPORT_REPORT.md.{" "}
            <span className="italic">Read-only. Evidence/triage only. No production mutation.</span>
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
          <CalendarCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Launch-Day Execution Support</CardTitle>
          {report && statusBadge(report.status)}
        </div>
        <CardDescription>
          Manual timeline, operator checklist, smoke commands, and rollback reminder for launch day.
          Export LAUNCH_DAY_SUPPORT_REPORT.md.{" "}
          <span className="italic">
            Read-only — evidence collection and manual operator support only. No production mutation.
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

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

        {/* Tabs */}
        {report && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit flex-wrap">
            {(["timeline", "checklist", "smoke", "rollback"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  "text-xs px-3 py-1.5 rounded-md transition-colors",
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {tab === "timeline"  ? "Timeline"
                 : tab === "checklist" ? "Operator Checklist"
                 : tab === "smoke"     ? "Smoke Commands"
                 :                      "Rollback Reminder"}
              </button>
            ))}
          </div>
        )}

        {/* Timeline tab */}
        {report && activeTab === "timeline" && (
          <div className="space-y-2">
            {PHASE_ORDER.map((phase) => {
              const items    = report.timeline.filter((t) => t.phase === phase);
              if (items.length === 0) return null;
              const isOpen   = expanded.has(phase);
              const hasIssue = items.some((t) => t.status === "blocked" || t.status === "warning");
              const done     = items.filter((t) => t.status === "pass" || t.status === "manual").length;
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
                        {done}/{items.length} steps
                      </span>
                    </span>
                    {isOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                  {isOpen && (
                    <div className="divide-y border-t">
                      {items.map((item) => (
                        <div key={item.id} className="px-3 py-2.5 flex items-start gap-2.5">
                          <TimelineIcon status={item.status} />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-xs font-medium">
                              {item.label}
                              {item.required && (
                                <span className="ml-1.5 text-xs text-muted-foreground font-normal">required</span>
                              )}
                              {item.status === "manual" && (
                                <span className="ml-1.5 text-xs text-blue-600 font-normal">manual operator step</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                            {item.command && (
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded block mt-0.5 font-mono">
                                {item.command}
                              </code>
                            )}
                            {item.evidence && (
                              <p className="text-xs text-muted-foreground">
                                Evidence: <span className="italic">{item.evidence}</span>
                              </p>
                            )}
                            {item.operatorNote && (
                              <p className="text-xs text-muted-foreground">
                                Note: {item.operatorNote}
                              </p>
                            )}
                            {item.safetyNote && item.status !== "pass" && (
                              <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                {item.safetyNote}
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

        {/* Operator checklist tab */}
        {report && activeTab === "checklist" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              Operator Checklist
            </p>
            <div className="space-y-1">
              {report.operatorChecklist.map((item, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground shrink-0 mt-0.5">☐</span>
                  {item}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Smoke commands tab */}
        {report && activeTab === "smoke" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              Smoke Check Commands
            </p>
            <div className="space-y-1">
              {report.smokeCommands.map((cmd, i) => (
                <code key={i} className="text-xs bg-muted px-2 py-1 rounded block font-mono text-foreground">
                  {cmd}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Rollback reminder tab */}
        {report && activeTab === "rollback" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rollback Reminder
            </p>
            <div className="space-y-1">
              {report.rollbackReminder.map((line, i) => (
                <p key={i} className="text-xs text-foreground">{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Required evidence */}
        {report && report.requiredEvidence.length > 0 && activeTab === "checklist" && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Required Evidence
            </p>
            {report.requiredEvidence.map((ev, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <span className="text-muted-foreground shrink-0">☐</span>
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
            Generate Launch-Day Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="LAUNCH_DAY_SUPPORT_REPORT.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — evidence collection and manual operator support only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
