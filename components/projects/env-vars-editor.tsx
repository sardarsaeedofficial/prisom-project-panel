"use client";

/**
 * components/projects/env-vars-editor.tsx
 *
 * Per-project environment variable manager.
 *
 * Features:
 *   - List all env vars (names + masked values)
 *   - Add / edit individual vars
 *   - Bulk import from .env file paste
 *   - Delete individual vars
 *   - Never shows raw secret values after save
 */

import { useState, useTransition } from "react";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  KeyRound,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  upsertEnvVarAction,
  deleteEnvVarAction,
  bulkImportEnvVarsAction,
  type EnvVarRow,
} from "@/app/actions/project-envvars";

interface Props {
  projectId: string;
  initialVars: EnvVarRow[];
}

export function EnvVarsEditor({ projectId, initialVars }: Props) {
  const [vars,          setVars]          = useState<EnvVarRow[]>(initialVars);
  const [newName,       setNewName]       = useState("");
  const [newValue,      setNewValue]      = useState("");
  const [showValue,     setShowValue]     = useState(false);
  const [addError,      setAddError]      = useState("");
  const [addOk,         setAddOk]         = useState("");
  const [bulkText,      setBulkText]      = useState("");
  const [showBulk,      setShowBulk]      = useState(false);
  const [bulkError,     setBulkError]     = useState("");
  const [bulkOk,        setBulkOk]        = useState("");
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Add / update single var ──────────────────────────────────────────────

  async function handleAdd() {
    setAddError("");
    setAddOk("");
    if (!newName.trim() || !newValue.trim()) {
      setAddError("Both name and value are required.");
      return;
    }
    const res = await upsertEnvVarAction(projectId, newName.trim(), newValue.trim());
    if (!res.ok) {
      setAddError(res.error);
      return;
    }
    setAddOk(`${newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")} saved.`);
    setNewName("");
    setNewValue("");
    setTimeout(() => setAddOk(""), 3000);
    // Reload the list
    startTransition(async () => {
      const { getProjectEnvVarsAction } = await import("@/app/actions/project-envvars");
      const r = await getProjectEnvVarsAction(projectId);
      if (r.ok) setVars(r.vars);
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete env var ${name}?`)) return;
    setDeletingId(id);
    await deleteEnvVarAction(id, projectId);
    setVars((v) => v.filter((x) => x.id !== id));
    setDeletingId(null);
  }

  // ── Bulk import ──────────────────────────────────────────────────────────

  async function handleBulkImport() {
    setBulkError("");
    setBulkOk("");
    if (!bulkText.trim()) {
      setBulkError("Paste your .env file content above.");
      return;
    }
    const res = await bulkImportEnvVarsAction(projectId, bulkText);
    if (!res.ok) {
      setBulkError(res.error);
      return;
    }
    setBulkOk(`Imported ${res.imported} vars${res.skipped > 0 ? `, skipped ${res.skipped}` : ""}.`);
    setBulkText("");
    setShowBulk(false);
    startTransition(async () => {
      const { getProjectEnvVarsAction } = await import("@/app/actions/project-envvars");
      const r = await getProjectEnvVarsAction(projectId);
      if (r.ok) setVars(r.vars);
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Existing vars list ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">
                Environment Variables
                {vars.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({vars.length})
                  </span>
                )}
              </CardTitle>
            </div>
          </div>
          <CardDescription>
            Injected into every deployment. Secrets are AES-256-GCM encrypted at rest.
            Raw values are never shown after save.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {vars.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No env vars yet — add one below.
            </p>
          ) : (
            <div className="rounded-md border divide-y text-sm">
              {vars.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                  <code className="font-mono font-medium min-w-0 flex-1 truncate text-foreground">
                    {v.name}
                  </code>
                  <code className="font-mono text-xs text-muted-foreground flex-1 truncate">
                    {v.maskedValue}
                  </code>
                  {v.isSecret ? (
                    <Badge variant="secondary" className="text-xs shrink-0">secret</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs shrink-0">public</Badge>
                  )}
                  <button
                    type="button"
                    title={`Delete ${v.name}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                    onClick={() => handleDelete(v.id, v.name)}
                    disabled={deletingId === v.id}
                  >
                    {deletingId === v.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add single var ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add / Update Variable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="envName" className="text-xs">Name</Label>
              <Input
                id="envName"
                placeholder="DATABASE_URL"
                className="h-9 font-mono text-sm uppercase"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="envValue" className="text-xs">Value</Label>
              <div className="relative">
                <Input
                  id="envValue"
                  type={showValue ? "text" : "password"}
                  placeholder="••••••••"
                  className="h-9 font-mono text-sm pr-9"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowValue((v) => !v)}
                >
                  {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {addError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {addError}
            </p>
          )}
          {addOk && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {addOk}
            </p>
          )}

          <Button size="sm" onClick={handleAdd} className="gap-2">
            <Plus className="h-3.5 w-3.5" /> Save Variable
          </Button>

          <p className="text-xs text-muted-foreground">
            Updating an existing name overwrites the value. All secrets are encrypted before storage.
          </p>
        </CardContent>
      </Card>

      {/* ── Bulk import ── */}
      <Card>
        <CardHeader className="pb-2">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors text-muted-foreground"
            onClick={() => setShowBulk((v) => !v)}
          >
            <Upload className="h-4 w-4" />
            Bulk import from .env file
            {showBulk ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CardHeader>

        {showBulk && (
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste the contents of your .env file. Existing vars with the same name will be overwritten.
              <span className="text-amber-600 dark:text-amber-400 ml-1 font-medium">
                Never paste .env files from Replit into chat — use this form instead.
              </span>
            </p>
            <textarea
              className="w-full font-mono text-xs bg-zinc-950 text-zinc-200 rounded-md p-3 h-40 resize-none border border-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-600"
              placeholder={"DATABASE_URL=postgres://...\nSTRIPE_SECRET_KEY=sk_live_...\n# Comments are ignored"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> {bulkError}
              </p>
            )}
            {bulkOk && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> {bulkOk}
              </p>
            )}
            <Button size="sm" onClick={handleBulkImport} className="gap-2">
              <Upload className="h-3.5 w-3.5" /> Import Variables
            </Button>
          </CardContent>
        )}
      </Card>

      {/* ── Warning ── */}
      <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> Security reminders
        </p>
        <ul className="text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside">
          <li>Env vars are injected at deploy time — redeploy after changes.</li>
          <li>This project&apos;s DATABASE_URL overrides all others; it never inherits the panel&apos;s DB.</li>
          <li>If a secret was accidentally pasted into chat/logs, rotate it immediately.</li>
          <li>Stripe webhook secrets should be re-issued when changing domains.</li>
        </ul>
      </div>
    </div>
  );
}
