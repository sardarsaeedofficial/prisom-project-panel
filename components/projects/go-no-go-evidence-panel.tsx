"use client";

import { useState, useTransition, useRef }           from "react";
import {
  generateGoNoGoEvidencePackAction,
  exportGoNoGoEvidencePackAction,
}                                                     from "@/app/actions/go-no-go";
import { CopyDownloadButton }                         from "@/components/common/copy-download-button";
import { ActionLoadingButton }                        from "@/components/common/action-loading-button";
import { Badge }                                      from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                     from "@/components/ui/card";
import {
  CheckCircle2, AlertTriangle, XCircle, Clock,
  ChevronDown, ChevronUp, FileCheck,
}                                                     from "lucide-react";
import type {
  GoNoGoEvidencePack,
  GoNoGoEvidenceItem,
  GoNoGoDecision,
} from "@/lib/go-no-go/go-no-go-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function EvidenceIcon({ status }: { status: GoNoGoEvidenceItem["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "collected": return <CheckCircle2 className={`${cls} text-green-500`} />;
    case "warning":   return <AlertTriangle className={`${cls} text-yellow-500`} />;
    case "blocked":
    case "missing":   return <XCircle className={`${cls} text-red-500`} />;
    case "manual":    return <Clock className={`${cls} text-blue-500`} />;
  }
}

