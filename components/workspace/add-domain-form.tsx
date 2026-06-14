"use client";

import { useState, useTransition } from "react";
import { Plus, X, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDomainAction } from "@/app/actions/workspace-modules";

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type Env = { id: string; name: string };

export function AddDomainForm({
  projectId,
  environments,
}: {
  projectId: string;
  environments: Env[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const result = await createDomainAction(fd);
      if (result?.error) {
        setError(result.error);
      } else {
        form.reset();
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add Domain
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded-lg p-4 space-y-3 bg-muted/30"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4 text-muted-foreground" />
          New Domain
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label htmlFor="hostname">Hostname *</Label>
          <Input
            id="hostname"
            name="hostname"
            placeholder="app.yourdomain.com"
            required
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="provider">Provider (optional)</Label>
          <Input
            id="provider"
            name="provider"
            placeholder="Cloudflare, Route 53…"
            className="mt-1"
          />
        </div>

        {environments.length > 0 && (
          <div>
            <Label htmlFor="environmentId">Environment</Label>
            <select
              id="environmentId"
              name="environmentId"
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value="">Any environment</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isPrimary"
          name="isPrimary"
          value="true"
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="isPrimary" className="font-normal cursor-pointer">
          Set as primary domain
        </Label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add Domain"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
