"use client";

/**
 * components/projects/source-intake-panel.tsx
 *
 * Sprint 57: Source Intake Readiness panel.
 *
 * Full variant: detailed report with services, database, env names, Replit markers.
 * Compact variant: status badge + summary + link to Import/Migration page.
 *
 * Safety: never shows secret values, never triggers deploy, never runs migrations.
 */

import { useState }    from "react";
import Link            from "next/link";
import {
  PackageSearch, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Download, ChevronDown, ChevronRight, Database, Globe, Key,
  Layers, Terminal, RefreshCw, ExternalLink, Info,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import { Input }   from "@/components/ui/input";
import {
  generateSourceIntakeReportAction,
  exportSourceIntakeReportAction,
  validateGitHubImportInputAction,
  prepareGitHubImportAction,
} from "@/app/actions/source-intake";
import type {
  SourceIntakeReport,
  SourceIntakeStatus,
  GitHubImportValidation,
} from "@/lib/import/source-intake-types";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SourceIntakeStatus }) {
  const map: Record<SourceIntakeStatus, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    ready:   { variant: "success",   label: "Ready"   },
    warning: { variant: "warning",   label: "Warning" },
    blocked: { variant: "error",     label: "Blocked" },
    unknown: { variant: "secondary", label: "Unknown" },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// ── Check icon ────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: "pass" | "warning" | "fail" | "manual" }) {
  if (status === "pass")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  if (status === "fail")    return <XCircle       className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

// ── Compact variant ───────────────────────────────────────────────────────────

function CompactPanel({ projectId, report, loading, onGenerate }: {
  projectId: string;
  report:    SourceIntakeReport | null;
  loading:   boolean;
  onGenerate: () => void;
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3 flex-wrap">
          <PackageSearch className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Source Intake</p>
            <p className="text-xs text-muted-foreground">
              Package manager, services, database, env names.
              {report && <span className="ml-1"><StatusBadge status={report.status} /></span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!report ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onGenerate}
                disabled={loading}
                className="h-7 text-xs"
              >
                {loading
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Analyzing…</>
                  : "Analyze Source"
                }
              </Button>
            ) : (
              <Link
                href={`/projects/${projectId}/import`}
                className="text-xs text-primary hover:underline shrink-0"
              >
                View Details →
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Check categories ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  source:          "Source",
  package_manager: "Package Manager",
  monorepo:        "Workspace / Monorepo",
  services:        "Services",
  database:        "Database",
  env:             "Environment Variables",
  replit:          "Replit Markers",
  security:        "Security",
  manual:          "Manual Steps",
};

// ── GitHub import card ────────────────────────────────────────────────────────

function GitHubImportCard({ projectId }: { projectId: string }) {
  const [repoUrl,       setRepoUrl]       = useState("");
  const [branch,        setBranch]        = useState("main");
  const [validation,    setValidation]    = useState<GitHubImportValidation | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [prepResult,    setPrepResult]    = useState<{ destPath: string; manualCommand: string } | null>(null);
  const [prepLoading,   setPrepLoading]   = useState(false);
  const [prepError,     setPrepError]     = useState<string | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState("");
  const [open,          setOpen]          = useState(false);

  async function handleValidate() {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setValidation(null);
    setPrepResult(null);
    setPrepError(null);
    try {
      const result = await validateGitHubImportInputAction({ repositoryUrl: repoUrl, branch });
      if (result.ok) setValidation(result.data);
    } catch {
      // validation UI already shows nothing on failure; loading clears below
    } finally {
      setLoading(false);
    }
  }

  async function handlePrepare() {
    if (!validation?.isValid) return;
    setPrepLoading(true);
    setPrepError(null);
    try {
      const result = await prepareGitHubImportAction({
        projectId,
        repositoryUrl: repoUrl,
        branch,
        confirmation: replaceConfirm.trim() === "REPLACE SOURCE" ? "REPLACE SOURCE" : undefined,
      });
      if (result.ok) setPrepResult(result.data);
      else            setPrepError(result.error);
    } catch (e) {
      setPrepError(e instanceof Error ? e.message : "Prepare failed — please try again.");
    } finally {
      setPrepLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground text-left"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Globe className="h-4 w-4 text-primary" />
          Import from GitHub Repository
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            Validate a GitHub repository URL and branch before cloning. The actual{" "}
            <code className="font-mono text-xs">git clone</code> command must be run manually on the server.
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Repository URL</label>
              <Input
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setValidation(null); }}
                placeholder="https://github.com/owner/repo"
                className="text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Branch</label>
              <Input
                value={branch}
                onChange={(e) => { setBranch(e.target.value); setValidation(null); }}
                placeholder="main"
                className="text-sm font-mono w-48"
              />
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleValidate}
            disabled={loading || !repoUrl.trim()}
            className="h-8 text-xs"
          >
            {loading
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Validating…</>
              : "Validate Repository"
            }
          </Button>

          {validation && (
            <div className={`rounded-lg border p-3 text-sm space-y-2 ${
              validation.isValid ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"
            }`}>
              {validation.isValid ? (
                <>
                  <p className="font-medium text-green-700 dark:text-green-300 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Valid repository
                  </p>
                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>Owner: <code className="font-mono">{validation.owner}</code></p>
                    <p>Repo: <code className="font-mono">{validation.repo}</code></p>
                    <p>Branch: <code className="font-mono">{validation.branch}</code></p>
                    <p>Destination: <code className="font-mono">{validation.destPath}</code></p>
                    {validation.alreadyExists && (
                      <p className="text-yellow-600 dark:text-yellow-400">
                        ⚠️ Source already exists at this path.
                      </p>
                    )}
                  </div>

                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300">{w}</p>
                  ))}

                  {/* Replace source confirmation */}
                  {validation.alreadyExists && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">
                        Type <code className="font-mono">REPLACE SOURCE</code> to confirm overwrite:
                      </p>
                      <Input
                        value={replaceConfirm}
                        onChange={(e) => setReplaceConfirm(e.target.value)}
                        placeholder="REPLACE SOURCE"
                        className="text-sm font-mono h-8"
                      />
                    </div>
                  )}

                  {prepResult ? (
                    <div className="rounded border bg-muted p-2 space-y-1">
                      <p className="text-xs font-medium text-green-700 dark:text-green-300">
                        ✅ Import prepared. Run this command on the server:
                      </p>
                      <pre className="text-xs font-mono whitespace-pre-wrap bg-background rounded p-2 border">
                        {prepResult.manualCommand}
                      </pre>
                      <p className="text-xs text-muted-foreground">
                        After cloning, use <strong>Generate Source Report</strong> below to analyze the source.
                      </p>
                    </div>
                  ) : (
                    <>
                      {prepError && (
                        <p className="text-xs text-destructive flex items-start gap-1">
                          <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          {prepError}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handlePrepare}
                        disabled={
                          prepLoading ||
                          (validation.alreadyExists && replaceConfirm.trim() !== "REPLACE SOURCE")
                        }
                        className="h-8 text-xs"
                      >
                        {prepLoading
                          ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Preparing…</>
                          : "Prepare Import"
                        }
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium text-red-700 dark:text-red-300 flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" />
                    Invalid input
                  </p>
                  {validation.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="rounded-lg border border-muted bg-muted/30 p-2.5 text-xs space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">GitHub import notes:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Private repositories require a personal access token — set up SSH or token authentication on the server first.</li>
              <li>Webhook setup is optional and not required before import.</li>
              <li>The git clone command is not run automatically — review and run it manually.</li>
              <li>No code is executed during import preparation.</li>
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── ZIP upload info card ───────────────────────────────────────────────────────

function ZipUploadInfoCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <Terminal className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">ZIP / Replit Export Upload</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a ZIP file (max 50 MB) containing your project source. Replit exports are supported.
            </p>
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <p>✅ Top-level directory prefix stripped automatically</p>
              <p>✅ node_modules/, .git/, .next/, dist/, build/ are skipped</p>
              <p>✅ .env files are skipped — configure secrets via Secrets Vault</p>
              <p>⚠️ Max file size: 50 MB</p>
              <p>⚠️ Only .zip format supported</p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Link
                href={`/projects/${projectId}/import`}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Go to Upload <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Full panel ────────────────────────────────────────────────────────────────

function FullPanel({ projectId, report, loading, loadingExport, error, exportError, lastAction, onGenerate, onExport }: {
  projectId:    string;
  report:       SourceIntakeReport | null;
  loading:      boolean;
  loadingExport: boolean;
  error:        string | null;
  exportError:  string | null;
  lastAction:   string | null;
  onGenerate:   () => void;
  onExport:     () => void;
}) {
  const [showAllChecks, setShowAllChecks] = useState(false);

  const grouped = report
    ? report.checks.reduce<Record<string, typeof report.checks>>((acc, check) => {
        if (!acc[check.category]) acc[check.category] = [];
        acc[check.category].push(check);
        return acc;
      }, {})
    : {};

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary shrink-0" />
            <CardTitle className="text-base">Source Intake Readiness</CardTitle>
            {report && <StatusBadge status={report.status} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onGenerate}
              disabled={loading}
              className="h-7 text-xs"
            >
              {loading
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Analyzing…</>
                : report ? <><RefreshCw className="h-3 w-3 mr-1" />Re-analyze</> : "Generate Source Report"
              }
            </Button>
            {report && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onExport}
                disabled={loadingExport}
                className="h-7 text-xs"
              >
                {loadingExport
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Exporting…</>
                  : <><Download className="h-3 w-3 mr-1" />Export SOURCE_INTAKE_REPORT.md</>
                }
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Detect package manager, services, database, env names, and Replit markers without running any code.
        </p>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Error / last action */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">
            <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{error}
            </p>
          </div>
        )}
        {exportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">
            <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{exportError}
            </p>
          </div>
        )}
        {lastAction && !error && !exportError && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            {lastAction}
          </p>
        )}

        {/* Empty state */}
        {!report && !loading && !error && (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <PackageSearch className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No source report yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a ZIP or clone a repository, then click <strong>Generate Source Report</strong>.
            </p>
          </div>
        )}

        {report && (
          <>
            {/* Detected summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Package Manager", value: report.detected.packageManager ?? "—", icon: <Terminal className="h-3.5 w-3.5" /> },
                { label: "Services",        value: String(report.detected.services?.length ?? 0), icon: <Layers className="h-3.5 w-3.5" /> },
                { label: "Database",        value: report.detected.database?.tool ?? "—",   icon: <Database className="h-3.5 w-3.5" /> },
                { label: "Env Names",       value: String(report.detected.envNames?.length ?? 0), icon: <Key className="h-3.5 w-3.5" /> },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                    {item.icon}
                    <span className="text-[10px] uppercase tracking-wide">{item.label}</span>
                  </div>
                  <p className="text-sm font-medium font-mono">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Services */}
            {report.detected.services && report.detected.services.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Services</p>
                <div className="rounded-lg border divide-y divide-border">
                  {report.detected.services.map((svc) => (
                    <div key={svc.root} className="px-3 py-2 flex items-start gap-2 flex-wrap text-xs">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium font-mono">{svc.name}</span>
                        <Badge variant="secondary" className="ml-1.5 text-[10px]">{svc.kind}</Badge>
                      </div>
                      <code className="text-muted-foreground">{svc.root}</code>
                      {svc.buildCommand && <span className="text-muted-foreground">build: <code>{svc.buildCommand}</code></span>}
                      {svc.startCommand && <span className="text-muted-foreground">start: <code>{svc.startCommand}</code></span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Database */}
            {report.detected.database && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Database</p>
                <div className="rounded-lg border px-3 py-2 text-xs flex flex-wrap gap-3">
                  <span>Tool: <strong>{report.detected.database.tool}</strong></span>
                  <span>Provider: <strong>{report.detected.database.provider}</strong></span>
                  {report.detected.database.tool === "drizzle" && (
                    <span className="text-muted-foreground">Migration: <code>pnpm drizzle-kit push</code> (manual)</span>
                  )}
                  {report.detected.database.tool === "prisma" && (
                    <span className="text-muted-foreground">Migration: <code>pnpm prisma migrate deploy</code> (manual)</span>
                  )}
                </div>
              </div>
            )}

            {/* Env names */}
            {report.detected.envNames && report.detected.envNames.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  Env Variable Names ({report.detected.envNames.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {report.detected.envNames.map((name) => (
                    <code key={name} className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">
                      {name}
                    </code>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">Names only — no values shown.</p>
              </div>
            )}

            {/* Replit markers */}
            {report.detected.replitMarkers && report.detected.replitMarkers.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2">
                <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300 mb-1">
                  Replit Markers Detected
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {report.detected.replitMarkers.map((m) => (
                    <code key={m} className="rounded border border-yellow-200 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-xs font-mono text-yellow-800 dark:text-yellow-200">
                      {m}
                    </code>
                  ))}
                </div>
                <p className="text-[11px] text-yellow-700 dark:text-yellow-300 mt-1.5">
                  Apply portability patches before deployment.
                </p>
              </div>
            )}

            {/* Blockers */}
            {report.blockers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2 space-y-1">
                <p className="text-xs font-medium text-red-700 dark:text-red-300">
                  Blockers ({report.blockers.length})
                </p>
                {report.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{b}
                  </p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 space-y-1">
                <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                  Warnings ({report.warnings.length})
                </p>
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}
                  </p>
                ))}
              </div>
            )}

            {/* Next steps */}
            {report.nextSteps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Recommended Next Steps
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  {report.nextSteps.map((step, i) => (
                    <li key={i} className="text-xs text-muted-foreground">{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Checks detail (expandable) */}
            <div>
              <button
                type="button"
                onClick={() => setShowAllChecks((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {showAllChecks ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showAllChecks ? "Hide" : "Show"} all checks ({report.checks.length})
              </button>
              {showAllChecks && (
                <div className="mt-2 rounded-lg border divide-y divide-border">
                  {Object.entries(grouped).map(([category, checks]) => (
                    <div key={category} className="px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                        {CATEGORY_LABELS[category] ?? category}
                      </p>
                      <div className="space-y-1.5">
                        {checks.map((check) => (
                          <div key={check.id} className="flex items-start gap-2">
                            <CheckIcon status={check.status} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{check.label}</p>
                              <p className="text-xs text-muted-foreground">{check.message}</p>
                              {check.evidence && check.evidence.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {check.evidence.slice(0, 4).map((e, i) => (
                                    <code key={i} className="text-[10px] font-mono bg-muted rounded px-1">{e}</code>
                                  ))}
                                </div>
                              )}
                              {check.command && (
                                <code className="block mt-0.5 text-[10px] font-mono bg-muted rounded px-2 py-0.5">
                                  {check.command}
                                </code>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Report generated {new Date(report.generatedAt).toLocaleString("en-GB")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SourceIntakePanel({
  projectId,
  compact = false,
  showGitHubImport = false,
}: {
  projectId:       string;
  compact?:        boolean;
  showGitHubImport?: boolean;
}) {
  const [report,       setReport]       = useState<SourceIntakeReport | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [exportError,  setExportError]  = useState<string | null>(null);
  const [lastAction,   setLastAction]   = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateSourceIntakeReportAction({ projectId });
      if (result.ok) {
        setReport(result.data);
        setLastAction("Source intake report generated");
      } else {
        setError(
          result.error.toLowerCase().includes("no source") ||
          result.error.toLowerCase().includes("not found") ||
          result.error.toLowerCase().includes("zip")
            ? "No source files found. Upload a ZIP or clone a repository first, then run Analyze."
            : result.error,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed — please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function exportReport() {
    setLoadingExport(true);
    setExportError(null);
    try {
      const result = await exportSourceIntakeReportAction({ projectId });
      if (result.ok) {
        try {
          const blob = new Blob([result.data.markdown], { type: "text/markdown" });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement("a");
          a.href     = url;
          a.download = result.data.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setLastAction(`Downloaded ${result.data.filename}`);
        } catch {
          try {
            await navigator.clipboard.writeText(result.data.markdown);
            setLastAction("Copied SOURCE_INTAKE_REPORT.md to clipboard");
          } catch {
            setExportError("Download failed — refresh and try again.");
          }
        }
      } else {
        setExportError(result.error);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed — please try again.");
    } finally {
      setLoadingExport(false);
    }
  }

  if (compact) {
    return <CompactPanel projectId={projectId} report={report} loading={loading} onGenerate={generate} />;
  }

  return (
    <div className="space-y-4">
      <FullPanel
        projectId={projectId}
        report={report}
        loading={loading}
        loadingExport={loadingExport}
        error={error}
        exportError={exportError}
        lastAction={lastAction}
        onGenerate={generate}
        onExport={exportReport}
      />

      {showGitHubImport && (
        <>
          <GitHubImportCard projectId={projectId} />
          <ZipUploadInfoCard projectId={projectId} />
        </>
      )}
    </div>
  );
}