function decisionBadge(decision: GoNoGoDecision) {
  const map: Record<
    GoNoGoDecision,
    { variant: "error" | "warning" | "success" | "secondary"; label: string }
  > = {
    go:                  { variant: "success",   label: "GO" },
    no_go:               { variant: "error",     label: "NO GO" },
    go_with_warnings:    { variant: "warning",   label: "GO WITH WARNINGS" },
    needs_manual_review: { variant: "secondary", label: "NEEDS MANUAL REVIEW" },
  };
  const m = map[decision];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const CATEGORY_LABELS: Record<GoNoGoEvidenceItem["category"], string> = {
  deployment: "Deployment",
  qa:         "QA",
  release:    "Release",
  migration:  "Migration",
  backup:     "Backup",
  monitoring: "Monitoring",
  security:   "Security",
  rollback:   "Rollback",
  operator:   "Operator",
  client:     "Client",
};

const CATEGORY_ORDER: GoNoGoEvidenceItem["category"][] = [
  "deployment", "qa", "release", "migration",
  "backup", "monitoring", "security",
  "rollback", "operator", "client",
];

// ── Category group ─────────────────────────────────────────────────────────────

function EvidenceGroup({
  category,
  items,
}: {
  category: GoNoGoEvidenceItem["category"];
  items: GoNoGoEvidenceItem[];
}) {
  const [open, setOpen] = useState(true);
  const blocked   = items.filter((i) => i.status === "blocked" || i.status === "missing").length;
  const collected = items.filter((i) => i.status === "collected").length;

  return (
    <div className="border rounded-md mb-2">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{CATEGORY_LABELS[category]}</span>
        <span className="flex items-center gap-2">
          {collected > 0 && (
            <Badge variant="success" className="text-xs">{collected} collected</Badge>
          )}
          {blocked > 0 && (
            <Badge variant="error" className="text-xs">{blocked} missing</Badge>
          )}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-0.5">
              <div className="flex items-start gap-2">
                <EvidenceIcon status={item.status} />
                <span className="text-xs font-medium leading-tight">{item.label}</span>
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground ml-5">{item.description}</p>
              )}
              <p className="text-xs text-blue-600 ml-5 italic">
                {item.evidencePrompt}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

type Tab = "evidence" | "approvals" | "conditions";

export function GoNoGoEvidencePanel({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const [pack, setPack]                   = useState<GoNoGoEvidencePack | null>(null);
  const [tab, setTab]                     = useState<Tab>("evidence");
  const [exportMd, setExportMd]           = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState("GO_NO_GO_EVIDENCE_PACK.md");
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
        const res = await generateGoNoGoEvidencePackAction({ projectId });
        if (res.ok) setPack(res.data);
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
        const res = await exportGoNoGoEvidencePackAction({ projectId });
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
            <FileCheck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Go/No-Go Evidence Pack</CardTitle>
            {pack && decisionBadge(pack.decision)}
          </div>
          <CardDescription className="text-xs">
            Read-only · Final evidence only · No production mutation
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-3 space-y-2">
          {pack ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Evidence items: {pack.evidence.length}</p>
              {pack.blockers.length > 0 && (
                <p className="text-red-500">{pack.blockers.length} blocker(s)</p>
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
            Generate Evidence Pack
          </ActionLoadingButton>
        </CardContent>
      </Card>
    );
  }

  const groupedEvidence = CATEGORY_ORDER.reduce<
    Record<string, GoNoGoEvidenceItem[]>
  >((acc, cat) => {
    const group = pack?.evidence.filter((e) => e.category === cat) ?? [];
    if (group.length > 0) acc[cat] = group;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Go/No-Go Evidence Pack</CardTitle>
              {pack && decisionBadge(pack.decision)}
            </div>
            <CardDescription>
              Final go/no-go evidence collection for production launch.
              Read-only. No production mutation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Generate button */}
        <ActionLoadingButton
          type="button"
          loading={isPending}
          loadingLabel="Generating…"
          onClick={handleGenerate}
          className="h-8 text-xs"
        >
          Generate Evidence Pack
        </ActionLoadingButton>

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {pack && (
          <>
            {/* Operator message */}
            <div className={`rounded-md p-3 text-xs border ${
              pack.decision === "go"             ? "bg-green-50 border-green-200 text-green-700" :
              pack.decision === "no_go"          ? "bg-red-50 border-red-200 text-red-700" :
              pack.decision === "go_with_warnings" ? "bg-yellow-50 border-yellow-200 text-yellow-700" :
                                                   "bg-muted border text-muted-foreground"
            }`}>
              {pack.finalOperatorMessage}
            </div>

            {/* Blockers */}
            {pack.blockers.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-semibold text-red-700 mb-1">
                  {pack.blockers.length} Blocker{pack.blockers.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-0.5">
                  {pack.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-red-600">• {b}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {pack.warnings.length > 0 && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
                <p className="text-xs font-semibold text-yellow-700 mb-1">
                  {pack.warnings.length} Warning{pack.warnings.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-0.5">
                  {pack.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-yellow-600">• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b pb-1">
              {(["evidence", "approvals", "conditions"] as Tab[]).map((t) => (
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
                  {t === "evidence"   ? "Evidence Checklist" :
                   t === "approvals"  ? "Required Approvals" : "Launch Conditions"}
                </button>
              ))}
            </div>

            {tab === "evidence" && (
              <div>
                {Object.entries(groupedEvidence).map(([cat, items]) => (
                  <EvidenceGroup
                    key={cat}
                    category={cat as GoNoGoEvidenceItem["category"]}
                    items={items}
                  />
                ))}
              </div>
            )}

            {tab === "approvals" && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Required Approvals
                  </p>
                  {pack.requiredApprovals.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1">
                      <Clock className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                      <span className="text-xs">{a}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Final Go/No-Go Questions
                  </p>
                  {pack.finalQuestions.map((q, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1">
                      <Clock className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                      <span className="text-xs">{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "conditions" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-green-600 mb-2">
                    Launch Allowed Only If
                  </p>
                  {pack.launchAllowedOnlyIf.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                      <span className="text-xs">{c}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-600 mb-2">
                    Launch Blocked If
                  </p>
                  {pack.launchBlockedIf.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1">
                      <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-xs">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export */}
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionLoadingButton
                type="button"
                loading={isExporting}
                loadingLabel="Exporting…"
                onClick={handleExport}
                variant="outline"
                className="h-8 text-xs"
              >
                Export GO_NO_GO_EVIDENCE_PACK.md
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
