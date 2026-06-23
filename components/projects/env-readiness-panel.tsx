"use client";

/**
 * components/projects/env-readiness-panel.tsx
 *
 * Sprint 46: Environment/Secrets Readiness panel.
 * Shows grouped env var findings with status badges and fix hints.
 *
 * Safety rules:
 *  - No raw secret values shown
 *  - maskedPreview only
 *  - Replit leftovers surfaced prominently
 *  - "Create Placeholders" only creates empty isEnabled: false records
 */

import { useState }          from "react";
import Link                  from "next/link";
import { Badge }             from "@/components/ui/badge";
import { Button }            from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Shield,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  PlusCircle,
  ExternalLink,
} from "lucide-react";
import {
  generateEnvReadinessReportAction,
  createMissingEnvPlaceholdersAction,
} from "@/app/actions/project-env-readiness";
import type {
  EnvReadinessReport,
  EnvReadinessFinding,
  EnvVarCategory,
  EnvReadinessStatus,
} from "@/lib/env/env-readiness-types";

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
};

// ── Category labels ───────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<EnvVarCategory, string> = {
  database:   "Database",
  stripe:     "Stripe",
  cloudinary: "Cloudinary",
  email:      "Email",
  auth:       "Auth / Secrets",
  app_url:    "App URL",
  oauth:      "OAuth",
  storage:    "Storage",
  replit:     "Replit Leftovers",
  analytics:  "Analytics",
  unknown:    "Other",
};

