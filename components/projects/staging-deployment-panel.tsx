"use client";

/**
 * components/projects/staging-deployment-panel.tsx
 *
 * Sprint 64: Sardar Staging Deployment panel.
 *
 * Sections:
 *  - Staging target config
 *  - Generate staging plan (always available)
 *  - Service plan
 *  - Source preparation plan (PREPARE STAGING SOURCE)
 *  - Env placeholders
 *  - Dry run + smoke checks (RUN STAGING DRY RUN)
 *  - Blockers / warnings
 *  - Manual evidence checklist (15 items)
 *  - Export STAGING_DEPLOYMENT_PROOF.md
 *  - Mark staging ready (MARK STAGING READY)
 *
 * Safety: no production mutation, no secrets.
 */

import { useState, useTransition, useRef, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Download, Wrench,
  CheckSquare, Square, ShieldCheck, Rocket, Server,
  Terminal,
} from "lucide-react";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import {
  generateStagingDeploymentPlanAction,
  prepareStagingSourceAction,
  runStagingDeploymentDryRunAction,
  exportStagingDeploymentProofAction,
  markStagingReadyAction,
} from "@/app/actions/staging-deployment";
import type {
  StagingDeploymentPlan,
  StagingDeploymentStep,
  StagingDeploymentStage,
  StagingServicePlan,
} from "@/lib/staging/staging-deployment-types";
import type { StagingSourcePlan } from "@/app/actions/staging-deployment";
import type { StagingSmokeReport } from "@/lib/staging/staging-deployment-smoke-checks";
import {
  DEFAULT_STAGING_SLUG,
  DEFAULT_STAGING_DOMAIN,
} from "@/lib/staging/staging-target-guard";

// ── Status helpers ────────────────────────────────────────────────────────────

