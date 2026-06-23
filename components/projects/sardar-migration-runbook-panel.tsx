"use client";

/**
 * components/projects/sardar-migration-runbook-panel.tsx
 *
 * Sprint 50: Sardar Security Supplies ecommerce migration runbook panel.
 *
 * Displays all 10 migration stages with collapsible checklists,
 * blockers, warnings, and recommended next steps.
 * Provides a one-click export to SARDAR_MIGRATION_RUNBOOK.md.
 *
 * Safety:
 *  - no secrets exposed
 *  - no auto-cutover
 *  - no DB commands executed
 *  - all actions are manual confirmations
 */

import { useState }  from "react";
import Link          from "next/link";
import {
  ShieldCheck, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertTriangle, Clock, Loader2, RefreshCw, Download, ExternalLink,
  Play, Pause, Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import {
  generateSardarMigrationRunbookAction,
  exportSardarMigrationRunbookAction,
} from "@/app/actions/sardar-migration-runbook";
import type {
  SardarMigrationRunbook,
  SardarMigrationChecklistItem,
  SardarMigrationStatus,
  SardarMigrationStage,
} from "@/lib/migration/sardar-migration-types";
import { SARDAR_STAGE_ORDER } from "@/lib/migration/sardar-migration-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SardarMigrationStatus }) {
  if (status === "ready")       return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "blocked")     return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "in_progress") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  if (status === "manual")      return <Clock         className="h-4 w-4 text-blue-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

function StatusBadge({ status, required }: { status: SardarMigrationStatus; required?: boolean }) {
  if (status === "ready")       return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Ready</Badge>;
  if (status === "blocked")     return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">Blocked</Badge>;
  if (status === "in_progress") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">In Progress</Badge>;
  if (status === "manual")      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">Manual</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Not Started</Badge>;
}

function OverallStatusBadge({ status }: { status: "ready" | "warning" | "blocked" }) {
  if (status === "ready")   return <Badge className="bg-green-100 text-green-800 border-green-200">Ready</Badge>;
  if (status === "blocked") return <Badge className="bg-red-100 text-red-800 border-red-200">Blocked</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">In Progress</Badge>;
}

// ── Single checklist item ─────────────────────────────────────────────────────

