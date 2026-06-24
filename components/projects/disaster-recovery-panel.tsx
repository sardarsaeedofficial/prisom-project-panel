"use client";

/**
 * components/projects/disaster-recovery-panel.tsx
 *
 * Sprint 60: Disaster Recovery Drill panel.
 *
 * Sections:
 *  - Backup readiness report
 *  - Restore drill plan
 *  - Backup integrity check (VERIFY BACKUP)
 *  - Rollback readiness (release, route, DB warning)
 *  - Export DISASTER_RECOVERY_REPORT.md
 *  - Mark Drill Complete (MARK DRILL COMPLETE)
 *
 * Safety rules:
 *  - No live restore triggered.
 *  - No DB mutation.
 *  - No nginx write/reload.
 *  - No PM2 restart.
 *  - No secrets shown.
 */

import { useState, useCallback, useTransition, useRef } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  ChevronDown,
  ChevronUp,
  Loader2,
  Database,
  RotateCcw,
  Globe,
  Wrench,
  FileText,
  Flag,
} from "lucide-react";
import { Badge }               from "@/components/ui/badge";
import { Button }              from "@/components/ui/button";
import { Input }               from "@/components/ui/input";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import {
  generateDisasterRecoveryReportAction,
  generateRestoreDrillPlanAction,
  verifyBackupIntegrityAction,
  exportDisasterRecoveryReportAction,
  markRestoreDrillCompleteAction,
} from "@/app/actions/disaster-recovery";
import type {
  DisasterRecoveryReport,
  DisasterRecoveryCheck,
  RestoreDrillPlan,
  BackupIntegrityResult,
} from "@/lib/backups/disaster-recovery-types";

