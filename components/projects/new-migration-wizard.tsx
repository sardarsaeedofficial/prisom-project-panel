"use client";

/**
 * components/projects/new-migration-wizard.tsx
 *
 * Sprint 72: Step-by-step migration wizard for a new project.
 * UI-only — no source creation, no deployments, no production mutation.
 *
 * For Sardar projects, shows a notice that the Sardar profile was detected
 * and that existing migration panels remain below.
 */

import { useState }                   from "react";
import { BUILTIN_TEMPLATES }          from "@/lib/project-templates/builtin-project-templates";
import { Badge }                      from "@/components/ui/badge";
import { Button }                     from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
}                                     from "@/components/ui/card";
import {
  ShoppingCart, Globe, Server, FileCode, Settings,
  CheckCircle2, ChevronRight, Info, Loader2, Terminal,
} from "lucide-react";
import type { ProjectTemplate }       from "@/lib/project-templates/project-template-types";
import { applyReplitPresetAction }    from "@/app/actions/replit-preset";

// ── Steps ────────────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { id: "template",  label: "Choose Template" },
  { id: "source",    label: "Source Type" },
  { id: "services",  label: "Services" },
  { id: "env",       label: "Environment Vars" },
  { id: "safety",    label: "Safety Notes" },
  { id: "open",      label: "Open First Page" },
] as const;

type WizardStepId = typeof WIZARD_STEPS[number]["id"];

// ── Source types ──────────────────────────────────────────────────────────────

