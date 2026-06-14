"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Github,
  Upload,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  FileArchive,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/app/actions/projects";
import { slugify } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = "template" | "github" | "upload" | "ai";

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES = [
  { id: "next",      name: "Next.js",       description: "Full-stack React with App Router",          tag: "Popular",  framework: "Next.js",   language: "TypeScript" },
  { id: "fastapi",   name: "FastAPI",        description: "High-performance Python API",               tag: null,       framework: "FastAPI",   language: "Python"     },
  { id: "go-fiber",  name: "Go + Fiber",     description: "Lightweight and fast Go web framework",     tag: null,       framework: "Fiber",     language: "Go"         },
  { id: "astro",     name: "Astro",          description: "Content-first web with island architecture",tag: null,       framework: "Astro",     language: "TypeScript" },
  { id: "sveltekit", name: "SvelteKit",      description: "Full-stack Svelte with file-based routing", tag: null,       framework: "SvelteKit", language: "TypeScript" },
  { id: "blank",     name: "Blank Project",  description: "Start from scratch, no template",          tag: null,       framework: "",          language: ""           },
];

// ── Shared name/slug fields ───────────────────────────────────────────────────

function NameSlugRow({
  name, slug, slugEdited,
  onNameChange, onSlugChange,
  nameError, slugError,
}: {
  name: string; slug: string; slugEdited: boolean;
  onNameChange: (v: string) => void; onSlugChange: (v: string) => void;
  nameError?: string; slugError?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Project name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="my-project"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          required
          aria-invalid={!!nameError}
        />
        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">
          Slug <span className="text-destructive">*</span>
        </Label>
        <Input
          id="slug"
          name="slug"
          placeholder="my-project"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          required
          aria-invalid={!!slugError}
        />
        {slugError ? (
          <p className="text-xs text-destructive">{slugError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            ID: <span className="font-mono">{slug || "…"}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      {message}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CreateProjectForm({ aiAvailable = false }: { aiAvailable?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("template");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Shared name/slug state (reused across modes)
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Template mode
  const [framework, setFramework] = useState("");
  const [language, setLanguage] = useState("");

  // Upload mode
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI mode
  const [aiPrompt, setAiPrompt] = useState("");

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };
  const handleSlugChange = (v: string) => {
    setSlug(v);
    setSlugEdited(true);
  };
  const clearErrors = () => { setError(null); setFieldErrors({}); };

  const handleModeSelect = (m: Mode) => {
    setMode(m);
    clearErrors();
  };

  // ── Template / GitHub Import submit ──────────────────────────────────────────

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProjectAction(null, formData);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
      // Success → server action calls redirect() automatically
    });
  };

  // ── Upload submit ─────────────────────────────────────────────────────────────

  const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();

    if (!uploadFile) { setError("Please select a .zip file to upload."); return; }
    if (!name.trim()) { setError("Project name is required."); return; }
    if (!slug.trim()) { setError("Slug is required."); return; }

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("slug", slug.trim());
    fd.append("description", (e.currentTarget.elements.namedItem("description") as HTMLTextAreaElement | null)?.value ?? "");
    fd.append("type", (e.currentTarget.elements.namedItem("type") as HTMLSelectElement | null)?.value ?? "APP");
    fd.append("file", uploadFile);

    setUploading(true);
    try {
      const res = await fetch("/api/projects/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { projectId?: string; error?: string };
      if (!res.ok || !data.projectId) {
        setError(data.error ?? "Upload failed. Please try again.");
        return;
      }
      router.push(`/projects/${data.projectId}/files`);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  // ── AI submit ─────────────────────────────────────────────────────────────────

  const handleAiSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();
    // AI is not connected — create a plain DRAFT project with the description
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProjectAction(null, formData);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
    });
  };

  // ── Mode selector cards ───────────────────────────────────────────────────────

  const MODES: Array<{ id: Mode; icon: React.ReactNode; label: string; sub: string }> = [
    { id: "template", icon: <Github className="h-5 w-5 text-primary" />, label: "Start from template", sub: "Pick a framework or blank" },
    { id: "github",   icon: <Github className="h-5 w-5 text-primary" />, label: "Import from GitHub",   sub: "Link a GitHub repository" },
    { id: "upload",   icon: <Upload className="h-5 w-5 text-primary" />, label: "Upload Files",          sub: "Upload a .zip archive" },
    { id: "ai",       icon: <Sparkles className="h-5 w-5 text-primary" />, label: "AI Generate",        sub: "Describe what to build" },
  ];

  return (
    <div className="max-w-2xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-6 -ml-2 text-muted-foreground"
        asChild
      >
        <Link href="/projects">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to projects
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create a new project</h1>
        <p className="text-muted-foreground mt-1">Choose how you want to start.</p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-4">
        {MODES.map(({ id, icon, label, sub }) => (
          <Card
            key={id}
            className={`cursor-pointer transition-all ${
              mode === id
                ? "border-primary shadow-sm ring-1 ring-primary"
                : "hover:border-primary/50 hover:shadow-sm"
            }`}
            onClick={() => handleModeSelect(id)}
          >
            <CardContent className="p-4 flex flex-col items-center text-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                {icon}
              </div>
              <p className="text-sm font-medium leading-snug">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Template mode ── */}
      {mode === "template" && (
        <>
          <div className="mb-6">
            <h2 className="text-sm font-semibold mb-3">Start from a template</h2>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((tpl) => (
                <Card
                  key={tpl.id}
                  className={`cursor-pointer transition-all ${
                    framework === tpl.framework && language === tpl.language && tpl.id !== "blank"
                      ? "border-primary ring-1 ring-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => { setFramework(tpl.framework); setLanguage(tpl.language); }}
                >
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{tpl.name}</p>
                      <p className="text-xs text-muted-foreground">{tpl.description}</p>
                    </div>
                    {tpl.tag && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium shrink-0 ml-2">
                        {tpl.tag}
                      </span>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <form onSubmit={handleFormSubmit}>
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Project details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && <ErrorBanner message={error} />}

                <NameSlugRow
                  name={name} slug={slug} slugEdited={slugEdited}
                  onNameChange={handleNameChange} onSlugChange={handleSlugChange}
                  nameError={fieldErrors.name?.[0]} slugError={fieldErrors.slug?.[0]}
                />

                <div className="space-y-1.5">
                  <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea id="description" name="description" placeholder="A brief description" rows={2} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="type">Type</Label>
                    <select id="type" name="type" defaultValue="APP" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {["APP","API","LIBRARY","STATIC","SERVICE","OTHER"].map((t) => (
                        <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="visibility">Visibility</Label>
                    <select id="visibility" name="visibility" defaultValue="PRIVATE" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="PRIVATE">Private</option>
                      <option value="PUBLIC">Public</option>
                      <option value="UNLISTED">Unlisted</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="language">Language</Label>
                    <Input id="language" name="language" placeholder="TypeScript" value={language} onChange={(e) => setLanguage(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="framework">Framework</Label>
                    <Input id="framework" name="framework" placeholder="Next.js" value={framework} onChange={(e) => setFramework(e.target.value)} />
                  </div>
                </div>

                <div className="border-t pt-3">
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    Advanced settings
                  </button>
                  {showAdvanced && (
                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label htmlFor="installCommand">Install command</Label><Input id="installCommand" name="installCommand" placeholder="npm install" className="font-mono text-xs" /></div>
                      <div className="space-y-1.5"><Label htmlFor="buildCommand">Build command</Label><Input id="buildCommand" name="buildCommand" placeholder="npm run build" className="font-mono text-xs" /></div>
                      <div className="space-y-1.5"><Label htmlFor="startCommand">Start command</Label><Input id="startCommand" name="startCommand" placeholder="npm start" className="font-mono text-xs" /></div>
                      <div className="space-y-1.5"><Label htmlFor="outputDirectory">Output directory</Label><Input id="outputDirectory" name="outputDirectory" placeholder=".next" className="font-mono text-xs" /></div>
                    </div>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Creating…" : "Create Project"}
                </Button>
              </CardContent>
            </Card>
          </form>
        </>
      )}

      {/* ── GitHub Import mode ── */}
      {mode === "github" && (
        <form onSubmit={handleFormSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Github className="h-4 w-4" />
                Import from GitHub
              </CardTitle>
              <CardDescription>
                Link a GitHub repository to this project. Make sure the{" "}
                <Link href="/integrations/github" className="underline underline-offset-2 hover:text-foreground">
                  GitHub App is configured
                </Link>{" "}
                so that webhooks are received and commits are synced automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              <div className="space-y-1.5">
                <Label htmlFor="githubUrl">
                  GitHub repository URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="githubUrl"
                  name="githubUrl"
                  placeholder="https://github.com/owner/repo"
                  type="url"
                  required
                  aria-invalid={!!fieldErrors.githubUrl}
                />
                {fieldErrors.githubUrl && (
                  <p className="text-xs text-destructive">{fieldErrors.githubUrl[0]}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Public or private — the GitHub App must be installed on the repo for sync.
                </p>
              </div>

              <NameSlugRow
                name={name} slug={slug} slugEdited={slugEdited}
                onNameChange={handleNameChange} onSlugChange={handleSlugChange}
                nameError={fieldErrors.name?.[0]} slugError={fieldErrors.slug?.[0]}
              />

              <div className="space-y-1.5">
                <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea id="description" name="description" placeholder="What does this project do?" rows={2} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <select id="type" name="type" defaultValue="APP" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {["APP","API","LIBRARY","STATIC","SERVICE","OTHER"].map((t) => (
                      <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="visibility">Visibility</Label>
                  <select id="visibility" name="visibility" defaultValue="PRIVATE" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="PRIVATE">Private</option>
                    <option value="PUBLIC">Public</option>
                    <option value="UNLISTED">Unlisted</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="language">Language</Label>
                  <Input id="language" name="language" placeholder="TypeScript" />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Importing…" : "Import Repository"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}

      {/* ── Upload Files mode ── */}
      {mode === "upload" && (
        <form onSubmit={handleUploadSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Project Files
              </CardTitle>
              <CardDescription>
                Upload a <code className="font-mono bg-muted px-1 rounded text-xs">.zip</code> archive of your project source code (max 50 MB).
                Files are extracted to <code className="font-mono bg-muted px-1 rounded text-xs">storage/projects/&lt;slug&gt;/</code> and are never executed automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              {/* File picker */}
              <div className="space-y-1.5">
                <Label htmlFor="file">
                  ZIP archive <span className="text-destructive">*</span>
                </Label>
                <div
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                    uploadFile ? "border-primary/50 bg-primary/5" : "border-muted-foreground/30 hover:border-primary/40 hover:bg-muted/30"
                  }`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dropped = e.dataTransfer.files[0];
                    if (dropped && dropped.name.toLowerCase().endsWith(".zip")) {
                      setUploadFile(dropped);
                      if (!slugEdited && !name) {
                        const base = dropped.name.replace(/\.zip$/i, "");
                        handleNameChange(base);
                      }
                    } else {
                      setError("Only .zip files are accepted.");
                    }
                  }}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setUploadFile(f);
                      if (f && !slugEdited && !name) {
                        const base = f.name.replace(/\.zip$/i, "");
                        handleNameChange(base);
                      }
                    }}
                  />
                  {uploadFile ? (
                    <>
                      <FileArchive className="h-8 w-8 text-primary mb-2" />
                      <p className="text-sm font-medium">{uploadFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                        onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium">Drag &amp; drop or click to select</p>
                      <p className="text-xs text-muted-foreground mt-0.5">ZIP only, max 50 MB</p>
                    </>
                  )}
                </div>
              </div>

              <NameSlugRow
                name={name} slug={slug} slugEdited={slugEdited}
                onNameChange={handleNameChange} onSlugChange={handleSlugChange}
              />

              <div className="space-y-1.5">
                <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea id="description" name="description" placeholder="What does this project do?" rows={2} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <select id="type" name="type" defaultValue="APP" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {["APP","API","LIBRARY","STATIC","SERVICE","OTHER"].map((t) => (
                    <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-300">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Uploaded files are stored on disk and never executed automatically. To deploy, configure deployment settings after creating the project.
              </div>

              <Button type="submit" className="w-full" disabled={uploading || !uploadFile}>
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {uploading ? "Uploading & extracting…" : "Upload & Create Project"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}

      {/* ── AI Generate mode ── */}
      {mode === "ai" && (
        <form onSubmit={handleAiSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI Generate
              </CardTitle>
              <CardDescription>
                Describe what you want to build. A project will be created with your description — code generation requires a connected AI provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              {/* Honest AI status banner */}
              {!aiAvailable ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>AI code generation is not connected.</strong>{" "}
                    Set <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">ANTHROPIC_API_KEY</code> in <code className="font-mono">.env</code> to enable it.
                    Your project will still be created with the description you provide below.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-50/50 dark:bg-green-950/20 p-3 text-xs text-green-700 dark:text-green-300">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  AI provider is connected. Code generation is available in the project's AI tab after creation.
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="aiPrompt">What do you want to build?</Label>
                <Textarea
                  id="aiPrompt"
                  name="aiPrompt"
                  placeholder="A task management app with projects, tags, and due dates. Built with Next.js and PostgreSQL."
                  rows={4}
                  value={aiPrompt}
                  onChange={(e) => {
                    setAiPrompt(e.target.value);
                    if (!slugEdited && !name) {
                      // Try to extract a name from the first few words
                    }
                  }}
                />
                {/* Use the prompt text as the description when submitting */}
                <input type="hidden" name="description" value={aiPrompt} />
              </div>

              <NameSlugRow
                name={name} slug={slug} slugEdited={slugEdited}
                onNameChange={handleNameChange} onSlugChange={handleSlugChange}
                nameError={fieldErrors.name?.[0]} slugError={fieldErrors.slug?.[0]}
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <select id="type" name="type" defaultValue="APP" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {["APP","API","LIBRARY","STATIC","SERVICE","OTHER"].map((t) => (
                      <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="visibility">Visibility</Label>
                  <select id="visibility" name="visibility" defaultValue="PRIVATE" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="PRIVATE">Private</option>
                    <option value="PUBLIC">Public</option>
                    <option value="UNLISTED">Unlisted</option>
                  </select>
                </div>
              </div>

              {/* status is DRAFT initially */}
              <input type="hidden" name="status" value="DRAFT" />

              <Button type="submit" className="w-full" disabled={isPending || !name.trim()}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Creating project…" : "Create Project"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
