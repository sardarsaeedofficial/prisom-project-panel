"use client";

/**
 * components/projects/debug-summary-panel.tsx
 *
 * Sprint 58: Debug Summary Panel — analyze logs, display findings, export bundle.
 *
 * Variants:
 *  - compact: status badge + "Analyze Failure" button + link to logs
 *  - full: source selector, log textarea, findings, excerpt, next steps, export
 *
 * Safety: never shows raw secrets. All text analyzed server-side via actions.
 * No mutations — read-only debugging UI only.
 */

import { useState, useTransition, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Bug,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileText,
  ScrollText,
  ExternalLink,
  Copy,
  ClipboardList,
} from "lucide-react";
import { Button }               from "@/components/ui/button";
import { Badge }                from "@/components/ui/badge";
import { ActionLoadingButton }  from "@/components/common/action-loading-button";
import { CopyDownloadButton }   from "@/components/common/copy-download-button";
import {
  generateDebugSummaryAction,
  exportDebugBundleAction,
} from "@/app/actions/project-debug";
import type { DebugSummary, DebugFinding, DebugCategory } from "@/lib/debug/debug-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Source = DebugSummary["source"];

const SOURCE_LABELS: Record<Source, string> = {
  logs:      "Logs",
  operation: "Operation",
  build:     "Build",
  deploy:    "Deploy",
  dry_run:   "Dry Run",
  routing:   "Routing",
  cutover:   "Cutover",
  github:    "GitHub",
  unknown:   "Unknown",
};