const SOURCE_TYPES = [
  { id: "github",   label: "GitHub Repository",    description: "Clone from a GitHub URL via Source Intake." },
  { id: "zip",      label: "ZIP / Archive",         description: "Upload and extract a ZIP of the source." },
  { id: "replit",   label: "Replit Export",         description: "Downloaded Replit project export folder." },
  { id: "storage",  label: "Existing Storage",      description: "Source already exists in storage/projects/." },
];

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

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ steps, currentStep, completedSteps }: {
  steps: typeof WIZARD_STEPS;
  currentStep: WizardStepId;
  completedSteps: Set<WizardStepId>;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-4">
      {steps.map((step, i) => {
        const done    = completedSteps.has(step.id);
        const current = step.id === currentStep;
        return (
          <div key={step.id} className="flex items-center gap-1">
            <div className={[
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors",
              done    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
              current ? "bg-primary text-primary-foreground" :
                        "bg-muted text-muted-foreground",
            ].join(" ")}>
              {done
                ? <CheckCircle2 className="h-3 w-3" />
                : <span>{i + 1}</span>
              }
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NewMigrationWizardProps {
  projectId: string;
  isSardar?: boolean;
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function NewMigrationWizard({ projectId, isSardar }: NewMigrationWizardProps) {
  const [currentStep,    setCurrentStep]    = useState<WizardStepId>("template");
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStepId>>(new Set());
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [selectedSource,   setSelectedSource]   = useState<string | null>(null);
  const [presetApplying,   setPresetApplying]   = useState(false);
  const [presetResult,     setPresetResult]     = useState<
    { ok: true; message: string } | { ok: false; error: string } | null
  >(null);

  function markComplete(step: WizardStepId, nextStep: WizardStepId) {
    setCompletedSteps((prev) => new Set([...prev, step]));
    setCurrentStep(nextStep);
  }

  async function handleApplyPreset() {
    setPresetApplying(true);
    setPresetResult(null);
    try {
      const result = await applyReplitPresetAction({ projectId });
      if (result.ok) {
        setPresetResult({
          ok: true,
          message: `Deployment preset applied (${result.data.preset.detected}). Visit Publishing to deploy.`,
        });
      } else {
        setPresetResult({ ok: false, error: result.error });
      }
    } catch (e) {
      setPresetResult({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setPresetApplying(false);
    }
  }

  // ── Sardar notice ─────────────────────────────────────────────────────────

  if (isSardar) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500 shrink-0" />
            <CardTitle className="text-base">Migration Wizard</CardTitle>
            <Badge variant="success">Sardar Ecommerce Detected</Badge>
          </div>
          <CardDescription>
            This project has been detected as a Sardar ecommerce profile. The full Sardar migration
            panels (Staging Import, Trial Migration, Ecommerce Test, Staging Deployment) are available below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Recommended deployment preset */}
          <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recommended Deployment Preset
            </p>
            <div className="font-mono text-xs space-y-1 text-foreground">
              <div><span className="text-muted-foreground">install: </span>pnpm install --frozen-lockfile --ignore-scripts</div>
              <div><span className="text-muted-foreground">build:   </span>pnpm run build</div>
              <div><span className="text-muted-foreground">start:   </span>node artifacts/api-server/dist/index.mjs</div>
              <div><span className="text-muted-foreground">health:  </span>/api/healthz</div>
              <div><span className="text-muted-foreground">mode:    </span>static_plus_api → /api/* Node, /* Vite frontend</div>
              <div><span className="text-muted-foreground">static:  </span>artifacts/sardar-security/dist/public</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleApplyPreset}
              disabled={presetApplying || presetResult?.ok === true}
            >
              {presetApplying
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Applying…</>
                : <><Terminal className="h-3 w-3 mr-1.5" />Apply Recommended Sardar Preset</>
              }
            </Button>
            {presetResult?.ok === true && (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {presetResult.message}
              </span>
            )}
          </div>

          {presetResult?.ok === false && (
            <p className="text-xs text-destructive">{presetResult.error}</p>
          )}

          <p className="text-xs text-muted-foreground">
            Applying the preset saves the deployment config for this project.
            No deployment is triggered — use the Publishing tab to deploy.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Step content ──────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">New Migration Wizard</CardTitle>
        </div>
        <CardDescription>
          Follow these steps to onboard a new project. No source is created automatically — this is a planning guide only.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <StepIndicator
          steps={WIZARD_STEPS}
          currentStep={currentStep}
          completedSteps={completedSteps}
        />

        {/* Step 1: Choose template */}
        {currentStep === "template" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 1 — Choose a migration template</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BUILTIN_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(t);
                    markComplete("template", "source");
                  }}
                  className={[
                    "text-left rounded-lg border p-3 transition-colors hover:bg-accent",
                    selectedTemplate?.id === t.id
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
          </div>
        )}

        {/* Step 2: Source type */}
        {currentStep === "source" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 2 — Confirm source type</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SOURCE_TYPES.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => {
                    setSelectedSource(src.id);
                    markComplete("source", "services");
                  }}
                  className={[
                    "text-left rounded-lg border p-3 transition-colors hover:bg-accent",
                    selectedSource === src.id
                      ? "border-primary bg-accent"
                      : "border-border bg-card",
                  ].join(" ")}
                >
                  <p className="text-sm font-medium">{src.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{src.description}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              All source types are imported manually via the{" "}
              <a href={`/projects/${projectId}/publishing`} className="text-primary hover:underline">
                Source Intake → Publishing
              </a>{" "}
              page.
            </p>
          </div>
        )}

        {/* Step 3: Review services */}
        {currentStep === "services" && selectedTemplate && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 3 — Review expected services</p>
            {selectedTemplate.expectedServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pre-configured services for this template. Customize in Settings.</p>
            ) : (
              <div className="rounded-md border divide-y">
                {selectedTemplate.expectedServices.map((svc, i) => (
                  <div key={i} className="px-3 py-2.5 text-xs space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{svc.name}</span>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">{svc.kind}</Badge>
                      {svc.routeHint && (
                        <code className="ml-auto text-muted-foreground font-mono">{svc.routeHint}</code>
                      )}
                    </div>
                    {svc.buildCommandHint && (
                      <div className="text-muted-foreground">
                        Build: <code className="font-mono">{svc.buildCommandHint}</code>
                      </div>
                    )}
                    {(svc.startCommandHint ?? svc.outputPathHint) && (
                      <div className="text-muted-foreground">
                        {svc.startCommandHint
                          ? <>Start: <code className="font-mono">{svc.startCommandHint}</code></>
                          : <>Output: <code className="font-mono">{svc.outputPathHint}</code></>
                        }
                      </div>
                    )}
                    {svc.healthPathHint && (
                      <div className="text-muted-foreground">
                        Health: <code className="font-mono">{svc.healthPathHint}</code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => markComplete("services", "env")}
              className="text-xs text-primary hover:underline"
            >
              Looks right — continue →
            </button>
          </div>
        )}

        {/* Step 4: Env placeholders */}
        {currentStep === "env" && selectedTemplate && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 4 — Review environment variable placeholders</p>
            <p className="text-xs text-muted-foreground">
              These are key names only — values are never stored here.
              Add them in{" "}
              <a href={`/projects/${projectId}/settings`} className="text-primary hover:underline">Settings</a>.
            </p>
            <div className="rounded-md border divide-y max-h-60 overflow-y-auto">
              {selectedTemplate.expectedEnv
                .filter((e) => e.required)
                .map((env, i) => (
                  <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
                    <code className="font-mono text-foreground w-52 shrink-0">{env.name}</code>
                    <Badge
                      variant={env.required ? "default" : "secondary"}
                      className="text-xs px-1.5 py-0 shrink-0"
                    >
                      {env.category}
                    </Badge>
                    <span className="text-muted-foreground truncate">{env.description}</span>
                  </div>
                ))}
              {selectedTemplate.expectedEnv.filter((e) => !e.required).length > 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground italic">
                  +{selectedTemplate.expectedEnv.filter((e) => !e.required).length} optional key(s)
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => markComplete("env", "safety")}
              className="text-xs text-primary hover:underline"
            >
              Noted — continue →
            </button>
          </div>
        )}

        {/* Step 5: Safety notes */}
        {currentStep === "safety" && selectedTemplate && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 5 — Safety notes</p>
            <ul className="space-y-1.5">
              {selectedTemplate.safetyNotes.map((note, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <span className="text-yellow-500 shrink-0">⚠</span>
                  {note}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => markComplete("safety", "open")}
              className="text-xs text-primary hover:underline"
            >
              Understood — continue →
            </button>
          </div>
        )}

        {/* Step 6: Open first page */}
        {currentStep === "open" && selectedTemplate && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Step 6 — Open the first recommended page</p>
            <div className="rounded-md border divide-y">
              {selectedTemplate.recommendedPages.map((page, i) => (
                <a
                  key={i}
                  href={`/projects/${projectId}${page.hrefSuffix}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-medium text-foreground w-28 shrink-0">{page.label}</span>
                  <span className="text-xs text-muted-foreground flex-1">{page.reason}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-xs text-green-700 dark:text-green-400">
                Wizard complete. Use the Template Selector above to generate and export <strong>CLIENT_MIGRATION_PLAN.md</strong>.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
