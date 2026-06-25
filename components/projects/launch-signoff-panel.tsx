"use client";

/**
 * components/projects/launch-signoff-panel.tsx
 *
 * Sprint 74: Final launch signoff panel.
 * Read-only — documentation and signoff only. No production mutation.
 */

import { useState, useTransition, useRef }       from "react";
import {
  generateLaunchSignoffReportAction,
  exportLaunchSignoffReportAction,
}                                                from "@/app/actions/launch-signoff";
import { CopyDownloadButton }                    from "@/components/common/copy-download-button";
import { ActionLoadingButton }                  from "@/components/common/action-loading-button";
import { Badge }                                 from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Wrench,
  Flag, ChevronDown, ChevronUp,
}                                                from "lucide-react";
import type {
  LaunchSignoffReport,
  LaunchSignoffCheck,
  LaunchSignoffCheckCategory,
} from "@/lib/launch-signoff/launch-signoff-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: LaunchSignoffCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Wrench className={`${cls} text-blue-500`} />;
    default:        return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: LaunchSignoffReport["status"]) {
  const map = {
    not_started:  { variant: "secondary" as const, label: "Not Started" },
    in_progress:  { variant: "warning"   as const, label: "In Progress" },
    blocked:      { variant: "error"     as const, label: "Blocked" },
    ready:        { variant: "success"   as const, label: "Ready" },
    signed_off:   { variant: "success"   as const, label: "Signed Off" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<LaunchSignoffCheckCategory, string> = {
  qa:               "QA Verification",
  release_candidate:"Release Candidate",
  staging:          "Staging & Deployment",
  ecommerce:        "Ecommerce",
  backups:          "Backups & Recovery",
  monitoring:       "Monitoring",
  security:         "Security & Secrets",
  team:             "Team & Permissions",
  runbook:          "Operator Runbook",
  client_handover:  "Client Handover",
};

const CATEGORY_ORDER: LaunchSignoffCheckCategory[] = [
  "staging", "ecommerce", "backups", "qa", "release_candidate",
  "monitoring", "security", "team", "runbook", "client_handover",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface LaunchSignoffPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LaunchSignoffPanel({ projectId, compact }: LaunchSignoffPanelProps) {
  const [report,     setReport]     = useState<LaunchSignoffReport | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());

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
        const result = await generateLaunchSignoffReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        // Expand all categories that have blockers/warnings
        const toExpand = new Set(
          result.data.checks
            .filter((c) => c.status === "blocked" || c.status === "warning")
            .map((c) => c.category),
        );
        setExpanded(toExpand);
        // Pre-generate export
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportLaunchSignoffReportAction({ projectId });
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
        <Flag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Final Launch Signoff</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate FINAL_LAUNCH_SIGNOFF.md — score, blockers, evidence checklist, manual signoff.{" "}
            <span className="italic">Read-only. Documentation only. No production mutation.</span>
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
          <Flag className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Final Launch Signoff</CardTitle>
          {report && statusBadge(report.status)}
        </div>
        <CardDescription>
          Generate a scored signoff report across all pre-launch checks. Export FINAL_LAUNCH_SIGNOFF.md for client handover.{" "}
          <span className="italic">Read-only — no production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Score bar */}
        {report && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Required checks passed</span>
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

        {/* Checks by category */}
        {report && (
          <div className="space-y-2">
            {CATEGORY_ORDER.map((cat) => {
              const catChecks = report.checks.filter((c) => c.category === cat);
              if (catChecks.length === 0) return null;
              const isOpen = expanded.has(cat);
              const hasIssue = catChecks.some((c) => c.status === "blocked" || c.status === "warning");
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
                        {catChecks.filter((c) => c.status === "pass").length}/{catChecks.length} passed
                      </span>
                    </span>
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
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
                            {c.evidence && (
                              <p className="text-xs text-muted-foreground">
                                Evidence: <code className="text-xs">{c.evidence}</code>
                              </p>
                            )}
                            {c.nextStep && c.status !== "pass" && (
                              <p className="text-xs text-primary">{c.nextStep}</p>
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

        {/* Error */}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

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
            Generate Signoff Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="FINAL_LAUNCH_SIGNOFF.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — documentation and signoff only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
