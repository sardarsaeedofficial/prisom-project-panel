"use client";

/**
 * components/projects/create-from-template-form.tsx
 *
 * Sprint 19: Multi-step UI for creating a project from a curated template.
 *
 * Steps:
 *  1. Pick a template
 *  2. Configure (name, slug, vars, options)
 *  3. Preview files
 *  4. Create + show result
 *
 * Uses only available shadcn/ui components:
 *  button, badge, card, separator, avatar, dropdown-menu, scroll-area,
 *  tooltip, tabs, switch, input, textarea, label
 */

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  Loader2,
  AlertCircle,
  Info,
  FolderOpen,
  ExternalLink,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { createProjectFromTemplateAction, previewTemplateFilesAction } from "@/app/actions/project-templates";
import type {
  ProjectTemplateSummary,
  ProjectTemplateVariable,
} from "@/lib/templates/project-templates";
import { slugify } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "pick" | "configure" | "preview" | "done";

type PreviewFile = { path: string; content: string; sizeBytes: number };

type DoneData = {
  projectId: string;
  slug: string;
  fileCount: number;
  installed: boolean;
  gitInitialized: boolean;
  gitCommitSkipped: boolean;
  warnings: string[];
};

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  templates: ProjectTemplateSummary[];
};

// ── Category badge colours ─────────────────────────────────────────────────────

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  static: "secondary",
  frontend: "default",
  backend: "outline",
  fullstack: "default",
};

// ── Shared native select ───────────────────────────────────────────────────────

const SELECT_CLS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── Error banner ───────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ── Info note ──────────────────────────────────────────────────────────────────

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3 text-xs text-blue-700 dark:text-blue-300">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "pick", label: "Template" },
  { id: "configure", label: "Configure" },
  { id: "preview", label: "Preview" },
  { id: "done", label: "Done" },
];

