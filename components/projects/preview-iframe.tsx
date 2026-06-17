"use client";

/**
 * components/projects/preview-iframe.tsx
 *
 * Sprint 4 (updated): Full-screen project preview component.
 *
 * Loading states:
 *   spinning     — iframe mounted, onLoad not yet fired, timeout not yet reached
 *   loaded       — onLoad fired cleanly
 *   timed-out    — 9 s elapsed without onLoad → fallback card shown
 *   error        — onError fired → fallback card shown
 *
 * On Refresh:
 *   - Appends ?_t=<timestamp> cache-buster to iframe URL
 *   - Increments frameKey (forces full iframe remount)
 *   - useEffect resets all loading/timeout/error state and restarts the timer
 *
 * The toolbar (including Open-in-new-tab) is always visible regardless of
 * loading state, so users can always escape a stuck iframe.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useTransition,
  useMemo,
} from "react";
import {
  RefreshCw, ExternalLink, Copy, CheckCircle2,
  Monitor, Smartphone, Tablet,
  Wifi, WifiOff, Loader2, AlertCircle,
  ArrowRight, ShieldCheck, Eye,
} from "lucide-react";
import Link from "next/link";
import { Button }        from "@/components/ui/button";
import { Badge }         from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  checkProjectPreviewStatusAction,
  type ProjectPreviewStatus,
} from "@/app/actions/project-preview";
import type { ProjectPreviewTarget } from "@/lib/projects/live-endpoint-resolver";

// ── Constants ──────────────────────────────────────────────────────────────

/** Milliseconds before we give up waiting for onLoad and show the fallback. */
const IFRAME_LOAD_TIMEOUT_MS = 9_000;

