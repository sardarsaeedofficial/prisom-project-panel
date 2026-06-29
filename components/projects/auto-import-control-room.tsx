"use client";

/**
 * components/projects/auto-import-control-room.tsx
 *
 * Sprint 86: Auto Import Control Room.
 * Replit-style import loop: analyze → fix → retry → preview live.
 */

import { useState } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Clock,
  Loader2, RefreshCw, Download, Globe, Server,
  Database, Key, Terminal, Eye, ChevronDown, ChevronUp,
  ShieldCheck, ExternalLink, ArrowRight,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  runAutoImportAnalysisAction,
  applyAutoImportSafeFixAction,
  retryAutoImportDeployAction,
  exportAutoImportRunbookAction,
} from "@/app/actions/auto-import";
import type {
  AutoImportRun,
  AutoImportStatus,
  AutoImportSafeFix,
} from "@/lib/auto-import/auto-import-types";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AutoImportStatus, string> = {
  not_started:       "text-muted-foreground",
  analyzing:         "text-blue-500",
  needs_env:         "text-yellow-600 dark:text-yellow-400",
  needs_database:    "text-orange-600 dark:text-orange-400",
  config_ready:      "text-blue-500",
  deploying:         "text-blue-500",
  fix_available:     "text-yellow-600 dark:text-yellow-400",
  retry_ready:       "text-blue-500",
  preview_live:      "text-green-600 dark:text-green-400",
  ready_for_go_live: "text-green-600 dark:text-green-400",
  blocked:           "text-destructive",
};

const STATUS_LABEL: Record<AutoImportStatus, string> = {
  not_started:       "Not started",
  analyzing:         "Analyzing…",
  needs_env:         "Needs env vars",
  needs_database:    "Needs database",
  config_ready:      "Config ready",
  deploying:         "Deploying…",
  fix_available:     "Fix available",
  retry_ready:       "Ready to retry",
  preview_live:      "Preview is live",
  ready_for_go_live: "Ready for Go Live",
  blocked:           "Blocked",
};

