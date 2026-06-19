"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Github,
  Upload,
  Sparkles,
  FolderPlus,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  FileArchive,
  Info,
  LayoutTemplate,
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
import { createProjectAction, createBlankProjectAction } from "@/app/actions/projects";
import { slugify } from "@/lib/utils";
import { CreateFromTemplateForm } from "@/components/projects/create-from-template-form";
import { listProjectTemplates } from "@/lib/templates/project-templates";

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = "blank" | "github" | "upload" | "ai" | "template";

// ── Shared sub-components ─────────────────────────────────────────────────────

const SELECT_CLS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TypeSelect({ defaultValue = "APP" }: { defaultValue?: string }) {
  return (
    <select id="type" name="type" defaultValue={defaultValue} className={SELECT_CLS}>
      {["APP", "API", "LIBRARY", "STATIC", "SERVICE", "OTHER"].map((t) => (
        <option key={t} value={t}>
          {t.charAt(0) + t.slice(1).toLowerCase()}
        </option>
      ))}
    </select>
  );
}

function VisibilitySelect() {
  return (
    <select id="visibility" name="visibility" defaultValue="PRIVATE" className={SELECT_CLS}>
      <option value="PRIVATE">Private</option>
      <option value="PUBLIC">Public</option>
      <option value="UNLISTED">Unlisted</option>
    </select>
  );
}

