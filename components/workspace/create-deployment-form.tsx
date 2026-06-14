"use client";

import { useState, useTransition } from "react";
import { Rocket, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDeploymentRecordAction } from "@/app/actions/workspace-modules";

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type Env = { id: string; name: string };

export function CreateDeploymentForm({
  projectId,
  environments,
}: {
  projectId: string;
  environments: Env[];
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const result = await createDeploymentRecordAction(fd);
      if (result?.error) {
        setError(result.error);
      } else {
        form.reset();
        setOpen(false);
        setAdvanced(false);
      }
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Rocket className="h-4 w-4 mr-1.5" />
        Create Deployment
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded-lg p-4 space-y-3 bg-muted/30"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4 text-muted-foreground" />
          New Deployment Record
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
        {environments.length > 0 && (
          <div>
            <Label htmlFor="dep-env">Environment</Label>
            <select
              id="dep-env"
              name="environmentId"
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value="">None</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label htmlFor="dep-branch">Branch</Label>
          <Input
            id="dep-branch"
            name="branch"
            placeholder="main"
            className="mt-1"
          />
        </div>
      </div>

      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        Advanced
      </button>

      {advanced && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="dep-sha">Commit SHA</Label>
            <Input
              id="dep-sha"
              name="commitSha"
              placeholder="a1b2c3d…"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="dep-msg">Commit message</Label>
            <Input
              id="dep-msg"
              name="commitMessage"
              placeholder="feat: …"
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dep-url">Deployment URL</Label>
            <Input
              id="dep-url"
              name="url"
              type="url"
              placeholder="https://…"
              className="mt-1"
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Creates a metadata record with status{" "}
        <strong>QUEUED</strong>. No build pipeline runs in Phase 6.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Deployment"}
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