function stepIcon(status: StagingDeploymentStep["status"]) {
  switch (status) {
    case "pass":    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    case "fail":    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "manual":  return <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    case "pending": return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

function overallBadge(status: StagingDeploymentPlan["status"]) {
  const map: Record<string, string> = {
    ready:       "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    passed:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    complete:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    warning:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    blocked:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    failed:      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    running:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    not_started: "bg-muted text-muted-foreground",
    unknown:     "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] ?? map.not_started}`}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function smokeResultIcon(status: "pass" | "warning" | "fail") {
  return status === "pass"
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
    : status === "warning"
    ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
    : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
}

// ── Stage labels ──────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<StagingDeploymentStage, string> = {
  target:          "Target",
  source:          "Source",
  services:        "Services",
  env:             "Env / Secrets",
  database:        "Database",
  build:           "Build",
  routing_preview: "Routing Preview",
  smoke_checks:    "Smoke Checks",
  manual:          "Manual Review",
};

const STAGE_ORDER: StagingDeploymentStage[] = [
  "target", "source", "services", "env", "database",
  "build", "routing_preview", "smoke_checks", "manual",
];

// ── Evidence items ────────────────────────────────────────────────────────────

const EVIDENCE_ITEMS = [
  { id: "s1",  label: "Staging project target reviewed" },
  { id: "s2",  label: "Staging source path reviewed" },
  { id: "s3",  label: "Production source untouched (live Sardar at port 4100 still running)" },
  { id: "s4",  label: "Staging env placeholders reviewed" },
  { id: "s5",  label: "Staging DATABASE_URL uses staging DB (not production)" },
  { id: "s6",  label: "API service command reviewed" },
  { id: "s7",  label: "Static frontend command reviewed" },
  { id: "s8",  label: "/api/* route preview reviewed" },
  { id: "s9",  label: "/* static route preview reviewed" },
  { id: "s10", label: "Build dry run reviewed" },
  { id: "s11", label: "Staging root smoke check reviewed" },
  { id: "s12", label: "Staging API health reviewed" },
  { id: "s13", label: "Staging SPA fallback reviewed" },
  { id: "s14", label: "Logs reviewed after dry run" },
  { id: "s15", label: "Staging marked ready by owner" },
];

// ── Stage section ─────────────────────────────────────────────────────────────

function StageSection({
  stage, steps, projectId,
}: {
  stage:     StagingDeploymentStage;
  steps:     StagingDeploymentStep[];
  projectId: string;
}) {
  const [open, setOpen] = useState(stage === "target" || stage === "services");
  const fail   = steps.filter((s) => s.status === "fail").length;
  const warn   = steps.filter((s) => s.status === "warning").length;
  const manual = steps.filter((s) => s.status === "manual").length;
  const pass   = steps.filter((s) => s.status === "pass").length;

  const icon =
    fail   > 0 ? <XCircle   className="h-3.5 w-3.5 text-red-500 shrink-0" /> :
    warn   > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" /> :
    manual > 0 ? <Wrench    className="h-3.5 w-3.5 text-blue-400 shrink-0" /> :
                 <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-muted/40 transition-colors text-left"
      >
        {icon}
        <span className="flex-1 text-sm font-medium">{STAGE_LABELS[stage]}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
          {pass   > 0 && <span className="text-green-600">{pass}✓</span>}
          {warn   > 0 && <span className="text-yellow-600">{warn}⚠</span>}
          {fail   > 0 && <span className="text-red-600">{fail}✗</span>}
          {manual > 0 && <span className="text-blue-500">{manual}M</span>}
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t divide-y divide-border">
          {steps.map((s) => (
            <div key={s.id} className="px-4 py-2.5 flex items-start gap-2">
              {stepIcon(s.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium">{s.label}</span>
                  {s.required && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">required</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.message}</p>
                {s.warning && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">⚠ {s.warning}</p>
                )}
                {s.command && (
                  <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded mt-1 inline-block max-w-full truncate">
                    {s.command}
                  </code>
                )}
                {s.linkHref && (
                  <Link href={s.linkHref} className="text-xs text-primary hover:underline mt-0.5 inline-block">
                    → Open page
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Service plan ──────────────────────────────────────────────────────────────

function ServicePlanCard({ svc }: { svc: StagingServicePlan }) {
  const kindColor =
    svc.kind === "api"    ? "text-blue-600 dark:text-blue-400" :
    svc.kind === "static" ? "text-green-600 dark:text-green-400" :
    "text-muted-foreground";
  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold">{svc.name}</span>
        <span className={`text-xs font-medium ${kindColor}`}>{svc.kind}</span>
        {svc.route && (
          <code className="text-[11px] font-mono bg-muted px-1 rounded ml-auto">{svc.route}</code>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Root: <code className="font-mono bg-muted px-1 rounded">{svc.root}</code></p>
      {svc.buildCommand && (
        <p className="text-xs text-muted-foreground">
          Build: <code className="font-mono bg-muted px-1 rounded">{svc.buildCommand}</code>
        </p>
      )}
      {svc.startCommand && (
        <p className="text-xs text-muted-foreground">
          Start: <code className="font-mono bg-muted px-1 rounded">{svc.startCommand}</code>
        </p>
      )}
      {svc.outputPath && (
        <p className="text-xs text-muted-foreground">
          Output: <code className="font-mono bg-muted px-1 rounded">{svc.outputPath}</code>
        </p>
      )}
      {svc.healthPath && (
        <p className="text-xs text-muted-foreground">
          Health: <code className="font-mono bg-muted px-1 rounded">{svc.healthPath}</code>
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StagingDeploymentPanel({ projectId }: { projectId: string }) {
  const [stagingSlug,   setStagingSlug]   = useState(DEFAULT_STAGING_SLUG);
  const [stagingDomain, setStagingDomain] = useState(DEFAULT_STAGING_DOMAIN);

  const [plan,         setPlan]         = useState<StagingDeploymentPlan | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sourcePlan,   setSourcePlan]   = useState<any>(null);
  const [smokeReport,  setSmokeReport]  = useState<StagingSmokeReport | null>(null);
  const [exportData,   setExportData]   = useState<{ markdown: string; filename: string } | null>(null);

  const [error,        setError]        = useState<string | null>(null);
  const [lastAction,   setLastAction]   = useState<string | null>(null);
  const [markedReady,  setMarkedReady]  = useState(false);

  const [prepareConfirm,  setPrepareConfirm]  = useState("");
  const [dryRunConfirm,   setDryRunConfirm]   = useState("");
  const [readyConfirm,    setReadyConfirm]    = useState("");

  const [evidenceDone, setEvidenceDone] = useState<Set<string>>(new Set());

  const [pending, start] = useTransition();
  const inFlight = useRef(false);

  const run = useCallback(<T,>(fn: () => Promise<T>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        await fn();
      } finally {
        inFlight.current = false;
      }
    });
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    run(async () => {
      const res = await generateStagingDeploymentPlanAction({
        projectId,
        stagingSlug:   stagingSlug.trim() || DEFAULT_STAGING_SLUG,
        stagingDomain: stagingDomain.trim() || DEFAULT_STAGING_DOMAIN,
      });
      if (!res.ok) { setError(res.error); return; }
      setPlan(res.data);
      setExportData(null);
      setLastAction("Staging deployment plan generated.");
    });
  }, [projectId, stagingSlug, stagingDomain, run]);

  const handlePrepare = useCallback(() => {
    run(async () => {
      if (prepareConfirm.trim().toUpperCase() !== "PREPARE STAGING SOURCE") {
        setError('Type "PREPARE STAGING SOURCE" to confirm.');
        return;
      }
      const res = await prepareStagingSourceAction({
        projectId,
        stagingSlug:  stagingSlug.trim() || DEFAULT_STAGING_SLUG,
        confirmation: "PREPARE STAGING SOURCE",
      });
      if (!res.ok) { setError(res.error); return; }
      setSourcePlan(res.data as typeof sourcePlan);
      setPrepareConfirm("");
      setLastAction("Source preparation plan generated.");
    });
  }, [projectId, stagingSlug, prepareConfirm, run]);

  const handleDryRun = useCallback(() => {
    run(async () => {
      if (dryRunConfirm.trim().toUpperCase() !== "RUN STAGING DRY RUN") {
        setError('Type "RUN STAGING DRY RUN" to confirm.');
        return;
      }
      const res = await runStagingDeploymentDryRunAction({
        projectId,
        stagingSlug:   stagingSlug.trim() || DEFAULT_STAGING_SLUG,
        stagingDomain: stagingDomain.trim() || DEFAULT_STAGING_DOMAIN,
        confirmation:  "RUN STAGING DRY RUN",
      });
      if (!res.ok) { setError(res.error); return; }
      setPlan(res.data.plan);
      setSmokeReport(res.data.smokeReport);
      setDryRunConfirm("");
      setLastAction(`Staging dry run complete — smoke checks: ${res.data.smokeReport.status}.`);
    });
  }, [projectId, stagingSlug, stagingDomain, dryRunConfirm, run]);

  const handleExport = useCallback(() => {
    run(async () => {
      const res = await exportStagingDeploymentProofAction({
        projectId,
        stagingSlug:   stagingSlug.trim() || DEFAULT_STAGING_SLUG,
        stagingDomain: stagingDomain.trim() || DEFAULT_STAGING_DOMAIN,
      });
      if (!res.ok) { setError(res.error); return; }
      setExportData(res.data);
      setLastAction("STAGING_DEPLOYMENT_PROOF.md ready to download.");
    });
  }, [projectId, stagingSlug, stagingDomain, run]);

  const handleMarkReady = useCallback(() => {
    run(async () => {
      if (readyConfirm.trim().toUpperCase() !== "MARK STAGING READY") {
        setError('Type "MARK STAGING READY" to confirm.');
        return;
      }
      const res = await markStagingReadyAction({
        projectId,
        confirmation: "MARK STAGING READY",
      });
      if (!res.ok) { setError(res.error); return; }
      setMarkedReady(true);
      setReadyConfirm("");
      setLastAction(`Staging marked ready at ${new Date(res.data.markedAt).toLocaleString()}.`);
    });
  }, [projectId, readyConfirm, run]);

  const toggleEvidence = useCallback((id: string) => {
    setEvidenceDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const allEvidenceDone = EVIDENCE_ITEMS.every((e) => evidenceDone.has(e.id));

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Sardar Staging Deployment</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Plan and verify a safe isolated staging deployment before production cutover.
          </p>
        </div>
        {plan && overallBadge(plan.status)}
      </div>

      {/* ── Safety banner ── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-200">
          <strong>Staging only.</strong> This workflow does not apply production nginx routes, restart live PM2 processes, run DB migrations, or touch Doorsteps/LocalShop.
          Live Sardar (port 4100) is untouched.
        </p>
      </div>

      {/* ── Staging target config ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium">Staging Target</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Staging slug</label>
            <input
              className="h-8 w-full text-xs border rounded px-2 font-mono bg-background"
              value={stagingSlug}
              onChange={(e) => setStagingSlug(e.target.value)}
              disabled={pending}
              placeholder={DEFAULT_STAGING_SLUG}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Staging domain</label>
            <input
              className="h-8 w-full text-xs border rounded px-2 font-mono bg-background"
              value={stagingDomain}
              onChange={(e) => setStagingDomain(e.target.value)}
              disabled={pending}
              placeholder={DEFAULT_STAGING_DOMAIN}
            />
          </div>
        </div>
        <ActionLoadingButton
          loading={pending}
          loadingLabel="Generating…"
          onClick={handleGenerate}
          size="sm"
          disabled={pending}
        >
          Generate Staging Plan
        </ActionLoadingButton>
      </div>

      {/* ── Error / last action ── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}
      {lastAction && !error && (
        <p className="text-xs text-green-700 dark:text-green-400">{lastAction}</p>
      )}

      {/* ── Plan sections ── */}
      {plan && (
        <div className="space-y-4">

          {/* Blockers */}
          {plan.blockers.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                {plan.blockers.length} Blocker{plan.blockers.length > 1 ? "s" : ""}
              </p>
              {plan.blockers.map((b, i) => (
                <p key={i} className="text-xs text-red-700 dark:text-red-300">• {b}</p>
              ))}
            </div>
          )}

          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {plan.warnings.length} Warning{plan.warnings.length > 1 ? "s" : ""}
              </p>
              {plan.warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">• {w}</p>
              ))}
            </div>
          )}

          {/* Service plan */}
          <div>
            <p className="text-xs font-medium mb-2">Service Plan</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {plan.servicePlan.map((svc) => (
                <ServicePlanCard key={svc.name} svc={svc} />
              ))}
            </div>
          </div>

          {/* Stage breakdown */}
          <div>
            <p className="text-xs font-medium mb-2">Plan Steps</p>
            <div className="space-y-1.5">
              {STAGE_ORDER.map((stage) => {
                const stageSteps = plan.steps.filter((s) => s.stage === stage);
                if (stageSteps.length === 0) return null;
                return (
                  <StageSection
                    key={stage}
                    stage={stage}
                    steps={stageSteps}
                    projectId={projectId}
                  />
                );
              })}
            </div>
          </div>

          {/* Source preparation plan */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Source Preparation</p>
            <p className="text-xs text-muted-foreground">
              Type <code className="font-mono bg-muted px-1 rounded">PREPARE STAGING SOURCE</code> to generate the source copy plan.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 h-8 text-xs border rounded px-2 font-mono bg-background"
                placeholder="PREPARE STAGING SOURCE"
                value={prepareConfirm}
                onChange={(e) => setPrepareConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handlePrepare(); }}
                disabled={pending}
              />
              <ActionLoadingButton
                loading={pending}
                loadingLabel="Preparing…"
                onClick={handlePrepare}
                size="sm"
                variant="outline"
                disabled={pending}
              >
                Prepare Staging Source
              </ActionLoadingButton>
            </div>
            {sourcePlan?.plan && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <div className="flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-xs font-medium">Source Copy Plan (plan-only, no files copied)</p>
                </div>
                {sourcePlan.plan && (
                  <>
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">Source: <code className="font-mono bg-muted px-1 rounded">{(sourcePlan as any).plan.sourcePath}</code></p>
                      <p className="text-[11px] text-muted-foreground">Target: <code className="font-mono bg-muted px-1 rounded">{(sourcePlan as any).plan.targetPath}</code></p>
                    </div>
                    <div className="rounded bg-muted px-2 py-1.5 max-h-48 overflow-y-auto">
                      <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed">
                        {(sourcePlan as any).plan.commands.join("\n")}
                      </pre>
                    </div>
                    {(sourcePlan as any).plan.warnings?.map((w: string, i: number) => (
                      <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">⚠ {w}</p>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Dry run */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Staging Dry Run + Smoke Checks</p>
            <p className="text-xs text-muted-foreground">
              Type <code className="font-mono bg-muted px-1 rounded">RUN STAGING DRY RUN</code> to run safe GET-only smoke checks against the staging domain.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 h-8 text-xs border rounded px-2 font-mono bg-background"
                placeholder="RUN STAGING DRY RUN"
                value={dryRunConfirm}
                onChange={(e) => setDryRunConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleDryRun(); }}
                disabled={pending}
              />
              <ActionLoadingButton
                loading={pending}
                loadingLabel="Running…"
                onClick={handleDryRun}
                size="sm"
                variant="outline"
                disabled={pending}
              >
                Run Staging Dry Run
              </ActionLoadingButton>
            </div>
            {smokeReport && (
              <div className="border rounded-lg divide-y divide-border">
                <div className="px-3 py-2 flex items-center gap-2">
                  {smokeReport.status === "passed"
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : smokeReport.status === "warning"
                    ? <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    : <XCircle className="h-4 w-4 text-red-500" />}
                  <p className="text-xs font-medium">
                    Smoke checks: {smokeReport.status.toUpperCase()} — {smokeReport.stagingDomain}
                  </p>
                </div>
                {smokeReport.results.map((r, i) => (
                  <div key={i} className="px-3 py-2 flex items-start gap-2">
                    {smokeResultIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{r.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{r.httpStatus ? `HTTP ${r.httpStatus}` : "—"}</span>
                      <p className="text-xs text-muted-foreground">{r.message}</p>
                    </div>
                    <code className="text-[10px] font-mono text-muted-foreground truncate max-w-[180px]">{r.url}</code>
                  </div>
                ))}
                {smokeReport.warnings.map((w, i) => (
                  <div key={i} className="px-3 py-1.5">
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">⚠ {w}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual evidence checklist */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-medium">Staging Evidence Checklist</p>
              <span className="text-xs text-muted-foreground">
                ({evidenceDone.size}/{EVIDENCE_ITEMS.length} complete)
              </span>
              {allEvidenceDone && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">All items complete ✓</span>
              )}
            </div>
            <div className="border rounded-lg divide-y divide-border">
              {EVIDENCE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleEvidence(item.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                >
                  {evidenceDone.has(item.id)
                    ? <CheckSquare className="h-4 w-4 text-green-500 shrink-0" />
                    : <Square      className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className={`text-xs ${evidenceDone.has(item.id) ? "line-through text-muted-foreground" : ""}`}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Next steps */}
          {plan.nextSteps.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1.5">Next Steps</p>
              <div className="space-y-0.5">
                {plan.nextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                ))}
              </div>
            </div>
          )}

          {/* Export + Mark ready */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium mb-2">Export</p>
              <div className="flex flex-wrap gap-2">
                <ActionLoadingButton
                  loading={pending}
                  loadingLabel="Generating…"
                  onClick={handleExport}
                  size="sm"
                  variant="outline"
                  disabled={pending}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Generate STAGING_DEPLOYMENT_PROOF.md
                </ActionLoadingButton>
                {exportData && (
                  <CopyDownloadButton
                    content={exportData.markdown}
                    filename={exportData.filename}
                    label="Download STAGING_DEPLOYMENT_PROOF.md"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium">Mark Staging Ready</p>
              <p className="text-xs text-muted-foreground">
                Type <code className="font-mono bg-muted px-1 rounded">MARK STAGING READY</code> after all evidence items are complete.
              </p>
              {markedReady ? (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-xs font-medium">Staging marked ready.</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-8 text-xs border rounded px-2 font-mono bg-background"
                    placeholder="MARK STAGING READY"
                    value={readyConfirm}
                    onChange={(e) => setReadyConfirm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleMarkReady(); }}
                    disabled={pending}
                  />
                  <ActionLoadingButton
                    loading={pending}
                    loadingLabel="Marking…"
                    onClick={handleMarkReady}
                    size="sm"
                    disabled={pending}
                  >
                    Mark Staging Ready
                  </ActionLoadingButton>
                </div>
              )}
            </div>
          </div>

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            Plan generated: {new Date(plan.generatedAt).toLocaleString("en-GB", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
