"use client";

import { useActionState, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createPortfolioItemAction, type PortfolioFormState } from "@/app/actions/portfolio";

export function AddPortfolioItemForm() {
  const [state, formAction, isPending] = useActionState<PortfolioFormState, FormData>(
    createPortfolioItemAction,
    null
  );
  const [open, setOpen] = useState(false);

  // Collapse form on success
  const success = state?.success;

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-between w-full text-left"
        >
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Portfolio Item
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Showcase a project, case study, or piece of work.
            </CardDescription>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>
      </CardHeader>

      {open && (
        <CardContent>
          {success && (
            <div className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400 mb-4">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Portfolio item added successfully.
            </div>
          )}

          {state?.error && !success && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive mb-4">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="pi-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pi-title"
                name="title"
                placeholder="My Awesome Project"
                required
                aria-invalid={!!state?.fieldErrors?.title}
              />
              {state?.fieldErrors?.title && (
                <p className="text-xs text-destructive">{state.fieldErrors.title[0]}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="pi-description">Description</Label>
              <Textarea
                id="pi-description"
                name="description"
                rows={2}
                placeholder="Brief description of what this is and what you built."
              />
            </div>

            {/* URLs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="pi-liveUrl">Live URL</Label>
                <Input
                  id="pi-liveUrl"
                  name="liveUrl"
                  type="url"
                  placeholder="https://example.com"
                  aria-invalid={!!state?.fieldErrors?.liveUrl}
                />
                {state?.fieldErrors?.liveUrl && (
                  <p className="text-xs text-destructive">{state.fieldErrors.liveUrl[0]}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pi-githubUrl">GitHub URL</Label>
                <Input
                  id="pi-githubUrl"
                  name="githubUrl"
                  type="url"
                  placeholder="https://github.com/you/repo"
                  aria-invalid={!!state?.fieldErrors?.githubUrl}
                />
                {state?.fieldErrors?.githubUrl && (
                  <p className="text-xs text-destructive">{state.fieldErrors.githubUrl[0]}</p>
                )}
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label htmlFor="pi-tags">Tags</Label>
              <Input
                id="pi-tags"
                name="tags"
                placeholder="React, TypeScript, Next.js"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of tags.
              </p>
            </div>

            {/* Featured */}
            <div className="flex items-center gap-2">
              <input
                id="pi-featured"
                name="featured"
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="pi-featured" className="font-normal cursor-pointer">
                Feature this item (shown first)
              </Label>
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Adding…" : "Add Item"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
