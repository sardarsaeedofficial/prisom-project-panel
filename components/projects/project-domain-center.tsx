"use client";

/**
 * components/projects/project-domain-center.tsx
 *
 * Sprint 29: Domain + SSL Health Center.
 *
 * Displays live DNS, HTTP, HTTPS, SSL, and nginx routing status for each
 * domain attached to the project.  Runs checks server-side via server action.
 */

import { useState, useTransition, useCallback } from "react";
import {
  RefreshCw,
  Globe,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  Shield,
  Wifi,
  Server,
  Lock,
  ExternalLink,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { cn }     from "@/lib/utils";
import { getDomainHealthReportAction } from "@/app/actions/project-domain-health";
import type {
  DomainHealthReport,
  DomainHealthEntry,
  DnsCheckResult,
  HttpCheckResult,
  SslCheckResult,
  NginxRouteSummary,
  DomainRecommendation,
  CheckStatus,
} from "@/lib/domains/domain-health-types";

// ── Status icon ────────────────────────────────────────────────────────────────

function StatusIcon({ status, className }: { status: CheckStatus; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (status === "pass")    return <CheckCircle2 className={cn(cls, "text-green-500")} />;
  if (status === "warning") return <AlertCircle  className={cn(cls, "text-amber-500")} />;
  if (status === "fail")    return <XCircle      className={cn(cls, "text-red-500")} />;
  return                           <HelpCircle   className={cn(cls, "text-muted-foreground/50")} />;
}

function statusBg(status: CheckStatus): string {
  if (status === "pass")    return "border-green-200  bg-green-50  dark:bg-green-950/20";
  if (status === "warning") return "border-amber-200  bg-amber-50  dark:bg-amber-950/20";
  if (status === "fail")    return "border-red-200    bg-red-50    dark:bg-red-950/20";
  return "border-border bg-muted/30";
}

function statusLabel(status: CheckStatus): string {
  if (status === "pass")    return "OK";
  if (status === "warning") return "Warning";
  if (status === "fail")    return "Fail";
  return "Unknown";
}

// ── DNS row ────────────────────────────────────────────────────────────────────

function DnsSection({ dns }: { dns: DnsCheckResult }) {
  const allAddrs = [...dns.aRecords, ...dns.aaaaRecords];
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">DNS Resolution</span>
        <StatusIcon status={dns.status} />
        <span className={cn("text-xs", dns.status === "pass" ? "text-green-600" : dns.status === "fail" ? "text-red-600" : "text-amber-600")}>
          {statusLabel(dns.status)}
        </span>
      </div>
      <div className="pl-5 space-y-0.5 text-xs text-muted-foreground">
        {dns.aRecords.length > 0 && (
          <p>A: {dns.aRecords.join(", ")}</p>
        )}
        {dns.aaaaRecords.length > 0 && (
          <p>AAAA: {dns.aaaaRecords.join(", ")}</p>
        )}
        {dns.cnameValue && (
          <p>CNAME → {dns.cnameValue}</p>
        )}
        {allAddrs.length === 0 && !dns.cnameValue && (
          <p className="text-red-500">No DNS records found.</p>
        )}
        <p className="text-muted-foreground/60">Expected: {dns.expectedIp}</p>
        {dns.error && <p className="text-red-500">{dns.error}</p>}
      </div>
    </div>
  );
}

// ── HTTP/HTTPS row ─────────────────────────────────────────────────────────────

function HttpSection({
  label,
  result,
  icon: Icon,
}: {
  label: string;
  result: HttpCheckResult;
  icon: React.ElementType;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{label}</span>
        <StatusIcon status={result.status} />
        <span className={cn("text-xs", result.status === "pass" ? "text-green-600" : result.status === "fail" ? "text-red-600" : "text-amber-600")}>
          {result.statusCode ? `${statusLabel(result.status)} (HTTP ${result.statusCode})` : statusLabel(result.status)}
        </span>
        {result.responseTimeMs !== null && (
          <span className="text-xs text-muted-foreground ml-auto">{result.responseTimeMs}ms</span>
        )}
      </div>
      {result.redirectedTo && (
        <p className="pl-5 text-xs text-muted-foreground truncate">↳ {result.redirectedTo}</p>
      )}
      {result.error && (
        <p className="pl-5 text-xs text-red-500">{result.error}</p>
      )}
    </div>
  );
}

// ── SSL section ────────────────────────────────────────────────────────────────

function SslSection({ ssl }: { ssl: SslCheckResult }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">SSL Certificate</span>
        <StatusIcon status={ssl.status} />
        <span className={cn("text-xs", ssl.status === "pass" ? "text-green-600" : ssl.status === "fail" ? "text-red-600" : "text-amber-600")}>
          {ssl.daysRemaining !== null
            ? ssl.daysRemaining <= 0
              ? `Expired ${Math.abs(ssl.daysRemaining)}d ago`
              : `${ssl.daysRemaining}d remaining`
            : statusLabel(ssl.status)}
        </span>
      </div>
      <div className="pl-5 space-y-0.5 text-xs text-muted-foreground">
        {ssl.issuer  && <p>Issuer: {ssl.issuer}</p>}
        {ssl.subject && <p>Subject: {ssl.subject}</p>}
        {ssl.validTo && (
          <p>Expires: {new Date(ssl.validTo).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
        )}
        {ssl.error && <p className="text-amber-600">{ssl.error}</p>}
      </div>
    </div>
  );
}

// ── Nginx section ──────────────────────────────────────────────────────────────

function NginxSection({ nginx }: { nginx: NginxRouteSummary }) {
  if (nginx.unavailableReason) {
    return (
      <div className="flex items-center gap-2">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Nginx Route</span>
        <HelpCircle className="h-4 w-4 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground">{nginx.unavailableReason}</span>
      </div>
    );
  }

  const matchStatus: CheckStatus = nginx.serverNameMatch === true ? "pass" : nginx.serverNameMatch === false ? "warning" : "unknown";

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Nginx Route</span>
        <StatusIcon status={matchStatus} />
        <span className="text-xs text-muted-foreground">
          {nginx.configLabel
            ? <><span className="font-mono">{nginx.configLabel}</span> — config found</>
            : nginx.serverNameMatch === false
            ? "No matching config"
            : "Status unknown"}
        </span>
      </div>
      {(nginx.proxyTarget || nginx.staticRoot) && (
        <div className="pl-5 space-y-0.5 text-xs text-muted-foreground">
          {nginx.proxyTarget  && <p>Proxy → {nginx.proxyTarget}</p>}
          {nginx.staticRoot   && <p>Static root: {nginx.staticRoot}</p>}
          {nginx.hasSslBlock  && <p className="text-green-600">SSL (443) block present</p>}
        </div>
      )}
    </div>
  );
}

