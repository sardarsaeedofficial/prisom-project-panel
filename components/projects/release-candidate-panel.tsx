"use client";

/**
 * components/projects/release-candidate-panel.tsx
 *
 * Sprint 68: Release Candidate Hardening Panel.
 *
 * Shows the RC report with score, category matrix, blockers/warnings,
 * manual checklist, confirmation phrase index, smoke commands, and export.
 *
 * Safety: documentation/reporting only — no production mutation.
 */

import { useState, useTransition, useRef } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ChevronDown, ChevronUp, Terminal, Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge }               from "@/components/ui/badge";
import { Button }              from "@/components/ui/button";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import { generateReleaseCandidateReportAction, exportReleaseCandidateReportAction } from "@/app/actions/release-candidate";
import { SMOKE_COMMANDS, SMOKE_EXPECTED, CONFIRMATION_PHRASES } from "@/lib/release-candidate/release-candidate-export";
import type { ReleaseCandidateReport, ReleaseCandidateCategory, ReleaseCandidateCheck } from "@/lib/release-candidate/release-candidate-types";

// ── Category labels ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ReleaseCandidateCategory, string> = {
  navigation:    "Navigation",
  actions:       "Actions",
  permissions:   "Permissions",
  confirmations: "Confirmations",
  exports:       "Exports",
  readiness:     "Readiness",
  monitoring:    "Monitoring",
  backup:        "Backup",
  staging:       "Staging",
  go_live:       "Go-Live",
  ecommerce:     "Ecommerce",
  runbook:       "Runbook",
  safety:        "Safety",
  ui:            "UI",
};

// ── Status display ────────────────────────────────────────────────────────────

function RCStatusBadge({ status, score }: { status: ReleaseCandidateReport["status"]; score: number }) {
  if (status === "ready")
    return <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium"><CheckCircle2 className="h-4 w-4" /> Ready — {score}%</span>;
  if (status === "blocked")
    return <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium"><XCircle className="h-4 w-4" /> Blocked — {score}%</span>;
  if (status === "warning")
    return <span className="flex items-center gap-1.5 text-orange-500 font-medium"><AlertTriangle className="h-4 w-4" /> Warning — {score}%</span>;
  return <span className="flex items-center gap-1.5 text-muted-foreground font-medium">Unknown — {score}%</span>;
}

// ── Check status icon ─────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: ReleaseCandidateCheck["status"] }) {
  if (status === "pass")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />;
  if (status === "fail")    return <XCircle       className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />;
  if (status === "manual")  return <span className="h-3.5 w-3.5 inline-block border border-muted-foreground rounded-sm shrink-0 mt-0.5" />;
  return <span className="h-3.5 w-3.5 inline-block rounded-full border border-muted shrink-0 mt-0.5" />;
}

// ── Category matrix ────────────────────────────────────────────────────────────