// ── Status icons ──────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: DisasterRecoveryCheck["status"] }) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "manual":  return <Wrench className="h-4 w-4 text-blue-500 shrink-0" />;
    case "pending": return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function StatusBadge({ status }: { status: DisasterRecoveryReport["status"] }) {
  const map: Record<string, string> = {
    ready:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    passed:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    blocked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    failed:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    unknown: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.unknown}`}>
      {status.toUpperCase()}
    </span>
  );
}

// ── Check list item ───────────────────────────────────────────────────────────

function CheckItem({ check }: { check: DisasterRecoveryCheck }) {
  const [open, setOpen] = useState(false);
  const hasDetails =
    (check.evidence && check.evidence.length > 0) ||
    check.command ||
    check.warning ||
    check.confirmationRequired ||
    check.linkHref;

  return (
    <div className="py-2 border-b last:border-0">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={`w-full flex items-start gap-2.5 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="mt-0.5">
          <CheckIcon status={check.status} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{check.label}</span>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{check.message}</p>
        </div>
        {hasDetails && (
          open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
               : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
        )}
      </button>

      {open && hasDetails && (
        <div className="mt-2 ml-7 space-y-1.5">
          {check.warning && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5 border border-amber-200 dark:border-amber-800">
              ⚠️ {check.warning}
            </p>
          )}
          {check.command && (
            <code className="block text-xs bg-muted rounded px-2 py-1 font-mono break-all">
              {check.command}
            </code>
          )}
          {check.confirmationRequired && (
            <p className="text-xs text-muted-foreground">
              Required phrase:{" "}
              <code className="font-mono bg-muted px-1 rounded">{check.confirmationRequired}</code>
            </p>
          )}
          {check.evidence?.map((e, i) => (
            <code key={i} className="block text-xs text-muted-foreground break-all">{e}</code>
          ))}
          {check.linkHref && (
            <Link
              href={check.linkHref}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Checks section ────────────────────────────────────────────────────────────

function ChecksSection({ title, checks, icon }: {
  title: string;
  checks: DisasterRecoveryCheck[];
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (checks.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">({checks.length})</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-3">
          {checks.map((c) => <CheckItem key={c.id} check={c} />)}
        </div>
      )}
    </div>
  );
}

// ── DR report summary ─────────────────────────────────────────────────────────

function ReportSummary({ report }: { report: DisasterRecoveryReport }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={report.status} />
        <span className="text-xs text-muted-foreground">
          {report.summary.passed} passed · {report.summary.warnings} warnings ·{" "}
          {report.summary.failed} failed · {report.summary.manual} manual
        </span>
      </div>
      {report.blockers.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Blockers:</p>
          {report.blockers.map((b, i) => (
            <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
              {b}
            </p>
          ))}
        </div>
      )}
      {report.nextSteps.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1">Next steps:</p>
          {report.nextSteps.slice(0, 3).map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {s}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drill plan summary ────────────────────────────────────────────────────────

function DrillPlanSummary({ plan }: { plan: RestoreDrillPlan }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={plan.status} />
        <span className="text-xs text-muted-foreground">
          Staging target:{" "}
          <code className="font-mono bg-muted px-1 rounded">{plan.recommendedTargetSlug}</code>
        </span>
      </div>
      {plan.sourceBackupRef && (
        <p className="text-xs text-muted-foreground">
          Source backup:{" "}
          <code className="font-mono">{plan.sourceBackupRef}</code>
          {plan.sourceBackupCreatedAt && ` — ${plan.sourceBackupCreatedAt.slice(0, 10)}`}
        </p>
      )}
      {plan.blockers.length > 0 && (
        <div>
          {plan.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
              {b}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Integrity result ──────────────────────────────────────────────────────────

function IntegrityResultPanel({ result }: { result: BackupIntegrityResult }) {
  const statusColor =
    result.status === "passed"
      ? "text-green-600 dark:text-green-400"
      : result.status === "warning"
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        {result.status === "passed"
          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
          : result.status === "warning"
          ? <AlertTriangle className="h-4 w-4 text-yellow-500" />
          : <XCircle className="h-4 w-4 text-red-500" />}
        <span className={`text-sm font-medium ${statusColor}`}>{result.summary}</span>
      </div>
      <p className="text-xs text-muted-foreground font-mono">
        Backup: {result.backupRef || result.backupId}
      </p>
      <div>
        {result.checks.map((c) => <CheckItem key={c.id} check={c} />)}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function DisasterRecoveryPanel({ projectId }: { projectId: string }) {
  const [report,          setReport]          = useState<DisasterRecoveryReport | null>(null);
  const [drillPlan,       setDrillPlan]       = useState<RestoreDrillPlan | null>(null);
  const [integrity,       setIntegrity]       = useState<BackupIntegrityResult | null>(null);
  const [exportData,      setExportData]      = useState<{ markdown: string; filename: string } | null>(null);
  const [drillComplete,   setDrillComplete]   = useState<string | null>(null);

  const [error,           setError]           = useState<string | null>(null);
  const [lastAction,      setLastAction]      = useState<string | null>(null);

  const [verifyBackupId,  setVerifyBackupId]  = useState("");
  const [verifyConfirm,   setVerifyConfirm]   = useState("");
  const [drillConfirm,    setDrillConfirm]    = useState("");

  const [reportPending,  startReportTransition]  = useTransition();
  const [drillPending,   startDrillTransition]   = useTransition();
  const [verifyPending,  startVerifyTransition]  = useTransition();
  const [exportPending,  startExportTransition]  = useTransition();
  const [markPending,    startMarkTransition]    = useTransition();

  const reportInFlight  = useRef(false);
  const drillInFlight   = useRef(false);
  const verifyInFlight  = useRef(false);
  const exportInFlight  = useRef(false);
  const markInFlight    = useRef(false);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleGenerateReport = useCallback(() => {
    if (reportInFlight.current) return;
    reportInFlight.current = true;
    setError(null);
    startReportTransition(async () => {
      try {
        const res = await generateDisasterRecoveryReportAction(projectId);
        if (res.ok) {
          setReport(res.data);
          setLastAction("DR report generated");
        } else {
          setError(res.error);
        }
      } finally {
        reportInFlight.current = false;
      }
    });
  }, [projectId]);

  const handleGenerateDrillPlan = useCallback(() => {
    if (drillInFlight.current) return;
    drillInFlight.current = true;
    setError(null);
    startDrillTransition(async () => {
      try {
        const res = await generateRestoreDrillPlanAction({ projectId });
        if (res.ok) {
          setDrillPlan(res.data);
          setLastAction("Restore drill plan generated");
        } else {
          setError(res.error);
        }
      } finally {
        drillInFlight.current = false;
      }
    });
  }, [projectId]);

  const handleVerifyIntegrity = useCallback(() => {
    if (verifyInFlight.current) return;
    if (verifyConfirm.trim() !== "VERIFY BACKUP") return;
    if (!verifyBackupId.trim()) return;
    verifyInFlight.current = true;
    setError(null);
    startVerifyTransition(async () => {
      try {
        const res = await verifyBackupIntegrityAction({
          projectId,
          backupId:     verifyBackupId.trim(),
          confirmation: "VERIFY BACKUP",
        });
        if (res.ok) {
          setIntegrity(res.data);
          setLastAction("Backup integrity verified");
        } else {
          setError(res.error);
        }
      } finally {
        verifyInFlight.current = false;
      }
    });
  }, [projectId, verifyBackupId, verifyConfirm]);

  const handleExport = useCallback(() => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setError(null);
    startExportTransition(async () => {
      try {
        const res = await exportDisasterRecoveryReportAction(projectId);
        if (res.ok) {
          setExportData(res.data);
          setLastAction("DISASTER_RECOVERY_REPORT.md exported");
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
    if (drillConfirm.trim() !== "MARK DRILL COMPLETE") return;
    markInFlight.current = true;
    setError(null);
    startMarkTransition(async () => {
      try {
        const res = await markRestoreDrillCompleteAction({
          projectId,
          confirmation: "MARK DRILL COMPLETE",
        });
        if (res.ok) {
          setDrillComplete(res.data.completedAt);
          setLastAction("Restore drill marked complete ✓");
        } else {
          setError(res.error);
        }
      } finally {
        markInFlight.current = false;
      }
    });
  }, [projectId, drillConfirm]);

  // ── Render ────────────────────────────────────────────────────────────────

  const backupChecks      = report?.checks.filter((c) => c.category === "backup")          ?? [];
  const integrityChecks   = report?.checks.filter((c) => c.category === "integrity")       ?? [];
  const rollbackChecks    = report?.checks.filter((c) => c.category === "release_rollback") ?? [];
  const routeChecks       = report?.checks.filter((c) => c.category === "route_rollback")  ?? [];
  const dbChecks          = report?.checks.filter((c) => c.category === "database")        ?? [];

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">Disaster Recovery Drill</h3>
          {report && <StatusBadge status={report.status} />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionLoadingButton
            loading={reportPending}
            loadingLabel="Checking…"
            onClick={handleGenerateReport}
            size="sm"
            variant="outline"
          >
            <ShieldCheck className="h-4 w-4" />
            Generate DR Report
          </ActionLoadingButton>
          <ActionLoadingButton
            loading={drillPending}
            loadingLabel="Planning…"
            onClick={handleGenerateDrillPlan}
            size="sm"
            variant="outline"
          >
            <RotateCcw className="h-4 w-4" />
            Restore Drill Plan
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
        Validate backup readiness, plan a staging restore drill, and confirm rollback capability before production cutover.
        No live restore is triggered automatically.
      </p>

      {/* Last action / error */}
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

      {/* DR Report summary */}
      {report && <ReportSummary report={report} />}

      {/* Backup status checks */}
      {backupChecks.length > 0 && (
        <ChecksSection
          title="Backup Status"
          checks={backupChecks}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        />
      )}

      {/* Integrity checks from report */}
      {integrityChecks.length > 0 && (
        <ChecksSection
          title="Backup Integrity"
          checks={integrityChecks}
          icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
        />
      )}

      {/* Restore drill plan */}
      {drillPlan && (
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
            Restore Drill Plan
          </p>
          <DrillPlanSummary plan={drillPlan} />
          <ChecksSection
            title="Drill Steps"
            checks={drillPlan.steps}
            icon={<Flag className="h-4 w-4 text-muted-foreground" />}
          />
        </div>
      )}

      {/* Backup integrity check box */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Verify Backup Integrity</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter a backup ID from the{" "}
          <Link href={`/projects/${projectId}/backups`} className="text-primary hover:underline">
            Backups page
          </Link>{" "}
          and confirm with <code className="font-mono bg-muted px-1 rounded text-xs">VERIFY BACKUP</code>.
          No files are extracted into live directories.
        </p>
        <div className="space-y-2">
          <Input
            placeholder="Backup ID (e.g. clxyz123…)"
            value={verifyBackupId}
            onChange={(e) => setVerifyBackupId(e.target.value)}
            className="text-sm font-mono"
          />
          <Input
            placeholder='Type "VERIFY BACKUP" to confirm'
            value={verifyConfirm}
            onChange={(e) => setVerifyConfirm(e.target.value)}
            className="text-sm font-mono"
          />
          <ActionLoadingButton
            loading={verifyPending}
            loadingLabel="Verifying…"
            onClick={handleVerifyIntegrity}
            size="sm"
            variant="outline"
            disabled={
              verifyPending ||
              verifyConfirm.trim() !== "VERIFY BACKUP" ||
              !verifyBackupId.trim()
            }
          >
            <ShieldCheck className="h-4 w-4" />
            Verify Backup Integrity
          </ActionLoadingButton>
        </div>
        {integrity && <IntegrityResultPanel result={integrity} />}
      </div>

      {/* Rollback readiness */}
      {rollbackChecks.length > 0 && (
        <ChecksSection
          title="Release Rollback Readiness"
          checks={rollbackChecks}
          icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
        />
      )}

      {/* Route rollback */}
      {routeChecks.length > 0 && (
        <ChecksSection
          title="Route Rollback Plan"
          checks={routeChecks}
          icon={<Globe className="h-4 w-4 text-muted-foreground" />}
        />
      )}

      {/* DB rollback warning */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Database Rollback — Manual Only
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
              <strong>Application rollback does NOT automatically rollback database schema or data.</strong>{" "}
              Schema changes and data mutations must be reversed manually using a separate DB-level backup
              taken before the migration.
            </p>
          </div>
        </div>
        {dbChecks.map((c) => <CheckItem key={c.id} check={c} />)}
      </div>

      {/* Export section */}
      {exportData && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">DISASTER_RECOVERY_REPORT.md</span>
            <Badge variant="secondary" className="text-xs">Ready</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Report generated. No secrets included.
          </p>
          <CopyDownloadButton
            content={exportData.markdown}
            filename={exportData.filename}
            label="Download DISASTER_RECOVERY_REPORT.md"
          />
        </div>
      )}

      {/* Mark drill complete */}
      {drillComplete ? (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-200">
            Restore drill marked complete — {drillComplete.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Mark Drill Complete</span>
          </div>
          <p className="text-xs text-muted-foreground">
            After completing all drill steps, confirm with{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">MARK DRILL COMPLETE</code>{" "}
            to record that the drill passed.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='Type "MARK DRILL COMPLETE" to confirm'
              value={drillConfirm}
              onChange={(e) => setDrillConfirm(e.target.value)}
              className="text-sm font-mono"
            />
            <ActionLoadingButton
              loading={markPending}
              loadingLabel="Marking…"
              onClick={handleMarkComplete}
              size="sm"
              variant="outline"
              disabled={markPending || drillConfirm.trim() !== "MARK DRILL COMPLETE"}
              className="shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Drill Complete
            </ActionLoadingButton>
          </div>
        </div>
      )}

      {/* Link to backups page */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
        <Link
          href={`/projects/${projectId}/backups`}
          className="hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <Database className="h-3.5 w-3.5" />
          Manage Backups
        </Link>
        <Link
          href={`/projects/${projectId}/releases`}
          className="hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Release History
        </Link>
      </div>
    </div>
  );
}
