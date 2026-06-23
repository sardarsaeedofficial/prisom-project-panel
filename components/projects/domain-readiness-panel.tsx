"use client";

/**
 * components/projects/domain-readiness-panel.tsx
 *
 * Sprint 47: Domain / SSL / Nginx readiness panel.
 *
 * Safety rules:
 *  - No secret values displayed
 *  - configPath shown as basename only
 *  - No nginx config raw content
 *  - Panel domain is always shown as blocked
 */

import { useState }          from "react";
import Link                  from "next/link";
import { Badge }             from "@/components/ui/badge";
import { Button }            from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Globe,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Shield,
  Server,
  Lock,
  ExternalLink,
} from "lucide-react";
import { generateDomainReadinessAction } from "@/app/actions/project-domain-readiness";
import type {
  DomainReadinessReport,
  DomainReadinessStatus,
  DomainDnsRecordStatus,
  DomainSslStatus,
  NginxOwnershipStatus,
} from "@/lib/domains/domain-readiness-types";

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId:     string;
  primaryDomain: string | null;
};

// ── Status helpers ────────────────────────────────────────────────────────────

function OverallBadge({ status }: { status: DomainReadinessStatus }) {
  if (status === "ready")   return <Badge variant="success">Ready</Badge>;
  if (status === "warning") return <Badge variant="warning">Warnings</Badge>;
  return                           <Badge variant="destructive">Blocked</Badge>;
}

function DnsStatusIcon({ status }: { status: DomainDnsRecordStatus["status"] }) {
  if (status === "match")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "mismatch") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  if (status === "missing")  return <XCircle       className="h-4 w-4 text-red-500 shrink-0" />;
  return                            <AlertCircle   className="h-4 w-4 text-muted-foreground shrink-0" />;
}

// ── Section: DNS ──────────────────────────────────────────────────────────────

function DnsSection({ dns }: { dns: DomainDnsRecordStatus[] }) {
  if (dns.length === 0) {
    return (
      <div className="flex items-start gap-2 py-2">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">No DNS records checked.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {dns.map((r) => (
        <div key={r.type} className="flex items-start gap-2">
          <DnsStatusIcon status={r.status} />
          <div className="min-w-0">
            <span className="text-xs font-mono font-semibold mr-1.5">{r.type}</span>
            <span className="text-sm">{r.message}</span>
            {r.values.length > 0 && (
              <p className="text-xs font-mono text-muted-foreground mt-0.5">{r.values.join(", ")}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section: SSL ──────────────────────────────────────────────────────────────

function SslSection({ ssl }: { ssl: DomainSslStatus }) {
  const icon =
    ssl.status === "valid"    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> :
    ssl.status === "expiring" ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> :
    ssl.status === "expired"  ? <XCircle className="h-4 w-4 text-red-500 shrink-0" /> :
    ssl.status === "missing"  ? <XCircle className="h-4 w-4 text-red-500 shrink-0" /> :
                                <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />;

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        {icon}
        <p className="text-sm">{ssl.message}</p>
      </div>
      {ssl.issuer && (
        <p className="text-xs text-muted-foreground ml-6">Issuer: {ssl.issuer}</p>
      )}
      {ssl.validTo && (
        <p className="text-xs text-muted-foreground ml-6">
          Expires: {new Date(ssl.validTo).toLocaleDateString()}
          {ssl.daysRemaining !== undefined && ` (${ssl.daysRemaining} days)`}
        </p>
      )}
    </div>
  );
}

// ── Section: Nginx ────────────────────────────────────────────────────────────

function NginxSection({ nginx }: { nginx: NginxOwnershipStatus }) {
  const icon =
    nginx.conflict          ? <XCircle className="h-4 w-4 text-red-500 shrink-0" /> :
    nginx.managedByPrisom   ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> :
                              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        {icon}
        <p className="text-sm">{nginx.message}</p>
      </div>
      {nginx.configPath && (
        <p className="text-xs text-muted-foreground ml-6 font-mono">Config: {nginx.configPath}</p>
      )}
      {nginx.ownerProjectSlug && nginx.conflict && (
        <p className="text-xs text-red-600 dark:text-red-400 ml-6">Owned by: {nginx.ownerProjectSlug}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DomainReadinessPanel({ projectId, primaryDomain }: Props) {
  const [report,       setReport]       = useState<DomainReadinessReport | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"check" | null>(null);
  const [lastAction,   setLastAction]   = useState("");
  const [domainInput,  setDomainInput]  = useState(primaryDomain ?? "");

  async function handleCheck() {
    const domain = domainInput.trim();
    if (!domain) { setError("Enter a domain to check."); return; }
    if (activeAction) return;

    setActiveAction("check");
    setError(null);
    setLastAction(`Checking ${domain}…`);

    try {
      const res = await generateDomainReadinessAction({ projectId, domain });
      if (!res.ok) {
        setError(res.error);
        setLastAction(`Check failed: ${res.error}`);
        return;
      }
      setReport(res.report);
      setLastAction(`Report ready — ${res.report.status}, ${res.report.blockers.length} blockers`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unexpected error.";
      setError(msg);
      setLastAction("Check crashed");
    } finally {
      setActiveAction(null);
    }
  }

  const isChecking = activeAction === "check";

  return (
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-sm">Domain Readiness</h3>
              <p className="text-xs text-muted-foreground">
                DNS, SSL, and nginx config ownership checks for go-live.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {report && <OverallBadge status={report.status} />}
          </div>
        </div>

        {/* ── Domain input ── */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="yourdomain.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCheck(); }}
            disabled={isChecking}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCheck}
            disabled={isChecking || !domainInput.trim()}
          >
            {isChecking
              ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Checking…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Check Domain</>
            }
          </Button>
        </div>

        {/* ── Diagnostics ── */}
        {lastAction && (
          <p className="text-xs text-muted-foreground">Last action: {lastAction}</p>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {report && (
          <div className="space-y-4">
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

            {/* ── DNS ── */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Server className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">DNS Records</h4>
              </div>
              <DnsSection dns={report.dns} />
            </div>

            {/* ── SSL ── */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">SSL Certificate</h4>
              </div>
              <SslSection ssl={report.ssl} />
            </div>

            {/* ── Nginx ── */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Nginx Ownership</h4>
              </div>
              <NginxSection nginx={report.nginx} />
            </div>

            {/* ── Next steps ── */}
            {report.nextSteps.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">Next Steps</h4>
                {report.nextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground">→ {s}</p>
                ))}
              </div>
            )}

            {/* ── Actions ── */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/projects/${projectId}/publishing`}>
                <Button type="button" variant="outline" size="sm" asChild>
                  <span><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Publishing</span>
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!report && !error && !isChecking && (
          <div className="text-center py-6 text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Enter a domain and click Check Domain to scan DNS, SSL, and nginx config.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