function NameSlugRow({
  name,
  slug,
  onNameChange,
  onSlugChange,
  nameError,
  slugError,
}: {
  name: string;
  slug: string;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  nameError?: string;
  slugError?: string;
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ── Mode descriptor ───────────────────────────────────────────────────────────

const MODES: Array<{
  id: Mode;
  label: string;
  sub: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "blank",    label: "Blank Project",      sub: "Start with an empty project",  Icon: FolderPlus    },
  { id: "template", label: "From Template",       sub: "Scaffold from a starter",      Icon: LayoutTemplate },
  { id: "github",   label: "Import from GitHub", sub: "Link a repository",             Icon: Github        },
  { id: "upload",   label: "Upload ZIP",          sub: "Upload a .zip archive",         Icon: Upload        },
  { id: "ai",       label: "AI Generate",         sub: "Describe what to build",        Icon: Sparkles      },
];

// ── Main component ────────────────────────────────────────────────────────────

export function CreateProjectForm({ aiAvailable = false }: { aiAvailable?: boolean }) {
  const router = useRouter();

  // ── State ───────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("blank");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Shared name/slug — persists when switching modes
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Upload mode
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // AI mode
  const [aiPrompt, setAiPrompt] = useState("");

  // Hidden file input ref — MUST be at root level so the Upload button
  // can call .click() even before the upload form section is rendered.
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const clearErrors = () => {
    setError(null);
    setFieldErrors({});
  };

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSlugChange = (v: string) => {
    setSlug(v);
    setSlugEdited(true);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearErrors();
  };

  /** Open the OS file picker. Safe to call before upload mode is active. */
  const openFilePicker = () => {
    clearErrors();
    zipInputRef.current?.click();
  };

  /** Called when the hidden file input fires onChange. */
  const handleZipSelected = (f: File | null) => {
    if (!f) return;
    setZipFile(f);
    setMode("upload"); // switch into upload mode (highlights the button, shows form)
    // Auto-derive name/slug from filename if the user hasn't typed anything yet
    if (!name.trim() || !slugEdited) {
      const derived = f.name
        .replace(/\.zip$/i, "")
        .replace(/[_\s]+/g, "-")
        .toLowerCase();
      // Let handleNameChange set both name and slug
      setName(derived);
      setSlug(slugify(derived));
    }
    clearErrors();
  };

  // ── Submit handlers ──────────────────────────────────────────────────────────

  /** Blank project — calls server action which redirects to /files on success. */
  const handleBlankSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBlankProjectAction(null, fd);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
      // On success, createBlankProjectAction calls redirect() → navigation is automatic
    });
  };

  /** GitHub import — uses existing createProjectAction (redirects to /projects/[id]). */
  const handleGithubSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProjectAction(null, fd);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
    });
  };

  /** ZIP upload — POST to /api/projects/upload, then client-navigates to /files. */
  const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();

    if (!zipFile) { setError("Please select a .zip file first."); return; }
    if (!name.trim()) { setError("Project name is required."); return; }
    if (!slug.trim()) { setError("Slug is required."); return; }

    const form = e.currentTarget;
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("slug", slug.trim());
    fd.append("description",
      (form.elements.namedItem("description") as HTMLTextAreaElement | null)?.value ?? "");
    fd.append("type",
      (form.elements.namedItem("type") as HTMLSelectElement | null)?.value ?? "APP");
    fd.append("file", zipFile);

    setUploading(true);
    try {
      const res = await fetch("/api/projects/upload", { method: "POST", body: fd });

      // Attempt to parse JSON — may fail if the response was truncated by the server.
      let data: { projectId?: string; error?: string } = {};
      try {
        data = (await res.json()) as { projectId?: string; error?: string };
      } catch {
        // Non-JSON body (e.g. Next.js returned a plain-text error after truncating the stream).
        // Fall through to the size/generic error below.
      }

      if (res.status === 413) {
        setError(
          "Upload failed. ZIP must be under 50 MB. If your file is smaller, try again."
        );
        return;
      }

      if (!res.ok || !data.projectId) {
        // Surface the server error message; fall back to a size hint since the most
        // common cause of a generic failure is an oversized file.
        setError(
          data.error ?? "Upload failed. ZIP must be under 50 MB. If your file is smaller, try again."
        );
        return;
      }

      router.push(`/projects/${data.projectId}/files`);
    } catch (err) {
      // TypeError is thrown when the request never reached the server (CORS, DNS, etc.)
      // or when the browser aborted the upload before it completed.
      if (err instanceof TypeError) {
        setError(
          "Upload failed before reaching the server. Please check your upload limit or connection."
        );
      } else {
        setError("Network error — please check your connection and try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  /** AI generate — creates project record with description, redirects to /projects/[id]. */
  const handleAiSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearErrors();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProjectAction(null, fd);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      {/*
        Hidden file input at the ROOT level — outside every conditional block.
        This lets the Upload ZIP mode button call zipInputRef.current?.click()
        immediately, before the upload form section is in the DOM.
      */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          handleZipSelected(e.target.files?.[0] ?? null);
          // Reset so the same file can be re-selected if needed
          e.target.value = "";
        }}
      />

      {/* Back link */}
      <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground" asChild>
        <Link href="/projects">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to projects
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create a new project</h1>
        <p className="text-muted-foreground mt-1">Choose how you want to start.</p>
      </div>

      {/* ── Mode selector ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-5">
        {MODES.map(({ id, label, sub, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === "upload") {
                // Switch mode immediately (highlights the button) AND open file picker.
                // If the user already has a file, keep it; just switch back into upload view.
                switchMode("upload");
                openFilePicker();
              } else {
                switchMode(id);
              }
            }}
            className={[
              "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              mode === id
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/50 hover:shadow-sm",
            ].join(" ")}
          >
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium leading-snug">{label}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Template Mode
      ══════════════════════════════════════════════════════════════ */}
      {mode === "template" && (
        <CreateFromTemplateForm templates={listProjectTemplates()} />
      )}

      {/* ══════════════════════════════════════════════════════════════
          Blank Project
      ══════════════════════════════════════════════════════════════ */}
      {mode === "blank" && (
        <form onSubmit={handleBlankSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <FolderPlus className="h-4 w-4" />
                Blank Project
              </CardTitle>
              <CardDescription>
                Creates an empty project folder on the server. Add files later via upload or
                GitHub sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              <NameSlugRow
                name={name}
                slug={slug}
                onNameChange={handleNameChange}
                onSlugChange={handleSlugChange}
                nameError={fieldErrors.name?.[0]}
                slugError={fieldErrors.slug?.[0]}
              />

              <div className="space-y-1.5">
                <Label htmlFor="description">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="A brief description of the project"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <TypeSelect />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="visibility">Visibility</Label>
                  <VisibilitySelect />
                </div>
              </div>

              {/* Advanced build settings */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Advanced settings
                </button>
                {showAdvanced && (
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="installCommand">Install command</Label>
                      <Input
                        id="installCommand"
                        name="installCommand"
                        placeholder="npm install"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="buildCommand">Build command</Label>
                      <Input
                        id="buildCommand"
                        name="buildCommand"
                        placeholder="npm run build"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="startCommand">Start command</Label>
                      <Input
                        id="startCommand"
                        name="startCommand"
                        placeholder="npm start"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="outputDirectory">Output directory</Label>
                      <Input
                        id="outputDirectory"
                        name="outputDirectory"
                        placeholder=".next"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isPending || !name.trim()}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Creating…" : "Create Blank Project"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}

      {/* ══════════════════════════════════════════════════════════════
          GitHub Import
      ══════════════════════════════════════════════════════════════ */}
      {mode === "github" && (
        <form onSubmit={handleGithubSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Github className="h-4 w-4" />
                Import from GitHub
              </CardTitle>
              <CardDescription>
                Link a GitHub repository to this project. Make sure the{" "}
                <Link
                  href="/integrations/github"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  GitHub App is configured
                </Link>{" "}
                so webhooks are received and commits sync automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              <div className="space-y-1.5">
                <Label htmlFor="githubUrl">
                  GitHub repository URL{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="githubUrl"
                  name="githubUrl"
                  type="url"
                  placeholder="https://github.com/owner/repo"
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
                name={name}
                slug={slug}
                onNameChange={handleNameChange}
                onSlugChange={handleSlugChange}
                nameError={fieldErrors.name?.[0]}
                slugError={fieldErrors.slug?.[0]}
              />

              <div className="space-y-1.5">
                <Label htmlFor="description">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="What does this project do?"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <TypeSelect />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="visibility">Visibility</Label>
                  <VisibilitySelect />
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

      {/* ══════════════════════════════════════════════════════════════
          Upload ZIP
          The hidden <input type="file"> is at the root of this
          component — the section below is only the visible UI.
      ══════════════════════════════════════════════════════════════ */}
      {mode === "upload" && (
        <>
          {/* ── No file yet: large click-to-select target ── */}
          {!zipFile && (
            <div>
              <button
                type="button"
                onClick={openFilePicker}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f && f.name.toLowerCase().endsWith(".zip")) {
                    handleZipSelected(f);
                  } else {
                    setError("Only .zip files are accepted.");
                  }
                }}
                className={[
                  "w-full flex flex-col items-center justify-center gap-3 rounded-lg",
                  "border-2 border-dashed border-muted-foreground/30 p-14 text-center",
                  "cursor-pointer transition-colors select-none",
                  "hover:border-primary/50 hover:bg-muted/20",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                ].join(" ")}
              >
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <p className="text-base font-semibold">Click to select a ZIP file</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    or drag &amp; drop here
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    .zip only &middot; max 50 MB
                  </p>
                </div>
              </button>
              {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
            </div>
          )}

          {/* ── File selected: show details form ── */}
          {zipFile && (
            <form onSubmit={handleUploadSubmit}>
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Upload Project Files
                  </CardTitle>
                  <CardDescription>
                    Files are extracted on the server and{" "}
                    <strong>never executed automatically</strong>. Configure deployment
                    settings after creating the project to go live.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {error && <ErrorBanner message={error} />}

                  {/* Selected file info */}
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <FileArchive className="h-8 w-8 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{zipFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(zipFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openFilePicker}
                      className="text-xs text-muted-foreground hover:text-foreground underline shrink-0 transition-colors"
                    >
                      Choose different ZIP
                    </button>
                  </div>

                  <NameSlugRow
                    name={name}
                    slug={slug}
                    onNameChange={handleNameChange}
                    onSlugChange={handleSlugChange}
                  />

                  <div className="space-y-1.5">
                    <Label htmlFor="description">
                      Description{" "}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Textarea
                      id="description"
                      name="description"
                      placeholder="What does this project do?"
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="type">Type</Label>
                      <TypeSelect />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="visibility">Visibility</Label>
                      <VisibilitySelect />
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Files are stored on disk and never auto-executed. Deployment config can
                      be added after the project is created.
                    </span>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={uploading || !zipFile || !name.trim() || !slug.trim()}
                  >
                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {uploading ? "Uploading & extracting…" : "Upload ZIP and Create Project"}
                  </Button>
                </CardContent>
              </Card>
            </form>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          AI Generate
      ══════════════════════════════════════════════════════════════ */}
      {mode === "ai" && (
        <form onSubmit={handleAiSubmit}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI Generate
              </CardTitle>
              <CardDescription>
                Describe what you want to build. A project record will be created with your
                description — actual code generation requires a connected AI provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}

              {aiAvailable ? (
                <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-50/50 dark:bg-green-950/20 p-3 text-xs text-green-700 dark:text-green-300">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  AI provider connected. Code generation is available in the project&apos;s
                  AI tab after creation.
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>AI code generation is not connected.</strong> Set{" "}
                    <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">
                      ANTHROPIC_API_KEY
                    </code>{" "}
                    in <code className="font-mono">.env</code> to enable it. Your project
                    will be created with the description below.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="aiPrompt">What do you want to build?</Label>
                <Textarea
                  id="aiPrompt"
                  name="aiPrompt"
                  placeholder="A task management app with projects, tags, and due dates — built with Next.js and PostgreSQL."
                  rows={4}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
                {/* Pass the prompt as description into the standard createProjectAction */}
                <input type="hidden" name="description" value={aiPrompt} />
              </div>

              <NameSlugRow
                name={name}
                slug={slug}
                onNameChange={handleNameChange}
                onSlugChange={handleSlugChange}
                nameError={fieldErrors.name?.[0]}
                slugError={fieldErrors.slug?.[0]}
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <TypeSelect />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="visibility">Visibility</Label>
                  <VisibilitySelect />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isPending || !name.trim()}
              >
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
