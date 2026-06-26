"use client";

/**
 * components/projects/deploy-verification-panel.tsx
 *
 * Sprint 78: Deploy Verification panel.
 * Read-only — deploy verification documentation only. No production mutation.
 */

import { useState, useTransition, useRef }                from "react";
import {
  generateDeployVerificationReportAction,
  exportDeployVerificationReportAction,
}                                                          from "@/app/actions/deploy-verification";
import { CopyDownloadButton }                              from "@/components/common/copy-download-button";
import { ActionLoadingButton }                            from "@/components/common/action-loading-button";
import { Badge }                                           from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                          from "@/components/ui/card";
import { Input }                                           from "@/components/ui/input";
import { Label }                                           from "@/components/ui/label";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Loader2,
  GitCommit, ChevronDown, ChevronUp, ShieldCheck,
}                                                          from "lucide-react";
import type {
  DeployVerificationReport,
  DeployVerificationCheck,
  DeployVerificationStatus,
} from "@/lib/deploy-verification/deploy-verification-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: DeployVerificationCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Clock className={`${cls} text-blue-500`} />;
    case "pending": return <Loader2 className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: DeployVerificationStatus) {
  const map: Record<DeployVerificationStatus, { variant: "error" | "warning" | "success" | "secondary"; label: string }> = {
    not_checked: { variant: "secondary", label: "Not Checked" },
    blocked:     { variant: "error",     label: "Blocked" },
    warnings:    { variant: "warning",   label: "Warnings" },
    verified:    { variant: "success",   label: "Verified" },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<DeployVerificationCheck["category"], string> = {
  commit:        "Commit",
  panel_route:   "Panel Routes",
  project_route: "Project Routes",
  export:        "Exports",
  action:        "Action Gates",
  permissions:   "Permissions",
  safety:        "Safety",
  runtime:       "Runtime",
};

const CATEGORY_ORDER: DeployVerificationCheck["category"][] = [
  "commit", "panel_route", "project_route", "export", "action", "permissions", "safety", "runtime",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface DeployVerificationPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function DeployVerificationPanel({ projectId, compact }: DeployVerificationPanelProps) {
  const [report,          setReport]          = useState<DeployVerificationReport | null>(null);
  const [exportData,      setExportData]      = useState<string>("");
  const [error,           setError]           = useState<string>("");
  const [expectedCommit,  setExpectedCommit]  = useState<string>("");
  const [expanded,        setExpanded]        = useState<Set<string>>(new Set());
  const [activeTab,       setActiveTab]       = useState<"checks" | "routes" | "exports">("checks");

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
        const result = await generateDeployVerificationReportAction({
          projectId,
          expectedCommit: expectedCommit.trim() || undefined,
        });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        const toExpand = new Set(
          result.data.checks
            .filter((c) => c.status === "blocked" || c.status === "warning")
            .map((c) => c.category),
        );
        if (toExpand.size === 0) toExpand.add("commit");
        setExpanded(toExpand);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportDeployVerificationReportAction({
              projectId,
              expectedCommit: expectedCommit.trim() || undefined,
            });
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
        <GitCommit className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Deploy Verification</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verify deployed commit, panel routes, project routes, exports, and action gates.
            Export DEPLOY_VERIFICATION_REPORT.md.{" "}
            <span className="italic">Read-only. Deploy verification only. No production mutation.</span>
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
          <GitCommit className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Deploy Verification</CardTitle>
          {report && statusBadge(report.status)}
        </div>
        <CardDescription>
          Verify deployed commit, panel routes, project routes, exports, and action gates.
          Export DEPLOY_VERIFICATION_REPORT.md.{" "}
          <span className="italic">Read-only — deploy verification only. No production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Expected commit input */}
        <div className="space-y-1.5">
          <Label htmlFor="deploy-expected-commit" className="text-xs">
            Expected commit SHA (optional)
          </Label>
          <Input
            id="deploy-expected-commit"
            value={expectedCommit}
            onChange={(e) => setExpectedCommit(e.target.value)}
            placeholder="e.g. 95b296f"
            className="h-8 text-xs font-mono max-w-xs"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">
            Run <code className="font-mono text-xs">git rev-parse --short HEAD</code> on the server to get this.
          </p>
        </div>

        {/* Commit info */}
        {report && (
          <div className="rounded-lg border p-3 text-xs space-y-1 bg-muted/30">
            <div className="flex items-center gap-2">
              <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold">Commit</span>
            </div>
            <p>
              <span className="text-muted-foreground">Expected: </span>
              <code className="font-mono">{report.expectedCommit || "_(not specified)_"}</code>
            </p>
            <p>
              <span className="text-muted-foreground">Last recorded: </span>
              <code className="font-mono">{report.observedCommit || "_(no deployment on record)_"}</code>
            </p>
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

        {/* Safety: no mutation */}
        {report && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-2.5 flex items-center gap-2 text-xs text-green-800 dark:text-green-300">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Read-only — no production mutation. All smoke checks must be run manually by an operator.
          </div>
        )}

        {/* Tabs */}
        {report && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit">
            {(["checks", "routes", "exports"] as const).map((tab) => (
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
                {tab === "checks" ? "Verification Checks" : tab === "routes" ? "Routes" : "Exports & Actions"}
              </button>
            ))}
          </div>
        )}

        {/* Checks tab */}
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
                        {passed}/{catChecks.length} confirmed
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
                        <div key={c.id} className="px-3 py-2.5 space-y-1">
                          <div className="flex items-start gap-2">
                            <CheckIcon status={c.status} />
                            <p className="text-xs font-medium leading-tight">{c.label}</p>
                          </div>
                          <p className="text-xs text-muted-foreground pl-5">{c.description}</p>
                          {c.command && (
                            <div className="pl-5">
                              <code className="text-xs font-mono bg-muted px-2 py-1 rounded block whitespace-pre-wrap">
                                {c.command}
                              </code>
                            </div>
                          )}
                          {c.evidence && (
                            <p className="text-xs text-green-700 dark:text-green-300 pl-5">Evidence: {c.evidence}</p>
                          )}
                          {c.nextStep && c.status !== "pass" && (
                            <p className="text-xs text-muted-foreground pl-5">Next: {c.nextStep}</p>
                          )}
                          {c.safetyNote && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 pl-5 italic">Safety: {c.safetyNote}</p>
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

        {/* Routes tab */}
        {report && activeTab === "routes" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Routes to verify</p>
              {report.verifiedRoutes.map((r, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <code className="font-mono">{r}</code>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Exports & Actions tab */}
        {report && activeTab === "exports" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exports to verify</p>
              {report.exportsToVerify.map((e, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  {e}
                </p>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions to verify</p>
              {report.actionsToVerify.map((a, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  {a}
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
            Generate Verification Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="DEPLOY_VERIFICATION_REPORT.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — deploy verification only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
