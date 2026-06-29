"use client";

/**
 * components/projects/smart-import-panel.tsx
 *
 * Sprint 85: Smart Import wizard panel.
 * One-click import readiness: detect stack, apply preset, check preview.
 */

import { useState } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Clock,
  Loader2, ChevronDown, ChevronUp, Download, RefreshCw,
  Terminal, Eye, Sparkles,
} from "lucide-react";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  generateSmartImportReportAction,
  applySmartImportPresetAction,
  runSmartPreviewChecksAction,
  exportSmartImportReportAction,
} from "@/app/actions/smart-import";
import type {
  SmartImportReport,
  SmartImportStatus,
} from "@/lib/smart-import/smart-import-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<SmartImportStatus, React.ReactNode> = {
  passed:  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />,
  blocked: <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />,
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
  skipped: <span className="h-3.5 w-3.5 text-muted-foreground shrink-0 text-xs">—</span>,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />,
};

function StatusIcon({ status }: { status: SmartImportStatus }) {
  return <>{STATUS_ICON[status]}</>;
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const variant = confidence === "high" ? "success" : confidence === "medium" ? "warning" : "secondary";
  return <Badge variant={variant as "success" | "warning" | "secondary"}>{confidence} confidence</Badge>;
}

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stage timeline ────────────────────────────────────────────────────────────

const TIMELINE_STAGES = [
  { id: "source",           label: "Source detected" },
  { id: "detect",           label: "Stack detected" },
  { id: "configure",        label: "Preset selected" },
  { id: "secrets",          label: "Env checked" },
  { id: "database",         label: "Database checked" },
  { id: "deploy_preview",   label: "Deploy config checked" },
  { id: "verify_preview",   label: "Preview verified" },
  { id: "ready_for_go_live", label: "Ready for Go Live" },
] as const;