function StepBar({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 mb-6 select-none">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.id} className="flex items-center">
            <div
              className={[
                "flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-all",
                done ? "bg-primary text-primary-foreground" : "",
                active ? "bg-primary text-primary-foreground ring-2 ring-primary/30" : "",
                !done && !active ? "bg-muted text-muted-foreground" : "",
              ].join(" ")}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={[
                "ml-1.5 text-xs font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={["mx-3 h-px flex-1 w-8", done ? "bg-primary/50" : "bg-border"].join(" ")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: ProjectTemplateSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const isDeployable = !!template.packageManager;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "text-left rounded-lg border p-4 transition-all w-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
          : "border-border bg-card hover:border-primary/50 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-sm">{template.name}</span>
        <Badge variant={CATEGORY_VARIANT[template.category] ?? "secondary"} className="text-[10px] shrink-0">
          {template.category}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{template.description}</p>
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px]">{template.language}</Badge>
        {template.framework !== "None" && (
          <Badge variant="outline" className="text-[10px]">{template.framework}</Badge>
        )}
        {template.packageManager && (
          <Badge variant="outline" className="text-[10px]">{template.packageManager}</Badge>
        )}
        <Badge
          variant="outline"
          className={[
            "text-[10px]",
            isDeployable
              ? "border-green-300 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950/20"
              : "border-border text-muted-foreground",
          ].join(" ")}
        >
          {isDeployable ? "⚡ deployable" : "static"}
        </Badge>
      </div>
    </button>
  );
}

// ── File tree preview ─────────────────────────────────────────────────────────

function FileTreePreview({ files }: { files: PreviewFile[] }) {
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const selectedFile = files.find((f) => f.path === selected);

  return (
    <div className="grid grid-cols-5 border rounded-lg overflow-hidden min-h-[320px] max-h-[420px]">
      {/* Tree */}
      <div className="col-span-2 border-r bg-muted/30 overflow-y-auto">
        <div className="p-2 border-b bg-muted/50">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Files</p>
        </div>
        <div className="p-1">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelected(f.path)}
              className={[
                "flex items-center gap-1.5 w-full text-left px-2 py-1 rounded text-xs",
                selected === f.path
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              ].join(" ")}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{f.path}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="col-span-3 overflow-hidden flex flex-col">
        <div className="p-2 border-b bg-muted/50 flex items-center justify-between">
          <p className="text-[10px] font-mono text-muted-foreground truncate">
            {selectedFile?.path ?? ""}
          </p>
          {selectedFile && (
            <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
              {selectedFile.sizeBytes < 1024
                ? `${selectedFile.sizeBytes}B`
                : `${(selectedFile.sizeBytes / 1024).toFixed(1)}KB`}
            </span>
          )}
        </div>
        <ScrollArea className="flex-1">
          <pre className="text-[10px] leading-relaxed p-3 font-mono whitespace-pre-wrap break-all text-foreground/80">
            {selectedFile?.content ?? ""}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CreateFromTemplateForm({ templates }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [isPending, startTransition] = useTransition();

  // Step 1: selected template
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null;

  // Step 2: form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [initGit, setInitGit] = useState(true);
  const [installDeps, setInstallDeps] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 3: preview
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    healthPath?: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Step 4: result
  const [doneData, setDoneData] = useState<DoneData | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Name/slug helpers ──────────────────────────────────────────────────────

  const handleNameChange = useCallback((v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
    setFormError(null);
  }, [slugEdited]);

  const handleSlugChange = useCallback((v: string) => {
    setSlug(v);
    setSlugEdited(true);
    setFormError(null);
  }, []);

  const handleVarChange = useCallback((key: string, value: string) => {
    setVariables((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
  }, []);

  // ── Step navigation ────────────────────────────────────────────────────────

  const goToConfigure = () => {
    if (!selectedId) return;
    // Reset variables to template defaults
    const tpl = templates.find((t) => t.id === selectedId);
    if (tpl?.variables) {
      const defaults: Record<string, string> = {};
      for (const v of tpl.variables) {
        if (v.defaultValue) defaults[v.key] = v.defaultValue;
      }
      setVariables(defaults);
    }
    setFormError(null);
    setStep("configure");
  };

  const goToPreview = () => {
    // Basic validation
    if (!name.trim()) { setFormError("Project name is required."); return; }
    if (!slug.trim()) { setFormError("Slug is required."); return; }
    const slugPat = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
    if (!slugPat.test(slug)) {
      setFormError("Slug must contain only lowercase letters, numbers, and hyphens.");
      return;
    }
    setFormError(null);
    setPreviewFiles(null);
    setPreviewError(null);
    setStep("preview");

    // Fetch preview
    startTransition(async () => {
      const res = await previewTemplateFilesAction({
        templateId: selectedId!,
        variables,
        projectName: name,
        projectSlug: slug,
      });
      if (!res.ok) {
        setPreviewError(res.error);
      } else {
        setPreviewFiles(res.data.files);
        setPreviewMeta({
          installCommand: res.data.installCommand,
          buildCommand: res.data.buildCommand,
          startCommand: res.data.startCommand,
          healthPath: res.data.healthPath,
        });
      }
    });
  };

  const handleCreate = () => {
    setCreateError(null);
    startTransition(async () => {
      const res = await createProjectFromTemplateAction({
        templateId: selectedId!,
        name,
        slug,
        description: description || undefined,
        variables,
        initializeGit: initGit,
        installDependencies: installDeps,
      });
      if (!res.ok) {
        setCreateError(res.error);
        setStep("configure"); // go back for slug/name errors
      } else {
        setDoneData(res.data);
        setStep("done");
      }
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <StepBar current={step} />

      {/* ── Step 1: Pick template ─────────────────────────────────────────── */}
      {step === "pick" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-1">Choose a starter template</h2>
            <p className="text-xs text-muted-foreground">
              All templates are local and curated. No code is deployed automatically.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={selectedId === t.id}
                onSelect={() => setSelectedId(t.id)}
              />
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={goToConfigure}
              disabled={!selectedId}
              className="gap-1.5"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Configure ─────────────────────────────────────────────── */}
      {step === "configure" && selectedTemplate && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Back to template picker"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-sm font-semibold">{selectedTemplate.name}</h2>
              <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Project details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {formError && <ErrorBanner message={formError} />}

              {/* Name + Slug */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tmpl-name">
                    Project name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="tmpl-name"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="My Project"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tmpl-slug">
                    Slug <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="tmpl-slug"
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="my-project"
                    className="font-mono text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Files will be written to{" "}
                    <span className="font-mono">storage/projects/{slug || "…"}</span>
                  </p>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="tmpl-desc">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="tmpl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this project do?"
                  rows={2}
                />
              </div>

              {/* Template variables */}
              {(selectedTemplate.variables?.length ?? 0) > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Template variables
                    </p>
                    {selectedTemplate.variables!.map((v: ProjectTemplateVariable) => (
                      <div key={v.key} className="space-y-1.5">
                        <Label htmlFor={`var-${v.key}`}>
                          {v.label}
                          {v.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                          id={`var-${v.key}`}
                          value={variables[v.key] ?? ""}
                          onChange={(e) => handleVarChange(v.key, e.target.value)}
                          placeholder={v.placeholder ?? v.defaultValue ?? ""}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              {/* Options */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Options
                </p>

                <label className="flex items-center justify-between cursor-pointer gap-3 py-1">
                  <div>
                    <p className="text-sm font-medium">Initialise Git repository</p>
                    <p className="text-xs text-muted-foreground">
                      Runs <span className="font-mono">git init</span> and stages all files.
                      An initial commit will be attempted.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={initGit}
                    onChange={(e) => setInitGit(e.target.checked)}
                  />
                </label>

                {selectedTemplate.packageManager && (
                  <label className="flex items-center justify-between cursor-pointer gap-3 py-1">
                    <div>
                      <p className="text-sm font-medium">Install dependencies</p>
                      <p className="text-xs text-muted-foreground">
                        Runs{" "}
                        <span className="font-mono">
                          {selectedTemplate.packageManager} install --ignore-scripts
                        </span>
                        . Lifecycle scripts are disabled.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-primary"
                      checked={installDeps}
                      onChange={(e) => setInstallDeps(e.target.checked)}
                    />
                  </label>
                )}
              </div>

              {/* Framework-specific notes */}
              {(selectedTemplate.framework === "Next.js" || selectedTemplate.id.includes("next")) && (
                <InfoNote>
                  Next.js templates generate <span className="font-mono">next.config.mjs</span>{" "}
                  (not <span className="font-mono">.ts</span>) for compatibility. Install uses{" "}
                  <span className="font-mono">npm install --ignore-scripts</span>. Build uses{" "}
                  <span className="font-mono">npm run build</span>.{" "}
                  <span className="font-mono">DATABASE_URL</span> is not required unless your app
                  needs a database.
                </InfoNote>
              )}
              <InfoNote>
                Templates are local curated starters. No code is deployed automatically. Dependency
                install uses <span className="font-mono">--ignore-scripts</span>. You can review
                and edit all files before publishing.
              </InfoNote>
            </CardContent>
          </Card>

          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => setStep("pick")} className="gap-1.5">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={goToPreview}
              disabled={!name.trim() || !slug.trim()}
              className="gap-1.5"
            >
              Preview files
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview ───────────────────────────────────────────────── */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep("configure")}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Back to configure"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-sm font-semibold">Preview — {name || slug}</h2>
              <p className="text-xs text-muted-foreground">
                Review the files that will be created in{" "}
                <span className="font-mono">storage/projects/{slug}</span>
              </p>
            </div>
          </div>

          {isPending && !previewFiles && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Rendering template…
            </div>
          )}

          {previewError && <ErrorBanner message={previewError} />}

          {previewFiles && (
            <>
              <FileTreePreview files={previewFiles} />

              {/* Deployment defaults */}
              {previewMeta && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Deployment defaults</CardTitle>
                    <CardDescription className="text-xs">
                      These will be saved to the project but won&apos;t deploy automatically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      {previewMeta.installCommand && (
                        <>
                          <span className="text-muted-foreground">Install</span>
                          <span className="font-mono">{previewMeta.installCommand}</span>
                        </>
                      )}
                      {previewMeta.buildCommand && (
                        <>
                          <span className="text-muted-foreground">Build</span>
                          <span className="font-mono">{previewMeta.buildCommand}</span>
                        </>
                      )}
                      {previewMeta.startCommand && (
                        <>
                          <span className="text-muted-foreground">Start</span>
                          <span className="font-mono">{previewMeta.startCommand}</span>
                        </>
                      )}
                      {previewMeta.healthPath && (
                        <>
                          <span className="text-muted-foreground">Health path</span>
                          <span className="font-mono">{previewMeta.healthPath}</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {createError && <ErrorBanner message={createError} />}

              <InfoNote>
                Clicking &quot;Create project&quot; will write these files to{" "}
                <span className="font-mono">storage/projects/{slug}</span>. No deployment will
                happen automatically.
              </InfoNote>
            </>
          )}

          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => setStep("configure")} className="gap-1.5">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isPending || !previewFiles}
              className="gap-1.5"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Creating…" : "Create project"}
              {!isPending && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ─────────────────────────────────────────────────── */}
      {step === "done" && doneData && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Success header */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-semibold">Project created!</p>
                  <p className="text-xs text-muted-foreground">
                    {doneData.fileCount} files written to{" "}
                    <span className="font-mono">storage/projects/{doneData.slug}</span>
                  </p>
                </div>
              </div>

              <Separator />

              {/* Status items */}
              <div className="space-y-2 text-xs">
                <StatusRow
                  label="Files scaffolded"
                  value={`${doneData.fileCount} files`}
                  ok
                />
                <StatusRow
                  label="Git repository"
                  value={
                    doneData.gitInitialized
                      ? doneData.gitCommitSkipped
                        ? "Initialised (commit skipped — identity not configured)"
                        : "Initialised with initial commit"
                      : "Not initialised"
                  }
                  ok={doneData.gitInitialized}
                />
                <StatusRow
                  label="Dependencies"
                  value={doneData.installed ? "Installed" : "Not installed"}
                  ok={doneData.installed}
                  neutral={!doneData.installed}
                />
              </div>

              {/* Warnings */}
              {doneData.warnings.length > 0 && (
                <div className="space-y-1">
                  {doneData.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-300"
                    >
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <InfoNote>
                Your project is ready to edit. No deployment has happened. To go live, open
                Publishing, configure your deployment settings, and trigger your first deploy.
              </InfoNote>

              {/* Next steps */}
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Next steps
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full gap-2 justify-start"
                    onClick={() => router.push(`/projects/${doneData.projectId}/files`)}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    Open Files — review and edit generated files
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full gap-2 justify-start"
                    onClick={() => router.push(`/projects/${doneData.projectId}/publishing`)}
                  >
                    <Rocket className="h-4 w-4 shrink-0" />
                    Open Publishing — configure and deploy
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full gap-2 justify-start"
                    onClick={() => router.push(`/projects/${doneData.projectId}`)}
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    Go to project overview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full gap-2 justify-start text-muted-foreground"
                    onClick={() => router.push(`/projects/${doneData.projectId}/audit`)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    View creation audit event
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Status row helper ─────────────────────────────────────────────────────────

function StatusRow({
  label,
  value,
  ok,
  neutral,
}: {
  label: string;
  value: string;
  ok?: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "font-medium",
          ok ? "text-green-600 dark:text-green-400" : "",
          neutral ? "text-muted-foreground" : "",
          !ok && !neutral ? "text-amber-600 dark:text-amber-400" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
