"use client";

import { useState, useTransition } from "react";
import { Plus, X, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDatabaseAction } from "@/app/actions/workspace-modules";

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const DB_TYPES = ["POSTGRES", "MYSQL", "SQLITE", "MONGODB", "REDIS"] as const;

type Env = { id: string; name: string };

export function AddDatabaseForm({
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
      const result = await createDatabaseAction(fd);
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
        Add Database
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
          <Database className="h-4 w-4 text-muted-foreground" />
          New Database
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
        <div>
          <Label htmlFor="db-name">Name *</Label>
          <Input
            id="db-name"
            name="name"
            placeholder="e.g. primary-db"
            required
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="db-type">Type</Label>
          <select id="db-type" name="type" className={`mt-1 ${SELECT_CLASS}`}>
            {DB_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {environments.length > 0 && (
          <div>
            <Label htmlFor="db-env">Environment</Label>
            <select
              id="db-env"
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
          <Label htmlFor="db-host">Host</Label>
          <Input
            id="db-host"
            name="host"
            placeholder="localhost"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="db-port">Port</Label>
          <Input
            id="db-port"
            name="port"
            type="number"
            placeholder="5432"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="db-dbname">Database name</Label>
          <Input
            id="db-dbname"
            name="databaseName"
            placeholder="myapp"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="db-user">Username</Label>
          <Input
            id="db-user"
            name="username"
            placeholder="postgres"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="db-limit">Storage limit (MB)</Label>
          <Input
            id="db-limit"
            name="storageLimitMb"
            type="number"
            placeholder="1024"
            className="mt-1"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Passwords are never stored. Connection info is metadata only.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add Database"}
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
