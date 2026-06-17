"use client";

/**
 * components/projects/domain-manager.tsx
 *
 * Unified domain lifecycle UI for Prisom projects.
 *
 * Flow:
 *   Generated subdomain (*.doorstepmanchester.uk) — publish immediately (no DNS check)
 *   Custom domain                                 — add → DNS instructions → verify → publish → SSL
 *
 * Domain status map:
 *   PENDING              → "Pending DNS"  — DNS instructions shown, Check DNS & Publish button
 *   ACTIVE + ssl=NONE    → "HTTP Active"  — Enable HTTPS button
 *   ACTIVE + ssl=ACTIVE  → "HTTPS Active" — fully live
 *   FAILED               → "Failed"       — error shown, Retry button
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  Shield,
  Lock,
  Trash2,
  Zap,
  AlertCircle,
  Loader2,
  ExternalLink,
  Copy,
  Server,
  Plus,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  publishProjectDomainAction,
  addCustomDomainAction,
  checkDnsAndPublishDomainAction,
  requestSslCertAction,
  removeDomainAndNginxAction,
} from "@/app/actions/project-deployments";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DomainRow {
  id:              string;
  hostname:        string;
  isPrimary:       boolean;
  status:          "PENDING" | "ACTIVE" | "FAILED";
  sslStatus:       "NONE" | "PENDING" | "ACTIVE" | "FAILED" | "EXPIRED";
  nginxConfigPath: string | null;
  targetPort:      number | null;
  lastError:       string | null;
}

interface Props {
  projectId:       string;
  projectSlug:     string;
  port:            number;
  vpsIp:           string;
  hasDeployConfig: boolean;
  domains:         DomainRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_DOMAIN = "doorstepmanchester.uk";

function isWildcardSubdomain(hostname: string): boolean {
  return hostname.endsWith(`.${BASE_DOMAIN}`);
}

/** For a hostname, return the DNS record rows to add */
function dnsRecords(hostname: string, vpsIp: string) {
  const parts = hostname.split(".");
  // Root domain (e.g. example.com — 2 parts)
  if (parts.length === 2) {
    return [
      { type: "A", host: "@",   value: vpsIp, ttl: "Auto / 3600" },
      { type: "A", host: "www", value: vpsIp, ttl: "Auto / 3600" },
    ];
  }
  // Subdomain (e.g. app.example.com — 3+ parts)
  const subdomain = parts.slice(0, parts.length - 2).join(".");
  return [
    { type: "A", host: subdomain, value: vpsIp, ttl: "Auto / 3600" },
  ];
}

function useCopy(ms = 2000) {
  const [copied, setCopied] = useState(false);
  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), ms);
  }
  return { copied, copy };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      title="Copy"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

function DnsInstructionsCard({
  hostname,
  vpsIp,
}: {
  hostname: string;
  vpsIp: string;
}) {
  const records = dnsRecords(hostname, vpsIp);
  return (
    <div className="mt-3 rounded-md border bg-muted/40 overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/60">
        <p className="text-xs font-semibold text-foreground/80">
          DNS configuration required
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Add these records at your DNS provider, then click{" "}
          <strong>Check DNS &amp; Publish</strong>.
        </p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">Type</th>
            <th className="text-left px-3 py-1.5 font-medium">Host</th>
            <th className="text-left px-3 py-1.5 font-medium">Value</th>
            <th className="text-left px-3 py-1.5 font-medium">TTL</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono font-medium">{r.type}</td>
              <td className="px-3 py-2 font-mono">{r.host}</td>
              <td className="px-3 py-2 font-mono">{r.value}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.ttl}</td>
              <td className="px-3 py-2">
                <CopyButton text={r.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
        ⚠ DNS changes can take up to 48 hours to propagate globally. Usually
        minutes.
      </div>
    </div>
  );
}

// ── Per-domain card ────────────────────────────────────────────────────────