// ── Recommendation chip ────────────────────────────────────────────────────────

function RecChip({ rec }: { rec: DomainRecommendation }) {
  const colors = {
    critical: "border-red-200 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300",
    warning:  "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300",
    info:     "border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950/20 dark:text-blue-300",
  };
  const icons = {
    critical: XCircle,
    warning:  AlertTriangle,
    info:     Info,
  };
  const Icon = icons[rec.severity];

  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", colors[rec.severity])}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{rec.title}</p>
        <p className="mt-0.5 opacity-80">{rec.detail}</p>
      </div>
      {rec.href && (
        <a href={rec.href} className="shrink-0 underline underline-offset-2 opacity-70 hover:opacity-100">
          Fix
        </a>
      )}
    </div>
  );
}

// ── Domain card ────────────────────────────────────────────────────────────────

function DomainCard({ entry, projectId }: { entry: DomainHealthEntry; projectId: string }) {
  const [expanded, setExpanded] = useState(true);

  const overallStatus: CheckStatus =
    [entry.dns.status, entry.http.status, entry.https.status, entry.ssl.status].includes("fail")
      ? "fail"
      : [entry.dns.status, entry.http.status, entry.https.status, entry.ssl.status].includes("warning")
      ? "warning"
      : [entry.dns.status, entry.http.status, entry.https.status, entry.ssl.status].every((s) => s === "pass")
      ? "pass"
      : "unknown";

  return (
    <div className={cn("rounded-lg border overflow-hidden", statusBg(overallStatus))}>
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 transition-colors"
      >
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm flex-1 truncate">
          {entry.hostname}
        </span>
        {entry.isPrimary && (
          <Badge variant="outline" className="text-xs shrink-0">Primary</Badge>
        )}
        <StatusIcon status={overallStatus} />
        <a
          href={`https://${entry.hostname}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t">
          {/* Checks grid */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            <DnsSection dns={entry.dns} />
            <HttpSection label="HTTP"  result={entry.http}  icon={Globe} />
            <HttpSection label="HTTPS" result={entry.https} icon={ShieldCheck} />
            <SslSection  ssl={entry.ssl} />
          </div>

          {/* Nginx */}
          <div className="border-t pt-3">
            <NginxSection nginx={entry.nginx} />
          </div>

          {/* Recommendations */}
          {entry.recommendations.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Recommendations
              </p>
              {entry.recommendations.map((r) => (
                <RecChip key={r.id} rec={r} />
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground/60">
            Checked {new Date(entry.checkedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  projectId:     string;
  initialReport: DomainHealthReport | null;
};

export function ProjectDomainCenter({ projectId, initialReport }: Props) {
  const [report, setReport]      = useState<DomainHealthReport | null>(initialReport);
  const [error, setError]        = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await getDomainHealthReportAction(projectId);
        if (result.ok) {
          setReport(result.report);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }, [projectId]);

  const hasDomains = (report?.domains.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Domain Health</h3>
          {report && (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(report.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isPending}
          className="h-8 text-xs gap-1.5"
        >
          <RefreshCw className={cn("h-3 w-3", isPending && "animate-spin")} />
          {isPending ? "Checking…" : "Run Checks"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* No domains */}
      {!hasDomains && !isPending && (
        <div className="rounded-lg border border-dashed px-6 py-8 text-center space-y-1">
          <Globe className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm font-medium">No domains configured</p>
          <p className="text-xs text-muted-foreground">
            Add a domain in the section below, then run checks to see DNS, HTTPS, and SSL status.
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {isPending && !report && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border bg-muted/20 h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* Domain cards */}
      {hasDomains && report && (
        <div className="space-y-3">
          {report.domains.map((entry) => (
            <DomainCard key={entry.domainId} entry={entry} projectId={projectId} />
          ))}
        </div>
      )}

      {/* Legend */}
      {hasDomains && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> Pass</span>
          <span className="flex items-center gap-1"><AlertCircle  className="h-3 w-3 text-amber-500" /> Warning</span>
          <span className="flex items-center gap-1"><XCircle      className="h-3 w-3 text-red-500"   /> Fail</span>
          <span className="flex items-center gap-1"><HelpCircle   className="h-3 w-3 text-muted-foreground/50" /> Unknown (check not run yet)</span>
        </div>
      )}
    </div>
  );
}