function CategoryMatrix({ checks }: { checks: ReleaseCandidateCheck[] }) {
  const categories = [...new Set(checks.map((c) => c.category))] as ReleaseCandidateCategory[];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {categories.map((cat) => {
        const catChecks = checks.filter((c) => c.category === cat);
        const passed  = catChecks.filter((c) => c.status === "pass").length;
        const failed  = catChecks.filter((c) => c.status === "fail").length;
        const manual  = catChecks.filter((c) => c.status === "manual").length;
        const warning = catChecks.filter((c) => c.status === "warning").length;
        const color   = failed > 0 ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                       : warning > 0 ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20"
                       : manual > 0  ? "border-border bg-muted/30"
                       : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20";

        return (
          <div key={cat} className={`rounded-lg border px-3 py-2 ${color}`}>
            <p className="text-xs font-medium">{CATEGORY_LABELS[cat]}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {passed}✅ {warning > 0 ? `${warning}⚠️ ` : ""}{failed > 0 ? `${failed}❌ ` : ""}{manual > 0 ? `${manual}☐` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Expandable checks section ─────────────────────────────────────────────────

function ChecksSection({ checks }: { checks: ReleaseCandidateCheck[] }) {
  const [open, setOpen] = useState(false);
  const failing = checks.filter((c) => c.status === "fail" || c.status === "warning");

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-sm font-medium">
          All checks ({checks.length}) {failing.length > 0 ? `— ${failing.length} need attention` : ""}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-1 border-t pt-3 max-h-80 overflow-y-auto">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 py-1">
              <CheckIcon status={c.status} />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-snug">{c.label}</p>
                <p className="text-xs text-muted-foreground leading-snug">{c.message}</p>
                {c.warning && <p className="text-xs text-orange-500 leading-snug mt-0.5">{c.warning}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manual RC checklist ────────────────────────────────────────────────────────

const RC_ITEMS = [
  "All nav links opened at least once",
  "All Sardar panels generated at least once",
  "All exports downloaded at least once",
  "All dangerous actions show confirmation gates",
  "All production mutation warnings reviewed",
  "Logs/debug page reviewed",
  "Monitoring report generated and reviewed",
  "Operator runbook exported (OPERATOR_RUNBOOK.md)",
  "Final Go-Live pack exported (FINAL_GO_LIVE_PACK.md)",
  "Sardar live root (/) returns 200 OK",
  "Sardar /api/healthz returns 200 OK",
  "Doorsteps/LocalShop confirmed untouched",
];

function ManualRCChecklist() {
  const [done, setDone] = useState<Set<number>>(new Set());

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">Manual RC Checklist</CardTitle>
          <Badge variant={done.size === RC_ITEMS.length ? "default" : "outline"}
            className={done.size === RC_ITEMS.length ? "bg-green-600 hover:bg-green-600" : ""}>
            {done.size} / {RC_ITEMS.length} complete
          </Badge>
        </div>
        <CardDescription>Work through this checklist before marking the release candidate ready.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {RC_ITEMS.map((item, i) => (
          <label key={i} className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              checked={done.has(i)}
              onChange={() =>
                setDone((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                })
              }
            />
            <p className={`text-sm ${done.has(i) ? "line-through text-muted-foreground" : ""}`}>{item}</p>
          </label>
        ))}
        {done.size > 0 && (
          <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={() => setDone(new Set())}>
            Reset checklist
          </Button>
        )}
        {done.size === RC_ITEMS.length && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30 px-3 py-2 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            All manual RC checks complete.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Confirmation phrase index ─────────────────────────────────────────────────

function ConfirmationPhraseIndex() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Confirmation Phrase Index</CardTitle>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>Reference only — do not enter these phrases unless intentionally executing that workflow.</CardDescription>
      </CardHeader>
      {open && (
        <CardContent>
          <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20 px-3 py-2 mb-3 text-xs text-orange-700 dark:text-orange-300">
            Reference only. Do not enter these phrases unless intentionally executing that workflow.
          </div>
          <div className="space-y-1.5">
            {CONFIRMATION_PHRASES.map(([phrase, location]) => (
              <div key={phrase} className="flex items-start gap-2">
                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{phrase}</code>
                <span className="text-xs text-muted-foreground">{location}</span>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Smoke commands card ───────────────────────────────────────────────────────

function SmokeCommandsCard() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Final Smoke Commands</CardTitle>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>Run these on the server after deployment to verify the platform is live.</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-muted/60 p-3 space-y-1">
            {SMOKE_COMMANDS.map((cmd) => (
              <p key={cmd} className="text-xs font-mono">{cmd}</p>
            ))}
          </div>
          <div>
            <p className="text-xs font-medium text-foreground mb-1.5">Expected results:</p>
            <div className="space-y-1">
              {SMOKE_EXPECTED.map((exp) => (
                <p key={exp} className="text-xs text-muted-foreground font-mono">{exp}</p>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export function ReleaseCandidatePanel({ projectId }: Props) {
  const [report,     setReport]     = useState<ReleaseCandidateReport | null>(null);
  const [exportData, setExportData] = useState<{ content: string; filename: string } | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const inFlightGen  = useRef(false);
  const inFlightExp  = useRef(false);

  async function handleGenerate() {
    if (inFlightGen.current) return;
    inFlightGen.current = true;
    setError(null);
    startGen(async () => {
      const res = await generateReleaseCandidateReportAction({ projectId });
      if (res.ok) {
        setReport(res.data);
        setLastAction(`RC report generated — score ${res.data.score}%, ${new Date().toLocaleTimeString()}`);
      } else {
        setError(res.error);
      }
      inFlightGen.current = false;
    });
  }

  async function handleExport() {
    if (inFlightExp.current) return;
    inFlightExp.current = true;
    setError(null);
    startExp(async () => {
      const res = await exportReleaseCandidateReportAction({ projectId });
      if (res.ok) {
        setExportData(res.data);
        setLastAction(`RELEASE_CANDIDATE_REPORT.md ready — ${new Date().toLocaleTimeString()}`);
      } else {
        setError(res.error);
      }
      inFlightExp.current = false;
    });
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Release Candidate Hardening</CardTitle>
              <CardDescription className="mt-1">
                Final hardening audit across navigation, actions, permissions, confirmations, exports, safety, and UI.
                Documentation only — no production mutation.
              </CardDescription>
            </div>
            {report && <RCStatusBadge status={report.status} score={report.score} />}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Safety banner */}
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-3 py-2.5 text-xs text-green-700 dark:text-green-300">
            Reporting only — this panel does not apply routes, restart PM2, reload nginx, run DB migrations, or expose secrets.
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/30 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {lastAction && <p className="text-xs text-muted-foreground">{lastAction}</p>}

          <div className="flex flex-wrap gap-2">
            <ActionLoadingButton
              loading={genPending}
              loadingLabel="Running checks…"
              onClick={handleGenerate}
              size="sm"
              variant="default"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {report ? "Regenerate RC Report" : "Generate RC Report"}
            </ActionLoadingButton>

            {report && (
              <ActionLoadingButton
                loading={expPending}
                loadingLabel="Preparing…"
                onClick={handleExport}
                size="sm"
                variant="outline"
              >
                Export RELEASE_CANDIDATE_REPORT.md
              </ActionLoadingButton>
            )}

            {exportData && (
              <CopyDownloadButton
                content={exportData.content}
                filename={exportData.filename}
                label="Download RELEASE_CANDIDATE_REPORT.md"
                size="sm"
                variant="outline"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* RC report results */}
      {report && (
        <>
          {/* Summary grid */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: "Passed",   value: report.summary.passed,   color: "text-green-600 dark:text-green-400" },
              { label: "Warnings", value: report.summary.warnings, color: "text-orange-500" },
              { label: "Failed",   value: report.summary.failed,   color: "text-red-600 dark:text-red-400" },
              { label: "Manual",   value: report.summary.manual,   color: "text-muted-foreground" },
              { label: "Pending",  value: report.summary.pending,  color: "text-muted-foreground" },
              { label: "Total",    value: report.summary.total,    color: "text-foreground font-semibold" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border bg-card px-3 py-2 text-center">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Blockers */}
          {report.blockers.length > 0 && (
            <div className="space-y-1.5">
              {report.blockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {b}
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {report.warnings.length > 0 && (
            <div className="space-y-1.5">
              {report.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Category matrix */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Category Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryMatrix checks={report.checks} />
            </CardContent>
          </Card>

          {/* Expandable all-checks */}
          <ChecksSection checks={report.checks} />

          {/* Next steps */}
          {report.nextSteps.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Next Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {report.nextSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Always-visible cards */}
      <ManualRCChecklist />
      <ConfirmationPhraseIndex />
      <SmokeCommandsCard />
    </div>
  );
}
