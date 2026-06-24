"use client";

/**
 * components/projects/external-services-readiness-panel.tsx
 *
 * Sprint 54: External Services Readiness panel.
 * Shows Stripe, Cloudinary, Email, and APP_URL readiness with webhook URLs.
 *
 * Safety rules:
 *  - no secret values shown
 *  - status shown as Configured / Missing / Placeholder / Suspicious only
 *  - no provider mutations
 *  - no real charges or emails sent automatically
 */

import { useState }  from "react";
import Link          from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  Download, ChevronDown, ChevronRight, Globe, Copy, Check,
  CreditCard, Cloud, Mail, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import {
  generateExternalServicesReadinessAction,
  exportExternalServicesReadinessAction,
}                                                   from "@/app/actions/external-services-readiness";
import type {
  ExternalServiceReadinessReport,
  ExternalServiceCheck,
  ExternalServiceStatus,
  ExternalServiceProvider,
}                                                   from "@/lib/external-services/external-services-types";

// ── Provider labels & icons ───────────────────────────────────────────────────

const PROVIDER_LABEL: Record<ExternalServiceProvider, string> = {
  stripe:     "Stripe",
  cloudinary: "Cloudinary",
  email:      "Email",
  webhook:    "Webhook URLs",
  manual:     "App URL / General",
};

const PROVIDER_ORDER: ExternalServiceProvider[] = [
  "stripe", "cloudinary", "email", "manual", "webhook",
];

function ProviderIcon({ provider }: { provider: ExternalServiceProvider }) {
  const cls = "h-4 w-4 shrink-0";
  if (provider === "stripe")     return <CreditCard className={cls} />;
  if (provider === "cloudinary") return <Cloud className={cls} />;
  if (provider === "email")      return <Mail className={cls} />;
  if (provider === "webhook")    return <Zap className={cls} />;
  return <Globe className={cls} />;
}

// ── Status helpers ────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: ExternalServiceCheck["status"] }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "fail")    return <XCircle      className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />;
}