const CATEGORY_ORDER: EnvVarCategory[] = [
  "database", "stripe", "cloudinary", "email", "auth", "app_url",
  "oauth", "storage", "analytics", "unknown", "replit",
];

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: EnvReadinessFinding["status"] }) {
  switch (status) {
    case "configured": return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "suspicious": return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "placeholder":return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "missing":    return <XCircle       className="h-4 w-4 text-red-500 shrink-0" />;
    case "empty":      return <XCircle       className="h-4 w-4 text-red-500 shrink-0" />;
    default:           return <AlertCircle   className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

const STATUS_BADGE_VARIANT: Record<EnvReadinessFinding["status"], "success" | "warning" | "destructive" | "secondary"> = {
  configured:  "success",
  suspicious:  "warning",
  placeholder: "warning",
  missing:     "destructive",
  empty:       "destructive",
  duplicate:   "secondary",
};

function OverallBadge({ status }: { status: EnvReadinessStatus }) {
  if (status === "ready")   return <Badge variant="success">Ready</Badge>;
  if (status === "warning") return <Badge variant="warning">Warnings</Badge>;
  return                           <Badge variant="destructive">Blocked</Badge>;
}

// ── Finding row ───────────────────────────────────────────────────────────────

function FindingRow({
  finding,
  projectId,
}: {
  finding:   EnvReadinessFinding;
  projectId: string;
}) {
  const [showHint, setShowHint] = useState(false);

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="mt-0.5">
        <StatusIcon status={finding.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
          <code className="text-xs font-mono font-semibold">{finding.name}</code>
          <Badge
            variant={finding.severity === "required" ? "secondary" : "outline"}
            className="text-xs"
          >
            {finding.severity}
          </Badge>
          <Badge
            variant={STATUS_BADGE_VARIANT[finding.status]}
            className="text-xs capitalize"
          >
            {finding.status}
          </Badge>
        </div>

        {finding.maskedPreview && (
          <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
            {finding.maskedPreview}
          </p>
        )}

        {finding.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{finding.description}</p>
        )}

        {finding.fixHint && finding.status !== "configured" && (
          <button
            type="button"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-0.5 text-left"
            onClick={() => setShowHint((v) => !v)}
          >
            {showHint ? "Hide fix hint ▲" : "Show fix hint ▼"}
          </button>
        )}
        {showHint && finding.fixHint && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 mt-1">
            {finding.fixHint}
          </p>
        )}
      </div>

      <Link
        href={`/projects/${projectId}/env`}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        title="Open Secrets Vault"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({
  category,
  findings,
  projectId,
}: {
  category:  EnvVarCategory;
  findings:  EnvReadinessFinding[];
  projectId: string;
}) {
  const [open, setOpen] = useState(
    findings.some((f) => f.status !== "configured"),
  );

  const hasIssues = findings.some((f) => f.status !== "configured");
  const allOk     = findings.every((f) => f.status === "configured");

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="text-sm font-medium">{CATEGORY_LABEL[category]}</span>
          <span className="text-xs text-muted-foreground">({findings.length})</span>
        </div>
        {allOk ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : hasIssues ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : null}
      </button>

      {open && (
        <div className="px-3">
          {findings.map((f) => (
            <FindingRow key={f.name} finding={f} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCards({ report }: { report: EnvReadinessReport }) {
  const { summary } = report;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {[
        { label: "Total",       value: summary.total,           color: "" },
        { label: "Configured",  value: summary.configured,      color: "text-green-600" },
        { label: "Missing",     value: summary.missing,         color: summary.missing > 0     ? "text-red-600"   : "" },
        { label: "Placeholder", value: summary.placeholders,    color: summary.placeholders > 0 ? "text-amber-600" : "" },
        { label: "Suspicious",  value: summary.suspicious,      color: summary.suspicious > 0   ? "text-amber-600" : "" },
        { label: "Blocked",     value: summary.requiredBlocked, color: summary.requiredBlocked > 0 ? "text-red-600" : "" },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-center">
          <p className={`text-lg font-bold leading-none ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EnvReadinessPanel({ projectId }: Props) {
  const [report,        setReport]        = useState<EnvReadinessReport | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [activeAction,  setActiveAction]  = useState<"generate" | "create_placeholders" | null>(null);
  const [lastAction,    setLastAction]    = useState("");
  const [createdNames,  setCreatedNames]  = useState<string[]>([]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (activeAction) return;
    setActiveAction("generate");
    setError(null);
    setLastAction("Generate Report clicked");
    try {
      const res = await generateEnvReadinessReportAction(projectId);
      if (!res.ok || !res.report) {
        setError(res.error ?? "Failed to generate report.");
        setLastAction("Generate Report failed");
        return;
      }
      setReport(res.report);
      setLastAction(`Report ready — ${res.report.status}, ${res.report.summary.requiredBlocked} required blocked`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
      setLastAction("Generate Report crashed");
    } finally {
      setActiveAction(null);
    }
  }

  async function handleCreatePlaceholders() {
    if (!report || activeAction) return;
    const missingRequired = report.findings
      .filter((f) => f.severity === "required" && f.status === "missing")
      .map((f) => f.name);
    if (!missingRequired.length) return;

    setActiveAction("create_placeholders");
    setError(null);
    setLastAction(`Creating ${missingRequired.length} placeholder(s)…`);
    try {
      const res = await createMissingEnvPlaceholdersAction({
        projectId,
        envNames: missingRequired,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to create placeholders.");
        setLastAction("Create Placeholders failed");
        return;
      }
      setCreatedNames(res.created);
      setLastAction(`Created ${res.created.length} placeholder(s). Skipped ${res.skipped.length}.`);
      // Refresh report
      await handleGenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
      setLastAction("Create Placeholders crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Grouped findings ────────────────────────────────────────────────────────

  const grouped = new Map<EnvVarCategory, EnvReadinessFinding[]>();
  if (report) {
    for (const f of report.findings) {
      if (!grouped.has(f.category)) grouped.set(f.category, []);
      grouped.get(f.category)!.push(f);
    }
  }

  const missingRequiredCount = report?.findings.filter(
    (f) => f.severity === "required" && f.status === "missing",
  ).length ?? 0;

  const isGenerating      = activeAction === "generate";
  const isCreating        = activeAction === "create_placeholders";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-sm">Environment Readiness</h3>
              <p className="text-xs text-muted-foreground">
                All required secrets must be configured before deploying to production.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {report && <OverallBadge status={report.status} />}
            <Button
              type="button"
              size="sm"
              onClick={handleGenerate}
              disabled={!!activeAction}
            >
              {isGenerating ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Scanning…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Generate Report</>
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
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Error</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>
          </div>
        )}

        {/* ── Created notification ── */}
        {createdNames.length > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 px-4 py-3">
            <p className="text-sm font-medium text-green-700 dark:text-green-300">
              {createdNames.length} placeholder(s) created
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              Open Secrets Vault and enter real production values for:{" "}
              {createdNames.join(", ")}.
            </p>
          </div>
        )}

        {report && (
          <>
            {/* ── Summary cards ── */}
            <SummaryCards report={report} />

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

            {/* ── Actions ── */}
            <div className="flex flex-wrap gap-2">
              {missingRequiredCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCreatePlaceholders}
                  disabled={!!activeAction}
                >
                  {isCreating ? (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</>
                  ) : (
                    <><PlusCircle className="h-3.5 w-3.5 mr-1.5" />Create {missingRequiredCount} Missing Placeholder(s)</>
                  )}
                </Button>
              )}
              <Link href={`/projects/${projectId}/env`}>
                <Button type="button" variant="outline" size="sm" asChild>
                  <span><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Secrets Vault</span>
                </Button>
              </Link>
            </div>

            {/* ── Grouped findings ── */}
            <div className="space-y-2">
              {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
                <CategorySection
                  key={cat}
                  category={cat}
                  findings={grouped.get(cat)!}
                  projectId={projectId}
                />
              ))}
            </div>
          </>
        )}

        {!report && !error && !isGenerating && (
          <div className="text-center py-6 text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Click Generate Report to scan your environment configuration.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
