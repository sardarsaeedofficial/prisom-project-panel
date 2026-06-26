"use client";

/**
 * components/projects/post-launch-bug-capture-panel.tsx
 *
 * Sprint 76: Post-Launch Bug Capture panel.
 * Read-only — triage and evidence capture only. No production mutation.
 */

import { useState, useTransition, useRef }        from "react";
import {
  generatePostLaunchBugCaptureReportAction,
  exportPostLaunchBugCaptureReportAction,
}                                                  from "@/app/actions/post-launch-bug-capture";
import { CopyDownloadButton }                      from "@/components/common/copy-download-button";
import { ActionLoadingButton }                    from "@/components/common/action-loading-button";
import { Badge }                                   from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                  from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Bug, ChevronDown, ChevronUp,
}                                                  from "lucide-react";
import type {
  PostLaunchBugCaptureReport,
  PostLaunchIssueTemplate,
  PostLaunchIssueSeverity,
  PostLaunchIssueCategory,
} from "@/lib/post-launch/post-launch-bug-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_LABELS: Record<PostLaunchIssueSeverity, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
  cosmetic: "Cosmetic",
};

const SEVERITY_VARIANTS: Record<PostLaunchIssueSeverity, "error" | "warning" | "secondary" | "success"> = {
  critical: "error",
  high:     "error",
  medium:   "warning",
  low:      "secondary",
  cosmetic: "secondary",
};

const SEVERITY_ORDER: PostLaunchIssueSeverity[] = [
  "critical", "high", "medium", "low", "cosmetic",
];

const CATEGORY_LABELS: Record<PostLaunchIssueCategory, string> = {
  availability: "Availability",
  routing:      "Routing",
  checkout:     "Checkout",
  payments:     "Payments",
  orders:       "Orders",
  email:        "Email",
  admin:        "Admin",
  content:      "Content",
  performance:  "Performance",
  logs:         "Logs",
  unknown:      "Unknown",
};

function SeverityIcon({ severity }: { severity: PostLaunchIssueSeverity }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (severity === "critical" || severity === "high") return <XCircle className={`${cls} text-red-500`} />;
  if (severity === "medium") return <AlertTriangle className={`${cls} text-yellow-500`} />;
  return <CheckCircle2 className={`${cls} text-muted-foreground`} />;
}

// ── Sub-component: issue template card ───────────────────────────────────────

function IssueTemplateCard({ tpl }: { tpl: PostLaunchIssueTemplate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-2 font-medium min-w-0">
          <SeverityIcon severity={tpl.severity} />
          <span className="truncate">{tpl.title}</span>
          <Badge variant={SEVERITY_VARIANTS[tpl.severity]} className="text-xs shrink-0">
            {SEVERITY_LABELS[tpl.severity]}
          </Badge>
          <span className="text-xs text-muted-foreground font-normal shrink-0">
            {CATEGORY_LABELS[tpl.category]}
          </span>
        </span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">{tpl.description}</p>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence to collect
            </p>
            {tpl.evidenceToCollect.map((ev, i) => (
              <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <span className="text-muted-foreground shrink-0">☐</span>
                {ev}
              </p>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Immediate checks
            </p>
            {tpl.immediateChecks.map((chk, i) => (
              <code key={i} className="text-xs bg-muted px-2 py-0.5 rounded block font-mono text-foreground">
                {chk}
              </code>
            ))}
          </div>

          <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span><span className="font-semibold">Escalation:</span> {tpl.escalationRule}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PostLaunchBugCapturePanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PostLaunchBugCapturePanel({ projectId, compact }: PostLaunchBugCapturePanelProps) {
  const [report,     setReport]     = useState<PostLaunchBugCaptureReport | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [activeTab,  setActiveTab]  = useState<"issues" | "triage" | "changes">("issues");

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  function handleGenerate() {
    if (genFlight.current) return;
    genFlight.current = true;
    setError("");
    setReport(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generatePostLaunchBugCaptureReportAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setReport(result.data);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportPostLaunchBugCaptureReportAction({ projectId });
            if (exp.ok) setExportData(exp.data.markdown ?? "");
          } finally {
            expFlight.current = false;
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unexpected error.");
      } finally {
        genFlight.current = false;
      }
    });
  }

  // ── Compact card ──────────────────────────────────────────────────────────

  if (compact) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
        <Bug className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Post-Launch Bug Capture</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Issue templates, evidence checklists, triage rules, and escalation guidance for post-launch issues.
            Export POST_LAUNCH_BUG_CAPTURE.md.{" "}
            <span className="italic">Read-only. Triage only. No production mutation.</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Post-Launch Bug Capture</CardTitle>
          {report && (
            <Badge variant="secondary">{report.issueTemplates.length} templates</Badge>
          )}
        </div>
        <CardDescription>
          Issue templates, evidence checklists, triage rules, and escalation guidance for post-launch issues.
          Export POST_LAUNCH_BUG_CAPTURE.md.{" "}
          <span className="italic">
            Read-only — triage and evidence capture only. No production mutation.
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Tabs */}
        {report && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit">
            {(["issues", "triage", "changes"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  "text-xs px-3 py-1.5 rounded-md transition-colors",
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {tab === "issues" ? "Issue Templates"
                 : tab === "triage" ? "Triage Rules"
                 : "Changes"}
              </button>
            ))}
          </div>
        )}

        {/* Issues tab — grouped by severity */}
        {report && activeTab === "issues" && (
          <div className="space-y-4">
            {SEVERITY_ORDER.map((severity) => {
              const templates = report.issueTemplates.filter((t) => t.severity === severity);
              if (templates.length === 0) return null;
              return (
                <div key={severity} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <SeverityIcon severity={severity} />
                    {SEVERITY_LABELS[severity]}
                  </p>
                  {templates.map((tpl) => (
                    <IssueTemplateCard key={tpl.id} tpl={tpl} />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Triage tab */}
        {report && activeTab === "triage" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Triage Rules
              </p>
              {report.triageRules.map((rule, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground shrink-0">•</span>
                  {rule}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Changes tab */}
        {report && activeTab === "changes" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Allowed Immediate Fixes
              </p>
              {report.immediateFixAllowed.map((item, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                  {item}
                </p>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5 text-red-500" />
                Changes Requiring Approval
              </p>
              {report.changesRequiringApproval.map((item, i) => (
                <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  {item}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <ActionLoadingButton
            type="button"
            onClick={handleGenerate}
            loading={genPending}
            loadingLabel="Generating…"
            variant="outline"
            size="sm"
          >
            Generate Bug Capture Report
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="POST_LAUNCH_BUG_CAPTURE.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — triage and evidence capture only. No production mutation. Escalate before any risky change.
        </p>
      </CardContent>
    </Card>
  );
}