function TimelineRow({
  label,
  status,
}: {
  label: string;
  status: SmartImportStatus;
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusIcon status={status} />
      <span className={[
        "text-xs",
        status === "passed"  ? "text-foreground" :
        status === "blocked" ? "text-destructive" :
        status === "warning" ? "text-yellow-600 dark:text-yellow-400" :
        "text-muted-foreground",
      ].join(" ")}>
        {label}
      </span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SmartImportPanelProps {
  projectId: string;
  compact?:  boolean;
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SmartImportPanel({ projectId, compact }: SmartImportPanelProps) {
  const [report,          setReport]          = useState<SmartImportReport | null>(null);
  const [previewChecks,   setPreviewChecks]   = useState<SmartImportReport["previewChecks"] | null>(null);
  const [reportLoading,   setReportLoading]   = useState(false);
  const [presetLoading,   setPresetLoading]   = useState(false);
  const [previewLoading,  setPreviewLoading]  = useState(false);
  const [exportLoading,   setExportLoading]   = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [presetResult,    setPresetResult]    = useState<string | null>(null);
  const [showDetails,     setShowDetails]     = useState(false);

  // ── Compact mode ──────────────────────────────────────────────────────────
  if (compact) {
    return (
      <Card>
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Smart Import</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-detect commands, route mode, static output, and preview readiness.
            </p>
          </div>
          <a
            href={`/projects/${projectId}/import`}
            className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
          >
            Go to Import →
          </a>
        </CardContent>
      </Card>
    );
  }

  async function handleGenerateReport() {
    setReportLoading(true);
    setError(null);
    setPresetResult(null);
    setPreviewChecks(null);
    try {
      const result = await generateSmartImportReportAction({ projectId });
      if (result.ok) {
        setReport(result.data);
        setShowDetails(true);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setReportLoading(false);
    }
  }

  async function handleApplyPreset() {
    setPresetLoading(true);
    setError(null);
    try {
      const result = await applySmartImportPresetAction({ projectId });
      if (result.ok) {
        setPresetResult(`Preset applied: ${result.data.presetLabel}. Visit Publishing to deploy.`);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPresetLoading(false);
    }
  }

  async function handlePreviewChecks() {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await runSmartPreviewChecksAction({ projectId });
      if (result.ok) {
        setPreviewChecks(result.data);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExport() {
    setExportLoading(true);
    setError(null);
    try {
      const result = await exportSmartImportReportAction({ projectId });
      if (result.ok) {
        downloadMarkdown(result.data.markdown, result.data.filename);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setExportLoading(false);
    }
  }

  // Derive overall status for timeline display
  function stageStatus(stageId: string): SmartImportStatus {
    if (!report) return "pending";
    const stageSteps = report.steps.filter((s) => s.stage === stageId);
    if (stageSteps.length === 0) return "skipped";
    if (stageSteps.some((s) => s.status === "blocked"))  return "blocked";
    if (stageSteps.some((s) => s.status === "warning"))  return "warning";
    if (stageSteps.every((s) => s.status === "passed" || s.status === "skipped")) return "passed";
    return "pending";
  }

  const hasBlockers  = (report?.blockers.length ?? 0) > 0;
  const hasWarnings  = (report?.warnings.length ?? 0) > 0;
  const isHighConf   = report?.selectedPreset?.confidence === "high";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="h-4 w-4 text-primary shrink-0" />
          <CardTitle className="text-base">Smart Import</CardTitle>
          {isHighConf && (
            <Badge variant="success" className="gap-1">
              <Sparkles className="h-3 w-3" />
              High confidence preset
            </Badge>
          )}
          {report && !isHighConf && (
            <Badge variant="secondary">Manual review recommended</Badge>
          )}
        </div>
        <CardDescription>
          One-click import readiness: detect stack, apply best preset, verify preview.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Action buttons ── */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleGenerateReport} disabled={reportLoading}>
            {reportLoading
              ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Analysing…</>
              : <><RefreshCw className="h-3 w-3 mr-1.5" />Start Smart Import Analysis</>
            }
          </Button>

          {report && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleApplyPreset}
              disabled={presetLoading || !!presetResult}
            >
              {presetLoading
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Applying…</>
                : <><Terminal className="h-3 w-3 mr-1.5" />Apply Recommended Preset</>
              }
            </Button>
          )}

          {report && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreviewChecks}
              disabled={previewLoading}
            >
              {previewLoading
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Checking…</>
                : <><Eye className="h-3 w-3 mr-1.5" />Run Preview Checks</>
              }
            </Button>
          )}

          {report && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExport}
              disabled={exportLoading}
            >
              {exportLoading
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Exporting…</>
                : <><Download className="h-3 w-3 mr-1.5" />Export Report</>
              }
            </Button>
          )}
        </div>

        {/* ── Feedback messages ── */}
        {presetResult && (
          <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {presetResult}
          </p>
        )}
        {error && (
          <p className="text-xs text-destructive flex items-start gap-1.5">
            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {/* ── Report summary ── */}
        {report && (
          <div className="space-y-4">
            {/* Blockers */}
            {hasBlockers && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                <p className="text-xs font-semibold text-destructive">Blockers</p>
                {report.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-destructive/80">{b}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {hasWarnings && !hasBlockers && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10 p-3 space-y-1">
                <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Warnings</p>
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-700/80 dark:text-yellow-400/80">{w}</p>
                ))}
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Import Timeline
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                {TIMELINE_STAGES.map((stage) => (
                  <TimelineRow
                    key={stage.id}
                    label={stage.label}
                    status={stageStatus(stage.id)}
                  />
                ))}
              </div>
            </div>

            {/* Preset summary */}
            {report.selectedPreset && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">Recommended Preset</p>
                  <ConfidenceBadge confidence={report.selectedPreset.confidence} />
                </div>
                <p className="text-xs text-muted-foreground">{report.selectedPreset.label}</p>
                <div className="font-mono text-xs space-y-0.5 text-foreground">
                  <div><span className="text-muted-foreground">install: </span>{report.selectedPreset.installCommand}</div>
                  <div><span className="text-muted-foreground">build:   </span>{report.selectedPreset.buildCommand}</div>
                  {report.selectedPreset.startCommand && (
                    <div><span className="text-muted-foreground">start:   </span>{report.selectedPreset.startCommand}</div>
                  )}
                  <div><span className="text-muted-foreground">health:  </span>{report.selectedPreset.healthPath}</div>
                  <div><span className="text-muted-foreground">mode:    </span>{report.selectedPreset.routeMode}</div>
                  {report.selectedPreset.staticOutputPath && (
                    <div><span className="text-muted-foreground">static:  </span>{report.selectedPreset.staticOutputPath}</div>
                  )}
                </div>
              </div>
            )}

            {/* Missing env names */}
            {report.missingEnvNames.length > 0 && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-50/20 dark:bg-yellow-950/10 p-3">
                <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1">
                  Missing env var names
                </p>
                <div className="flex flex-wrap gap-1">
                  {report.missingEnvNames.map((n) => (
                    <code key={n} className="text-xs bg-muted px-1.5 py-0.5 rounded">{n}</code>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Add values in the Environment tab — never paste secrets here.
                </p>
              </div>
            )}

            {/* Preview checks */}
            {previewChecks && previewChecks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Preview Checks
                </p>
                {previewChecks.map((c, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <StatusIcon status={c.status} />
                    <span className="text-xs">
                      <code className="font-mono">{c.path}</code>
                      {" — "}
                      {c.result ?? c.expected}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Recommended next steps */}
            {report.recommendedNextSteps.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Next Steps
                </p>
                {report.recommendedNextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary shrink-0">{i + 1}.</span>
                    {s}
                  </p>
                ))}
              </div>
            )}

            {/* Step details toggle */}
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails
                ? <><ChevronUp className="h-3 w-3" />Hide step details</>
                : <><ChevronDown className="h-3 w-3" />Show step details ({report.steps.length} steps)</>
              }
            </button>

            {showDetails && (
              <div className="space-y-1.5 border-t pt-3">
                {report.steps.map((s) => (
                  <div key={s.id} className="flex items-start gap-2">
                    <StatusIcon status={s.status} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{s.label}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">— {s.message}</span>
                      {s.recommendedFix && (
                        <p className="text-xs text-primary mt-0.5">Fix: {s.recommendedFix}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Go-live safety note */}
        <p className="text-xs text-muted-foreground border-t pt-3">
          Smart Import never triggers automatic go-live. Final production promotion requires manual confirmation in the Publishing tab.
        </p>
      </CardContent>
    </Card>
  );
}
