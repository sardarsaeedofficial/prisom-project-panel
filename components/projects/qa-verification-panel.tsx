"use client";

/**
 * components/projects/qa-verification-panel.tsx
 *
 * Sprint 69: Live QA Verification Panel — report, smoke checks, manual checklist, export.
 *
 * Safety: no production mutation. Live smoke checks are GET/HEAD-only.
 */

import { useTransition, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Activity, Shield, FileText, ClipboardCheck, BarChart2,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";

import {
  generateQaVerificationReportAction,
  runLiveQaSmokeChecksAction,
  exportQaVerificationReportAction,
} from "@/app/actions/qa-verification";

import type { QaVerificationReport, QaVerificationCheck, LiveSmokeReport } from "@/lib/qa/qa-verification-types";

// ── Helpers ─────────────────────────────────────────────────────────────────

type CheckStatus = QaVerificationCheck["status"];

function CheckIcon({ status }: { status: CheckStatus }) {
  if (status === "pass")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  if (status === "fail")    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  if (status === "manual")  return <ClipboardCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function QaStatusBadge({ status, score }: { status: string; score: number }) {
  const map: Record<string, "success" | "warning" | "error" | "secondary"> = {
    ready:   "success",
    warning: "warning",
    blocked: "error",
    unknown: "secondary",
  };
  const variant = map[status] ?? "secondary";
  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant}>{status.toUpperCase()}</Badge>
      <span className="text-sm font-medium">{score}%</span>
    </div>
  );
}

// ── Category Matrix ───────────────────────────────────────────────────────────

