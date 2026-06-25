"use client";

/**
 * components/projects/project-template-selector.tsx
 *
 * Sprint 72: Template selection panel. Lets users pick a migration template,
 * preview its expected services/env categories, generate a migration plan,
 * and export CLIENT_MIGRATION_PLAN.md.
 *
 * No production mutation — read-only planning only.
 */

import { useState, useTransition, useRef }    from "react";
import { BUILTIN_TEMPLATES }                  from "@/lib/project-templates/builtin-project-templates";
import {
  generateTemplateMigrationPlanAction,
  exportClientMigrationPlanAction,
}                                             from "@/app/actions/project-templates";
import { CopyDownloadButton }                 from "@/components/common/copy-download-button";
import { ActionLoadingButton }               from "@/components/common/action-loading-button";
import { Badge }                              from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
}                                             from "@/components/ui/card";
import {
  ShoppingCart, Globe, Server, FileCode, Settings,
  CheckCircle2, AlertTriangle, Clock, Wrench,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { TemplateMigrationPlan }         from "@/lib/project-templates/project-template-types";

// ── Kind icon ─────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4 shrink-0";
  switch (kind) {
    case "ecommerce":   return <ShoppingCart className={cls} />;
    case "web_app":     return <Globe className={cls} />;
    case "api_service": return <Server className={cls} />;
    case "static_site": return <FileCode className={cls} />;
    default:            return <Settings className={cls} />;
  }
}

// ── Step icon ─────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: string }) {
  if (status === "pass")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  if (status === "manual")  return <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ProjectTemplateSelectorProps {
  projectId?: string;
  compact?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectTemplateSelector({ projectId, compact }: ProjectTemplateSelectorProps) {
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [plan,         setPlan]          = useState<TemplateMigrationPlan | null>(null);
  const [exportData,   setExportData]    = useState<string>("");
  const [error,        setError]         = useState<string>("");
  const [showSteps,    setShowSteps]     = useState(false);

  const [genPending,  startGen]  = useTransition();
  const [expPending,  startExp]  = useTransition();
  const genFlight = useRef(false);
  const expFlight = useRef(false);

  const selectedTemplate = BUILTIN_TEMPLATES.find((t) => t.id === selectedId);

  function handleSelect(id: string) {
    setSelectedId(id);
    setPlan(null);
    setExportData("");
    setError("");
    setShowSteps(false);
  }

  function handleGeneratePlan() {
    if (!selectedId || genFlight.current) return;
    genFlight.current = true;
    setError("");
    setPlan(null);
    setExportData("");
    startGen(async () => {
      try {
        const result = await generateTemplateMigrationPlanAction({ projectId, templateId: selectedId });
        if (!result.ok) { setError(result.error); return; }
        setPlan(result.data);
        setShowSteps(true);
        // Pre-generate export
        startExp(async () => {
          expFlight.current = true;
          try {
            const exp = await exportClientMigrationPlanAction({ projectId, templateId: selectedId });
            if (exp.ok) setExportData(exp.data.markdown);
          } finally {
            expFlight.current = false;
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unexpected error generating plan.");
      } finally {
        genFlight.current = false;
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Migration Templates</CardTitle>
        </div>
        <CardDescription>
          Choose a template to generate a first-run migration plan and onboarding checklist.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Template grid */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BUILTIN_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t.id)}
              className={[
                "text-left rounded-lg border p-3 transition-colors hover:bg-accent",
                selectedId === t.id
                  ? "border-primary bg-accent"
                  : "border-border bg-card",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 mb-1">
                <KindIcon kind={t.kind} />
                <span className="text-sm font-medium">{t.label}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
            </button>
          ))}
        </div>

        {/* Selected template detail */}
        {selectedTemplate && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <KindIcon kind={selectedTemplate.kind} />
                <span className="text-sm font-semibold">{selectedTemplate.label}</span>
                {selectedTemplate.kind === "ecommerce" && (
                  <Badge variant="secondary">Ecommerce</Badge>
                )}
              </div>
              <ActionLoadingButton
                loading={genPending}
                loadingLabel="Generating…"
                onClick={handleGeneratePlan}
                disabled={genPending}
                size="sm"
                variant="default"
              >
                Generate Migration Plan
              </ActionLoadingButton>
            </div>

            {/* Best for */}
            {!compact && selectedTemplate.bestFor.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Best for:</p>
                <ul className="space-y-0.5">
                  {selectedTemplate.bestFor.map((b, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="mt-0.5 text-green-500 shrink-0">✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Expected services */}
            {selectedTemplate.expectedServices.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Services ({selectedTemplate.expectedServices.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTemplate.expectedServices.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {s.name} ({s.kind})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Env categories */}
            {selectedTemplate.expectedEnv.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Env categories:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(selectedTemplate.expectedEnv.map((e) => e.category))].sort().map((cat) => {
                    const count = selectedTemplate.expectedEnv.filter((e) => e.category === cat).length;
                    return (
                      <Badge key={cat} variant="secondary" className="text-xs">
                        {cat} ({count})
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Safety notes */}
            {!compact && selectedTemplate.safetyNotes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-yellow-500" /> Safety notes:
                </p>
                <ul className="space-y-0.5">
                  {selectedTemplate.safetyNotes.map((note, i) => (
                    <li key={i} className="text-xs text-muted-foreground">⚠ {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 rounded border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2">
            {error}
          </p>
        )}

        {/* Generated plan */}
        {plan && (
          <div className="rounded-md border space-y-0">
            {/* Header row */}
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 rounded-t-md"
              onClick={() => setShowSteps((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Migration Plan Generated</span>
                <Badge variant="outline" className="text-xs">
                  {plan.steps.length} steps
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {exportData && (
                  <CopyDownloadButton
                    content={exportData}
                    filename="CLIENT_MIGRATION_PLAN.md"
                    label="Export"
                  />
                )}
                {showSteps ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* Blockers / warnings */}
            {(plan.blockers.length > 0 || plan.warnings.length > 0) && (
              <div className="px-3 py-2 border-t space-y-1">
                {plan.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                    <span className="shrink-0">🔴</span> {b}
                  </p>
                ))}
                {plan.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-600 flex items-start gap-1.5">
                    <span className="shrink-0">⚠</span> {w}
                  </p>
                ))}
              </div>
            )}

            {/* Steps list */}
            {showSteps && (
              <div className="border-t divide-y max-h-80 overflow-y-auto">
                {plan.steps.map((step) => (
                  <div key={step.id} className="px-3 py-2 flex items-start gap-2">
                    <StepIcon status={step.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{step.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{step.message}</p>
                    </div>
                    {step.linkHref && (
                      <a
                        href={step.linkHref}
                        className="text-xs text-primary hover:underline whitespace-nowrap shrink-0"
                      >
                        Open →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Next steps */}
            {showSteps && plan.nextSteps.length > 0 && (
              <div className="border-t px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Next steps:</p>
                <ol className="space-y-0.5 list-decimal list-inside">
                  {plan.nextSteps.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground">{s}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