function DomainCard({
  domain,
  projectId,
  vpsIp,
  onRefresh,
}: {
  domain:    DomainRow;
  projectId: string;
  vpsIp:     string;
  onRefresh: () => void;
}) {
  const [isPending,      startTransition]   = useTransition();
  const [actionError,    setActionError]    = useState("");
  const [sslLogs,        setSslLogs]        = useState("");
  const [showSslLogs,    setShowSslLogs]    = useState(false);
  const [confirmRemove,  setConfirmRemove]  = useState(false);

  const isActive  = domain.status === "ACTIVE";
  const isPending_ = domain.status === "PENDING";
  const isFailed  = domain.status === "FAILED";
  const hasSsl    = domain.sslStatus === "ACTIVE";
  const sslFailed = domain.sslStatus === "FAILED" || domain.sslStatus === "EXPIRED";

  const httpUrl  = `http://${domain.hostname}`;
  const httpsUrl = `https://${domain.hostname}`;
  const liveUrl  = hasSsl ? httpsUrl : isActive ? httpUrl : null;

  function handleCheckDns() {
    setActionError("");
    startTransition(async () => {
      const res = await checkDnsAndPublishDomainAction(projectId, domain.hostname);
      if (!res.ok) {
        setActionError(res.error + (res.resolvedIp ? `\n(Resolved: ${res.resolvedIp})` : ""));
      } else {
        onRefresh();
      }
    });
  }

  function handleEnableSsl() {
    setActionError("");
    setSslLogs("");
    startTransition(async () => {
      const res = await requestSslCertAction(projectId, domain.hostname);
      if (!res.ok) {
        setActionError(res.error);
        if (res.logs) setSslLogs(res.logs);
      } else {
        if (res.logs) setSslLogs(res.logs);
        onRefresh();
      }
    });
  }

  function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setActionError("");
    startTransition(async () => {
      const res = await removeDomainAndNginxAction(projectId, domain.id);
      if (!res.ok) {
        setActionError(res.error);
      } else {
        onRefresh();
      }
    });
  }

  // ── Status badge ──────────────────────────────────────────────────────────

  const statusBadge = (() => {
    if (hasSsl)
      return (
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          HTTPS active
        </span>
      );
    if (isActive)
      return (
        <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          HTTP active
        </span>
      );
    if (isFailed)
      return (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      );
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
        <Clock className="h-3.5 w-3.5" />
        Pending DNS
      </span>
    );
  })();

  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-3">
        {/* ── Icon ── */}
        <div className="mt-0.5 shrink-0">
          {hasSsl ? (
            <Lock className="h-4 w-4 text-green-500" />
          ) : isActive ? (
            <Globe className="h-4 w-4 text-blue-500" />
          ) : isFailed ? (
            <XCircle className="h-4 w-4 text-red-400" />
          ) : (
            <Clock className="h-4 w-4 text-yellow-500" />
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 min-w-0">
          {/* Hostname + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium font-mono">{domain.hostname}</p>
            {domain.isPrimary && (
              <Badge variant="secondary" className="text-xs">Primary</Badge>
            )}
            {statusBadge}
            {sslFailed && (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <Shield className="h-3.5 w-3.5" />
                SSL {domain.sslStatus.toLowerCase()}
              </span>
            )}
          </div>

          {/* Live URL link */}
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              {liveUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {/* Internal target */}
          {isActive && domain.targetPort && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Server className="h-3 w-3" />
              Internal: 127.0.0.1:{domain.targetPort}
            </p>
          )}

          {/* DNS instructions (for PENDING domains) */}
          {isPending_ && (
            <DnsInstructionsCard hostname={domain.hostname} vpsIp={vpsIp} />
          )}

          {/* Nginx / DNS error */}
          {(isFailed || (sslFailed && domain.lastError)) && domain.lastError && (
            <div className="mt-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs">
              <p className="font-medium text-red-700 dark:text-red-400 mb-1">Error:</p>
              <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all font-mono">
                {domain.lastError}
              </pre>
            </div>
          )}

          {/* Action error from this session */}
          {actionError && (
            <div className="mt-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all font-mono flex-1">
                  {actionError}
                </pre>
              </div>
            </div>
          )}

          {/* SSL logs (collapsible) */}
          {sslLogs && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowSslLogs((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showSslLogs ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Certbot output
              </button>
              {showSslLogs && (
                <pre className="mt-1 text-xs font-mono bg-muted/60 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
                  {sslLogs}
                </pre>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {/* Pending DNS: Check DNS & Publish */}
            {(isPending_ || isFailed) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                disabled={isPending}
                onClick={handleCheckDns}
              >
                {isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5" /> Check DNS &amp; Publish</>
                )}
              </Button>
            )}

            {/* HTTP active: Enable HTTPS */}
            {isActive && !hasSsl && domain.sslStatus !== "PENDING" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                disabled={isPending}
                onClick={handleEnableSsl}
              >
                {isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Issuing certificate…</>
                ) : (
                  <><Lock className="h-3.5 w-3.5" /> Enable HTTPS</>
                )}
              </Button>
            )}

            {/* SSL pending indicator */}
            {domain.sslStatus === "PENDING" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                SSL pending…
              </span>
            )}

            {/* HTTPS active: renewal option */}
            {hasSsl && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5 text-muted-foreground"
                disabled={isPending}
                onClick={handleEnableSsl}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Renew SSL
              </Button>
            )}

            {/* Remove */}
            {confirmRemove ? (
              <>
                <span className="text-xs text-red-600 dark:text-red-400">
                  Confirm remove?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  disabled={isPending}
                  onClick={handleRemove}
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, remove"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={isPending}
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleRemove}
                disabled={isPending}
                className="ml-auto p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded disabled:opacity-40"
                title="Remove domain"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Generated domain section ───────────────────────────────────────────────

function GeneratedDomainCard({
  projectId,
  generatedDomain,
  port,
  existingDomain,
}: {
  projectId:       string;
  generatedDomain: string;
  port:            number;
  existingDomain:  DomainRow | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error,     setError]        = useState("");
  const router = useRouter();

  const isPublished = !!existingDomain && existingDomain.status === "ACTIVE";
  const hasSsl      = existingDomain?.sslStatus === "ACTIVE";
  const liveUrl     = hasSsl
    ? `https://${generatedDomain}`
    : isPublished
    ? `http://${generatedDomain}`
    : null;

  function handlePublish() {
    setError("");
    startTransition(async () => {
      const res = await publishProjectDomainAction(projectId, generatedDomain);
      if (!res.ok) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-medium">Generated subdomain</p>
          </div>
          <p className="text-sm font-mono text-foreground">{generatedDomain}</p>
          <p className="text-xs text-muted-foreground">
            Wildcard{" "}
            <code className="font-mono">*.doorstepmanchester.uk → 178.105.105.59</code>{" "}
            is already configured — no DNS changes needed.
          </p>
        </div>

        {isPublished && (
          <Badge variant="success" className="shrink-0 text-xs gap-1">
            {hasSsl ? (
              <><ShieldCheck className="h-3 w-3" /> HTTPS</>
            ) : (
              <><CheckCircle2 className="h-3 w-3" /> Active</>
            )}
          </Badge>
        )}
      </div>

      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {liveUrl} <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {!isPublished && (
        <Button
          size="sm"
          className="gap-1.5"
          disabled={isPending}
          onClick={handlePublish}
        >
          {isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…</>
          ) : (
            <><Zap className="h-3.5 w-3.5" /> Publish to this subdomain</>
          )}
        </Button>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
          <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap font-mono flex-1">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Add custom domain form ─────────────────────────────────────────────────

function AddCustomDomainForm({
  projectId,
  onRefresh,
}: {
  projectId: string;
  onRefresh: () => void;
}) {
  const [hostname,   setHostname]   = useState("");
  const [isPending,  startTransition] = useTransition();
  const [error,      setError]      = useState("");
  const [showForm,   setShowForm]   = useState(false);

  function handleAdd() {
    const clean = hostname.trim().toLowerCase();
    if (!clean) return;
    setError("");
    startTransition(async () => {
      const res = await addCustomDomainAction(projectId, clean);
      if (!res.ok) {
        setError(res.error);
      } else {
        setHostname("");
        setShowForm(false);
        onRefresh();
      }
    });
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add custom domain
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Add custom domain</Label>
      <div className="flex gap-2">
        <Input
          className="h-9 font-mono text-sm"
          placeholder="myapp.example.com"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          disabled={isPending}
          autoFocus
        />
        <Button
          size="sm"
          className="shrink-0"
          disabled={isPending || !hostname.trim()}
          onClick={handleAdd}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={isPending}
          onClick={() => { setShowForm(false); setError(""); }}
        >
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        DNS instructions will be shown after adding. You&apos;ll verify DNS and
        publish in the next step.
      </p>
      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
          <span className="text-red-600 dark:text-red-400">{error}</span>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function DomainManager({
  projectId,
  projectSlug,
  port,
  vpsIp,
  hasDeployConfig,
  domains,
}: Props) {
  const router = useRouter();

  const generatedDomain  = `${projectSlug}.${BASE_DOMAIN}`;
  // Separate generated domain entry from custom domains
  const generatedRow     = domains.find((d) => d.hostname === generatedDomain) ?? null;
  const customDomains    = domains.filter((d) => d.hostname !== generatedDomain);

  function onRefresh() {
    router.refresh();
  }

  if (!hasDeployConfig) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Domains</CardTitle>
          </div>
          <CardDescription>
            Deploy your project first (Publishing tab) before connecting a
            domain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            <span>
              No deployment config — go to the Publishing tab to set up your
              project.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Generated subdomain ── */}
      <GeneratedDomainCard
        projectId={projectId}
        generatedDomain={generatedDomain}
        port={port}
        existingDomain={generatedRow}
      />

      {/* ── Custom domains ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Custom Domains</CardTitle>
              <CardDescription className="mt-1">
                Connect your own domain via DNS verification and nginx.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Add domain form */}
          <AddCustomDomainForm projectId={projectId} onRefresh={onRefresh} />

          {/* Domain list */}
          {customDomains.length > 0 && (
            <div className="-mx-6 border-t mt-4">
              <div className="divide-y">
                {customDomains.map((domain) => (
                  <DomainCard
                    key={domain.id}
                    domain={domain}
                    projectId={projectId}
                    vpsIp={vpsIp}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </div>
          )}

          {customDomains.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-md px-4 py-6 justify-center">
              <Globe className="h-4 w-4 opacity-40" />
              <span>No custom domains yet</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── How it works ── */}
      <div className="rounded-md bg-muted/40 px-4 py-3 text-xs space-y-1.5">
        <p className="font-medium text-foreground/70">How custom domains work</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Add your domain above — DNS instructions appear immediately.</li>
          <li>
            Add the A record(s) at your DNS provider pointing to{" "}
            <code className="font-mono">{vpsIp}</code>.
          </li>
          <li>
            Click <strong>Check DNS &amp; Publish</strong> — Prisom verifies the
            A record and writes an nginx config automatically.
          </li>
          <li>
            Click <strong>Enable HTTPS</strong> — certbot issues a free SSL
            certificate via Let&apos;s Encrypt.
          </li>
        </ol>
      </div>
    </div>
  );
}
