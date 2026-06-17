"use client";

/**
 * components/projects/live-endpoints-card.tsx
 *
 * Displays all public-access endpoints for a deployed project:
 *   1. Primary live URL  (best available — domain > IP preview > internal-only)
 *   2. IP Preview URL    (http://IP/ or http://IP/<slug>/)
 *   3. Custom Domains    (every active / pending domain)
 *   4. Internal runtime  (http://127.0.0.1:<port> — never the public URL)
 *
 * Also renders a "Set / update IP preview URL" inline form for backfilling
 * existing deployments that pre-date the auto-setup feature.
 */

import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  Monitor,
  Plus,
  Server,
  Wifi,
  WifiOff,
  Zap,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPublicPreviewUrlAction } from "@/app/actions/project-deployments";

// ── Types ──────────────────────────────────────────────────────────────────

export type PublicPreviewMode =
  | "root_ip"
  | "path_ip"
  | "preview_subdomain"
  | "raw_port"
  | "disabled";

export type PublicPreviewStatus = "active" | "inactive" | "error";

export interface EndpointDomain {
  hostname:  string;
  isPrimary: boolean;
  status:    string; // "ACTIVE" | "PENDING" | "FAILED"
  sslStatus: string; // "ACTIVE" | "NONE" | "PENDING" | "FAILED" | "EXPIRED"
}

interface Props {
  projectId:           string;
  /** Listening port of the PM2 process */
  port:                number;
  /** Public IP preview URL (e.g. http://178.105.105.59/ or /slug/) */
  publicPreviewUrl:    string | null;
  publicPreviewMode:   string;  // PublicPreviewMode
  publicPreviewStatus: string;  // PublicPreviewStatus
  /** All domains attached to this project */
  domains:             EndpointDomain[];
  /** Whether a successful deployment has occurred */
  isDeployed:          boolean;
  /** href for the Domains management page */
  domainsHref:         string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };
  return { copied, copy };
}