function CategoryMatrix({ checks }: { checks: QaVerificationCheck[] }) {
  const cats = [...new Set(checks.map((c) => c.category))];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {cats.map((cat) => {
        const cc   = checks.filter((c) => c.category === cat);
        const pass = cc.filter((c) => c.status === "pass").length;
        const fail = cc.filter((c) => c.status === "fail").length;
        const warn = cc.filter((c) => c.status === "warning").length;
        const man  = cc.filter((c) => c.status === "manual").length;
        const bg   =
          fail > 0 ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800" :
          warn > 0 ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800" :
          man > 0  ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" :
          "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800";
        return (
          <div key={cat} className={`rounded-lg border px-3 py-2 text-xs ${bg}`}>
            <p className="font-medium capitalize">{cat.replace(/_/g, " ")}</p>
            <p className="text-muted-foreground mt-0.5">{pass}✅ {warn > 0 ? `${warn}⚠️ ` : ""}{fail > 0 ? `${fail}❌ ` : ""}{man > 0 ? `${man}☐` : ""}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Checks Section ────────────────────────────────────────────────────────────

function ChecksSection({
  title, checks, defaultOpen = false,
}: { title: string; checks: QaVerificationCheck[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const failed  = checks.filter((c) => c.status === "fail").length;
  const warned  = checks.filter((c) => c.status === "warning").length;

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {failed > 0 && <Badge variant="error" className="text-xs">{failed} fail</Badge>}
          {warned > 0 && <Badge variant="warning" className="text-xs">{warned} warn</Badge>}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t divide-y max-h-80 overflow-y-auto">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 px-4 py-2.5 text-xs">
              <CheckIcon status={c.status} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.label}</p>
                <p className="text-muted-foreground mt-0.5">{c.message}</p>
                {c.linkHref && (
                  <a href={c.linkHref} className="text-primary hover:underline mt-0.5 block truncate">{c.linkHref}</a>
                )}
                {c.command && (
                  <code className="block text-[10px] bg-muted/50 rounded px-1.5 py-0.5 mt-1 font-mono break-all">{c.command}</code>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Smoke Results ─────────────────────────────────────────────────────────────

function SmokeResultsCard({ report }: { report: LiveSmokeReport }) {
  const statusColor =
    report.status === "passed" ? "border-green-200 bg-green-50 dark:bg-green-950/20" :
    report.status === "warning" ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20" :
    "border-red-200 bg-red-50 dark:bg-red-950/20";
  return (
    <div className={`rounded-lg border p-3 ${statusColor}`}>
      <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Live Smoke Results — {report.status.toUpperCase()}
      </p>
      <div className="space-y-1">
        {report.results.map((r) => {
          const icon = r.status === "pass" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
          return (
            <div key={r.url} className="flex items-center justify-between text-xs gap-2">
              <span>{icon} {r.label}</span>
              <span className="text-muted-foreground font-mono">HTTP {r.httpStatus ?? "—"}{r.durationMs ? ` (${r.durationMs}ms)` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Manual QA Checklist ───────────────────────────────────────────────────────

const MANUAL_ITEMS = [
  { id: "qa-releases",     label: "Opened Releases page" },
  { id: "qa-migration",    label: "Opened Migration page" },
  { id: "qa-publishing",   label: "Opened Publishing page" },
  { id: "qa-monitoring",   label: "Opened Monitoring page" },
  { id: "qa-runbook",      label: "Opened Runbook page" },
  { id: "qa-backups",      label: "Opened Backups page" },
  { id: "qa-logs",         label: "Opened Logs page" },
  { id: "qa-operations",   label: "Opened Operations page" },
  { id: "qa-team",         label: "Opened Team page" },
  { id: "qa-settings",     label: "Opened Settings page" },
  { id: "qa-rc-report",    label: "Generated Release Candidate report" },
  { id: "qa-go-live-gate", label: "Generated Final Go-Live gate" },
  { id: "qa-exec-plan",    label: "Generated Production Execution plan" },
  { id: "qa-monitoring-r", label: "Generated Monitoring report" },
  { id: "qa-runbook-exp",  label: "Exported Runbook" },
  { id: "qa-handoff-exp",  label: "Exported Handoff" },
  { id: "qa-sardar-root",  label: "Verified Sardar live root" },
  { id: "qa-sardar-health","label": "Verified Sardar health" },
];

function ManualQaChecklist() {
  const [done, setDone] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const count    = done.size;
  const total    = MANUAL_ITEMS.length;
  const allDone  = count === total;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <p className="text-sm font-medium flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-blue-500" />
          Manual QA Checklist
        </p>
        <Badge variant={allDone ? "success" : "secondary"}>{count} / {total} complete</Badge>
      </div>
      <div className="divide-y max-h-72 overflow-y-auto">
        {MANUAL_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => toggle(item.id)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-muted/40 transition-colors text-left"
          >
            {done.has(item.id)
              ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              : <div className="h-4 w-4 rounded border border-muted-foreground shrink-0" />
            }
            <span className={done.has(item.id) ? "line-through text-muted-foreground" : ""}>{item.label}</span>
          </button>
        ))}
      </div>
      {allDone && (
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950/20 border-t text-xs text-green-700 dark:text-green-300 font-medium">
          ✅ All manual QA items complete — ready to export the final report.
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function QaVerificationPanel({ projectId }: { projectId: string }) {
  const [report,      setReport]      = useState<QaVerificationReport | null>(null);
  const [smokeReport, setSmokeReport] = useState<LiveSmokeReport | null>(null);
  const [exportData,  setExportData]  = useState<{ content: string; filename: string } | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [lastAction,  setLastAction]  = useState<string | null>(null);
  const [smokeInput,  setSmokeInput]  = useState("");
  const [smokeError,  setSmokeError]  = useState<string | null>(null);

  const [genPending, startGen] = useTransition();
  const [smkPending, startSmk] = useTransition();
  const [expPending, startExp] = useTransition();

  const inFlightGen = useRef(false);
  const inFlightSmk = useRef(false);
  const inFlightExp = useRef(false);

  function handleGenerate() {
    if (inFlightGen.current) return;
    inFlightGen.current = true;
    setError(null);
    startGen(async () => {
      const result = await generateQaVerificationReportAction({ projectId });
      inFlightGen.current = false;
      if (result.ok) {
        setReport(result.data);
        setLastAction("Report generated");
      } else {
        setError(result.error);
      }
    });
  }

  function handleSmoke() {
    if (inFlightSmk.current) return;
    if (smokeInput.trim() !== "RUN LIVE QA SMOKE CHECKS") {
      setSmokeError('Type exactly "RUN LIVE QA SMOKE CHECKS" to run live checks.');
      return;
    }
    setSmokeError(null);
    inFlightSmk.current = true;
    setError(null);
    startSmk(async () => {
      const result = await runLiveQaSmokeChecksAction({ projectId, confirmation: smokeInput.trim() });
      inFlightSmk.current = false;
      if (result.ok) {
        setSmokeReport(result.data);
        setLastAction("Live smoke checks complete");
      } else {
        setError(result.error);
      }
    });
  }

  function handleExport() {
    if (inFlightExp.current) return;
    inFlightExp.current = true;
    setError(null);
    startExp(async () => {
      const result = await exportQaVerificationReportAction({ projectId });
      inFlightExp.current = false;
      if (result.ok) {
        setExportData(result.data);
        setLastAction("QA_VERIFICATION_REPORT.md ready");
      } else {
        setError(result.error);
      }
    });
  }

  const byCategory = (cat: QaVerificationCheck["category"]) =>
    report?.checks.filter((c) => c.category === cat) ?? [];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-primary" />
            Live QA Verification — Sprint 69
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Safety banner */}
          <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs">
            <Shield className="h-3.5 w-3.5 text-yellow-600 shrink-0 mt-0.5" />
            <span className="text-yellow-800 dark:text-yellow-200">
              <strong>QA and verification only.</strong> No production mutation, no PM2 restart, no nginx reload, no DNS change, no DB migration. Live smoke checks are GET/HEAD-only.
            </span>
          </div>

          {/* Report summary */}
          {report && (
            <div className="rounded-lg border px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <QaStatusBadge status={report.status} score={report.score} />
                <span className="text-xs text-muted-foreground">{new Date(report.generatedAt).toLocaleString()}</span>
              </div>
              {/* 6-stat grid */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center text-xs">
                {[
                  { label: "Total",    value: report.summary.total },
                  { label: "Passed",   value: report.summary.passed,   color: "text-green-600" },
                  { label: "Warnings", value: report.summary.warnings, color: "text-yellow-600" },
                  { label: "Failed",   value: report.summary.failed,   color: "text-red-600" },
                  { label: "Manual",   value: report.summary.manual,   color: "text-blue-500" },
                  { label: "Pending",  value: report.summary.pending },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded border px-2 py-1">
                    <p className={`font-bold ${color ?? ""}`}>{value}</p>
                    <p className="text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blockers */}
          {report && report.blockers.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs space-y-1">
              <p className="font-medium text-red-700 dark:text-red-300">Blockers</p>
              {report.blockers.map((b) => (
                <p key={b} className="text-red-600 dark:text-red-400">❌ {b}</p>
              ))}
            </div>
          )}

          {/* Warnings */}
          {report && report.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs space-y-1">
              <p className="font-medium text-yellow-700 dark:text-yellow-300">Warnings</p>
              {report.warnings.map((w) => (
                <p key={w} className="text-yellow-600 dark:text-yellow-400">⚠️ {w}</p>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Last action */}
          {lastAction && !error && (
            <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {lastAction}
            </p>
          )}

          {/* Buttons */}
          <div className="flex flex-wrap gap-2">
            <ActionLoadingButton
              onClick={handleGenerate}
              loading={genPending}
              loadingLabel="Generating…"
              size="sm"
              variant="default"
            >
              Generate QA Report
            </ActionLoadingButton>

            <ActionLoadingButton
              onClick={handleExport}
              loading={expPending}
              loadingLabel="Building export…"
              size="sm"
              variant="outline"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Export QA Report
            </ActionLoadingButton>

            {exportData && (
              <CopyDownloadButton
                content={exportData.content}
                filename={exportData.filename}
                label="Download QA_VERIFICATION_REPORT.md"
                mimeType="text/markdown"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category Matrix */}
      {report && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Category Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryMatrix checks={report.checks} />
          </CardContent>
        </Card>
      )}

      {/* Checks by section */}
      {report && (
        <div className="space-y-2">
          <ChecksSection title="Routes & Pages"    checks={[...byCategory("routes"), ...byCategory("pages")]} defaultOpen={report.blockers.length > 0} />
          <ChecksSection title="Navigation"        checks={byCategory("navigation")} />
          <ChecksSection title="Export Coverage"   checks={byCategory("exports")} />
          <ChecksSection title="Confirmation Gates" checks={byCategory("confirmations")} />
          <ChecksSection title="Safety Checks"     checks={byCategory("safety")} />
          <ChecksSection title="Sardar Checks"     checks={byCategory("sardar")} />
          <ChecksSection title="Admin Checks"      checks={byCategory("admin")} />
          <ChecksSection title="DB Readiness"      checks={byCategory("permissions")} />
        </div>
      )}

      {/* Next steps */}
      {report && report.nextSteps.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs font-medium mb-1.5">Next Steps</p>
            <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
              {report.nextSteps.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Live Smoke Checks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Live Smoke Checks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Runs HEAD-only requests against panel endpoints and Sardar production. Type the confirmation phrase to proceed.
          </p>
          <div className="space-y-1.5">
            <input
              type="text"
              value={smokeInput}
              onChange={(e) => { setSmokeInput(e.target.value); setSmokeError(null); }}
              placeholder="RUN LIVE QA SMOKE CHECKS"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {smokeError && (
              <p className="text-xs text-red-600 dark:text-red-400">{smokeError}</p>
            )}
          </div>
          <ActionLoadingButton
            type="button"
            onClick={handleSmoke}
            loading={smkPending}
            loadingLabel="Running smoke checks…"
            size="sm"
            variant="outline"
            disabled={smokeInput.trim() !== "RUN LIVE QA SMOKE CHECKS"}
          >
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Run Live QA Smoke Checks
          </ActionLoadingButton>
          {smokeReport && <SmokeResultsCard report={smokeReport} />}
        </CardContent>
      </Card>

      {/* Manual QA Checklist */}
      <ManualQaChecklist />
    </div>
  );
}
