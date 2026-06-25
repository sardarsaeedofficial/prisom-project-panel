"use client";

/**
 * components/projects/operator-training-panel.tsx
 *
 * Sprint 74: Operator training pack panel.
 * Read-only — documentation only. No production mutation.
 */

import { useState, useTransition, useRef }       from "react";
import {
  generateOperatorTrainingPackAction,
  exportOperatorTrainingPackAction,
}                                                from "@/app/actions/operator-training";
import { CopyDownloadButton }                    from "@/components/common/copy-download-button";
import { ActionLoadingButton }                  from "@/components/common/action-loading-button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                                from "@/components/ui/card";
import { Badge }                                 from "@/components/ui/badge";
import {
  BookOpen, ChevronDown, ChevronUp, AlertTriangle,
  Users, Code2, Wrench, Briefcase,
}                                                from "lucide-react";
import type {
  OperatorTrainingPack,
  TrainingAudience,
  TrainingSection,
} from "@/lib/operator-training/operator-training-types";

// ── Audience badge ────────────────────────────────────────────────────────────

function AudienceIcon({ audience }: { audience: TrainingAudience }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (audience) {
    case "admin":     return <Wrench className={cls} />;
    case "operator":  return <Briefcase className={cls} />;
    case "developer": return <Code2 className={cls} />;
    case "client":    return <Users className={cls} />;
  }
}

function audienceBadgeVariant(audience: TrainingAudience) {
  switch (audience) {
    case "admin":     return "error"     as const;
    case "operator":  return "warning"   as const;
    case "developer": return "secondary" as const;
    case "client":    return "success"   as const;
  }
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ section }: { section: TrainingSection }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <AudienceIcon audience={section.audience} />
          {section.title}
          <Badge variant={audienceBadgeVariant(section.audience)} className="text-xs">
            {section.audience}
          </Badge>
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">{section.summary}</p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Steps</p>
            <ol className="space-y-1">
              {section.steps.map((step, i) => (
                <li key={i} className="text-xs text-foreground flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          {section.safetyNotes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Safety Notes</p>
              {section.safetyNotes.map((note, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  {note}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Checklist block ───────────────────────────────────────────────────────────

function ChecklistBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
            <span className="text-muted-foreground shrink-0">•</span>
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OperatorTrainingPanelProps {
  projectId: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function OperatorTrainingPanel({ projectId, compact }: OperatorTrainingPanelProps) {
  const [pack,       setPack]       = useState<OperatorTrainingPack | null>(null);
  const [exportData, setExportData] = useState<string>("");
  const [error,      setError]      = useState<string>("");
  const [activeTab,  setActiveTab]  = useState<"sections" | "daily" | "emergency">("sections");

  const [genPending, startGen] = useTransition();
  const [expPending, startExp] = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  function handleGenerate() {
    if (genFlight.current) return;
    genFlight.current = true;
    setError("");
    setPack(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateOperatorTrainingPackAction({ projectId });
        if (!result.ok) { setError(result.error); return; }
        setPack(result.data);
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportOperatorTrainingPackAction({ projectId });
            if (exp.ok) setExportData(exp.data.markdown);
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
        <BookOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Operator Training Pack</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate OPERATOR_TRAINING_PACK.md — daily checklist, emergency rollback, escalation rules.{" "}
            <span className="italic">Read-only. Documentation only. No production mutation.</span>
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
          <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Operator Training Pack</CardTitle>
        </div>
        <CardDescription>
          Training sections, daily operations checklist, and emergency rollback procedure.
          Export OPERATOR_TRAINING_PACK.md for operator handover.{" "}
          <span className="italic">Read-only — no production mutation.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Tabs */}
        {pack && (
          <div className="flex gap-1 border rounded-lg p-1 w-fit">
            {(["sections", "daily", "emergency"] as const).map((tab) => (
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
                {tab === "sections" ? "Training Sections" : tab === "daily" ? "Daily Checklist" : "Emergency"}
              </button>
            ))}
          </div>
        )}

        {/* Training sections */}
        {pack && activeTab === "sections" && (
          <div className="space-y-2">
            {pack.sections.map((s) => (
              <SectionCard key={s.id} section={s} />
            ))}
          </div>
        )}

        {/* Daily checklist */}
        {pack && activeTab === "daily" && (
          <div className="space-y-5">
            <ChecklistBlock title="Daily Checklist" items={pack.dailyChecklist} />
            <ChecklistBlock title="Weekly Checklist" items={pack.weeklyChecklist} />
            <ChecklistBlock title="Launch-Day Checklist" items={pack.launchDayChecklist} />
            {pack.escalationRules.length > 0 && (
              <ChecklistBlock title="Escalation Rules" items={pack.escalationRules} />
            )}
          </div>
        )}

        {/* Emergency */}
        {pack && activeTab === "emergency" && (
          <div className="space-y-5">
            <ChecklistBlock title="Emergency Rollback Checklist" items={pack.emergencyChecklist} />
            {pack.pagesToAvoid.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Actions to Avoid from Panel UI
                </p>
                {pack.pagesToAvoid.map((p, i) => (
                  <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                    <span>
                      <strong>{p.label}:</strong> {p.note}
                    </span>
                  </p>
                ))}
              </div>
            )}
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
            Generate Training Pack
          </ActionLoadingButton>

          {exportData && (
            <CopyDownloadButton
              content={exportData}
              filename="OPERATOR_TRAINING_PACK.md"
              label="Export"
            />
          )}

          {expPending && !exportData && (
            <span className="text-xs text-muted-foreground">Preparing export…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Read-only — documentation only. No production mutation.
        </p>
      </CardContent>
    </Card>
  );
}
