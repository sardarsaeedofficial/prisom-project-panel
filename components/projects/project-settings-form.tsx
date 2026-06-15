"use client";

import { useState, useTransition } from "react";
import {
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Archive,
  Trash2,
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
import { Separator } from "@/components/ui/separator";
import { updateProjectAction, archiveProjectAction, deleteProjectAction } from "@/app/actions/projects";
import { slugify } from "@/lib/utils";

export type ProjectFormValues = {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  visibility: string;
  language: string;
  framework: string;
  liveUrl: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  outputDirectory: string;
  defaultBranch: string;
  hasGithubRepo: boolean;
};

type Props = {
  projectId: string;
  initialValues: ProjectFormValues;
};

export function ProjectSettingsForm({ projectId, initialValues }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isArchiving, startArchiveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState(false);

  const [name, setName] = useState(initialValues.name);
  const [slug, setSlug] = useState(initialValues.slug);
  const [slugEdited, setSlugEdited] = useState(true);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlug(e.target.value);
    setSlugEdited(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSuccess(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const boundAction = updateProjectAction.bind(null, projectId);
      const result = await boundAction(null, formData);
      if (result?.error) {
        setError(result.error);
        setFieldErrors((result.fieldErrors as Record<string, string[]>) ?? {});
      } else if (result?.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    });
  };

  const handleArchive = () => {
    if (!confirm(`Archive "${initialValues.name}"? You can restore it later.`)) return;
    startArchiveTransition(async () => {
      await archiveProjectAction(projectId);
    });
  };

  const handleDelete = () => {
    if (
      !confirm(
        `Permanently delete "${initialValues.name}"?\n\nThis will remove the project and all its data from the database. This cannot be undone.`
      )
    )
      return;
    startDeleteTransition(async () => {
      await deleteProjectAction(projectId);
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <form onSubmit={handleSubmit}>
        {/* General settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />
              General
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Settings saved successfully.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project name <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  name="name"
                  value={name}
                  onChange={handleNameChange}
                  required
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug <span className="text-destructive">*</span></Label>
                <Input
                  id="slug"
                  name="slug"
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
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={initialValues.description}
                rows={2}
                placeholder="A brief description of your project"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  name="type"
                  defaultValue={initialValues.type}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  defaultValue={initialValues.visibility}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  defaultValue={initialValues.language}
                  placeholder="TypeScript"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="framework">Framework</Label>
                <Input id="framework" name="framework" defaultValue={initialValues.framework} placeholder="Next.js" />
              </div>
              {initialValues.hasGithubRepo && (
                <div className="space-y-1.5">
                  <Label htmlFor="defaultBranch">Default branch</Label>
                  <Input id="defaultBranch" name="defaultBranch" defaultValue={initialValues.defaultBranch} placeholder="main" />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="liveUrl">Live URL</Label>
              <Input
                id="liveUrl"
                name="liveUrl"
                type="url"
                defaultValue={initialValues.liveUrl}
                placeholder="https://your-project.com"
                aria-invalid={!!fieldErrors.liveUrl}
              />
              {fieldErrors.liveUrl ? (
                <p className="text-xs text-destructive">{fieldErrors.liveUrl[0]}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Public URL shown on project overview and Published page.
                </p>
              )}
            </div>

            {/* Build commands */}
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Build &amp; Deploy</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="installCommand">Install command</Label>
                  <Input
                    id="installCommand"
                    name="installCommand"
                    defaultValue={initialValues.installCommand}
                    placeholder="npm install"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="buildCommand">Build command</Label>
                  <Input
                    id="buildCommand"
                    name="buildCommand"
                    defaultValue={initialValues.buildCommand}
                    placeholder="npm run build"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="startCommand">Start command</Label>
                  <Input
                    id="startCommand"
                    name="startCommand"
                    defaultValue={initialValues.startCommand}
                    placeholder="npm start"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outputDirectory">Output directory</Label>
                  <Input
                    id="outputDirectory"
                    name="outputDirectory"
                    defaultValue={initialValues.outputDirectory}
                    placeholder=".next"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving…" : "Save Changes"}
            </Button>
          </CardContent>
        </Card>
      </form>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>These actions can have permanent consequences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Archive Project</p>
              <p className="text-xs text-muted-foreground">
                Hides the project from active lists. You can restore it later.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchive}
              disabled={isArchiving}
            >
              {isArchiving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4 mr-1.5" />
              )}
              Archive
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete Project</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete this project and all its data.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1.5" />
              )}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