function CopyButton({ text, id, copied, copy }: {
  text:   string;
  id:     string;
  copied: string | null;
  copy:   (text: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      title="Copy URL"
      onClick={() => copy(text, id)}
      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied === id
        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Determine the best public URL in priority order. */
function computePrimaryUrl(
  domains: EndpointDomain[],
  publicPreviewUrl: string | null,
  publicPreviewStatus: string,
  port: number,
  publicPreviewMode: string
): { url: string; label: string } | null {
  // 1. SSL-active primary domain
  const sslPrimary = domains.find(
    (d) => d.isPrimary && d.status === "ACTIVE" && d.sslStatus === "ACTIVE"
  );
  if (sslPrimary) return { url: `https://${sslPrimary.hostname}`, label: "Primary domain (HTTPS)" };

  // 2. Any active primary domain (HTTP)
  const httpPrimary = domains.find((d) => d.isPrimary && d.status === "ACTIVE");
  if (httpPrimary) return { url: `http://${httpPrimary.hostname}`, label: "Primary domain" };

  // 3. Any active domain
  const anyDomain = domains.find((d) => d.status === "ACTIVE");
  if (anyDomain) {
    const scheme = anyDomain.sslStatus === "ACTIVE" ? "https" : "http";
    return { url: `${scheme}://${anyDomain.hostname}`, label: "Custom domain" };
  }

  // 4. IP preview
  if (publicPreviewUrl && publicPreviewStatus === "active") {
    return { url: publicPreviewUrl, label: "IP preview" };
  }

  // 5. Raw port (not shown unless mode === "raw_port")
  if (publicPreviewMode === "raw_port") {
    return { url: `http://178.105.105.59:${port}`, label: "Raw port (not recommended)" };
  }

  return null;
}

// ── Set Preview URL form ───────────────────────────────────────────────────

const MODE_OPTIONS: { value: PublicPreviewMode; label: string }[] = [
  { value: "root_ip",           label: "Root IP  (http://IP/)" },
  { value: "path_ip",           label: "Path IP  (http://IP/<slug>/)" },
  { value: "preview_subdomain", label: "Preview subdomain" },
  { value: "raw_port",          label: "Raw port (internal / dev only)" },
  { value: "disabled",          label: "Disabled" },
];

function SetPreviewForm({
  projectId,
  currentUrl,
  currentMode,
  currentStatus,
}: {
  projectId:     string;
  currentUrl:    string | null;
  currentMode:   string;
  currentStatus: string;
}) {
  const [open,      setOpen]      = useState(false);
  const [url,       setUrl]       = useState(currentUrl ?? "");
  const [mode,      setMode]      = useState(currentMode === "disabled" ? "root_ip" : currentMode);
  const [isPending, setIsPending] = useState(false);
  const [error,     setError]     = useState("");
  const [saved,     setSaved]     = useState(false);

  async function handleSave() {
    setError("");
    setIsPending(true);
    try {
      const res = await setPublicPreviewUrlAction(projectId, {
        publicPreviewUrl:    url,
        publicPreviewMode:   mode,
        publicPreviewStatus: "active",
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { setSaved(false); setOpen(false); }, 1500);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setIsPending(false);
    }
  }

  async function handleDisable() {
    setError("");
    setIsPending(true);
    try {
      const res = await setPublicPreviewUrlAction(projectId, {
        publicPreviewUrl:    "",
        publicPreviewMode:   "disabled",
        publicPreviewStatus: "inactive",
      });
      if (res.ok) { setSaved(true); setTimeout(() => { setSaved(false); setOpen(false); }, 1000); }
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {currentMode === "disabled" ? "Set IP preview URL…" : "Change IP preview URL…"}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border bg-muted/30 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Set the public IP preview URL for this project (backfill or override the auto-detected value).
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://178.105.105.59/"
              className="h-8 font-mono text-xs"
              disabled={isPending}
            />
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              disabled={isPending}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleSave} disabled={isPending || !url.trim()}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : null}
              {saved ? "Saved" : "Save"}
            </Button>
            {currentMode !== "disabled" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleDisable} disabled={isPending}>
                Disable preview
              </Button>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LiveEndpointsCard({
  projectId,
  port,
  publicPreviewUrl,
  publicPreviewMode,
  publicPreviewStatus,
  domains,
  isDeployed,
  domainsHref,
}: Props) {
  const { copied, copy } = useCopy();

  const primaryEntry = computePrimaryUrl(
    domains,
    publicPreviewUrl,
    publicPreviewStatus,
    port,
    publicPreviewMode
  );

  const internalUrl = `http://127.0.0.1:${port}`;
  const activeDomains   = domains.filter((d) => d.status === "ACTIVE");
  const pendingDomains  = domains.filter((d) => d.status === "PENDING");
  const hasAnyDomain    = domains.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Live Endpoints</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-0 divide-y">

        {/* ── 1. Primary live URL ── */}
        <div className="py-3 first:pt-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24 shrink-0">
              Primary
            </span>
            {primaryEntry ? (
              <Badge variant="success" className="text-xs gap-1 py-0">
                <Zap className="h-3 w-3" />
                Live
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs gap-1 py-0">
                <WifiOff className="h-3 w-3" />
                {isDeployed ? "Internal only" : "Not deployed"}
              </Badge>
            )}
          </div>

          {primaryEntry ? (
            <div className="flex items-center gap-2 pl-[6.5rem]">
              <a
                href={primaryEntry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline flex items-center gap-1 min-w-0 truncate"
              >
                {primaryEntry.url}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <CopyButton text={primaryEntry.url} id="primary" copied={copied} copy={copy} />
              <span className="text-xs text-muted-foreground shrink-0">{primaryEntry.label}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground pl-[6.5rem]">
              {isDeployed
                ? "No public URL yet — add a domain or set an IP preview URL below."
                : "Deploy the project to get a public URL."}
            </p>
          )}
        </div>

        {/* ── 2. IP Preview ── */}
        <div className="py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24 shrink-0">
              IP Preview
            </span>
            {publicPreviewStatus === "active" && publicPreviewUrl ? (
              <Badge variant="outline" className="text-xs gap-1 py-0 border-blue-300 text-blue-600 dark:text-blue-400">
                <Wifi className="h-3 w-3" />
                Active
              </Badge>
            ) : publicPreviewStatus === "error" ? (
              <Badge variant="error" className="text-xs gap-1 py-0">
                <AlertCircle className="h-3 w-3" />
                Error
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
          </div>

          <div className="pl-[6.5rem] space-y-2">
            {publicPreviewUrl && publicPreviewStatus !== "disabled" ? (
              <div className="flex items-center gap-2">
                <a
                  href={publicPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono text-foreground/80 hover:text-primary hover:underline flex items-center gap-1 min-w-0 truncate"
                >
                  {publicPreviewUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                <CopyButton text={publicPreviewUrl} id="preview" copied={copied} copy={copy} />
                <span className="text-xs text-muted-foreground shrink-0">
                  {publicPreviewMode === "root_ip"  && "root"}
                  {publicPreviewMode === "path_ip"  && "path"}
                  {publicPreviewMode === "preview_subdomain" && "subdomain"}
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isDeployed
                  ? "Auto-setup not available or disabled. Set manually below."
                  : "Deploy the project first."}
              </p>
            )}

            {/* Inline form to set/update IP preview URL */}
            {isDeployed && (
              <SetPreviewForm
                projectId={projectId}
                currentUrl={publicPreviewUrl}
                currentMode={publicPreviewMode}
                currentStatus={publicPreviewStatus}
              />
            )}
          </div>
        </div>

        {/* ── 3. Custom Domains ── */}
        <div className="py-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24 shrink-0">
                Domains
              </span>
              {activeDomains.length > 0 ? (
                <Badge variant="success" className="text-xs gap-1 py-0">
                  <Globe className="h-3 w-3" />
                  {activeDomains.length} active
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">None</span>
              )}
            </div>
            <Link
              href={domainsHref}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              Add domain
            </Link>
          </div>

          <div className="pl-[6.5rem] space-y-1.5">
            {hasAnyDomain ? (
              <>
                {activeDomains.map((d) => {
                  const scheme = d.sslStatus === "ACTIVE" ? "https" : "http";
                  const url    = `${scheme}://${d.hostname}`;
                  return (
                    <div key={d.hostname} className="flex items-center gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-foreground/80 hover:text-primary hover:underline flex items-center gap-1 min-w-0 truncate"
                      >
                        {d.sslStatus === "ACTIVE"
                          ? <Lock className="h-3 w-3 text-green-500 shrink-0" />
                          : <Globe className="h-3 w-3 text-muted-foreground shrink-0" />}
                        {url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <CopyButton text={url} id={`domain-${d.hostname}`} copied={copied} copy={copy} />
                      {d.isPrimary && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">Primary</Badge>
                      )}
                    </div>
                  );
                })}
                {pendingDomains.map((d) => (
                  <div key={d.hostname} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="font-mono">{d.hostname}</span>
                    <span>— pending DNS</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No custom domains yet.{" "}
                <Link href={domainsHref} className="text-primary hover:underline">
                  Publish a domain →
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* ── 4. Internal runtime ── */}
        <div className="py-3 last:pb-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24 shrink-0">
              Internal
            </span>
            <Badge variant="secondary" className="text-xs gap-1 py-0">
              <Lock className="h-3 w-3" />
              Internal only
            </Badge>
          </div>
          <div className="pl-[6.5rem] flex items-center gap-2">
            <span className="text-xs font-mono text-foreground/60 flex items-center gap-1.5">
              <Server className="h-3 w-3 shrink-0" />
              {internalUrl}
            </span>
            <CopyButton text={internalUrl} id="internal" copied={copied} copy={copy} />
            <span className="text-xs text-muted-foreground">
              PM2 process — not accessible from the internet
            </span>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
