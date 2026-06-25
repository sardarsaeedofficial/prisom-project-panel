"use client";

/**
 * components/projects/launch-freeze-panel.tsx
 *
 * Sprint 75: Launch freeze checklist panel.
 * Read-only — freeze documentation only. No production mutation.
 */

import { useState, useTransition, useRef }      from "react";
import {
  generateLaunchFreezeReportAction,
  exportLaunchFreezeReportAction,
}                                               from "@/app/actions/launch-freeze";
import { CopyDownloadButton }                   from "@/components/common/copy-download-button";
import { ActionLoadingButton }                 from "@/components/common/action-loading-button";
import { Badge }                                from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                               from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Wrench,
  Lock, ChevronDown, ChevronUp,
}                                               from "lucide-react";
import type {
  LaunchFreezeReport,
  LaunchFreezeCheck,
  LaunchFreezeCheckCategory,
} from "@/lib/launch-freeze/launch-freeze-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: LaunchFreezeCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Wrench className={`${cls} text-blue-500`} />;
    default:        return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: LaunchFreezeReport["status"]) {
  const map = {
    not_frozen:             { variant: "secondary" as const, label: "Not Frozen" },
    freeze_recommended:     { variant: "warning"   as const, label: "Freeze Recommended" },
    frozen_pending_launch:  { variant: "success"   as const, label: "Frozen — Pending Launch" },
    blocked:                { variant: "error"     as const, label: "Blocked" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<LaunchFreezeCheckCategory, string> = {
  code:          "Code Changes",
  deployment:    "Deployment",
  database:      "Database",
  secrets:       "Secrets & Env Vars",
  routing:       "Routing & DNS",
  qa:            "QA Verification",
  team:          "Team",
  documentation: "Documentation",
  monitoring:    "Monitoring",
};

const CATEGORY_ORDER: LaunchFreezeCheckCategory[] = [
  "code", "deployment", "database", "secrets", "routing",
  "qa", "team", "documentation", "monitoring",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface LaunchFreezePanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LaunchFreezePanel({ projectId, compact }: LaunchFreezePanelProps) {
  const [report,     setReport]     = useState<LaunchFreezeReport | null>(null);
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
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
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
        const result = await generateLaunchFreezeReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        const toExpand = new Set(
          result.data.checks
            .filter((c) => c.status === "blocked" || c.status === "warning")
            .map((c) => c.category),
        );
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportLaunchFreezeReportAction({ projectId });
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
        <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Launch Freeze Checklist</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Freeze the codebase before production cutover — allowed changes, blocked changes, freeze rules.
            Export LAUNCH_FREEZE_CHECKLIST.md.{" "}
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
          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Launch Freeze Checklist</CardTitle>
          {report && statusBadge(report.status)}
        </div>
        <CardDescription>
          Verify freeze conditions, confirm allowed vs. blocked changes, and export LAUNCH_FREEZE_CHECKLIST.md.{" "}
          <span className="italic">Read-only — freeze documentation only. No production mutation.</span>
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
                {tab === "checks" ? "Freeze Checks" : tab === "allowed" ? "Allowed" : "Blocked"}
              </button>
            ))}
          </div>
        )}

        {/* Checks by category */}
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
                            {c.freezeRule && (
                              <p className="text-xs text-blue-700 dark:text-blue-300">{c.freezeRule}</p>
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

        {/* Allowed changes */}
        {report && activeTab === "allowed" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Allowed During Freeze
              </p>
              {report.allowedChanges.map((item, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                  {item}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Blocked changes */}
        {report && activeTab === "blocked" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Blocked During Freeze
              </p>
              {report.blockedChanges.map((item, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  {item}
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
            loadingLabel="Generating…"
            variant="outline"
            size="sm"
          >
            Generate Freeze Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="LAUNCH_FREEZE_CHECKLIST.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — freeze documentation only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
