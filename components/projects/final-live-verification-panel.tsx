"use client";

import { useState, useTransition, useRef }               from "react";
import {
  generateFinalLiveVerificationRunAction,
  exportFinalLiveVerificationRunAction,
}                                                         from "@/app/actions/final-live-verification";
import { CopyDownloadButton }                             from "@/components/common/copy-download-button";
import { ActionLoadingButton }                            from "@/components/common/action-loading-button";
import { Badge }                                          from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                         from "@/components/ui/card";
import { Input }                                          from "@/components/ui/input";
import { Label }                                          from "@/components/ui/label";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Loader2,
  ChevronDown, ChevronUp, ShieldCheck, ClipboardList,
}                                                         from "lucide-react";
import type {
  FinalLiveVerificationRun,
  FinalLiveVerificationCheck,
  FinalLiveVerificationStatus,
} from "@/lib/final-live-verification/final-live-verification-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: FinalLiveVerificationCheck["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "pass":    return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning": return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked": return <XCircle className={`${cls} text-red-500`} />;
    case "manual":  return <Clock className={`${cls} text-blue-500`} />;
    case "pending": return <Loader2 className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadge(status: FinalLiveVerificationStatus) {
  const map: Record<
    FinalLiveVerificationStatus,
    { variant: "error" | "warning" | "success" | "secondary"; label: string }
  > = {
    not_started:    { variant: "secondary", label: "Not Started" },
    blocked:        { variant: "error",     label: "Blocked" },
    needs_review:   { variant: "warning",   label: "Needs Review" },
    verified_ready: { variant: "success",   label: "Verified Ready" },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<FinalLiveVerificationCheck["category"], string> = {
  deployment:        "Deployment",
  route:             "Routes",
  panel:             "Panels",
  export:            "Exports",
  confirmation_gate: "Confirmation Gates",
  sardar:            "Sardar",
  security:          "Security",
  monitoring:        "Monitoring",
  rollback:          "Rollback",
  handoff:           "Handoff",
};

const CATEGORY_ORDER: FinalLiveVerificationCheck["category"][] = [
  "deployment", "route", "panel", "export",
  "confirmation_gate", "sardar", "security",
  "monitoring", "rollback", "handoff",
];

// ── Category group ─────────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  checks,
}: {
  category: FinalLiveVerificationCheck["category"];
  checks: FinalLiveVerificationCheck[];
}) {
  const [open, setOpen] = useState(true);
  const blocked = checks.filter((c) => c.status === "blocked").length;
  const warned  = checks.filter((c) => c.status === "warning").length;

  return (
    <div className="border rounded-md mb-2">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{CATEGORY_LABELS[category]}</span>
        <span className="flex items-center gap-2">
          {blocked > 0 && <Badge variant="error" className="text-xs">{blocked} blocked</Badge>}
          {warned  > 0 && <Badge variant="warning" className="text-xs">{warned} warning</Badge>}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1.5">
          {checks.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5">
              <div className="flex items-start gap-2">
                <CheckIcon status={c.status} />
                <span className="text-xs font-medium leading-tight">{c.label}</span>
              </div>
              {c.description && (
                <p className="text-xs text-muted-foreground ml-5">{c.description}</p>
              )}
              {c.command && (
                <code className="ml-5 text-xs bg-muted rounded px-1.5 py-0.5 font-mono block w-fit max-w-full overflow-x-auto">
                  {c.command}
                </code>
              )}
              {c.evidence && (
                <p className="ml-5 text-xs text-green-600">Evidence: {c.evidence}</p>
              )}
              {c.nextStep && (
                <p className="ml-5 text-xs text-blue-600">Next: {c.nextStep}</p>
              )}
              {c.safetyNote && (
                <p className="ml-5 text-xs text-orange-600 font-medium">⚠ {c.safetyNote}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

type Tab = "checks" | "evidence" | "exports";

export function FinalLiveVerificationPanel({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const [report, setReport]               = useState<FinalLiveVerificationRun | null>(null);
  const [expectedCommit, setExpectedCommit] = useState("");
  const [tab, setTab]                     = useState<Tab>("checks");
  const [exportMd, setExportMd]           = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState("FINAL_LIVE_VERIFICATION_RUN.md");
  const [error, setError]                 = useState<string | null>(null);
  const [isPending, startTransition]      = useTransition();
  const [isExporting, startExport]        = useTransition();
  const generating                        = useRef(false);
  const exporting                         = useRef(false);

  function handleGenerate() {
    if (generating.current) return;
    generating.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const res = await generateFinalLiveVerificationRunAction({
          projectId,
          expectedCommit: expectedCommit.trim() || undefined,
        });
        if (res.ok) setReport(res.data);
        else        setError(res.error);
      } finally {
        generating.current = false;
      }
    });
  }

  function handleExport() {
    if (exporting.current) return;
    exporting.current = true;
    setError(null);
    startExport(async () => {
      try {
        const res = await exportFinalLiveVerificationRunAction({
          projectId,
          expectedCommit: expectedCommit.trim() || undefined,
        });
        if (res.ok) {
          setExportMd(res.data.markdown);
          setExportFilename(res.data.filename);
        } else {
          setError(res.error);
        }
      } finally {
        exporting.current = false;
      }
    });
  }

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Final Live Verification Run</CardTitle>
            {report && statusBadge(report.status)}
          </div>
          <CardDescription className="text-xs">
            Read-only · Final evidence only · No production mutation
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-3 space-y-2">
          {report ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Score: {report.score}%</p>
              <p>Checks: {report.checks.length}</p>
              {report.blockers.length > 0 && (
                <p className="text-red-500">{report.blockers.length} blocker(s)</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Not yet generated.</p>
          )}
          <ActionLoadingButton
            type="button"
            loading={isPending}
            loadingLabel="Generating…"
            onClick={handleGenerate}
            className="h-7 text-xs w-full"
          >
            Generate Verification
          </ActionLoadingButton>
        </CardContent>
      </Card>
    );
  }

  const groupedChecks = CATEGORY_ORDER.reduce<
    Record<string, FinalLiveVerificationCheck[]>
  >((acc, cat) => {
    const group = report?.checks.filter((c) => c.category === cat) ?? [];
    if (group.length > 0) acc[cat] = group;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Final Live Verification Run</CardTitle>
              {report && statusBadge(report.status)}
            </div>
            <CardDescription>
              Read-only live verification of all routes, panels, exports, and safety gates.
              No production mutation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Commit input */}
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="flv-commit" className="text-xs">
              Expected Commit SHA (optional)
            </Label>
            <Input
              id="flv-commit"
              placeholder="e.g. abc1234"
              value={expectedCommit}
              onChange={(e) => setExpectedCommit(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <ActionLoadingButton
            type="button"
            loading={isPending}
            loadingLabel="Generating…"
            onClick={handleGenerate}
            className="h-8 text-xs"
          >
            Generate Verification
          </ActionLoadingButton>
        </div>

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {report && (
          <>
            {/* Score bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Verification Score</span>
                <span className="font-medium">{report.score}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    report.score === 100 ? "bg-green-500" :
                    report.score >= 60   ? "bg-yellow-500" : "bg-red-500"
                  }`}
                  style={{ width: `${report.score}%` }}
                />
              </div>
            </div>

            {/* Blockers */}
            {report.blockers.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-semibold text-red-700 mb-1">
                  {report.blockers.length} Blocker{report.blockers.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-0.5">
                  {report.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-red-600">• {b}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
                <p className="text-xs font-semibold text-yellow-700 mb-1">
                  {report.warnings.length} Warning{report.warnings.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-0.5">
                  {report.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-yellow-600">• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b pb-1">
              {(["checks", "evidence", "exports"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                    tab === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "checks"   ? "Verification Checks" :
                   t === "evidence" ? "Evidence Required" : "Exports & Panels"}
                </button>
              ))}
            </div>

            {tab === "checks" && (
              <div>
                {Object.entries(groupedChecks).map(([cat, checks]) => (
                  <CategoryGroup
                    key={cat}
                    category={cat as FinalLiveVerificationCheck["category"]}
                    checks={checks}
                  />
                ))}
              </div>
            )}

            {tab === "evidence" && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Evidence Required
                </p>
                {report.evidenceRequired.map((e, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Clock className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                    <span className="text-xs">{e}</span>
                  </div>
                ))}
                {report.recommendedNextSteps.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground mt-3 mb-1">
                      Recommended Next Steps
                    </p>
                    {report.recommendedNextSteps.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground">{i + 1}.</span>
                        <span className="text-xs">{s}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === "exports" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Exports to Verify
                  </p>
                  {report.verifiedExports.map((x, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Clock className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                      <span className="text-xs font-mono">{x}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Panels to Verify
                  </p>
                  {report.verifiedPanels.map((p, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Clock className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                      <span className="text-xs">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export button */}
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionLoadingButton
                type="button"
                loading={isExporting}
                loadingLabel="Exporting…"
                onClick={handleExport}
                variant="outline"
                className="h-8 text-xs"
              >
                Export FINAL_LIVE_VERIFICATION_RUN.md
              </ActionLoadingButton>
              {exportMd && (
                <CopyDownloadButton
                  content={exportMd}
                  filename={exportFilename}
                  label="Download"
                  mimeType="text/markdown"
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
