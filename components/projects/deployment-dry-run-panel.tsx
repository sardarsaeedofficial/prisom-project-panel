"use client";

/**
 * components/projects/deployment-dry-run-panel.tsx
 *
 * Sprint 53: Deployment dry-run mode panel.
 *
 * Safety rules:
 *  - no secrets shown
 *  - no live deploy triggered
 *  - build execution requires RUN BUILD DRY RUN confirmation
 *  - all mutations require explicit user action
 */

import { useState }   from "react";
import Link           from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  Download, ChevronDown, ChevronRight, Play, Shield,
  Wrench, Package,
} from "lucide-react";
import { RequiredPermissionNote } from "@/components/projects/required-permission-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import {
  generateDeploymentDryRunPlanAction,
  runDeploymentBuildDryRunAction,
  exportDeploymentDryRunReportAction,
}                                                   from "@/app/actions/deployment-dry-run";
import type {
  DeploymentDryRunPlan,
  DeploymentDryRunCheck,
  DeploymentDryRunStatus,
  DeploymentDryRunCategory,
  DeploymentDryRunBuildResult,
}                                                   from "@/lib/deploy/dry-run-types";

// ── Category labels & order ───────────────────────────────────────────────────

const CATEGORY_LABEL: Record<DeploymentDryRunCategory, string> = {
  source:          "Source",
  package_manager: "Package Manager",
  install:         "Install",
  build:           "Build",
  services:        "Services",
  env:             "Environment",
  database:        "Database",
  routing:         "Routing",
  domain:          "Domain",
  smoke:           "Smoke Checks",
  manual:          "Manual Steps",
};

const CATEGORY_ORDER: DeploymentDryRunCategory[] = [
  "source", "package_manager", "install", "build", "services",
  "env", "database", "routing", "domain", "smoke", "manual",
];

// ── Status helpers ────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: DeploymentDryRunCheck["status"] }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "fail")    return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