function ChecklistItem({ it, projectId }: { it: SardarMigrationChecklistItem; projectId: string }) {
  const [open, setOpen] = useState(it.status === "blocked");
  const hasDetails = it.description || it.command || it.warning || it.fixHref;

  return (
    <div className={`border-b last:border-0 ${it.status === "not_started" ? "opacity-60" : ""}`}>
      <button
        className="w-full flex items-start gap-2.5 py-2.5 px-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <StatusIcon status={it.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium leading-snug">{it.title}</span>
            {it.required && it.status !== "ready" && (
              <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1 rounded">Required</span>
            )}
          </div>
        </div>
        {hasDetails && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {open && hasDetails && (
        <div className="px-3 pb-3 pl-10 space-y-2">
          {it.description && (
            <p className="text-xs text-muted-foreground">{it.description}</p>
          )}
          {it.warning && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded px-2 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {it.warning}
            </div>
          )}
          {it.command && (
            <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded break-all">
              {it.command}
            </code>
          )}
          {it.fixHref && (
            <Link
              href={it.fixHref}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Fix this <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stage group ───────────────────────────────────────────────────────────────

function StageGroup({
  stageData,
  projectId,
  defaultOpen,
}: {
  stageData: SardarMigrationRunbook["stages"][number];
  projectId: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const failCount = stageData.items.filter((i) => i.required && i.status === "blocked").length;
  const passCount = stageData.items.filter((i) => i.status === "ready").length;
  const total     = stageData.items.length;

  const borderColor = stageData.status === "blocked"     ? "border-red-200 bg-red-50/30 dark:bg-red-950/10"
                    : stageData.status === "ready"        ? "border-green-200 bg-green-50/30 dark:bg-green-950/10"
                    : stageData.status === "in_progress"  ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/10"
                    : "border-border";

  return (
    <div className={`rounded-md border ${borderColor}`}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <StatusIcon status={stageData.status} />
        <span className="text-xs font-semibold flex-1">{stageData.title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{passCount}/{total}</span>
          {failCount > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded">{failCount} blocker{failCount > 1 ? "s" : ""}</span>
          )}
          <StatusBadge status={stageData.status} />
        </div>
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="divide-y border-t bg-background">
          {stageData.items.map((it) => (
            <ChecklistItem key={it.id} it={it} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type ActiveAction = "generate" | "export" | null;

export function SardarMigrationRunbookPanel({
  projectId,
  compact = false,
}: {
  projectId:  string;
  compact?:   boolean;
}) {
  const [runbook,      setRunbook]      = useState<SardarMigrationRunbook | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [exported,     setExported]     = useState(false);

  // ── Generate ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setActiveAction("generate");
    setError(null);
    setExported(false);
    try {
      const res = await generateSardarMigrationRunbookAction(projectId);
      if (res.ok) {
        setRunbook(res.runbook);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Failed to generate runbook. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport() {
    setActiveAction("export");
    setError(null);
    try {
      const res = await exportSardarMigrationRunbookAction(projectId);
      if (res.ok) {
        // Trigger download
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
      setError("Failed to export runbook. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Compact variant (for publishing/releases pages) ──────────────────────────

  if (compact) {
    return (
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold">Sardar Migration Runbook</p>
                <p className="text-[10px] text-muted-foreground">Ecommerce migration checklist for Sardar Security Supplies</p>
              </div>
              {runbook && <OverallStatusBadge status={runbook.overallStatus} />}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!runbook ? (
                <Button size="sm" variant="outline" onClick={handleGenerate} disabled={activeAction !== null}>
                  {activeAction === "generate"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : "Generate"}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={handleGenerate} disabled={activeAction !== null}>
                  {activeAction === "generate"
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

  // ── Full panel ───────────────────────────────────────────────────────────────

  const stageOrder = SARDAR_STAGE_ORDER;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                Sardar Migration Runbook
                {runbook && <OverallStatusBadge status={runbook.overallStatus} />}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sardar Security Supplies ecommerce — all 10 migration stages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {runbook && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={activeAction !== null}
              >
                {activeAction === "export"
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Exporting…</>
                  : exported
                  ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500 mr-1.5" />Downloaded!</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" />Export</>
                }
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              disabled={activeAction !== null}
            >
              {activeAction === "generate"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generating…</>
                : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{runbook ? "Re-generate" : "Generate Runbook"}</>
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

        {!runbook && !error && (
          <div className="text-center py-6 space-y-3">
            <Package className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-medium">Sardar Security Supplies Migration Runbook</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Generates a complete 10-stage migration checklist: source audit, staging import,
                service config, env/secrets, database, Stripe/Cloudinary/email, routing,
                staging validation, production cutover, and post go-live checks.
              </p>
            </div>
            <Button onClick={handleGenerate} disabled={activeAction !== null}>
              {activeAction === "generate"
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating…</>
                : <><Play className="h-4 w-4 mr-2" />Generate Runbook</>
              }
            </Button>
            <p className="text-[10px] text-muted-foreground">No commands are executed. No secrets are exposed. No automatic cutover.</p>
          </div>
        )}

        {runbook && (
          <>
            {/* ── Summary ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              {[
                { label: "Stages",   value: runbook.stages.length,                                                                           color: "text-foreground" },
                { label: "Blockers", value: runbook.blockers.length,   color: runbook.blockers.length > 0   ? "text-destructive" : "text-green-600" },
                { label: "Warnings", value: runbook.warnings.length,   color: runbook.warnings.length > 0   ? "text-amber-600"   : "text-green-600" },
                { label: "Ready",    value: runbook.stages.filter((s) => s.status === "ready").length,                                       color: "text-green-600" },
              ].map((s) => (
                <div key={s.label} className="rounded-md border py-2">
                  <p className={`text-base font-semibold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* ── Blockers ── */}
            {runbook.blockers.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                <p className="text-xs font-semibold text-red-700">
                  {runbook.blockers.length} blocker{runbook.blockers.length > 1 ? "s" : ""}
                </p>
                {runbook.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
                  </p>
                ))}
              </div>
            )}

            {/* ── Warnings ── */}
            {runbook.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                <p className="text-xs font-semibold text-amber-700">
                  {runbook.warnings.length} item{runbook.warnings.length > 1 ? "s" : ""} need attention
                </p>
                {runbook.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}

            {/* ── Next Steps ── */}
            {runbook.recommendedNextSteps.length > 0 && (
              <div className="space-y-1 border-l-2 border-primary/30 pl-3">
                <p className="text-xs font-semibold">Recommended next steps</p>
                {runbook.recommendedNextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s}
                  </p>
                ))}
              </div>
            )}

            {/* ── Stage groups ── */}
            <div className="space-y-2">
              {stageOrder.map((stage) => {
                const stageData = runbook.stages.find((s) => s.stage === stage);
                if (!stageData) return null;
                const defaultOpen = stageData.status === "blocked" || stageData.status === "in_progress";
                return (
                  <StageGroup
                    key={stage}
                    stageData={stageData}
                    projectId={projectId}
                    defaultOpen={defaultOpen}
                  />
                );
              })}
            </div>

            {/* ── Safety notice ── */}
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-amber-800">Safety reminders</p>
              <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                <li>Production cutover is fully manual — no automatic promotion</li>
                <li>No DNS changes are made automatically</li>
                <li>No database migration commands are executed</li>
                <li>No Stripe live webhooks are auto-enabled</li>
                <li>Application rollback does not revert database changes</li>
              </ul>
            </div>

            <p className="text-[10px] text-muted-foreground text-right border-t pt-2">
              Generated {new Date(runbook.generatedAt).toLocaleString("en-GB")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
