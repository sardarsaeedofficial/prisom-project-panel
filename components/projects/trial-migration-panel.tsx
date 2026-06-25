"use client";

/**
 * components/projects/trial-migration-panel.tsx
 *
 * Sprint 61: Sardar Staging Trial Migration panel.
 *
 * Sections:
 *  - Generate trial plan (overall status, stages, blockers, next steps)
 *  - Per-stage expandable step list
 *  - Run staging smoke checks (RUN STAGING CHECKS)
 *  - Manual evidence checklist (client-side)
 *  - Export TRIAL_MIGRATION_REPORT.md
 *  - Mark trial complete (MARK TRIAL COMPLETE)
 *
 * Safety: no live mutations, no secrets, no nginx, no PM2, no DB migration.
 */

import { useState, useCallback, useTransition, useRef } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  Loader2, ChevronDown, ChevronUp, Flag, Download,
  Globe, Wrench, CheckSquare, Square,
} from "lucide-react";
import { Badge }               from "@/components/ui/badge";
import { Button }              from "@/components/ui/button";
import { Input }               from "@/components/ui/input";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import {
  generateTrialMigrationRunAction,
  runTrialMigrationSmokeChecksAction,
  exportTrialMigrationReportAction,
  markTrialMigrationCompleteAction,
} from "@/app/actions/trial-migration";
import type {
  TrialMigrationRun,
  TrialMigrationStageGroup,
  TrialMigrationStep,
  StagingSmokeCheckReport,
} from "@/lib/migration/trial-migration-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function stepStatusIcon(status: TrialMigrationStep["status"]) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "manual":  return <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    case "pending": return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