function OverallBadge({ status }: { status: ExternalServiceStatus }) {
  const map: Record<ExternalServiceStatus, { label: string; cls: string }> = {
    ready:   { label: "Ready",   cls: "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300" },
    warning: { label: "Warning", cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300" },
    blocked: { label: "Blocked", cls: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300" },
    unknown: { label: "Unknown", cls: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/40 dark:text-gray-300" },
  };
  const { label, cls } = map[status];
  return <Badge className={`${cls} border text-[10px] font-semibold`}>{label}</Badge>;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => null);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label}`}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ c }: { c: ExternalServiceCheck }) {
  const [open, setOpen] = useState(c.status === "fail" || c.status === "warning");
  const hasDetails = c.evidence || c.command || c.linkHref;
  const isUrl = c.evidence && c.evidence.length === 1 && c.evidence[0].startsWith("https://");

  return (
    <div className={`border-b last:border-0 ${c.status === "manual" ? "opacity-75" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-start gap-2 py-2 px-3 hover:bg-muted/30 transition-colors"
        disabled={!hasDetails}
      >
        <CheckIcon status={c.status} />
        <span className="flex-1 min-w-0 text-sm">{c.label}</span>
        {/* Quick copy for single URL evidence */}
        {isUrl && c.evidence && (
          <CopyButton text={c.evidence[0]} label={c.label} />
        )}
        {hasDetails && !isUrl && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>
      {open && !isUrl && (
        <div className="px-3 pb-2 ml-6 space-y-1.5">
          <p className="text-xs text-muted-foreground">{c.message}</p>
          {c.command && (
            <code className="block text-xs font-mono bg-muted/60 rounded px-2 py-1 break-all">
              {c.command}
            </code>
          )}
          {c.evidence && c.evidence.length > 0 && (
            <ul className="text-xs space-y-1 mt-1">
              {c.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground/50 mt-0.5">•</span>
                  <span className="text-muted-foreground">
                    {e.startsWith("https://")
                      ? <span className="flex items-center gap-1">
                          <code className="font-mono text-xs break-all">{e}</code>
                          <CopyButton text={e} label="URL" />
                        </span>
                      : e
                    }
                  </span>
                </li>
              ))}
            </ul>
          )}
          {c.linkHref && !c.evidence?.length && (
            <Link href={c.linkHref} className="text-xs text-primary hover:underline">
              Open →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Provider section ──────────────────────────────────────────────────────────

function ProviderSection({
  provider,
  checks,
}: {
  provider: ExternalServiceProvider;
  checks:   ExternalServiceCheck[];
}) {
  const hasFailure = checks.some((c) => c.status === "fail");
  const hasWarning = checks.some((c) => c.status === "warning");
  const allPass    = checks.every((c) => c.status === "pass" || c.status === "manual");
  const [open, setOpen] = useState(hasFailure || hasWarning);

  const headerCls =
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
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${headerCls}`}>
          <ProviderIcon provider={provider} />
          {PROVIDER_LABEL[provider]}
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

// ── Main panel ────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  compact?:  boolean;
};

export function ExternalServicesReadinessPanel({ projectId, compact }: Props) {
  const [report,        setReport]        = useState<ExternalServiceReadinessReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [reportError,   setReportError]   = useState<string | null>(null);
  const [exportDone,    setExportDone]    = useState(false);
  const [exportError,   setExportError]   = useState<string | null>(null);

  async function handleGenerate() {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await generateExternalServicesReadinessAction(projectId);
      if (res.ok) {
        setReport(res.data);
      } else {
        setReportError(res.error);
      }
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingReport(false);
    }
  }

  async function handleExport() {
    setLoadingExport(true);
    setExportError(null);
    setExportDone(false);
    try {
      const res = await exportExternalServicesReadinessAction(projectId);
      if (res.ok) {
        const blob = new Blob([res.data.markdown], { type: "text/markdown" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "EXTERNAL_SERVICES_READINESS.md";
        a.click();
        URL.revokeObjectURL(url);
        setExportDone(true);
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
      <Card className="border-violet-200/60 bg-violet-50/30 dark:bg-violet-950/10">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">External Services</p>
              <p className="text-xs text-muted-foreground">
                Stripe, Cloudinary, Email readiness.
                {report && <span className="ml-1"><OverallBadge status={report.status} /></span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!report ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleGenerate}
                disabled={loadingReport}
                className="h-7 text-xs"
              >
                {loadingReport
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Checking…</>
                  : "Check"
                }
              </Button>
            ) : (
              <Link
                href={`/projects/${projectId}/env`}
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

  const groupedChecks = report
    ? PROVIDER_ORDER.reduce<Record<string, ExternalServiceCheck[]>>((acc, prov) => {
        const items = report.checks.filter((c) => c.provider === prov);
        if (items.length > 0) acc[prov] = items;
        return acc;
      }, {})
    : {};

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary shrink-0" />
            <CardTitle className="text-base">External Services Readiness</CardTitle>
            {report && <OverallBadge status={report.status} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              disabled={loadingReport}
              className="h-7 text-xs"
            >
              {loadingReport
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Checking…</>
                : report ? "Re-check" : "Generate Report"
              }
            </Button>
            {report && (
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
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Checks Stripe, Cloudinary, Email, and APP_URL configuration. No secret values are shown.
        </p>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">

        {reportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
            {reportError}
          </div>
        )}

        {exportDone && !exportError && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-3 text-sm text-green-700 dark:text-green-400">
            EXTERNAL_SERVICES_READINESS.md downloaded.
          </div>
        )}
        {exportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
            Export failed: {exportError}
          </div>
        )}

        {/* Webhook URL quick-copy strip */}
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Webhook URLs (copy to Stripe Dashboard)</p>
          {[
            {
              label: "Production webhook",
              url:   "https://sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe",
            },
            {
              label: "Staging webhook",
              url:   "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe",
            },
          ].map(({ label, url }) => (
            <div key={url} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">{label}:</span>
              <code className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 flex-1 min-w-0 break-all">{url}</code>
              <CopyButton text={url} label={label} />
            </div>
          ))}
        </div>

        {/* No report yet */}
        {!report && !loadingReport && !reportError && (
          <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center space-y-2">
            <Globe className="h-6 w-6 text-muted-foreground/50 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Generate a report to check Stripe, Cloudinary, Email, and APP_URL readiness.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Checks env var presence only — no secret values are read or shown.
            </p>
          </div>
        )}

        {loadingReport && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking external service readiness…
          </div>
        )}

        {/* Results */}
        {report && (
          <div className="space-y-3">

            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Passed",   val: report.summary.passed,   cls: "text-green-700 dark:text-green-400" },
                { label: "Warnings", val: report.summary.warnings, cls: "text-amber-700 dark:text-amber-400" },
                { label: "Failed",   val: report.summary.failed,   cls: "text-red-700 dark:text-red-400" },
                { label: "Manual",   val: report.summary.manual,   cls: "text-muted-foreground" },
              ].map(({ label, val, cls }) => (
                <div key={label} className="rounded-lg border bg-muted/20 px-3 py-2 text-center">
                  <p className={`text-xl font-bold ${cls}`}>{val}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Blockers */}
            {report.blockers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                  {report.blockers.length} Blocker{report.blockers.length > 1 ? "s" : ""} — Resolve before going live
                </p>
                {report.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 dark:text-red-400">• {b}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && report.blockers.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  {report.warnings.length} Warning{report.warnings.length > 1 ? "s" : ""}
                </p>
                {report.warnings.slice(0, 5).map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-400">• {w}</p>
                ))}
              </div>
            )}

            {/* Next steps */}
            {report.nextSteps.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">Next Steps</p>
                {report.nextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                ))}
              </div>
            )}

            {/* Grouped provider sections */}
            <div className="space-y-2">
              {PROVIDER_ORDER.filter((prov) => groupedChecks[prov]).map((prov) => (
                <ProviderSection
                  key={prov}
                  provider={prov as ExternalServiceProvider}
                  checks={groupedChecks[prov]!}
                />
              ))}
            </div>

            <p className="text-xs text-muted-foreground text-right">
              Generated {new Date(report.generatedAt).toLocaleString("en-GB", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
