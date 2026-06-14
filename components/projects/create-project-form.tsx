"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/app/actions/projects";
import { slugify } from "@/lib/utils";

const TEMPLATES = [
  { id: "next", name: "Next.js", description: "Full-stack React framework with App Router", tag: "Popular", framework: "Next.js", language: "TypeScript" },
  { id: "fastapi", name: "FastAPI", description: "High-performance Python API framework", tag: null, framework: "FastAPI", language: "Python" },
  { id: "go-fiber", name: "Go + Fiber", description: "Lightweight and blazing fast Go web framework", tag: null, framework: "Fiber", language: "Go" },
  { id: "astro", name: "Astro", description: "Content-first web framework with island architecture", tag: null, framework: "Astro", language: "TypeScript" },
  { id: "sveltekit", name: "SvelteKit", description: "Full-stack Svelte framework with file-based routing", tag: null, framework: "SvelteKit", language: "TypeScript" },
  { id: "blank", name: "Blank Project", description: "Start from scratch with no template", tag: null, framework: "", language: "" },
];

export function CreateProjectForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [framework, setFramework] = useState("");
  const [language, setLanguage] = useState("");

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlug(e.target.value);
    setSlugEdited(true);
  };

  const handleTemplate = (tpl: (typeof TEMPLATES)[0]) => {
    setFramework(tpl.framework);
    setLanguage(tpl.language);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProjectAction(null, formData);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      }
      // On success the server action calls redirect() — navigation is automatic
    });
  };

  return (
    <div className="max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground" asChild>
        <Link href="/projects">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to projects
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create a new project</h1>
        <p className="text-muted-foreground mt-1">Choose how you want to start your project.</p>
      </div>

      {/* Import options */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { icon: Github, label: "Import from GitHub", sub: "Connect a repository" },
          { icon: Upload, label: "Upload Files", sub: "Drag and drop your code" },
          { icon: Sparkles, label: "AI Generate", sub: "Describe what to build" },
        ].map(({ icon: Icon, label, sub }) => (
          <Card key={label} className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all opacity-60 select-none">
            <CardContent className="p-4 flex flex-col items-center text-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Template picker */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold mb-3">Start from a template</h2>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((tpl) => (
            <Card
              key={tpl.id}
              className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all"
              onClick={() => handleTemplate(tpl)}
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

      {/* Project form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Project details</CardTitle>
            <CardDescription>Fill in the details for your new project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project name <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="my-awesome-project"
                  value={name}
                  onChange={handleNameChange}
                  required
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && (
                  <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="slug">
                  Slug <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="slug"
                  name="slug"
                  placeholder="my-awesome-project"
                  value={slug}
                  onChange={handleSlugChange}
                  required
                  aria-invalid={!!fieldErrors.slug}
                />
                {fieldErrors.slug ? (
                  <p className="text-xs text-destructive">{fieldErrors.slug[0]}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    prisom.dev/<span className="font-mono">{slug || "…"}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="description"
                name="description"
                placeholder="A brief description of your project"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  name="type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  defaultValue="APP"
                >
                  {["APP", "API", "LIBRARY", "STATIC", "SERVICE", "OTHER"].map((t) => (
                    <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="visibility">Visibility</Label>
                <select
                  id="visibility"
                  name="visibility"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  defaultValue="PRIVATE"
                >
                  <option value="PRIVATE">Private</option>
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="language">Language</Label>
                <Input
                  id="language"
                  name="language"
                  placeholder="TypeScript"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="framework">Framework</Label>
                <Input
                  id="framework"
                  name="framework"
                  placeholder="Next.js"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="githubUrl">GitHub URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="githubUrl"
                  name="githubUrl"
                  placeholder="https://github.com/owner/repo"
                  type="url"
                />
                {fieldErrors.githubUrl && (
                  <p className="text-xs text-destructive">{fieldErrors.githubUrl[0]}</p>
                )}
              </div>
            </div>

            {/* Advanced section */}
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Advanced settings
              </button>

              {showAdvanced && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="installCommand">Install command</Label>
                    <Input id="installCommand" name="installCommand" placeholder="npm install" className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="buildCommand">Build command</Label>
                    <Input id="buildCommand" name="buildCommand" placeholder="npm run build" className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="startCommand">Start command</Label>
                    <Input id="startCommand" name="startCommand" placeholder="npm start" className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="outputDirectory">Output directory</Label>
                    <Input id="outputDirectory" name="outputDirectory" placeholder=".next" className="font-mono text-xs" />
                  </div>
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
    </div>
  );
}