function stageStatusBadge(status: TrialMigrationStageGroup["status"]) {
  const map: Record<string, string> = {
    passed:      "border-green-400 text-green-700 dark:text-green-400",
    complete:    "border-green-400 text-green-700 dark:text-green-400",
    ready:       "border-blue-400 text-blue-700 dark:text-blue-400",
    warning:     "border-yellow-400 text-yellow-700 dark:text-yellow-400",
    failed:      "border-red-400 text-red-600 dark:text-red-400",
    blocked:     "border-red-400 text-red-600 dark:text-red-400",
    not_started: "border-border text-muted-foreground",
    running:     "border-blue-400 text-blue-600 dark:text-blue-400",
  };
  return (
    <Badge
      variant="outline"
      className={`text-xs py-0 h-5 ${map[status] ?? map.not_started}`}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

function overallStatusBadge(status: TrialMigrationRun["status"]) {
  const map: Record<string, string> = {
    passed:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    complete:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    ready:       "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    warning:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    blocked:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    failed:      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    not_started: "bg-muted text-muted-foreground",
    running:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.not_started}`}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

// ── Step item ─────────────────────────────────────────────────────────────────

function StepItem({ step }: { step: TrialMigrationStep }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    step.warning || step.command || step.confirmationRequired ||
    (step.evidence && step.evidence.length > 0) || step.linkHref;

  return (
    <div className="py-2 border-b last:border-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`w-full flex items-start gap-2 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{step.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
        </div>
        {step.required && (
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 border rounded px-1 py-0.5">required</span>
        )}
        {hasDetail && (
          <div className="shrink-0 mt-1">
            {open
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        )}
      </button>

      {open && hasDetail && (
        <div className="ml-5 mt-2 space-y-1.5">
          {step.warning && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5 border border-amber-200 dark:border-amber-800">
              ⚠️ {step.warning}
            </p>
          )}
          {step.command && (
            <code className="block text-xs bg-muted rounded px-2 py-1 font-mono break-all">
              {step.command}
            </code>
          )}
          {step.confirmationRequired && (
            <p className="text-xs text-muted-foreground">
              Confirmation required:{" "}
              <code className="font-mono bg-muted px-1 rounded">{step.confirmationRequired}</code>
            </p>
          )}
          {step.evidence?.map((e, i) => (
            <p key={i} className="text-xs text-muted-foreground font-mono break-all">• {e}</p>
          ))}
          {step.linkHref && (
            <Link href={step.linkHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stage group ───────────────────────────────────────────────────────────────

function StageGroup({ stage }: { stage: TrialMigrationStageGroup }) {
  const [open, setOpen] = useState(false);
  const passCount = stage.steps.filter((s) => s.status === "pass").length;
  const total     = stage.steps.length;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {stageStatusBadge(stage.status)}
          <span className="text-sm font-medium truncate">{stage.title}</span>
          <span className="text-xs text-muted-foreground shrink-0">{passCount}/{total}</span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t">
          {stage.steps.map((s) => <StepItem key={s.id} step={s} />)}
        </div>
      )}
    </div>
  );
}

// ── Smoke check results ───────────────────────────────────────────────────────

function SmokeResultRow({ r }: { r: StagingSmokeCheckReport["results"][number] }) {
  const icon =
    r.status === "pass"    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> :
    r.status === "warning" ? <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" /> :
                              <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  return (
    <div className="flex items-start gap-2 py-2 border-b last:border-0">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <code className="text-xs font-mono break-all">{r.url}</code>
        <p className="text-xs text-muted-foreground mt-0.5">
          {r.httpStatus !== null && <span className="mr-2">HTTP {r.httpStatus}</span>}
          {r.message}
          {r.durationMs !== null && <span className="ml-2 text-muted-foreground/70">{r.durationMs}ms</span>}
        </p>
      </div>
    </div>
  );
}

// ── Manual evidence checklist ─────────────────────────────────────────────────

const EVIDENCE_ITEMS = [
  "Staging source imported into staging project",
  "Staging env values entered manually (no production secrets copied)",
  "Staging DB URL configured — separate from production",
  "Drizzle migration reviewed manually before running",
  "API service configured (artifacts/api-server)",
  "Static frontend service configured (artifacts/sardar-security/dist/public)",
  "Route preview checked — /api/* → API, /* → frontend with SPA fallback",
  "Staging root URL checked and returns 200",
  "Staging API health endpoint (/api/healthz) returns 200",
  "Staging SPA fallback checked (non-existent route returns 200)",
  "Stripe test mode reviewed — sk_test_* / pk_test_* keys confirmed",
  "Cloudinary upload manually tested in staging",
  "Email provider manually tested (test delivery confirmed)",
  "Backup/restore drill reviewed — backup integrity confirmed",
];

function ManualEvidenceChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const done  = checked.size;
  const total = EVIDENCE_ITEMS.length;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Manual Evidence Checklist</span>
        <span className="text-xs text-muted-foreground">{done}/{total} confirmed</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Check each item after manually verifying it in the staging environment.
        These items require human verification and cannot be automated.
      </p>
      <div className="space-y-1">
        {EVIDENCE_ITEMS.map((label, i) => {
          const isDone = checked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
            >
              {isDone
                ? <CheckSquare className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                : <Square className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
              <span className={`text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {done === total && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            All {total} evidence items confirmed ✓
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function TrialMigrationPanel({ projectId }: { projectId: string }) {
  const [run,           setRun]           = useState<TrialMigrationRun | null>(null);
  const [smokeReport,   setSmokeReport]   = useState<StagingSmokeCheckReport | null>(null);
  const [exportData,    setExportData]    = useState<{ markdown: string; filename: string } | null>(null);
  const [trialComplete, setTrialComplete] = useState<string | null>(null);

  const [error,         setError]         = useState<string | null>(null);
  const [lastAction,    setLastAction]    = useState<string | null>(null);
  const [stagingDomain, setStagingDomain] = useState("");
  const [smokeConfirm,  setSmokeConfirm]  = useState("");
  const [markConfirm,   setMarkConfirm]   = useState("");

  const [planPending,   startPlanTransition]   = useTransition();
  const [smokePending,  startSmokeTransition]  = useTransition();
  const [exportPending, startExportTransition] = useTransition();
  const [markPending,   startMarkTransition]   = useTransition();

  const planInFlight   = useRef(false);
  const smokeInFlight  = useRef(false);
  const exportInFlight = useRef(false);
  const markInFlight   = useRef(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleGeneratePlan = useCallback(() => {
    if (planInFlight.current) return;
    planInFlight.current = true;
    setError(null);
    startPlanTransition(async () => {
      try {
        const res = await generateTrialMigrationRunAction(projectId);
        if (res.ok) {
          setRun(res.data);
          setLastAction("Trial migration plan generated");
        } else {
          setError(res.error);
        }
      } finally {
        planInFlight.current = false;
      }
    });
  }, [projectId]);

  const handleRunSmoke = useCallback(() => {
    if (smokeInFlight.current) return;
    if (smokeConfirm.trim() !== "RUN STAGING CHECKS") return;
    smokeInFlight.current = true;
    setError(null);
    startSmokeTransition(async () => {
      try {
        const res = await runTrialMigrationSmokeChecksAction({
          projectId,
          stagingDomain: stagingDomain.trim() || undefined,
          confirmation:  "RUN STAGING CHECKS",
        });
        if (res.ok) {
          setSmokeReport(res.data);
          setLastAction(
            `Staging smoke checks ${res.data.overall === "pass" ? "passed ✓" : `completed — ${res.data.overall}`}`,
          );
        } else {
          setError(res.error);
        }
      } finally {
        smokeInFlight.current = false;
      }
    });
  }, [projectId, stagingDomain, smokeConfirm]);

  const handleExport = useCallback(() => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setError(null);
    startExportTransition(async () => {
      try {
        const res = await exportTrialMigrationReportAction(projectId);
        if (res.ok) {
          setExportData(res.data);
          setLastAction("TRIAL_MIGRATION_REPORT.md exported");
        } else {
          setError(res.error);
        }
      } finally {
        exportInFlight.current = false;
      }
    });
  }, [projectId]);

  const handleMarkComplete = useCallback(() => {
    if (markInFlight.current) return;
    if (markConfirm.trim() !== "MARK TRIAL COMPLETE") return;
    markInFlight.current = true;
    setError(null);
    startMarkTransition(async () => {
      try {
        const res = await markTrialMigrationCompleteAction({
          projectId,
          confirmation: "MARK TRIAL COMPLETE",
        });
        if (res.ok) {
          setTrialComplete(res.data.completedAt);
          setLastAction("Staging trial migration marked complete ✓");
        } else {
          setError(res.error);
        }
      } finally {
        markInFlight.current = false;
      }
    });
  }, [projectId, markConfirm]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">Sardar Staging Trial Migration</h3>
          {run && overallStatusBadge(run.status)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionLoadingButton
            loading={planPending}
            loadingLabel="Planning…"
            onClick={handleGeneratePlan}
            size="sm"
            variant="outline"
          >
            Generate Trial Plan
          </ActionLoadingButton>
          <ActionLoadingButton
            loading={exportPending}
            loadingLabel="Exporting…"
            onClick={handleExport}
            size="sm"
            variant="outline"
          >
            <Download className="h-4 w-4" />
            Export Report
          </ActionLoadingButton>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Execute a guided staging trial migration to prove the source import, service config, env
        checklist, routing, dry run, external services, backup drill, and smoke checks all work
        together — before any production cutover.
      </p>

      {/* Feedback */}
      {lastAction && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">{lastAction}</span>
        </div>
      )}
      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Plan: summary */}
      {run && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            {overallStatusBadge(run.status)}
            <span className="text-xs text-muted-foreground">
              Staging:{" "}
              <code className="font-mono bg-muted px-1 rounded">{run.recommendedStagingSlug}</code>
              {" — "}
              <code className="font-mono bg-muted px-1 rounded text-xs">{run.recommendedStagingDomain}</code>
            </span>
          </div>
          {run.blockers.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">Blockers:</p>
              {run.blockers.map((b, i) => (
                <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />{b}
                </p>
              ))}
            </div>
          )}
          {run.warnings.length > 0 && (
            <div className="space-y-0.5">
              {run.warnings.map((w, i) => (
                <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />{w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stages */}
      {run && (
        <div className="space-y-2">
          {run.stages.map((stage) => (
            <StageGroup key={stage.stage} stage={stage} />
          ))}
        </div>
      )}

      {/* Smoke checks */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Run Staging Smoke Checks</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Checks staging root URL, API health endpoint, and SPA fallback route.
          Confirm with{" "}
          <code className="font-mono bg-muted px-1 rounded text-xs">RUN STAGING CHECKS</code>.
          No production traffic is affected.
        </p>
        <div className="space-y-2">
          <Input
            placeholder={`Staging domain (default: staging-sardar-security-project.doorstepmanchester.uk)`}
            value={stagingDomain}
            onChange={(e) => setStagingDomain(e.target.value)}
            className="text-sm font-mono"
          />
          <Input
            placeholder='Type "RUN STAGING CHECKS" to confirm'
            value={smokeConfirm}
            onChange={(e) => setSmokeConfirm(e.target.value)}
            className="text-sm font-mono"
          />
          <ActionLoadingButton
            loading={smokePending}
            loadingLabel="Checking…"
            onClick={handleRunSmoke}
            size="sm"
            variant="outline"
            disabled={smokePending || smokeConfirm.trim() !== "RUN STAGING CHECKS"}
          >
            <Globe className="h-4 w-4" />
            Run Staging Checks
          </ActionLoadingButton>
        </div>

        {smokeReport && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-2 mb-2">
              {smokeReport.overall === "pass"
                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                : smokeReport.overall === "warning"
                ? <AlertTriangle className="h-4 w-4 text-yellow-500" />
                : <XCircle className="h-4 w-4 text-red-500" />}
              <span className="text-sm font-medium capitalize">
                Smoke checks {smokeReport.overall} — {new Date(smokeReport.checkedAt).toLocaleTimeString()}
              </span>
            </div>
            {smokeReport.results.map((r) => <SmokeResultRow key={r.url} r={r} />)}
          </div>
        )}
      </div>

      {/* Manual evidence checklist */}
      <ManualEvidenceChecklist />

      {/* Export */}
      {exportData && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">TRIAL_MIGRATION_REPORT.md</span>
            <Badge variant="secondary" className="text-xs">Ready</Badge>
          </div>
          <p className="text-xs text-muted-foreground">No secrets included.</p>
          <CopyDownloadButton
            content={exportData.markdown}
            filename={exportData.filename}
            label="Download TRIAL_MIGRATION_REPORT.md"
          />
        </div>
      )}

      {/* Mark complete */}
      {trialComplete ? (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            Staging trial marked complete — {trialComplete.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Mark Trial Complete</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Once all stages pass and manual evidence is confirmed, type{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">MARK TRIAL COMPLETE</code>{" "}
            to record the staging trial as successful. Only then proceed to production cutover.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='Type "MARK TRIAL COMPLETE" to confirm'
              value={markConfirm}
              onChange={(e) => setMarkConfirm(e.target.value)}
              className="text-sm font-mono"
            />
            <ActionLoadingButton
              loading={markPending}
              loadingLabel="Marking…"
              onClick={handleMarkComplete}
              size="sm"
              variant="outline"
              disabled={markPending || markConfirm.trim() !== "MARK TRIAL COMPLETE"}
              className="shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Trial Complete
            </ActionLoadingButton>
          </div>
        </div>
      )}

      {/* Next steps */}
      {run?.nextSteps && run.nextSteps.length > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium">Next steps:</p>
          {run.nextSteps.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {s}</p>
          ))}
        </div>
      )}

      {/* Safety note */}
      <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1">
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
        This trial does not modify live Sardar routing, apply nginx changes, run DB migrations, or restart PM2.
      </p>
    </div>
  );
}
