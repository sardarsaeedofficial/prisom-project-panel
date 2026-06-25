"use client";

/**
 * components/projects/operator-runbook-panel.tsx
 *
 * Sprint 67: Operator Runbook Panel.
 *
 * Shows the generated operator runbook with expandable sections,
 * daily checklist, and OPERATOR_RUNBOOK.md export.
 *
 * Safety: documentation only — no production mutation.
 */

import { useState, useTransition, useRef } from "react";
import {
  BookOpen, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle2, XCircle, Activity, RefreshCw,
} from "lucide-react";
import { Button }              from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge }               from "@/components/ui/badge";
import { ActionLoadingButton } from "@/components/common/action-loading-button";
import { CopyDownloadButton }  from "@/components/common/copy-download-button";
import { generateOperatorRunbookAction, exportOperatorRunbookAction } from "@/app/actions/operator-runbook";
import type { OperatorRunbook, RunbookSection } from "@/lib/runbook/operator-runbook-types";

// ── Priority badge ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: RunbookSection["priority"] }) {
  const map: Record<RunbookSection["priority"], { label: string; className: string }> = {
    critical: { label: "Critical", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    high:     { label: "High",     className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
    medium:   { label: "Medium",   className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
    low:      { label: "Low",      className: "bg-muted text-muted-foreground" },
  };
  const { label, className } = map[priority];
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${className}`}>{label}</span>;
}

// ── Section row ────────────────────────────────────────────────────────────────

function SectionRow({ section }: { section: RunbookSection }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <PriorityBadge priority={section.priority} />
          <span className="font-medium text-sm truncate">{section.title}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline truncate">
            — {section.summary}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs text-muted-foreground">{section.steps.length} steps</span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Audience: <span className="font-mono">{section.audience.join(", ")}</span>
          </p>
          <div className="space-y-2.5">
            {section.steps.map((step) => (
              <div key={step.id} className="pl-3 border-l-2 border-muted space-y-1">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
                {step.command && (
                  <code className="block text-xs font-mono bg-muted px-2 py-1 rounded mt-1">
                    {step.command}
                  </code>
                )}
                {step.linkHref && (
                  <a
                    href={step.linkHref}
                    target={step.linkHref.startsWith("http") ? "_blank" : undefined}
                    rel={step.linkHref.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-xs text-primary hover:underline block mt-1"
                  >
                    → {step.linkHref}
                  </a>
                )}
                {step.warning && (
                  <div className="flex items-start gap-1.5 mt-1.5 text-xs text-orange-600 dark:text-orange-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{step.warning}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Daily checklist ────────────────────────────────────────────────────────────

function DailyChecklist({ runbook }: { runbook: OperatorRunbook }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const daily = runbook.sections.find((s) => s.id === "daily_operations");
  if (!daily) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Daily Operations Checklist</CardTitle>
        <CardDescription>
          {done.size} / {daily.steps.length} complete
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {daily.steps.map((step) => (
          <label key={step.id} className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              checked={done.has(step.id)}
              onChange={() =>
                setDone((prev) => {
                  const next = new Set(prev);
                  if (next.has(step.id)) next.delete(step.id);
                  else next.add(step.id);
                  return next;
                })
              }
            />
            <div>
              <p className={`text-sm font-medium ${done.has(step.id) ? "line-through text-muted-foreground" : ""}`}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </label>
        ))}
        {done.size > 0 && done.size < daily.steps.length && (
          <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={() => setDone(new Set())}>
            Reset checklist
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Status display ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OperatorRunbook["status"] }) {
  if (status === "ready")
    return <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="h-4 w-4" /> Ready</span>;
  if (status === "warning")
    return <span className="flex items-center gap-1 text-orange-500 text-sm"><AlertTriangle className="h-4 w-4" /> Warning</span>;
  return <span className="flex items-center gap-1 text-muted-foreground text-sm"><XCircle className="h-4 w-4" /> Incomplete</span>;
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface Props {
  projectId?: string;
}

export function OperatorRunbookPanel({ projectId }: Props) {
  const [runbook,    setRunbook]    = useState<OperatorRunbook | null>(null);
  const [exportData, setExportData] = useState<{ content: string; filename: string } | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [genPending,  startGen]  = useTransition();
  const [expPending,  startExp]  = useTransition();
  const inFlightGen  = useRef(false);
  const inFlightExp  = useRef(false);

  async function handleGenerate() {
    if (inFlightGen.current) return;
    inFlightGen.current = true;
    setError(null);
    startGen(async () => {
      const res = await generateOperatorRunbookAction({ projectId });
      if (res.ok) {
        setRunbook(res.data);
        setLastAction("Operator runbook generated — " + new Date().toLocaleTimeString());
      } else {
        setError(res.error);
      }
      inFlightGen.current = false;
    });
  }

  async function handleExport() {
    if (inFlightExp.current) return;
    inFlightExp.current = true;
    setError(null);
    startExp(async () => {
      const res = await exportOperatorRunbookAction({ projectId });
      if (res.ok) {
        setExportData(res.data);
        setLastAction("OPERATOR_RUNBOOK.md ready for download — " + new Date().toLocaleTimeString());
      } else {
        setError(res.error);
      }
      inFlightExp.current = false;
    });
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <BookOpen className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <CardTitle className="text-base">Operator Runbook</CardTitle>
                <CardDescription className="mt-1">
                  Documentation-only guide for operators and admins. Covers daily operations,
                  go-live workflow, incident response, rollback, and handoff. No production mutation.
                </CardDescription>
              </div>
            </div>
            {runbook && <StatusBadge status={runbook.status} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Safety banner */}
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-3 py-2.5 text-xs text-green-700 dark:text-green-300">
            Documentation only — this panel does not apply routes, restart PM2, reload nginx, run DB migrations, or expose secrets.
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {lastAction && (
            <p className="text-xs text-muted-foreground">{lastAction}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <ActionLoadingButton
              loading={genPending}
              loadingLabel="Generating…"
              onClick={handleGenerate}
              size="sm"
              variant="default"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {runbook ? "Regenerate Runbook" : "Generate Runbook"}
            </ActionLoadingButton>

            {runbook && (
              <ActionLoadingButton
                loading={expPending}
                loadingLabel="Preparing…"
                onClick={handleExport}
                size="sm"
                variant="outline"
              >
                <Activity className="h-3.5 w-3.5 mr-1.5" />
                Export OPERATOR_RUNBOOK.md
              </ActionLoadingButton>
            )}

            {exportData && (
              <CopyDownloadButton
                content={exportData.content}
                filename={exportData.filename}
                label="Download OPERATOR_RUNBOOK.md"
                size="sm"
                variant="outline"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Runbook content */}
      {runbook && (
        <>
          {/* Warnings */}
          {runbook.warnings.length > 0 && (
            <div className="space-y-1.5">
              {runbook.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Sections */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Runbook Sections</CardTitle>
              <CardDescription>
                {runbook.sections.length} sections — click any section to expand
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {runbook.sections.map((section) => (
                <SectionRow key={section.id} section={section} />
              ))}
            </CardContent>
          </Card>

          {/* Daily checklist */}
          <DailyChecklist runbook={runbook} />

          {/* Next steps */}
          {runbook.nextSteps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recommended Next Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {runbook.nextSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
