"use client";

/**
 * components/projects/staging-import-panel.tsx
 *
 * Sprint 51: Staging import executor panel.
 *
 * Guides the user through creating a staging project, configuring services,
 * setting env placeholders, running a build, and validating with smoke checks.
 *
 * Safety:
 *  - no secrets exposed
 *  - no live project mutated
 *  - no automatic project creation
 *  - no route apply
 *  - no DB command execution
 */

import { useState }  from "react";
import Link          from "next/link";
import {
  Server, CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  RefreshCw, Download, ExternalLink, ChevronDown, ChevronRight,
  Play, Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import {
  generateStagingImportPlanAction,
  prepareStagingChecklistAction,
  runStagingSmokeChecksAction,
  exportStagingImportReportAction,
}                                                   from "@/app/actions/staging-import";
import type {
  StagingImportPlan,
  StagingImportStep,
  StagingImportStatus,
  StagingImportStepCategory,
  StagingSmokeReport,
}                                                   from "@/lib/migration/staging-import-types";
import {
  STAGING_CATEGORY_LABEL,
  STAGING_CATEGORY_ORDER,
  STAGING_SLUG,
  STAGING_DOMAIN,
}                                                   from "@/lib/migration/staging-import-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StagingImportStatus }) {
  if (status === "ready" || status === "passed")   return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "blocked" || status === "failed") return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "warning")                        return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  if (status === "running")                        return <Loader2       className="h-4 w-4 text-primary animate-spin shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

function StatusBadge({ status }: { status: StagingImportStatus }) {
  const map: Record<StagingImportStatus, { label: string; cls: string }> = {
    not_started: { label: "Not Started",  cls: "bg-gray-100 text-gray-600 border-gray-200" },
    ready:       { label: "Ready",        cls: "bg-green-100 text-green-800 border-green-200" },
    warning:     { label: "Warning",      cls: "bg-amber-100 text-amber-800 border-amber-200" },
    blocked:     { label: "Blocked",      cls: "bg-red-100 text-red-800 border-red-200" },
    running:     { label: "Running",      cls: "bg-blue-100 text-blue-800 border-blue-200" },
    passed:      { label: "Passed",       cls: "bg-green-100 text-green-800 border-green-200" },
    failed:      { label: "Failed",       cls: "bg-red-100 text-red-800 border-red-200" },
  };
  const { label, cls } = map[status];
  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>;
}

// ── Single step row ───────────────────────────────────────────────────────────

