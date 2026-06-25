"use client";

/**
 * components/projects/production-execution-panel.tsx
 *
 * Sprint 65: Production Cutover Execution Guard panel.
 *
 * Safety:
 *  - no secrets displayed
 *  - no automatic production mutation
 *  - APPLY PRODUCTION CUTOVER and EXECUTE PRODUCTION ROLLBACK require
 *    exact confirmation phrases typed by the user
 *  - RUN PRODUCTION SMOKE CHECKS requires confirmation
 *  - apply/rollback are guarded dry-runs (execution-record only)
 */

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2,
  Clock, ChevronDown, ChevronRight, Terminal, Eye,
  Rocket, RotateCcw, Download, Loader2, Globe, Activity,
  FileCog,
} from "lucide-react";
import { RequiredPermissionNote } from "@/components/projects/required-permission-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { CopyDownloadButton }   from "@/components/common/copy-download-button";
import { ActionLoadingButton }  from "@/components/common/action-loading-button";
import {
  generateProductionExecutionPlanAction,
  generateProductionRouteApplyPreviewAction,
  runProductionSmokeChecksAction,
  applyProductionCutoverAction,
  executeProductionRollbackAction,
  exportProductionExecutionPlanAction,
} from "@/app/actions/production-execution";
import type {
  ProductionExecutionPlan,
  ProductionRouteApplyPreview,
  ProductionExecutionSmokeReport,
  ProductionExecutionStage,
  ProductionExecutionStatus,
  ProductionExecutionStep,
} from "@/lib/cutover/production-execution-types";

// ── Stage ordering ─────────────────────────────────────────────────────────────

const STAGE_ORDER: ProductionExecutionStage[] = [
  "final_gate", "staging_proof", "backup", "permissions",
  "domain", "routing", "deployment", "smoke_checks", "rollback", "manual",
];

const STAGE_LABELS: Record<ProductionExecutionStage, string> = {
  final_gate:    "Final Gate Review",
  staging_proof: "Staging Proof",
  backup:        "Backup",
  permissions:   "Permissions",
  domain:        "Domain",
  routing:       "Routing",
  deployment:    "Deployment",
  smoke_checks:  "Smoke Checks",
  rollback:      "Rollback Plan",
  manual:        "Manual Sign-offs",
};

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusBadge(status: ProductionExecutionStatus) {
  const map: Record<ProductionExecutionStatus, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    not_started: { variant: "secondary", label: "Not Started" },
    ready:       { variant: "success",   label: "Ready" },
    warning:     { variant: "warning",   label: "Warnings" },
    blocked:     { variant: "error",     label: "Blocked" },
    running:     { variant: "warning",   label: "Running" },
    passed:      { variant: "success",   label: "Passed" },
    failed:      { variant: "error",     label: "Failed" },
    complete:    { variant: "success",   label: "Complete" },
    unknown:     { variant: "secondary", label: "Unknown" },
  };
  const { variant, label } = map[status] ?? map.unknown;
  return <Badge variant={variant as never}>{label}</Badge>;
}

function stepIcon(status: ProductionExecutionStep["status"]) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />;
  if (status === "fail")    return <XCircle      className="h-4 w-4 text-red-500    shrink-0 mt-0.5" />;
  if (status === "manual")  return <Clock        className="h-4 w-4 text-blue-500   shrink-0 mt-0.5" />;
  return                           <Clock        className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
}