function StatusBadge({ status }: { status: DeploymentDryRunStatus }) {
  const map: Record<DeploymentDryRunStatus, { label: string; cls: string }> = {
    ready:   { label: "Ready",   cls: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300" },
    warning: { label: "Warning", cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300" },
    blocked: { label: "Blocked", cls: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300" },
    running: { label: "Running", cls: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300" },
    passed:  { label: "Passed",  cls: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300" },
    failed:  { label: "Failed",  cls: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300" },
  };
  const { label, cls } = map[status];
  return <Badge className={`${cls} border text-[10px] font-semibold`}>{label}</Badge>;
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ c }: { c: DeploymentDryRunCheck }) {
  const [open, setOpen] = useState(c.status === "fail" || c.status === "warning");
  const hasDetails = c.evidence || c.command || c.linkHref;

  return (
    <div className={`border-b last:border-0 ${c.status === "manual" ? "opacity-70" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-start gap-2 py-2 px-3 hover:bg-muted/30 transition-colors"
        disabled={!hasDetails}
      >
        <CheckIcon status={c.status} />
        <span className="flex-1 min-w-0 text-sm">{c.label}</span>
        {hasDetails && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-2 ml-6 space-y-1">
          <p className="text-xs text-muted-foreground">{c.message}</p>
          {c.command && (
            <code className="block text-xs font-mono bg-muted/60 rounded px-2 py-1 break-all">
              {c.command}
            </code>
          )}
          {c.evidence && c.evidence.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
              {c.evidence.map((e, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="text-muted-foreground/50">•</span>
                  <code className="font-mono">{e}</code>
                </li>
              ))}
            </ul>
          )}
          {c.linkHref && (
            <Link href={c.linkHref} className="text-xs text-primary hover:underline">
              Open →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({ category, checks }: { category: DeploymentDryRunCategory; checks: DeploymentDryRunCheck[] }) {
  const hasFailure = checks.some((c) => c.status === "fail");
  const hasWarning = checks.some((c) => c.status === "warning");
  const allPass    = checks.every((c) => c.status === "pass" || c.status === "manual");
  const [open, setOpen] = useState(hasFailure || hasWarning);

  const headerStatus =
    hasFailure ? "text-red-700 dark:text-red-400" :
    hasWarning ? "text-amber-700 dark:text-amber-400" :
    allPass    ? "text-green-700 dark:text-green-400" :
    "text-muted-foreground";

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className={`text-xs font-semibold ${headerStatus}`}>
          {CATEGORY_LABEL[category]}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {checks.filter((c) => c.status === "pass").length}/{checks.length}
          </span>
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          }
        </div>
      </button>
      {open && (
        <div className="divide-y">
          {checks.map((c) => <CheckRow key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

// ── Build result view ─────────────────────────────────────────────────────────

function BuildResultView({ result }: { result: DeploymentDryRunBuildResult }) {
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${result.success ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
      <div className="flex items-center gap-2">
        {result.success
          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
          : <XCircle className="h-4 w-4 text-red-500" />
        }
        <span className="text-sm font-medium">
          {result.success ? "Build succeeded" : "Build failed"}
          {result.serviceName ? ` — ${result.serviceName}` : ""}
          {" "}({(result.durationMs / 1000).toFixed(1)}s)
        </span>
      </div>
      {result.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
      )}
      {result.command && (
        <code className="block text-xs font-mono bg-muted/60 rounded px-2 py-1">{result.command}</code>
      )}
      {result.stdout && (
        <pre className="text-xs font-mono bg-muted/40 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">{result.stdout.slice(0, 3000)}</pre>
      )}
      {result.stderr && (
        <pre className="text-xs font-mono bg-muted/40 rounded p-2 overflow-x-auto max-h-24 text-amber-700 dark:text-amber-400 whitespace-pre-wrap">{result.stderr.slice(0, 1000)}</pre>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  compact?:  boolean;
};

export function DeploymentDryRunPanel({ projectId, compact }: Props) {
  const [plan,          setPlan]          = useState<DeploymentDryRunPlan | null>(null);
  const [buildResult,   setBuildResult]   = useState<DeploymentDryRunBuildResult | null>(null);
  const [exportMd,      setExportMd]      = useState<string | null>(null);
  const [loadingPlan,   setLoadingPlan]   = useState(false);
  const [loadingBuild,  setLoadingBuild]  = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [planError,     setPlanError]     = useState<string | null>(null);
  const [buildError,    setBuildError]    = useState<string | null>(null);
  const [exportError,   setExportError]   = useState<string | null>(null);
  const [buildConfirm,  setBuildConfirm]  = useState("");
  const [showBuildBox,  setShowBuildBox]  = useState(false);

  const CONFIRM_PHRASE = "RUN BUILD DRY RUN";

  async function handleGeneratePlan() {
    setLoadingPlan(true);
    setPlanError(null);
    try {
      const res = await generateDeploymentDryRunPlanAction(projectId);
      if (res.ok) {
        setPlan(res.data);
      } else {
        setPlanError(res.error);
      }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingPlan(false);
    }
  }

  async function handleRunBuild() {
    if (buildConfirm !== CONFIRM_PHRASE) return;
    setLoadingBuild(true);
    setBuildError(null);
    try {
      const res = await runDeploymentBuildDryRunAction({
        projectId,
        confirmation: buildConfirm,
      });
      if (res.ok) {
        setBuildResult(res.data);
        setShowBuildBox(false);
        setBuildConfirm("");
      } else {
        setBuildError(res.error);
      }
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingBuild(false);
    }
  }

  async function handleExport() {
    setLoadingExport(true);
    setExportError(null);
    try {
      const res = await exportDeploymentDryRunReportAction(projectId);
      if (res.ok) {
        setExportMd(res.data.markdown);
        // Trigger download
        const blob = new Blob([res.data.markdown], { type: "text/markdown" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "DEPLOYMENT_DRY_RUN_REPORT.md";
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setExportError(res.error);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingExport(false);
    }
  }

  // ── Compact variant ─────────────────────────────────────────────────────────

  if (compact) {
    return (
      <Card className="border-blue-200/60 bg-blue-50/30 dark:bg-blue-950/10">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="h-4 w-4 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Deployment Dry Run</p>
              <p className="text-xs text-muted-foreground">
                Validate before deploying — no live changes.
                {plan && <span className="ml-1"><StatusBadge status={plan.status} /></span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!plan ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleGeneratePlan}
                disabled={loadingPlan}
                className="h-7 text-xs"
              >
                {loadingPlan ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {loadingPlan ? "Checking…" : "Run Check"}
              </Button>
            ) : (
              <Link
                href={`/projects/${projectId}/publishing`}
                className="text-xs text-primary hover:underline shrink-0"
              >
                View Details →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Full panel ──────────────────────────────────────────────────────────────

  const groupedChecks = plan
    ? CATEGORY_ORDER.reduce<Record<string, DeploymentDryRunCheck[]>>((acc, cat) => {
        const items = plan.checks.filter((c) => c.category === cat);
        if (items.length > 0) acc[cat] = items;
        return acc;
      }, {})
    : {};

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <CardTitle className="text-base">Deployment Dry Run</CardTitle>
            {plan && <StatusBadge status={plan.status} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleGeneratePlan}
              disabled={loadingPlan}
              className="h-7 text-xs"
            >
              {loadingPlan
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Running…</>
                : <><Play className="h-3 w-3 mr-1" />{plan ? "Re-run Check" : "Generate Dry Run Plan"}</>
              }
            </Button>
            {plan && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowBuildBox((o) => !o)}
                  disabled={loadingBuild}
                  className="h-7 text-xs"
                >
                  <Wrench className="h-3 w-3 mr-1" />Run Build Dry Run
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleExport}
                  disabled={loadingExport}
                  className="h-7 text-xs"
                >
                  {loadingExport
                    ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Exporting…</>
                    : <><Download className="h-3 w-3 mr-1" />Export Report</>
                  }
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Validates install, build, service readiness, env, database, routing, and domain without
          changing live production traffic.
        </p>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">

        {/* ── Plan error ── */}
        {planError && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
            {planError}
          </div>
        )}

        {/* ── Export confirmation ── */}
        {exportMd && !exportError && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-3 text-sm text-green-700 dark:text-green-400">
            DEPLOYMENT_DRY_RUN_REPORT.md downloaded.
          </div>
        )}
        {exportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
            Export failed: {exportError}
          </div>
        )}

        {/* ── Build confirmation box ── */}
        {showBuildBox && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Run Build Dry Run</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  This will run the configured build command in the project source directory.
                  No PM2 restarts, no nginx changes, no DB migrations.
                  Type <code className="font-mono">{CONFIRM_PHRASE}</code> to proceed.
                </p>
              </div>
            </div>
            <RequiredPermissionNote permission="project.edit" description="Developers, Admins, and Owners can run build dry-runs." />
            <input
              type="text"
              value={buildConfirm}
              onChange={(e) => setBuildConfirm(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleRunBuild}
                disabled={buildConfirm !== CONFIRM_PHRASE || loadingBuild}
                className="h-7 text-xs"
              >
                {loadingBuild
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Building…</>
                  : <><Play className="h-3 w-3 mr-1" />Run Build</>
                }
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { setShowBuildBox(false); setBuildConfirm(""); setBuildError(null); }}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
            </div>
            {buildError && (
              <p className="text-xs text-red-600 dark:text-red-400">{buildError}</p>
            )}
          </div>
        )}

        {/* ── Build result ── */}
        {buildResult && <BuildResultView result={buildResult} />}

        {/* ── No plan yet ── */}
        {!plan && !loadingPlan && !planError && (
          <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center space-y-2">
            <Package className="h-6 w-6 text-muted-foreground/50 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Generate a dry-run plan to validate deployment readiness before going live.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Checks source, install/build commands, services, env, database, routing, domain, and smoke-check plan.
            </p>
          </div>
        )}

        {loadingPlan && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running deployment dry-run checks…
          </div>
        )}

        {/* ── Plan results ── */}
        {plan && (
          <div className="space-y-3">

            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Passed",   val: plan.checks.filter((c) => c.status === "pass").length,    cls: "text-green-700 dark:text-green-400" },
                { label: "Warnings", val: plan.checks.filter((c) => c.status === "warning").length, cls: "text-amber-700 dark:text-amber-400" },
                { label: "Failed",   val: plan.checks.filter((c) => c.status === "fail").length,    cls: "text-red-700 dark:text-red-400" },
                { label: "Manual",   val: plan.checks.filter((c) => c.status === "manual").length,  cls: "text-muted-foreground" },
              ].map(({ label, val, cls }) => (
                <div key={label} className="rounded-lg border bg-muted/20 px-3 py-2 text-center">
                  <p className={`text-xl font-bold ${cls}`}>{val}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Blockers */}
            {plan.blockers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                  {plan.blockers.length} Blocker{plan.blockers.length > 1 ? "s" : ""} — Resolve before deploying
                </p>
                {plan.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 dark:text-red-400">• {b}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {plan.warnings.length > 0 && plan.blockers.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  {plan.warnings.length} Warning{plan.warnings.length > 1 ? "s" : ""}
                </p>
                {plan.warnings.slice(0, 5).map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-400">• {w}</p>
                ))}
              </div>
            )}

            {/* Next steps */}
            {plan.nextSteps.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">Next Steps</p>
                {plan.nextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                ))}
              </div>
            )}

            {/* Grouped checks */}
            <div className="space-y-2">
              {CATEGORY_ORDER.filter((cat) => groupedChecks[cat]).map((cat) => (
                <CategorySection
                  key={cat}
                  category={cat}
                  checks={groupedChecks[cat]!}
                />
              ))}
            </div>

            <p className="text-xs text-muted-foreground text-right">
              Generated {new Date(plan.generatedAt).toLocaleString("en-GB", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