function StepRow({ s }: { s: StagingImportStep }) {
  const [open, setOpen] = useState(s.status === "blocked" || s.status === "failed");
  const hasDetails = s.description || s.command || s.warning || s.linkHref;

  return (
    <div className={`border-b last:border-0 ${s.status === "not_started" ? "opacity-60" : ""}`}>
      <button
        className="w-full flex items-start gap-2.5 py-2.5 px-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <StepIcon status={s.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium leading-snug">{s.title}</span>
            {s.required && s.status !== "ready" && s.status !== "passed" && (
              <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1 rounded">Required</span>
            )}
          </div>
        </div>
        {hasDetails && (
          open
            ? <ChevronDown  className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {open && hasDetails && (
        <div className="px-3 pb-3 pl-10 space-y-2">
          {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
          {s.warning && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded px-2 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {s.warning}
            </div>
          )}
          {s.command && (
            <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded break-all">
              {s.command}
            </code>
          )}
          {s.linkHref && (
            <Link href={s.linkHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Go there <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category group ────────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  steps,
  defaultOpen,
}: {
  category:    StagingImportStepCategory;
  steps:       StagingImportStep[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const failCount = steps.filter((s) => s.required && (s.status === "blocked" || s.status === "failed")).length;
  const passCount = steps.filter((s) => s.status === "ready" || s.status === "passed").length;
  const total     = steps.length;

  const borderColor = failCount > 0
    ? "border-red-200 bg-red-50/30 dark:bg-red-950/10"
    : passCount === total
    ? "border-green-200 bg-green-50/30 dark:bg-green-950/10"
    : "border-border";

  return (
    <div className={`rounded-md border ${borderColor}`}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold flex-1">{STAGING_CATEGORY_LABEL[category]}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{passCount}/{total}</span>
          {failCount > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded">{failCount} blocker{failCount > 1 ? "s" : ""}</span>
          )}
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="divide-y border-t bg-background">
          {steps.map((s) => <StepRow key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

// ── Smoke results ─────────────────────────────────────────────────────────────

function SmokePanel({ report }: { report: StagingSmokeReport }) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        {report.overallPass
          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
        Smoke checks {report.overallPass ? "passed" : "need review"} — {report.stagingDomain}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(report.runAt).toLocaleTimeString("en-GB")}
        </span>
      </div>
      {report.checks.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
          {c.status === "pass"    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
          : c.status === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          : c.status === "skipped" ? <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className="font-medium">{c.label}</span>
            {c.statusCode && <span className="text-muted-foreground ml-1">HTTP {c.statusCode}</span>}
            {c.durationMs !== undefined && <span className="text-muted-foreground ml-1">{c.durationMs}ms</span>}
            <p className="text-muted-foreground">{c.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type ActiveAction = "plan" | "checklist" | "smoke" | "export" | null;

export function StagingImportPanel({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?:  boolean;
}) {
  const [plan,         setPlan]         = useState<StagingImportPlan | null>(null);
  const [smokeReport,  setSmokeReport]  = useState<StagingSmokeReport | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [exported,     setExported]     = useState(false);
  const [stagingDomain, setStagingDomain] = useState(STAGING_DOMAIN);

  // ── Plan ────────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setActiveAction("plan");
    setError(null);
    try {
      const res = await generateStagingImportPlanAction(projectId);
      if (res.ok) {
        setPlan(res.plan);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Plan generation failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Checklist ───────────────────────────────────────────────────────────────

  async function handleChecklist() {
    setActiveAction("checklist");
    setError(null);
    try {
      const res = await prepareStagingChecklistAction({ projectId, stagingDomain });
      if (res.ok) {
        setPlan(res.plan);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Checklist preparation failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Smoke checks ─────────────────────────────────────────────────────────────

  async function handleSmoke() {
    setActiveAction("smoke");
    setError(null);
    try {
      const res = await runStagingSmokeChecksAction({ sourceProjectId: projectId, stagingDomain });
      if (res.ok) {
        setSmokeReport(res.report);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Smoke checks failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport() {
    setActiveAction("export");
    setError(null);
    try {
      const res = await exportStagingImportReportAction({ sourceProjectId: projectId, stagingDomain });
      if (res.ok) {
        const blob = new Blob([res.markdown], { type: "text/markdown;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
        setExported(true);
        setTimeout(() => setExported(false), 3000);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Export failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Compact variant ──────────────────────────────────────────────────────────

  if (compact) {
    const compactStatus = plan?.status ?? "not_started";
    return (
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold">Staging Import</p>
                <p className="text-[10px] text-muted-foreground">Sardar Security Supplies staging import plan</p>
              </div>
              <StatusBadge status={compactStatus} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!plan ? (
                <Button type="button" size="sm" variant="outline" onClick={handleGenerate} disabled={activeAction !== null}>
                  {activeAction === "plan"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : "Generate"}
                </Button>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={handleGenerate} disabled={activeAction !== null}>
                  {activeAction === "plan"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Link href={`/projects/${projectId}/migration`}>
                <Button size="sm" variant="outline">
                  View <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────────

  const groupedSteps = plan
    ? STAGING_CATEGORY_ORDER.map((cat) => ({
        category: cat,
        steps:    plan.steps.filter((s) => s.category === cat),
      })).filter((g) => g.steps.length > 0)
    : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                Staging Import Plan
                {plan && <StatusBadge status={plan.status} />}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sardar Security Supplies — safe staging import and validation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {plan && (
              <Button type="button" size="sm" variant="outline" onClick={handleExport} disabled={activeAction !== null}>
                {activeAction === "export"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Exporting…</>
                  : exported
                  ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500 mr-1.5" />Downloaded!</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" />Export</>
                }
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={handleGenerate} disabled={activeAction !== null}>
              {activeAction === "plan"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generating…</>
                : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{plan ? "Re-generate" : "Generate Staging Plan"}</>
              }
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* ── Empty state ── */}
        {!plan && !error && (
          <div className="text-center py-6 space-y-3">
            <Server className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-medium">Staging Import Plan</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Generates a step-by-step staging import checklist covering project setup,
                source import, service configuration, env placeholders, database, routing,
                build validation, and smoke checks.
              </p>
            </div>
            <Button type="button" onClick={handleGenerate} disabled={activeAction !== null}>
              {activeAction === "plan"
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating…</>
                : <><Play className="h-4 w-4 mr-2" />Generate Staging Plan</>
              }
            </Button>
            <p className="text-[10px] text-muted-foreground">
              No commands are executed. No secrets are copied. No live project is modified.
            </p>
          </div>
        )}

        {/* ── Staging project recommendation ── */}
        {plan && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">Recommended Staging Setup</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Staging slug</span>
                <code className="block font-mono text-sm mt-0.5">{plan.recommendedStagingSlug}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Staging domain</span>
                <code className="block font-mono text-sm mt-0.5">{plan.recommendedStagingDomain}</code>
              </div>
            </div>
          </div>
        )}

        {/* ── Summary stats ── */}
        {plan && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            {[
              { label: "Steps",    value: plan.steps.length,                                                     color: "text-foreground" },
              { label: "Blockers", value: plan.blockers.length,   color: plan.blockers.length > 0 ? "text-destructive" : "text-green-600" },
              { label: "Warnings", value: plan.warnings.length,   color: plan.warnings.length > 0 ? "text-amber-600"   : "text-green-600" },
              { label: "Ready",    value: plan.steps.filter((s) => s.status === "ready" || s.status === "passed").length, color: "text-green-600" },
            ].map((st) => (
              <div key={st.label} className="rounded-md border py-2">
                <p className={`text-base font-semibold ${st.color}`}>{st.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{st.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Blockers ── */}
        {plan && plan.blockers.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-red-700">{plan.blockers.length} blocker{plan.blockers.length > 1 ? "s" : ""}</p>
            {plan.blockers.map((b, i) => (
              <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
              </p>
            ))}
          </div>
        )}

        {/* ── Next steps ── */}
        {plan && plan.nextSteps.length > 0 && (
          <div className="space-y-1 border-l-2 border-primary/30 pl-3">
            <p className="text-xs font-semibold">Next steps</p>
            {plan.nextSteps.map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s}
              </p>
            ))}
          </div>
        )}

        {/* ── Steps by category ── */}
        {plan && groupedSteps.length > 0 && (
          <div className="space-y-2">
            {groupedSteps.map(({ category, steps }) => (
              <CategoryGroup
                key={category}
                category={category}
                steps={steps}
                defaultOpen={steps.some((s) => s.status === "blocked" || s.status === "failed")}
              />
            ))}
          </div>
        )}

        {/* ── Staging domain config + actions ── */}
        {plan && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold">Staging Domain Configuration</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={stagingDomain}
                onChange={(e) => setStagingDomain(e.target.value)}
                className="flex-1 h-8 rounded-md border bg-background px-3 text-xs font-mono"
                placeholder={STAGING_DOMAIN}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleChecklist}
                disabled={activeAction !== null}
              >
                {activeAction === "checklist"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Preparing…</>
                  : "Prepare Staging Checklist"
                }
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSmoke}
                disabled={activeAction !== null}
              >
                {activeAction === "smoke"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Running…</>
                  : <><Play className="h-3.5 w-3.5 mr-1.5" />Run Staging Smoke Checks</>
                }
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Smoke checks run against the staging domain above — not the live production domain.
            </p>
          </div>
        )}

        {/* ── Smoke check results ── */}
        {smokeReport && (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold mb-2">Smoke Check Results</p>
            <SmokePanel report={smokeReport} />
          </div>
        )}

        {/* ── Safety notice ── */}
        {plan && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-amber-800">Safety reminders</p>
            <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
              <li>No live Sardar project settings are modified</li>
              <li>No production secrets are copied to staging automatically</li>
              <li>No routes are applied automatically</li>
              <li>Staging database is separate from production</li>
              <li>Smoke checks run against staging domain only</li>
            </ul>
          </div>
        )}

        {plan && (
          <p className="text-[10px] text-muted-foreground text-right border-t pt-2">
            Generated {new Date(plan.generatedAt).toLocaleString("en-GB")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