function smokeIcon(status: "pass" | "warning" | "fail") {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return                           <XCircle      className="h-4 w-4 text-red-500    shrink-0" />;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StageSection({
  stageId,
  steps,
  projectId,
  defaultOpen,
}: {
  stageId:     ProductionExecutionStage;
  steps:       ProductionExecutionStep[];
  projectId:   string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const failCount = steps.filter((s) => s.status === "fail").length;
  const warnCount = steps.filter((s) => s.status === "warning").length;
  const passCount = steps.filter((s) => s.status === "pass").length;

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-lg transition-colors"
      >
        {open
          ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="flex-1 text-left">{STAGE_LABELS[stageId]}</span>
        <span className="flex gap-1">
          {failCount > 0 && (
            <Badge variant="error"   className="text-xs">{failCount} blocked</Badge>
          )}
          {warnCount > 0 && (
            <Badge variant="warning" className="text-xs">{warnCount} warn</Badge>
          )}
          {passCount > 0 && failCount === 0 && warnCount === 0 && (
            <Badge variant="success" className="text-xs">{passCount} pass</Badge>
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t mt-0 pt-2">
          {steps.map((step) => (
            <div key={step.id} className="flex gap-2 text-sm">
              {stepIcon(step.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium leading-snug">{step.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{step.message}</p>
                {step.command && (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono mt-1 block break-all">
                    {step.command}
                  </code>
                )}
                {step.warning && (
                  <p className="text-xs text-yellow-600 mt-0.5">⚠️ {step.warning}</p>
                )}
                {step.linkHref && (
                  <Link
                    href={step.linkHref}
                    className="text-xs text-primary hover:underline mt-0.5 inline-block"
                  >
                    → View
                  </Link>
                )}
                {step.confirmationRequired && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    🔐 Requires: <span className="font-mono">{step.confirmationRequired}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutePreviewSection({ preview }: { preview: ProductionRouteApplyPreview }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-lg transition-colors"
      >
        {open
          ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">Route Apply Preview — {preview.domain}</span>
        {statusBadge(preview.status)}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t pt-2 space-y-2">
          {preview.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-600">❌ {b}</p>
          ))}
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-600">⚠️ {w}</p>
          ))}
          <div className="space-y-1">
            {preview.routes.map((r, i) => (
              <div key={i} className="text-xs flex gap-2 items-start">
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">{r.path}</code>
                <span className="text-muted-foreground">→</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono break-all">{r.target}</code>
              </div>
            ))}
          </div>
          {preview.nginxPreview && preview.nginxPreview.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground select-none">
                nginx config preview (display only — never written to disk)
              </summary>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto font-mono leading-relaxed">
                {preview.nginxPreview.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function SmokeCheckResults({ report }: { report: ProductionExecutionSmokeReport }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium mb-1">
        Smoke results — {report.generatedAt.slice(0, 19).replace("T", " ")} UTC
      </p>
      {report.results.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {smokeIcon(r.status)}
          <span className="font-medium shrink-0">{r.label}</span>
          <span className="text-muted-foreground truncate flex-1">{r.message}</span>
          {r.httpStatus && (
            <Badge variant={r.status === "pass" ? "success" : "error"} className="text-xs shrink-0">
              HTTP {r.httpStatus}
            </Badge>
          )}
        </div>
      ))}
      {report.warnings.slice(1).map((w, i) => (
        <p key={i} className="text-xs text-yellow-600">⚠️ {w}</p>
      ))}
    </div>
  );
}

function ManualCommandBlock({ domain }: { domain: string }) {
  const commands = [
    `# Pre-cutover verification`,
    `curl -I https://${domain}/`,
    `curl -I https://${domain}/api/healthz`,
    `pm2 status`,
    ``,
    `# nginx validation (operator only)`,
    `sudo cp /etc/nginx/sites-available/<project> /etc/nginx/sites-available/<project>.bak`,
    `sudo nginx -t`,
    `# sudo nginx -s reload  ← only after nginx -t passes and operator approval`,
    ``,
    `# Rollback route restore`,
    `# sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>`,
    `# sudo nginx -t && sudo nginx -s reload`,
    ``,
    `# Post-cutover log review`,
    `pm2 logs --lines 50`,
    `sudo tail -f /var/log/nginx/error.log`,
  ].join("\n");

  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Manual Operator Commands</span>
        <span className="text-xs text-muted-foreground ml-auto">documented only — not executed</span>
      </div>
      <div className="p-3">
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto leading-relaxed whitespace-pre">
          {commands}
        </pre>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ProductionExecutionPanel({ projectId }: { projectId: string }) {
  const [pending, start]  = useTransition();
  const inFlight          = useRef(false);

  const [plan,         setPlan]         = useState<ProductionExecutionPlan | null>(null);
  const [routePreview, setRoutePreview] = useState<ProductionRouteApplyPreview | null>(null);
  const [smokeReport,  setSmokeReport]  = useState<ProductionExecutionSmokeReport | null>(null);
  const [exportData,   setExportData]   = useState<{ content: string; filename: string } | null>(null);

  const [error,      setError]      = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [smokeConfirm,   setSmokeConfirm]   = useState("");
  const [applyConfirm,   setApplyConfirm]   = useState("");
  const [rollbackConfirm, setRollbackConfirm] = useState("");

  const [applyResult,    setApplyResult]    = useState<string | null>(null);
  const [rollbackResult, setRollbackResult] = useState<string | null>(null);

  function run<T>(label: string, fn: () => Promise<T>, onOk: (v: T) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        onOk(res);
        setLastAction(`${label} — ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
      }
    });
  }

  const handleGeneratePlan = () =>
    run("Plan generated", () => generateProductionExecutionPlanAction({ projectId }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setPlan(res.data);
      setRoutePreview(res.data.routePreview);
    });

  const handleRoutePreview = () =>
    run("Route preview generated", () => generateProductionRouteApplyPreviewAction({ projectId }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setRoutePreview(res.data);
    });

  const handleSmokeChecks = () => {
    if (smokeConfirm !== "RUN PRODUCTION SMOKE CHECKS") {
      setError("Type RUN PRODUCTION SMOKE CHECKS exactly to confirm.");
      return;
    }
    run("Smoke checks complete", () => runProductionSmokeChecksAction({
      projectId,
      confirmation: "RUN PRODUCTION SMOKE CHECKS",
    }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setSmokeReport(res.data);
      setSmokeConfirm("");
    });
  };

  const handleApplyCutover = () => {
    if (applyConfirm !== "APPLY PRODUCTION CUTOVER") {
      setError("Type APPLY PRODUCTION CUTOVER exactly to confirm.");
      return;
    }
    run("Cutover apply recorded", () => applyProductionCutoverAction({
      projectId,
      confirmation: "APPLY PRODUCTION CUTOVER",
    }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setApplyResult(res.data.message);
      setApplyConfirm("");
    });
  };

  const handleRollback = () => {
    if (rollbackConfirm !== "EXECUTE PRODUCTION ROLLBACK") {
      setError("Type EXECUTE PRODUCTION ROLLBACK exactly to confirm.");
      return;
    }
    run("Rollback request recorded", () => executeProductionRollbackAction({
      projectId,
      confirmation: "EXECUTE PRODUCTION ROLLBACK",
    }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setRollbackResult(res.data.message);
      setRollbackConfirm("");
    });
  };

  const handleExport = () =>
    run("Plan exported", () => exportProductionExecutionPlanAction({ projectId }), (res) => {
      if (!res.ok) { setError(res.error); return; }
      setExportData(res.data);
    });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base leading-none">
            Production Cutover Execution Guard
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Final guarded workflow before production route apply. Requires explicit confirmation.
          </p>
        </div>
        {plan && statusBadge(plan.status)}
      </div>

      {/* Safety notice */}
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800 px-3 py-2 space-y-1">
        <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300">Safety notices</p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          This panel does not change DNS.
        </p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          This panel must not run DB migrations.
        </p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          Production apply is blocked unless every required guard passes and the exact confirmation phrase is entered.
        </p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          Apply/rollback are execution-record only — operator must apply nginx config manually after sign-off.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Last action */}
      {lastAction && !error && (
        <p className="text-xs text-muted-foreground">
          ✓ {lastAction}
        </p>
      )}

      {/* Blockers / Warnings */}
      {plan && plan.blockers.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 dark:bg-red-950/20 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">Blockers</p>
          {plan.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-600">❌ {b}</p>
          ))}
        </div>
      )}
      {plan && plan.warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50/60 dark:bg-yellow-950/20 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Warnings</p>
          {plan.warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-600">⚠️ {w}</p>
          ))}
        </div>
      )}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Generating…"
          onClick={handleGeneratePlan}
          size="sm"
          variant="default"
        >
          <FileCog className="h-3.5 w-3.5 mr-1.5" />
          Generate Execution Plan
        </ActionLoadingButton>
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Generating…"
          onClick={handleRoutePreview}
          size="sm"
          variant="outline"
          disabled={!plan}
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          Preview Production Routes
        </ActionLoadingButton>
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Exporting…"
          onClick={handleExport}
          size="sm"
          variant="outline"
          disabled={!plan}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export Execution Plan
        </ActionLoadingButton>
      </div>

      {/* Export download */}
      {exportData && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-xs flex-1 font-medium">{exportData.filename} ready</span>
          <CopyDownloadButton
            content={exportData.content}
            filename={exportData.filename}
            label="Download"
          />
        </div>
      )}

      {/* Route preview */}
      {routePreview && <RoutePreviewSection preview={routePreview} />}

      {/* Stage checklist */}
      {plan && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Execution Steps
          </p>
          {STAGE_ORDER.map((stageId) => {
            const stageSteps = plan.steps.filter((s) => s.stage === stageId);
            if (stageSteps.length === 0) return null;
            return (
              <StageSection
                key={stageId}
                stageId={stageId}
                steps={stageSteps}
                projectId={projectId}
                defaultOpen={stageId === "final_gate" || stageId === "routing"}
              />
            );
          })}
        </div>
      )}

      {/* Smoke checks */}
      <div className="rounded-lg border bg-muted/30">
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Production Smoke Checks</span>
          <span className="text-xs text-muted-foreground ml-auto">GET-only, no mutations</span>
        </div>
        <div className="px-3 py-3 space-y-3">
          {smokeReport
            ? <SmokeCheckResults report={smokeReport} />
            : (
              <p className="text-xs text-muted-foreground">
                Runs GET checks on {plan?.domain ?? "sardar-security-project.doorstepmanchester.uk"}.
                Checks: root, /api/healthz, SPA fallback.
              </p>
            )
          }
          <div className="space-y-2">
            <Input
              value={smokeConfirm}
              onChange={(e) => setSmokeConfirm(e.target.value)}
              placeholder='Type "RUN PRODUCTION SMOKE CHECKS" to confirm'
              className="text-xs h-8 font-mono"
            />
            <ActionLoadingButton
              loading={pending}
              loadingLabel="Running smoke checks…"
              onClick={handleSmokeChecks}
              size="sm"
              variant="outline"
              disabled={smokeConfirm !== "RUN PRODUCTION SMOKE CHECKS"}
            >
              Run Production Smoke Checks
            </ActionLoadingButton>
          </div>
        </div>
      </div>

      {/* Cutover apply guard */}
      <div className="rounded-lg border border-orange-200 bg-orange-50/30 dark:bg-orange-950/20 dark:border-orange-800">
        <div className="px-3 py-2 border-b border-orange-200 dark:border-orange-800 flex items-center gap-2">
          <Rocket className="h-3.5 w-3.5 text-orange-600" />
          <span className="text-sm font-medium text-orange-700 dark:text-orange-400">Request Production Cutover Apply</span>
        </div>
        <div className="px-3 py-3 space-y-3">
          <RequiredPermissionNote permission="deploy.trigger" />
          <p className="text-xs text-muted-foreground">
            Records a guarded cutover request. Does NOT apply nginx routes automatically.
            Operator must apply nginx config manually after review.
          </p>
          {applyResult && (
            <div className="rounded border border-green-300 bg-green-50 dark:bg-green-950/20 px-2 py-1.5">
              <p className="text-xs text-green-700 dark:text-green-400 font-medium">Cutover Recorded</p>
              <p className="text-xs text-green-600 mt-0.5 break-words">{applyResult}</p>
            </div>
          )}
          <div className="space-y-2">
            <Input
              value={applyConfirm}
              onChange={(e) => setApplyConfirm(e.target.value)}
              placeholder='Type "APPLY PRODUCTION CUTOVER" to confirm'
              className="text-xs h-8 font-mono"
            />
            <ActionLoadingButton
              loading={pending}
              loadingLabel="Recording cutover…"
              onClick={handleApplyCutover}
              size="sm"
              variant="default"
              disabled={applyConfirm !== "APPLY PRODUCTION CUTOVER"}
            >
              <Rocket className="h-3.5 w-3.5 mr-1.5" />
              Request Production Cutover Apply
            </ActionLoadingButton>
          </div>
        </div>
      </div>

      {/* Rollback guard */}
      <div className="rounded-lg border border-red-200 bg-red-50/20 dark:bg-red-950/10 dark:border-red-800">
        <div className="px-3 py-2 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
          <RotateCcw className="h-3.5 w-3.5 text-red-600" />
          <span className="text-sm font-medium text-red-700 dark:text-red-400">Request Production Rollback</span>
        </div>
        <div className="px-3 py-3 space-y-3">
          <RequiredPermissionNote permission="deploy.trigger" />
          <p className="text-xs text-muted-foreground">
            Records a rollback request. Does NOT restart PM2 or restore nginx automatically.
            Operator must restore nginx backup and restart previous release manually.
            DB rollback is NOT automatic.
          </p>
          {rollbackResult && (
            <div className="rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 px-2 py-1.5">
              <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">Rollback Recorded</p>
              <p className="text-xs text-yellow-600 mt-0.5 break-words">{rollbackResult}</p>
            </div>
          )}
          <div className="space-y-2">
            <Input
              value={rollbackConfirm}
              onChange={(e) => setRollbackConfirm(e.target.value)}
              placeholder='Type "EXECUTE PRODUCTION ROLLBACK" to confirm'
              className="text-xs h-8 font-mono"
            />
            <ActionLoadingButton
              loading={pending}
              loadingLabel="Recording rollback…"
              onClick={handleRollback}
              size="sm"
              variant="outline"
              disabled={rollbackConfirm !== "EXECUTE PRODUCTION ROLLBACK"}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Request Production Rollback
            </ActionLoadingButton>
          </div>
        </div>
      </div>

      {/* Manual operator commands */}
      <ManualCommandBlock domain={plan?.domain ?? "sardar-security-project.doorstepmanchester.uk"} />

      {/* Next steps */}
      {plan && plan.nextSteps.length > 0 && (
        <div className="rounded-lg border bg-muted/20 px-3 py-3">
          <p className="text-xs font-semibold mb-2">Next Steps</p>
          <ol className="space-y-1">
            {plan.nextSteps.map((ns, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="shrink-0 font-mono text-xs">{i + 1}.</span>
                {ns}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