// ── Viewport config ────────────────────────────────────────────────────────

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_CONFIG: Record<Viewport, { width: string; label: string; maxWidth?: string }> = {
  desktop: { width: "100%",  label: "Desktop" },
  tablet:  { width: "768px", label: "Tablet",  maxWidth: "768px" },
  mobile:  { width: "390px", label: "Mobile",  maxWidth: "390px" },
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface Props {
  projectId:      string;
  initialStatus:  ProjectPreviewStatus;
  publishingHref: string;
  domainsHref:    string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function useCopy(ms = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), ms);
  }, [ms]);
  return { copied, copy };
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({
  target,
  isOnline,
  pm2Status,
}: {
  target:    ProjectPreviewTarget;
  isOnline:  boolean;
  pm2Status: string | null;
}) {
  void isOnline; // kept for future use (e.g. offline indicator while still showing URL)

  if (target.mode === "public") {
    return (
      <Badge variant="success" className="gap-1 shrink-0">
        <Wifi className="h-3 w-3" />
        Online — {target.label}
      </Badge>
    );
  }
  if (target.mode === "proxy") {
    return (
      <Badge
        variant="outline"
        className="gap-1 shrink-0 border-blue-300 text-blue-600 dark:text-blue-400"
      >
        <Wifi className="h-3 w-3" />
        Online via proxy
      </Badge>
    );
  }
  if (target.label === "Not running") {
    return (
      <Badge variant="error" className="gap-1 shrink-0">
        <WifiOff className="h-3 w-3" />
        {pm2Status ?? "Not running"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 shrink-0">
      <WifiOff className="h-3 w-3" />
      {target.label}
    </Badge>
  );
}

// ── Viewport selector ──────────────────────────────────────────────────────

function ViewportSelector({
  value,
  onChange,
}: {
  value:    Viewport;
  onChange: (vp: Viewport) => void;
}) {
  const buttons: { vp: Viewport; Icon: typeof Monitor }[] = [
    { vp: "desktop", Icon: Monitor },
    { vp: "tablet",  Icon: Tablet },
    { vp: "mobile",  Icon: Smartphone },
  ];

  return (
    <div
      className="hidden sm:flex items-center border rounded-md overflow-hidden"
      role="group"
      aria-label="Viewport size"
    >
      {buttons.map(({ vp, Icon }) => (
        <button
          key={vp}
          type="button"
          title={VIEWPORT_CONFIG[vp].label}
          aria-pressed={value === vp}
          onClick={() => onChange(vp)}
          className={`p-1.5 transition-colors ${
            value === vp
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// ── No-deploy fallback card ────────────────────────────────────────────────

function NoPreviewCard({
  target,
  status,
  publishingHref,
  domainsHref,
  onRetry,
  isRetrying,
}: {
  target:         ProjectPreviewTarget;
  status:         ProjectPreviewStatus;
  publishingHref: string;
  domainsHref:    string;
  onRetry:        () => void;
  isRetrying:     boolean;
}) {
  const isOffline = target.label === "Not running" || target.label === "No deployment config";

  return (
    <div className="flex-1 bg-muted/30 flex items-center justify-center p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="flex flex-col items-center text-center py-10 gap-4">
          {isOffline
            ? <WifiOff className="h-14 w-14 text-muted-foreground/30" />
            : <Eye     className="h-14 w-14 text-muted-foreground/30" />}

          <div>
            <p className="font-semibold">{target.label}</p>
            {target.reason && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {target.reason}
              </p>
            )}
            {status.pm2Name && (
              <p className="text-xs text-muted-foreground/70 mt-2 font-mono">
                pm2: {status.pm2Name} — {status.pm2Status ?? "not found"}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 justify-center">
            {isOffline && (
              <Button size="sm" asChild>
                <Link href={publishingHref}>
                  <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                  Go to Publishing
                </Link>
              </Button>
            )}
            {!isOffline && (
              <Button size="sm" variant="outline" asChild>
                <Link href={domainsHref}>
                  <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                  Manage Domains
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              disabled={isRetrying}
              className="gap-1.5"
            >
              {isRetrying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Iframe load-failure fallback card ──────────────────────────────────────

function IframeFailedCard({
  openUrl,
  isTimeout,
  onRetry,
  isRetrying,
}: {
  openUrl:    string | null;
  isTimeout:  boolean;
  onRetry:    () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95 z-20 p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="flex flex-col items-center text-center py-8 gap-4">
          <AlertCircle className="h-12 w-12 text-amber-500/70" />
          <div>
            <p className="font-semibold text-sm">
              {isTimeout ? "Preview timed out" : "Preview failed to load"}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Preview may be blocked, slow to load, or unable to embed.
              Open it in a new tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {openUrl && (
              <Button size="sm" asChild>
                <a href={openUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in new tab
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              disabled={isRetrying}
              className="gap-1.5"
            >
              {isRetrying
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function PreviewIframe({
  projectId,
  initialStatus,
  publishingHref,
  domainsHref,
}: Props) {
  const [status,         setStatus]         = useState<ProjectPreviewStatus>(initialStatus);
  const [viewport,       setViewport]       = useState<Viewport>("desktop");
  const [frameKey,       setFrameKey]       = useState(0);
  const [cacheBust,      setCacheBust]      = useState<number | null>(null);
  const [isLoaded,       setIsLoaded]       = useState(false);
  const [iframeTimedOut, setIframeTimedOut] = useState(false);
  const [iframeError,    setIframeError]    = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { copied, copy } = useCopy();
  const [isRefreshing, startRefresh] = useTransition();

  const target       = status.target;
  const displayUrl   = target.url;
  const baseIframeUrl = target.iframeUrl;

  // ── Cache-busting URL ────────────────────────────────────────────────────
  // On refresh, append ?_t=<timestamp> to force a true reload past caches.
  const iframeUrl = useMemo(() => {
    if (!baseIframeUrl || cacheBust === null) return baseIframeUrl;
    const sep = baseIframeUrl.includes("?") ? "&" : "?";
    return `${baseIframeUrl}${sep}_t=${cacheBust}`;
  }, [baseIframeUrl, cacheBust]);

  // ── Load timeout ─────────────────────────────────────────────────────────
  // Resets all per-frame state and (re)starts a 9-second load timer whenever
  // the effective iframe URL changes (new frameKey or new base URL).
  useEffect(() => {
    if (!iframeUrl) return;

    setIsLoaded(false);
    setIframeTimedOut(false);
    setIframeError(false);

    const timer = setTimeout(() => setIframeTimedOut(true), IFRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, iframeUrl]);

  // ── Refresh ──────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    startRefresh(async () => {
      const ts = Date.now();
      setCacheBust(ts);
      const res = await checkProjectPreviewStatusAction(projectId);
      if (res.ok && res.data) setStatus(res.data);
      setFrameKey((k) => k + 1);
    });
  }, [projectId]);

  // ── Iframe events ─────────────────────────────────────────────────────────
  function handleIframeLoad() {
    // If somehow onLoad fires after timeout (delayed page), recover gracefully.
    setIsLoaded(true);
    setIframeTimedOut(false);
    setIframeError(false);
  }

  function handleIframeError() {
    setIsLoaded(true); // stop the spinner
    setIframeError(true);
  }

  // ── Derived display flags ─────────────────────────────────────────────────
  const showSpinner   = !isLoaded && !iframeTimedOut && !iframeError && !!iframeUrl;
  const showFailed    = (iframeTimedOut || iframeError) && !isLoaded;
  const isHttpPublic  =
    target.mode === "public" &&
    typeof iframeUrl === "string" &&
    iframeUrl.startsWith("http://");

  // ── Toolbar (always rendered) ─────────────────────────────────────────────
  const toolbar = (
    <div className="border-b bg-background px-3 py-1.5 flex items-center gap-2 shrink-0">
      {/* Status badge — reflects resolver result, not iframe state */}
      <StatusBadge
        target={target}
        isOnline={status.isOnline}
        pm2Status={status.pm2Status}
      />

      {/* Address bar */}
      {displayUrl ? (
        <div className="flex-1 flex items-center bg-muted/60 rounded-md px-3 py-1 min-w-0 max-w-lg mx-2">
          <span className="text-xs text-muted-foreground font-mono truncate flex-1">
            {displayUrl}
          </span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Viewport selector (only when a URL is available) */}
      {target.mode !== "none" && (
        <ViewportSelector value={viewport} onChange={setViewport} />
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {displayUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Copy URL"
            onClick={() => copy(displayUrl)}
          >
            {copied
              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              : <Copy className="h-3.5 w-3.5" />}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="Refresh"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>

        {/* Open in new tab — ALWAYS visible when a URL exists */}
        {target.openUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Open in new tab"
            asChild
          >
            <a href={target.openUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}

        {/* Link to full readiness check on Publishing */}
        <Button
          size="sm"
          variant="ghost"
          className="hidden sm:flex h-7 px-2 gap-1 text-xs text-muted-foreground"
          title="Full readiness check"
          asChild
        >
          <Link href={publishingHref}>
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Readiness</span>
          </Link>
        </Button>
      </div>
    </div>
  );

  // ── No deployment / offline state ─────────────────────────────────────────
  if (target.mode === "none") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {toolbar}
        <NoPreviewCard
          target={target}
          status={status}
          publishingHref={publishingHref}
          domainsHref={domainsHref}
          onRetry={handleRefresh}
          isRetrying={isRefreshing}
        />
      </div>
    );
  }

  // ── Preview with URL ──────────────────────────────────────────────────────
  const vp = VIEWPORT_CONFIG[viewport];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toolbar}

      {/* ── Warning banners ── */}

      {/* HTTP-only warning (takes precedence; shown instead of generic banner) */}
      {isHttpPublic && (
        <div className="shrink-0 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 px-4 py-1.5 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            This preview is using HTTP. Some browsers may block or delay embedding.
            Open in a new tab if blank.
          </span>
          {target.openUrl && (
            <a
              href={target.openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 shrink-0 flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* Generic iframe-blocking warning for public HTTPS URLs */}
      {target.mode === "public" && !isHttpPublic && (
        <div className="shrink-0 bg-muted/40 border-b px-4 py-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Some sites block iframe embedding. If the preview is blank, use the ↗ button to open it in a new tab.
          </span>
          {target.openUrl && (
            <a
              href={target.openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 shrink-0 flex items-center gap-0.5 hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* ── Viewport frame ── */}
      <div className="flex-1 bg-zinc-100 dark:bg-zinc-900 flex items-start justify-center overflow-auto">
        <div
          className="relative flex-shrink-0 bg-white dark:bg-zinc-950 shadow-xl"
          style={{
            width:    vp.width,
            maxWidth: vp.maxWidth ?? "100%",
            height:   "100%",
          }}
        >
          {/* ① Loading spinner */}
          {showSpinner && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 text-muted-foreground/30 animate-spin" />
            </div>
          )}

          {/* ② Timeout / error fallback card */}
          {showFailed && (
            <IframeFailedCard
              openUrl={target.openUrl}
              isTimeout={iframeTimedOut}
              onRetry={handleRefresh}
              isRetrying={isRefreshing}
            />
          )}

          {/* ③ The iframe — always mounted so events fire; overlaid by spinner/fallback */}
          {iframeUrl && (
            <iframe
              key={frameKey}
              ref={iframeRef}
              src={iframeUrl}
              title={`Preview — ${displayUrl ?? "project"}`}
              className="w-full border-none block"
              style={{ height: "100%" }}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              allow="fullscreen"
            />
          )}
        </div>
      </div>

      {/* ── Proxy footer ── */}
      {target.mode === "proxy" && target.reason && (
        <div className="shrink-0 border-t bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span>{target.reason}</span>
          <Link
            href={domainsHref}
            className="ml-auto text-primary hover:underline whitespace-nowrap shrink-0"
          >
            Add a public domain →
          </Link>
        </div>
      )}
    </div>
  );
}