function StatusBadge({ status }: { status: AutoImportStatus }) {
  const color =
    status === "preview_live" || status === "ready_for_go_live" ? "success" :
    status === "blocked"                                         ? "destructive" :
    status === "needs_env" || status === "needs_database" ||
    status === "fix_available"                                   ? "warning" :
    "secondary";
  return (
    <Badge variant={color as "success" | "destructive" | "warning" | "secondary"}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function CheckIcon({ status }: { status: "pass" | "warning" | "blocked" }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
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

// ── Fix confirmation dialog ────────────────────────────────────────────────────

function FixCard({
  fix,
  onApply,
  applying,
}: {
  fix: AutoImportSafeFix;
  onApply: (fixId: string, confirmation: string) => Promise<void>;
  applying: boolean;
}) {
  const [conf, setConf] = useState("");
  const required = fix.confirmationRequired;
  const ready    = !required || conf.trim() === fix.confirmationPhrase;

  return (
    <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{fix.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{fix.description}</p>
        </div>
      </div>
      <ul className="pl-5 text-xs space-y-0.5 text-muted-foreground list-disc">
        {fix.changes.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
      {required && (
        <div className="flex items-center gap-2">
          <Input
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            placeholder={`Type: ${fix.confirmationPhrase}`}
            className="h-7 text-xs font-mono"
          />
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!ready || applying}
        onClick={() => onApply(fix.id, required ? conf.trim() : "APPLY SAFE FIX")}
        className="h-7 text-xs"
      >
        {applying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
        Apply Safe Fix
      </Button>
    </div>
  );
}

// ── Compact card ───────────────────────────────────────────────────────────────

interface AutoImportControlRoomProps {
  projectId: string;
  compact?:  boolean;
}

function CompactCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4 flex items-start gap-3">
        <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Auto Import Control Room</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Analyze, auto-fix, retry deploy, and verify preview. No secrets shown.
          </p>
        </div>
        <a
          href={`/projects/${projectId}/import`}
          className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5 flex items-center gap-1"
        >
          Open <ArrowRight className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}

// ── Full control room ──────────────────────────────────────────────────────────

export function AutoImportControlRoom({ projectId, compact }: AutoImportControlRoomProps) {
  if (compact) return <CompactCard projectId={projectId} />;

  const [run,           setRun]           = useState<AutoImportRun | null>(null);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [applying,      setApplying]      = useState<string | null>(null); // fixId being applied
  const [retrying,      setRetrying]      = useState(false);
  const [retryConf,     setRetryConf]     = useState("");
  const [exporting,     setExporting]     = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [fixMessages,   setFixMessages]   = useState<Record<string, string>>({});
  const [showDetails,   setShowDetails]   = useState(false);
  const [retryResult,   setRetryResult]   = useState<string | null>(null);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    const res = await runAutoImportAnalysisAction({ projectId });
    setAnalyzing(false);
    if (res.ok) {
      setRun(res.data);
    } else {
      setError(res.error);
    }
  }

  async function applyFix(fixId: string, confirmation: string) {
    setApplying(fixId);
    setError(null);
    const res = await applyAutoImportSafeFixAction({ projectId, fixId, confirmation });
    setApplying(null);
    if (res.ok) {
      setFixMessages((prev) => ({ ...prev, [fixId]: res.data.message }));
      await analyze(); // re-analyze after fix
    } else {
      setError(res.error);
    }
  }

  async function retryDeploy() {
    if (retryConf !== "RETRY DEPLOY") {
      setError("Type RETRY DEPLOY to confirm.");
      return;
    }
    setRetrying(true);
    setError(null);
    const res = await retryAutoImportDeployAction({ projectId, confirmation: retryConf });
    setRetrying(false);
    if (res.ok) {
      setRetryResult(res.data.message);
      setRetryConf("");
      await analyze();
    } else {
      setError(res.error);
    }
  }

  async function exportRunbook() {
    setExporting(true);
    const res = await exportAutoImportRunbookAction({ projectId });
    setExporting(false);
    if (res.ok) {
      downloadMarkdown(res.data.markdown, res.data.filename);
    } else {
      setError(res.error);
    }
  }

  const status = run?.status ?? "not_started";

  return (
    <div className="space-y-4">
      {/* ── Header card ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Auto Import Control Room</CardTitle>
                <CardDescription className="mt-0.5">
                  Analyze your project, apply safe fixes, retry deploy, and verify preview. No secrets shown.
                </CardDescription>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={analyze}
              disabled={analyzing}
            >
              {analyzing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Analyzing…</>
                : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Analyze Import</>
              }
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={exportRunbook}
              disabled={exporting || !run}
            >
              {exporting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Exporting…</>
                : <><Download className="h-3.5 w-3.5 mr-1.5" /> Export Runbook</>
              }
            </Button>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
          )}
          {retryResult && (
            <p className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded px-3 py-2">
              {retryResult}
            </p>
          )}
        </CardContent>
      </Card>

      {run && (
        <>
          {/* ── Detected Stack ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Terminal className="h-4 w-4" /> Detected Stack
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground text-xs">Package Manager</dt>
                <dd className="text-xs font-mono">{run.detectedStack.packageManager}</dd>

                {run.detectedStack.framework.length > 0 && (
                  <>
                    <dt className="text-muted-foreground text-xs">Frameworks</dt>
                    <dd className="text-xs">{run.detectedStack.framework.join(", ")}</dd>
                  </>
                )}

                {run.detectedStack.services.length > 0 && (
                  <>
                    <dt className="text-muted-foreground text-xs">Services</dt>
                    <dd className="text-xs space-y-0.5">
                      {run.detectedStack.services.map((s, i) => (
                        <div key={i}>{s}</div>
                      ))}
                    </dd>
                  </>
                )}

                {run.detectedStack.routeMode && (
                  <>
                    <dt className="text-muted-foreground text-xs">Route Mode</dt>
                    <dd className="text-xs font-mono">{run.detectedStack.routeMode}</dd>
                  </>
                )}

                {run.detectedStack.staticOutputPath && (
                  <>
                    <dt className="text-muted-foreground text-xs">Static Output</dt>
                    <dd className="text-xs font-mono">{run.detectedStack.staticOutputPath}</dd>
                  </>
                )}

                {run.detectedStack.healthPath && (
                  <>
                    <dt className="text-muted-foreground text-xs">Health Path</dt>
                    <dd className="text-xs font-mono">{run.detectedStack.healthPath}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* ── Domains / Preview URLs ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Globe className="h-4 w-4" /> Preview & Live URLs
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {run.domains.length === 0 ? (
                <p className="text-xs text-muted-foreground">No endpoints configured yet. Deploy the project first.</p>
              ) : (
                run.domains.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {d.type === "internal" ? <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> :
                       d.type === "preview"  ? <Eye    className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> :
                                               <Globe  className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-mono truncate">{d.url}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={d.status === "working" ? "success" : "secondary"} className="text-xs">
                        {d.type} · {d.status}
                      </Badge>
                      {d.type !== "internal" && (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
              {!run.domains.some((d) => d.type === "public") && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-1.5 mt-2">
                  No public domain attached yet. Add a domain before final go-live.
                </p>
              )}
              {run.status === "preview_live" || run.status === "ready_for_go_live" ? (
                <p className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded px-2 py-1.5 mt-2">
                  Preview is live.
                </p>
              ) : null}
              {run.issues.some((i) => i.kind === "frontend_not_served") && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-1.5 mt-2">
                  API is healthy, but frontend is not served. Apply API + Static Frontend routing fix below.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Missing Env Values ────────────────────────────────────────── */}
          {run.missingEnvNames.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Key className="h-4 w-4" /> Missing Env Vars
                  <Badge variant="warning" className="text-xs ml-1">
                    {run.missingEnvNames.filter((e) => e.required).length} required
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Names only — no values shown. Add these in the Environment tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {run.missingEnvNames.map((e) => (
                  <div key={e.name} className="flex items-start gap-2 text-xs py-0.5">
                    <span className={`font-mono shrink-0 ${e.required ? "text-destructive" : "text-muted-foreground"}`}>
                      {e.name}
                    </span>
                    <span className="text-muted-foreground">{e.purpose}</span>
                    {e.required && <Badge variant="destructive" className="text-[10px] h-4 shrink-0">required</Badge>}
                    {e.secret && <Badge variant="secondary" className="text-[10px] h-4 shrink-0">secret</Badge>}
                  </div>
                ))}
                <a
                  href={`/projects/${projectId}/env`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                >
                  Go to Environment tab <ArrowRight className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* ── Database Guidance ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Database className="h-4 w-4" /> Database Guidance
                <Badge
                  variant={run.database.targetConfigured ? "success" : "warning"}
                  className="text-xs ml-1"
                >
                  {run.database.targetConfigured ? "configured" : "not configured"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2 text-xs text-muted-foreground">
              <p>{run.database.message}</p>
              <div className="space-y-1">
                <p><span className="text-foreground font-medium">Target DB (Prisom):</span>{" "}
                  {run.database.targetConfigured ? "✓ DATABASE_URL is set" : "✗ DATABASE_URL missing — add in Environment tab"}
                </p>
                <p><span className="text-foreground font-medium">Cloudinary:</span>{" "}
                  Not a database — configure separately for media uploads
                </p>
                <p><span className="text-foreground font-medium">Stripe:</span>{" "}
                  Not a database — configure separately for payments
                </p>
              </div>
              {!run.database.targetConfigured && (
                <a
                  href={`/projects/${projectId}/env`}
                  className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
                >
                  Add DATABASE_URL <ArrowRight className="h-3 w-3" />
                </a>
              )}
            </CardContent>
          </Card>

          {/* ── Issues + Safe Fixes ────────────────────────────────────────── */}
          {run.issues.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Issues Found
                  <Badge variant="secondary" className="text-xs ml-1">{run.issues.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {run.issues.map((issue) => (
                  <div key={issue.id} className="space-y-2">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{issue.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{issue.message}</p>
                        {issue.evidence && (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5 bg-muted/50 rounded px-2 py-1">
                            {issue.evidence}
                          </p>
                        )}
                      </div>
                    </div>
                    {issue.fix && !fixMessages[issue.fix.id] && (
                      <FixCard
                        fix={issue.fix}
                        onApply={applyFix}
                        applying={applying === issue.fix.id}
                      />
                    )}
                    {issue.fix && fixMessages[issue.fix.id] && (
                      <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {fixMessages[issue.fix.id]}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── Preview Checks ────────────────────────────────────────────── */}
          {run.previewChecks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Eye className="h-4 w-4" /> Preview Checks
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1.5">
                {run.previewChecks.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <CheckIcon status={c.status} />
                    <span className="font-mono shrink-0">{c.path}</span>
                    <span className="text-muted-foreground">{c.result}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── Retry Deploy ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4" /> Retry Deploy
              </CardTitle>
              <CardDescription className="text-xs">
                After applying fixes, retry the deploy. Type <code className="font-mono">RETRY DEPLOY</code> to confirm.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={retryConf}
                  onChange={(e) => setRetryConf(e.target.value)}
                  placeholder="Type: RETRY DEPLOY"
                  className="h-7 text-xs font-mono max-w-[200px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryConf !== "RETRY DEPLOY" || retrying}
                  onClick={retryDeploy}
                  className="h-7 text-xs"
                >
                  {retrying
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Deploying…</>
                    : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry Deploy</>
                  }
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Recommended Next Steps ────────────────────────────────────── */}
          {run.recommendedNextSteps.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4" /> Recommended Next Steps
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ol className="space-y-1 text-xs">
                  {run.recommendedNextSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-muted-foreground">
                      <span className="shrink-0 text-foreground font-medium">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* ── Safety note ───────────────────────────────────────────────── */}
          <div className="text-xs text-muted-foreground flex items-start gap-2 px-1">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              No secrets shown. All fixes require confirmation. No automatic go-live.
              No database wipe. No DNS mutation without confirmation.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
