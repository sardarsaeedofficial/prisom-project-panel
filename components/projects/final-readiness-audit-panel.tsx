"use client";

/**
 * components/projects/final-readiness-audit-panel.tsx
 *
 * Sprint 77: Final Production Readiness Audit panel.
 * Read-only — final audit only. No production mutation.
 */

import { useState, useTransition, useRef }         from "react";
import {
  generateFinalReadinessAuditAction,
  exportFinalReadinessAuditAction,
}                                                   from "@/app/actions/final-readiness";
import { CopyDownloadButton }                       from "@/components/common/copy-download-button";
import { ActionLoadingButton }                     from "@/components/common/action-loading-button";
import { Badge }                                    from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                   from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Minus,
  ClipboardCheck, ChevronDown, ChevronUp,
}                                                   from "lucide-react";
import type {
  FinalReadinessAudit,
  FinalReadinessCheck,
  FinalReadinessCategory,
  FinalReadinessStatus,
  FinalKnownIssue,
} from "@/lib/final-readiness/final-readiness-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: FinalReadinessCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":           return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning":        return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked":        return <XCircle className={`${cls} text-red-500`} />;
    case "manual":         return <Clock className={`${cls} text-blue-500`} />;
    case "not_applicable": return <Minus className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: FinalReadinessStatus) {
  const map: Record<FinalReadinessStatus, { variant: "error" | "warning" | "success" | "secondary"; label: string }> = {
    blocked:          { variant: "error",     label: "Blocked" },
    needs_fixes:      { variant: "warning",   label: "Needs Fixes" },
    ready_to_execute: { variant: "success",   label: "Ready to Execute" },
    continue_building:{ variant: "secondary", label: "Continue Building" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<FinalReadinessCategory, string> = {
  qa:            "QA Verification",
  release:       "Release & Signoff",
  migration:     "Migration",
  staging:       "Staging & Trial",
  ecommerce:     "Ecommerce",
  routing:       "Routing & DNS",
  monitoring:    "Monitoring",
  logs:          "Logs",
  backups:       "Backups",
  security:      "Security",
  team:          "Team",
  documentation: "Documentation",
  training:      "Training",
  launch_day:    "Launch Day",
  post_launch:   "Post-Launch",
};

const CATEGORY_ORDER: FinalReadinessCategory[] = [
  "qa", "release", "migration", "staging", "ecommerce",
  "routing", "monitoring", "logs", "backups", "security",
  "team", "documentation", "training", "launch_day", "post_launch",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface FinalReadinessAuditPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function FinalReadinessAuditPanel({ projectId, compact }: FinalReadinessAuditPanelProps) {
  const [audit,      setAudit]      = useState<FinalReadinessAudit | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [activeTab,  setActiveTab]  = useState<"checks" | "issues">("checks");

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
    setAudit(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateFinalReadinessAuditAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setAudit(result.data);
        const toExpand = new Set(
          result.data.checks
            .filter((c) => c.status === "blocked" || c.status === "warning")
            .map((c) => c.category),
        );
        if (toExpand.size === 0) toExpand.add("qa");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportFinalReadinessAuditAction({ projectId });
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
        <ClipboardCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Final Production Readiness Audit</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cross-sprint readiness audit covering sprints 69–76. Known issues register, score, and final recommendation.
            Export FINAL_READINESS_AUDIT.md.{" "}
            <span className="italic">Read-only. Final audit only. No production mutation.</span>
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
          <ClipboardCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Final Production Readiness Audit</CardTitle>
          {audit && statusBadge(audit.status)}
          {audit && (
            <span className="text-xs text-muted-foreground">
              Score: {audit.score}%
            </span>
          )}
        </div>
        <CardDescription>
          Cross-sprint readiness audit covering sprints 69–76. Known issues register, score, blockers, and final recommendation.
          Export FINAL_READINESS_AUDIT.md.{" "}
          <span className="italic">Read-only — final audit only. No production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Score bar */}
        {audit && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Required checks passed / confirmed</span>
              <span className="font-medium text-foreground">{audit.score}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  audit.score === 100 ? "bg-green-500" : audit.score >= 60 ? "bg-yellow-500" : "bg-red-500",
                ].join(" ")}
                style={{ width: `${audit.score}%` }}
              />
            </div>
          </div>
        )}

        {/* Final recommendation */}
        {audit && (
          <div className={[
            "rounded-lg border p-3 text-xs",
            audit.status === "ready_to_execute"
              ? "border-green-200 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300"
              : audit.status === "blocked"
              ? "border-red-200 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"
              : "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-300",
          ].join(" ")}>
            <p className="font-semibold uppercase tracking-wide text-[10px] mb-1">Final Recommendation</p>
            <p>{audit.finalRecommendation}</p>
          </div>
        )}

        {/* Blockers */}
        {audit && audit.blockers.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
              {audit.blockers.length} Blocker{audit.blockers.length > 1 ? "s" : ""}
            </p>
            {audit.blockers.map((b, i) => (
              <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {b}
              </p>
            ))}
          </div>
        )}

        {/* Warnings */}
        {audit && audit.warnings.length > 0 && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">
              {audit.warnings.length} Warning{audit.warnings.length > 1 ? "s" : ""}
            </p>
            {audit.warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {w}
              </p>
            ))}
          </div>
        )}

        {/* Tabs */}
        {audit && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit">
            {(["checks", "issues"] as const).map((tab) => (
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
                {tab === "checks" ? "Readiness Checks" : `Known Issues (${audit.knownIssues.length})`}
              </button>
            ))}
          </div>
        )}

        {/* Checks tab */}
        {audit && activeTab === "checks" && (
          <div className="space-y-2">
            {CATEGORY_ORDER.map((cat) => {
              const catChecks = audit.checks.filter((c) => c.category === cat);
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
                        {passed}/{catChecks.filter((c) => c.status !== "not_applicable").length} confirmed
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
                              {c.status === "manual" && (
                                <span className="ml-1.5 text-xs text-blue-600 font-normal">manual confirmation</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{c.description}</p>
                            {c.evidence && (
                              <p className="text-xs text-green-700 dark:text-green-300">Evidence: {c.evidence}</p>
                            )}
                            {c.nextStep && c.status !== "pass" && (
                              <p className="text-xs text-muted-foreground">Next: {c.nextStep}</p>
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

        {/* Known issues tab */}
        {audit && activeTab === "issues" && (
          <div className="space-y-3">
            {audit.knownIssues.length === 0 ? (
              <p className="text-xs text-muted-foreground">No known issues recorded.</p>
            ) : (
              audit.knownIssues.map((ki) => (
                <KnownIssueCard key={ki.id} issue={ki} />
              ))
            )}
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
            loadingLabel="Auditing…"
            variant="outline"
            size="sm"
          >
            Generate Readiness Audit
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="FINAL_READINESS_AUDIT.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — final audit only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function KnownIssueCard({ issue }: { issue: FinalKnownIssue }) {
  const [open, setOpen] = useState(false);
  const sevColor =
    issue.severity === "critical" || issue.severity === "high"
      ? "text-red-600 dark:text-red-400"
      : issue.severity === "medium"
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-muted-foreground";
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-2 font-medium min-w-0">
          {issue.blocksLaunch
            ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
            : <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
          }
          <span className="truncate">{issue.title}</span>
          <span className={`text-xs font-normal shrink-0 ${sevColor}`}>{issue.severity}</span>
          {issue.blocksLaunch && (
            <Badge variant="error" className="text-xs shrink-0">blocks launch</Badge>
          )}
        </span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-2">
          <p className="text-xs text-muted-foreground">{issue.description}</p>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence to check</p>
            {issue.evidenceToCheck.map((ev, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <span className="text-muted-foreground shrink-0">•</span>
                {ev}
              </p>
            ))}
          </div>
          <p className="text-xs text-foreground">
            <span className="font-semibold">Recommended action:</span> {issue.recommendedAction}
          </p>
        </div>
      )}
    </div>
  );
}