const CATEGORY_LABELS: Record<DebugCategory, string> = {
  install:          "Install / Package",
  build:            "Build",
  runtime:          "Runtime",
  routing:          "Routing",
  database:         "Database",
  env:              "Environment",
  github:           "GitHub",
  external_service: "External Services",
  permissions:      "Permissions",
  network:          "Network",
  unknown:          "Unknown",
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DebugSummary["status"] }) {
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === "warning") {
    return (
      <Badge variant="outline" className="gap-1 border-yellow-400 text-yellow-700 dark:text-yellow-400">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  }
  if (status === "healthy") {
    return (
      <Badge variant="outline" className="gap-1 border-green-400 text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Healthy
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <HelpCircle className="h-3 w-3" />
      Unknown
    </Badge>
  );
}

// ── Severity indicator ────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: DebugFinding["severity"] }) {
  const cls = {
    critical: "bg-red-500",
    error:    "bg-orange-500",
    warning:  "bg-yellow-500",
    info:     "bg-blue-500",
  }[severity] ?? "bg-muted-foreground";
  return <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${cls}`} />;
}

// ── Single finding card ───────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: DebugFinding }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (finding.evidence && finding.evidence.length > 0) || finding.suggestedFix;

  return (
    <div className="rounded-md border bg-card p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <SeverityDot severity={finding.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{finding.title}</span>
            <Badge variant="outline" className="text-xs py-0 h-5">
              {finding.severity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{finding.message}</p>
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && (
        <div className="pl-4 space-y-2">
          {finding.evidence && finding.evidence.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Evidence:</p>
              <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                {finding.evidence.join("\n")}
              </pre>
            </div>
          )}
          {finding.suggestedFix && (
            <div className="flex items-start gap-1.5">
              <span className="text-xs font-medium text-muted-foreground mt-0.5 flex-shrink-0">Fix:</span>
              <span className="text-xs text-foreground">{finding.suggestedFix}</span>
            </div>
          )}
          {finding.fixHref && (
            <Link
              href={finding.fixHref}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open fix page
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Findings grouped by category ──────────────────────────────────────────────

function FindingsGroup({ findings }: { findings: DebugFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No known error patterns detected in the provided log text.
      </p>
    );
  }

  const byCategory = new Map<DebugCategory, DebugFinding[]>();
  for (const f of findings) {
    const arr = byCategory.get(f.category) ?? [];
    arr.push(f);
    byCategory.set(f.category, arr);
  }

  return (
    <div className="space-y-3">
      {[...byCategory.entries()].map(([cat, catFindings]) => (
        <div key={cat}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {CATEGORY_LABELS[cat]}
          </p>
          <div className="space-y-1.5">
            {catFindings.map((f) => <FindingCard key={f.id} finding={f} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Full panel ────────────────────────────────────────────────────────────────

function FullPanel({ projectId }: { projectId: string }) {
  const [source,        setSource]        = useState<Source>("logs");
  const [logText,       setLogText]       = useState("");
  const [summary,       setSummary]       = useState<DebugSummary | null>(null);
  const [bundleMd,      setBundleMd]      = useState<string | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [excerptOpen,   setExcerptOpen]   = useState(false);
  const [isPending,     startTransition]  = useTransition();
  const inFlight = useRef(false);

  const handleAnalyze = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBundleMd(null);

    startTransition(async () => {
      try {
        const res = await generateDebugSummaryAction({
          projectId,
          source,
          logText: logText.trim() || undefined,
        });
        if (res.ok) {
          setSummary(res.data);
        } else {
          setError(res.error);
        }
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId, source, logText]);

  const handleExport = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);

    startTransition(async () => {
      try {
        const res = await exportDebugBundleAction({
          projectId,
          source,
          logText: logText.trim() || undefined,
        });
        if (res.ok) {
          setBundleMd(res.data.markdown);
        } else {
          setError(res.error);
        }
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId, source, logText]);

  const handleCopyExcerpt = useCallback(() => {
    if (!summary?.sanitizedExcerpt) return;
    navigator.clipboard.writeText(summary.sanitizedExcerpt).catch(() => null);
  }, [summary]);

  return (
    <div className="space-y-4">
      {/* Source + Log input */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs font-medium text-muted-foreground">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            className="text-xs rounded border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Paste log output (optional)
          </label>
          <textarea
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder="Paste build/deploy/PM2 log output here to analyze…"
            rows={6}
            className="w-full rounded border bg-muted px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <ActionLoadingButton
          loading={isPending}
          loadingLabel="Analyzing…"
          onClick={handleAnalyze}
          size="sm"
        >
          <Bug className="h-4 w-4" />
          Analyze Logs
        </ActionLoadingButton>

        <ActionLoadingButton
          loading={isPending}
          loadingLabel="Exporting…"
          onClick={handleExport}
          variant="outline"
          size="sm"
        >
          <FileText className="h-4 w-4" />
          Export Debug Bundle
        </ActionLoadingButton>

        {summary?.sanitizedExcerpt && (
          <Button type="button" variant="ghost" size="sm" onClick={handleCopyExcerpt}>
            <Copy className="h-4 w-4" />
            Copy Sanitized Excerpt
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {summary && (
        <div className="space-y-4">
          {/* Status + likely cause */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={summary.status} />
              <span className="text-xs text-muted-foreground">
                {new Date(summary.generatedAt).toLocaleTimeString()} · source: {SOURCE_LABELS[summary.source]}
              </span>
            </div>
            {summary.likelyCause && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Likely cause: </span>
                <span className="text-sm font-medium">{summary.likelyCause}</span>
              </div>
            )}
          </div>

          {/* Findings */}
          <div>
            <h4 className="text-sm font-medium mb-2">
              Findings ({summary.findings.length})
            </h4>
            <FindingsGroup findings={summary.findings} />
          </div>

          {/* Sanitized excerpt */}
          {summary.sanitizedExcerpt && (
            <div>
              <button
                type="button"
                onClick={() => setExcerptOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {excerptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Sanitized Excerpt
                <Badge variant="outline" className="text-xs py-0 h-4 text-muted-foreground">
                  secrets redacted
                </Badge>
              </button>
              {excerptOpen && (
                <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-60 overflow-y-auto">
                  {summary.sanitizedExcerpt}
                </pre>
              )}
            </div>
          )}

          {/* Next steps */}
          {summary.nextSteps.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Next Steps</h4>
              <ul className="space-y-1">
                {summary.nextSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <ClipboardList className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-0.5" />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Bundle download */}
      {bundleMd && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <p className="text-sm font-medium">Debug Bundle Ready</p>
          <CopyDownloadButton
            content={bundleMd}
            filename="DEBUG_BUNDLE.md"
            label="Download DEBUG_BUNDLE.md"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

// ── Compact panel ─────────────────────────────────────────────────────────────

function CompactPanel({
  projectId,
  context,
}: {
  projectId: string;
  context?:  string;
}) {
  const [summary,    setSummary]    = useState<DebugSummary | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [isPending,  startTransition] = useTransition();
  const inFlight = useRef(false);

  const handleAnalyze = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);

    startTransition(async () => {
      try {
        const res = await generateDebugSummaryAction({
          projectId,
          source: (context ?? "unknown") as Source,
        });
        if (res.ok) setSummary(res.data);
        else setError(res.error);
      } finally {
        inFlight.current = false;
      }
    });
  }, [projectId, context]);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Debug Failed Operation</span>
          {summary && <StatusBadge status={summary.status} />}
        </div>
        <div className="flex items-center gap-1.5">
          <ActionLoadingButton
            loading={isPending}
            loadingLabel="Analyzing…"
            onClick={handleAnalyze}
            size="sm"
            variant="outline"
          >
            Analyze Failure
          </ActionLoadingButton>
          <Link
            href={`/projects/${projectId}/logs`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1.5 h-8 transition-colors"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Logs
          </Link>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {summary && (
        <>
          {summary.likelyCause && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Likely cause:</span> {summary.likelyCause}
            </p>
          )}
          {summary.findings.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.findings.length} finding{summary.findings.length !== 1 ? "s" : ""} detected.{" "}
              <Link
                href={`/projects/${projectId}/logs`}
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                View full analysis <ExternalLink className="h-3 w-3" />
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function DebugSummaryPanel({
  projectId,
  compact = false,
  context,
}: {
  projectId: string;
  compact?:  boolean;
  context?:  string;
}) {
  if (compact) {
    return <CompactPanel projectId={projectId} context={context} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bug className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-base font-semibold">Debug Summary</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste log output or select a source to analyze failures. All output is sanitized — no secrets are shown.
      </p>
      <FullPanel projectId={projectId} />
    </div>
  );
}
