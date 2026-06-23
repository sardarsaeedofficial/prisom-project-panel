"use client";

/**
 * components/projects/database-readiness-panel.tsx
 *
 * Sprint 45: Database Migration Readiness panel for the Database page.
 *
 * Safety rules:
 *  - No secret values displayed
 *  - Blocked commands never shown
 *  - Caution commands show confirmation prompt before copy
 *  - Connection test result shows host/latency only
 */

import { useState }          from "react";
import { Badge }             from "@/components/ui/badge";
import { Button }            from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  RefreshCw,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
  Shield,
  AlertCircle,
} from "lucide-react";
import {
  generateDatabaseReadinessReportAction,
  testProjectDatabaseConnectionAction,
  copyDatabaseCommandAction,
} from "@/app/actions/project-database-readiness";
import type {
  DatabaseReadinessReport,
  DatabaseEnvFinding,
  DatabaseCommand,
  DatabaseManualStep,
} from "@/lib/database/db-readiness-types";

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
};

// ── Active action type ────────────────────────────────────────────────────────

type ActiveAction = "generate" | "test" | `copy:${string}`;

// ── Sub-components ────────────────────────────────────────────────────────────

function EnvVarRow({ finding }: { finding: DatabaseEnvFinding }) {
  const configured = finding.valueConfigured;
  const present    = finding.presentInVault;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="mt-0.5 shrink-0">
        {configured ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : present ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono font-medium">{finding.name}</code>
          {finding.required && (
            <Badge variant="secondary" className="text-xs">required</Badge>
          )}
          {!present && (
            <Badge variant="destructive" className="text-xs">missing</Badge>
          )}
          {present && !configured && (
            <Badge variant="warning" className="text-xs">placeholder</Badge>
          )}
        </div>
        {finding.maskedPreview && (
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
            {finding.maskedPreview}
          </p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-0.5">{finding.purpose}</p>
      </div>
    </div>
  );
}

function CommandRow({
  cmd,
  isActive,
  onCopy,
}: {
  cmd:      DatabaseCommand;
  isActive: boolean;
  onCopy:   () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");

  const badgeVariant =
    cmd.safety === "safe"    ? "success" :
    cmd.safety === "caution" ? "warning" :
    "destructive";

  function handleCopyClick() {
    if (cmd.safety === "caution") {
      setShowConfirm(true);
    } else {
      onCopy();
    }
  }

  function handleConfirm() {
    if (confirmInput === cmd.confirmText) {
      setShowConfirm(false);
      setConfirmInput("");
      onCopy();
    }
  }

  return (
    <div className="py-3 border-b border-border/50 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium">{cmd.label}</span>
            <Badge variant={badgeVariant} className="text-xs">{cmd.safety}</Badge>
          </div>
          <code className="text-xs font-mono bg-muted px-2 py-1 rounded block break-all">
            {cmd.command}
          </code>
          <p className="text-xs text-muted-foreground mt-1">{cmd.description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 h-8 px-2"
          onClick={handleCopyClick}
          disabled={isActive}
          title="Copy command"
        >
          {isActive ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {showConfirm && (
        <div className="mt-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 space-y-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            This command modifies your production database. Type{" "}
            <strong>{cmd.confirmText}</strong> to copy it.
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 text-xs px-2 py-1 border border-amber-300 rounded bg-white dark:bg-zinc-900 font-mono"
              placeholder={cmd.confirmText}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            />
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={handleConfirm}
              disabled={confirmInput !== cmd.confirmText}
            >
              Confirm Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowConfirm(false); setConfirmInput(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualStepRow({ step }: { step: DatabaseManualStep }) {
  const icon =
    step.severity === "required"    ? <XCircle      className="h-4 w-4 text-red-500 shrink-0" /> :
    step.severity === "recommended" ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> :
                                      <AlertCircle   className="h-4 w-4 text-blue-500 shrink-0" />;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-medium">{step.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DatabaseReadinessPanel({ projectId }: Props) {
  const [report,       setReport]       = useState<DatabaseReadinessReport | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [lastAction,   setLastAction]   = useState<string>("");
  const [connResult,   setConnResult]   = useState<{
    ok: boolean; latencyMs?: number; host?: string; provider?: string; error?: string;
  } | null>(null);
  const [copiedId,     setCopiedId]     = useState<string | null>(null);
  const [showSteps,    setShowSteps]    = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (activeAction) return;
    setActiveAction("generate");
    setError(null);
    setLastAction("Generate Report clicked");
    try {
      const res = await generateDatabaseReadinessReportAction(projectId);
      if (!res.ok || !res.report) {
        setError(res.error ?? "Failed to generate report.");
        setLastAction("Generate Report failed");
        return;
      }
      setReport(res.report);
      setLastAction(`Generate Report completed — score ${res.report.readinessScore}/100`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected client error.");
      setLastAction("Generate Report crashed");
    } finally {
      setActiveAction(null);
    }
  }

  async function handleTestConnection() {
    if (activeAction) return;
    setActiveAction("test");
    setError(null);
    setLastAction("Test Connection clicked");
    try {
      const res = await testProjectDatabaseConnectionAction(projectId);
      if (!res.ok) {
        setError(res.error ?? "Connection test failed.");
        setLastAction("Test Connection failed");
        return;
      }
      setConnResult(res.result ?? null);
      setLastAction(
        res.result?.ok
          ? `Connection OK — ${res.result.latencyMs}ms`
          : `Connection failed — ${res.result?.error?.slice(0, 60) ?? "unknown"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected client error.");
      setLastAction("Test Connection crashed");
    } finally {
      setActiveAction(null);
    }
  }

  async function handleCopy(commandId: string) {
    if (activeAction) return;
    const key: ActiveAction = `copy:${commandId}`;
    setActiveAction(key);
    setLastAction(`Copy command "${commandId}" clicked`);
    try {
      const res = await copyDatabaseCommandAction(projectId, commandId);
      if (!res.ok || !res.command) {
        setError(res.error ?? "Copy failed.");
        setLastAction(`Copy command "${commandId}" failed`);
        return;
      }
      await navigator.clipboard.writeText(res.command).catch(() => null);
      setCopiedId(commandId);
      setLastAction(`Copied: ${res.command.slice(0, 60)}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected client error.");
      setLastAction(`Copy command "${commandId}" crashed`);
    } finally {
      setActiveAction(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isGenerating = activeAction === "generate";
  const isTesting    = activeAction === "test";
  const requiredEnvsOk = report
    ? report.envFindings.filter((f) => f.required && !f.valueConfigured).length === 0
    : null;

  return (
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-sm">Database Migration Readiness</h3>
              <p className="text-xs text-muted-foreground">Pre-production database health for go-live</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {report && (
              <div className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full ${
                  report.isReady ? "bg-green-500" : report.blockers.length > 0 ? "bg-red-500" : "bg-amber-500"
                }`} />
                <span className="text-xs text-muted-foreground">{report.readinessScore}/100</span>
              </div>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleGenerate}
              disabled={!!activeAction}
            >
              {isGenerating ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Scanning…</>
              ) : (
                <><Database className="h-3.5 w-3.5 mr-1.5" /> Generate Report</>
              )}
            </Button>
          </div>
        </div>

        {/* ── Diagnostics ── */}
        {lastAction && (
          <p className="text-xs text-muted-foreground">Last action: {lastAction}</p>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-300 font-medium">Error</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>
          </div>
        )}

        {report && (
          <>
            {/* ── Detected tool + provider ── */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {report.tool ? (
                  <Badge variant="secondary" className="capitalize font-medium">
                    {report.tool.tool}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-muted-foreground">No ORM detected</Badge>
                )}
                {report.provider && report.provider.provider !== "unknown" && (
                  <Badge variant="outline" className="capitalize">
                    {report.provider.provider}
                    {report.provider.host ? ` · ${report.provider.host}` : ""}
                  </Badge>
                )}
                {report.isReady ? (
                  <Badge variant="success" className="ml-auto">Ready</Badge>
                ) : report.blockers.length > 0 ? (
                  <Badge variant="destructive" className="ml-auto">Blocked</Badge>
                ) : (
                  <Badge variant="warning" className="ml-auto">Warnings</Badge>
                )}
              </div>
              {report.tool?.detectedVia && (
                <p className="text-xs text-muted-foreground">
                  Detected via {report.tool.detectedVia}
                  {report.tool.configFile ? ` · ${report.tool.configFile}` : ""}
                  {report.tool.migrationsDir ? ` · ${report.tool.migrationsDir}` : ""}
                </p>
              )}
            </div>

            {/* ── Blockers ── */}
            {report.blockers.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 space-y-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-300 flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" /> Blockers ({report.blockers.length})
                </p>
                {report.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">• {b}</p>
                ))}
              </div>
            )}

            {/* ── Warnings ── */}
            {report.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-1">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Warnings ({report.warnings.length})
                </p>
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 dark:text-amber-400">• {w}</p>
                ))}
              </div>
            )}

            {/* ── Env vars ── */}
            {report.envFindings.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">Required Env Vars</h4>
                  {requiredEnvsOk === true && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> All configured
                    </span>
                  )}
                  {requiredEnvsOk === false && (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Missing required vars
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-border divide-y divide-border/50">
                  {report.envFindings.map((f) => (
                    <div key={f.name} className="px-3">
                      <EnvVarRow finding={f} />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Go to <strong>Secrets</strong> to add or update env vars.
                </p>
              </div>
            )}

            {/* ── Commands ── */}
            {report.commands.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Recommended Commands</h4>
                <div className="rounded-lg border border-border divide-y divide-border/50">
                  {report.commands.map((cmd) => (
                    <div key={cmd.id} className="px-3">
                      <CommandRow
                        cmd={cmd}
                        isActive={activeAction === `copy:${cmd.id}` || copiedId === cmd.id}
                        onCopy={() => handleCopy(cmd.id)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Connection test ── */}
            <div className="rounded-lg border border-border px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium">Connection Test</h4>
                  <p className="text-xs text-muted-foreground">Runs SELECT 1 — no data read or written.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={!!activeAction}
                >
                  {isTesting ? (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Testing…</>
                  ) : (
                    <><Wifi className="h-3.5 w-3.5 mr-1.5" /> Test Connection</>
                  )}
                </Button>
              </div>

              {connResult && (
                <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                  connResult.ok
                    ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300"
                    : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300"
                }`}>
                  {connResult.ok
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    : <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
                  }
                  <div>
                    {connResult.ok ? (
                      <>
                        <span className="font-medium">Connected</span>
                        {connResult.latencyMs != null && ` · ${connResult.latencyMs}ms`}
                        {connResult.host && ` · ${connResult.host}`}
                        {connResult.provider && ` (${connResult.provider})`}
                      </>
                    ) : (
                      <>
                        <span className="font-medium">Connection failed</span>
                        {connResult.error && ` — ${connResult.error}`}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Manual steps (collapsible) ── */}
            {report.manualSteps.length > 0 && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-medium w-full text-left mb-2"
                  onClick={() => setShowSteps((v) => !v)}
                >
                  {showSteps
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />
                  }
                  Manual Steps ({report.manualSteps.length})
                </button>
                {showSteps && (
                  <div className="rounded-lg border border-border divide-y divide-border/50">
                    {report.manualSteps.map((step) => (
                      <div key={step.id} className="px-3">
                        <ManualStepRow step={step} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!report && !error && !isGenerating && (
          <div className="text-center py-6 text-muted-foreground">
            <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Click Generate Report to scan your database configuration.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
