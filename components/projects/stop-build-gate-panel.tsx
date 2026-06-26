"use client";

/**
 * components/projects/stop-build-gate-panel.tsx
 *
 * Sprint 77: Stop-Build Gate panel.
 * Read-only — gate documentation only. No production mutation.
 */

import { useState, useTransition, useRef }         from "react";
import {
  generateStopBuildGateReportAction,
  exportStopBuildGateReportAction,
}                                                   from "@/app/actions/stop-build";
import { CopyDownloadButton }                       from "@/components/common/copy-download-button";
import { ActionLoadingButton }                     from "@/components/common/action-loading-button";
import { Badge }                                    from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                   from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock,
  ShieldOff, ChevronDown, ChevronUp,
}                                                   from "lucide-react";
import type {
  StopBuildGateReport,
  StopBuildGateCheck,
  StopBuildDecision,
} from "@/lib/stop-build/stop-build-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: StopBuildGateCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Clock className={`${cls} text-blue-500`} />;
  }
}

function decisionBadge(decision: StopBuildDecision) {
  const map: Record<StopBuildDecision, { variant: "success" | "warning" | "secondary"; label: string }> = {
    stop_building_ready_to_launch: { variant: "success",   label: "Stop Building — Ready to Launch" },
    fix_blockers_only:             { variant: "warning",   label: "Fix Blockers Only" },
    continue_building:             { variant: "secondary", label: "Continue Building" },
  };
  const m = map[decision];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<StopBuildGateCheck["category"], string> = {
  core_platform:      "Core Platform",
  migration_workflow: "Migration Workflow",
  launch_workflow:    "Launch Workflow",
  safety:             "Safety",
  documentation:      "Documentation",
  operations:         "Operations",
  client_handover:    "Client Handover",
};

const CATEGORY_ORDER: StopBuildGateCheck["category"][] = [
  "core_platform", "migration_workflow", "launch_workflow",
  "safety", "documentation", "operations", "client_handover",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface StopBuildGatePanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function StopBuildGatePanel({ projectId, compact }: StopBuildGatePanelProps) {
  const [report,     setReport]     = useState<StopBuildGateReport | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [activeTab,  setActiveTab]  = useState<"checks" | "allowed" | "blocked">("checks");

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  function toggleCategory(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
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
        const result = await generateStopBuildGateReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        const toExpand = new Set(
          result.data.checks
            .filter((c) => c.status === "blocked" || c.status === "warning")
            .map((c) => c.category),
        );
        if (toExpand.size === 0) toExpand.add("core_platform");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportStopBuildGateReportAction({ projectId });
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
        <ShieldOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Stop-Build Gate</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Final gate decision: stop building, fix blockers, or continue. Allowed and blocked next work.
            Export STOP_BUILD_GATE.md.{" "}
            <span className="italic">Read-only. Final gate only. No production mutation.</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Stop-Build Gate</CardTitle>
          {report && decisionBadge(report.decision)}
        </div>
        <CardDescription>
          Final gate decision across all launch workflow checks. Confirms whether to stop building, fix blockers, or continue.
          Export STOP_BUILD_GATE.md.{" "}
          <span className="italic">Read-only — gate documentation only. No production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Final operator message */}
        {report && (
          <div className={[
            "rounded-lg border p-3 text-xs",
            report.decision === "stop_building_ready_to_launch"
              ? "border-green-200 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300"
              : report.blockers.length > 0
              ? "border-red-200 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"
              : "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-300",
          ].join(" ")}>
            <p className="font-semibold uppercase tracking-wide text-[10px] mb-1">Operator Message</p>
            <p>{report.finalOperatorMessage}</p>
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

        {/* Tabs */}
        {report && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit">
            {(["checks", "allowed", "blocked"] as const).map((tab) => (
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
                {tab === "checks" ? "Gate Checks" : tab === "allowed" ? "Allowed" : "Blocked"}
              </button>
            ))}
          </div>
        )}

        {/* Gate checks */}
        {report && activeTab === "checks" && (
          <div className="space-y-2">
            {CATEGORY_ORDER.map((cat) => {
              const catChecks = report.checks.filter((c) => c.category === cat);
              if (catChecks.length === 0) return null;
              const isOpen   = expanded.has(cat);
              const hasIssue = catChecks.some((c) => c.status === "blocked" || c.status === "warning");
              const passed   = catChecks.filter((c) => c.status === "pass").length;
              return (
                <div key={cat} className="rounded-lg border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {hasIssue && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                      {CATEGORY_LABELS[cat]}
                      <span className="text-xs text-muted-foreground font-normal">
                        {passed}/{catChecks.length} passed
                      </span>
                    </span>
                    {isOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                  {isOpen && (
                    <div className="divide-y border-t">
                      {catChecks.map((c) => (
                        <div key={c.id} className="px-3 py-2.5 flex items-start gap-2.5">
                          <CheckIcon status={c.status} />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-xs font-medium">
                              {c.label}
                              {c.required && (
                                <span className="ml-1.5 text-xs text-muted-foreground font-normal">required</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{c.description}</p>
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

        {/* Allowed next work */}
        {report && activeTab === "allowed" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Allowed Next Work
            </p>
            {report.allowedNextWork.map((item, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                {item}
              </p>
            ))}
          </div>
        )}

        {/* Blocked next work */}
        {report && activeTab === "blocked" && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blocked Next Work
            </p>
            {report.blockedNextWork.map((item, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                {item}
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
            loadingLabel="Running gate…"
            variant="outline"
            size="sm"
          >
            Run Stop-Build Gate
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="STOP_BUILD_GATE.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — gate documentation only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
