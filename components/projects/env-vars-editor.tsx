"use client";

/**
 * components/projects/env-vars-editor.tsx
 *
 * Per-project environment variable manager.
 *
 * Features:
 *   - Tab-based environment selection (development / preview / production)
 *   - List all env vars (names + masked values)
 *   - Enable / disable per var (excluded from deployment when disabled)
 *   - Add / replace individual vars
 *   - Bulk import from .env file paste
 *   - Delete individual vars
 *   - Reserved platform key validation (NODE_ENV, PORT, etc.)
 *   - Values are never shown in plaintext after save
 */

import { useState, useTransition } from "react";
import {
  Plus, Trash2, Eye, EyeOff, Upload,
  CheckCircle2, XCircle, Loader2, AlertCircle, KeyRound,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Switch }  from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  upsertEnvVarAction,
  deleteEnvVarAction,
  bulkImportEnvVarsAction,
  toggleEnvVarAction,
  getProjectEnvVarsAction,
  type EnvVarRow,
} from "@/app/actions/project-envvars";

// ── Constants ─────────────────────────────────────────────────────────────────

const ENVIRONMENTS = ["production", "preview", "development"] as const;
type Env = (typeof ENVIRONMENTS)[number];

const ENV_LABELS: Record<Env, string> = {
  production:  "Production",
  preview:     "Preview",
  development: "Development",
};

const ENV_BADGE_CLASS: Record<Env, string> = {
  production:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  preview:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  development: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:   string;
  initialVars: EnvVarRow[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EnvVarsEditor({ projectId, initialVars }: Props) {
  const [activeEnv, setActiveEnv] = useState<Env>("production");
  const [varsByEnv, setVarsByEnv] = useState<Record<Env, EnvVarRow[]>>(() => {
    const map: Record<Env, EnvVarRow[]> = { production: [], preview: [], development: [] };
    for (const v of initialVars) {
      const e = (v.environment as Env) ?? "production";
      if (map[e]) map[e].push(v);
    }
    return map;
  });

  const [newName,    setNewName]    = useState("");
  const [newValue,   setNewValue]   = useState("");
  const [showValue,  setShowValue]  = useState(false);
  const [addError,   setAddError]   = useState("");
  const [addOk,      setAddOk]      = useState("");
  const [bulkText,   setBulkText]   = useState("");
  const [showBulk,   setShowBulk]   = useState(false);
  const [bulkError,  setBulkError]  = useState("");
  const [bulkOk,     setBulkOk]     = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [, startTransition]         = useTransition();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function currentVars(): EnvVarRow[] {
    return varsByEnv[activeEnv] ?? [];
  }

  async function reloadEnv(env: Env) {
    startTransition(async () => {
      const r = await getProjectEnvVarsAction(projectId, env);
      if (r.ok) {
        setVarsByEnv((prev) => ({ ...prev, [env]: r.vars.filter((v) => (v.environment as Env) === env) }));
      }
    });
  }

  // ── Add / update ───────────────────────────────────────────────────────────

  async function handleAdd() {
    setAddError("");
    setAddOk("");
    if (!newName.trim() || !newValue.trim()) {
      setAddError("Both name and value are required.");
      return;
    }
    const res = await upsertEnvVarAction(projectId, newName.trim(), newValue.trim(), activeEnv);
    if (!res.ok) { setAddError(res.error); return; }
    const normalised = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    setAddOk(`${normalised} saved to ${ENV_LABELS[activeEnv]}.`);
    setNewName("");
    setNewValue("");
    setTimeout(() => setAddOk(""), 3000);
    await reloadEnv(activeEnv);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name} from ${ENV_LABELS[activeEnv]}?`)) return;
    setDeletingId(id);
    await deleteEnvVarAction(id, projectId);
    setVarsByEnv((prev) => ({
      ...prev,
      [activeEnv]: prev[activeEnv].filter((v) => v.id !== id),
    }));
    setDeletingId(null);
  }

  // ── Toggle enabled ─────────────────────────────────────────────────────────

  async function handleToggle(v: EnvVarRow) {
    setTogglingId(v.id);
    const res = await toggleEnvVarAction(v.id, projectId, !v.isEnabled);
    if (res.ok) {
      setVarsByEnv((prev) => ({
        ...prev,
        [activeEnv]: prev[activeEnv].map((r) =>
          r.id === v.id ? { ...r, isEnabled: !v.isEnabled } : r
        ),
      }));
    }
    setTogglingId(null);
  }

  // ── Bulk import ────────────────────────────────────────────────────────────

  async function handleBulkImport() {
    setBulkError("");
    setBulkOk("");
    if (!bulkText.trim()) { setBulkError("Paste your .env file content above."); return; }
    const res = await bulkImportEnvVarsAction(projectId, bulkText, activeEnv);
    if (!res.ok) { setBulkError(res.error); return; }
    setBulkOk(
      `Imported ${res.imported} var${res.imported !== 1 ? "s" : ""}` +
      (res.skipped > 0 ? `, skipped ${res.skipped}` : "") +
      ` into ${ENV_LABELS[activeEnv]}.`
    );
    setBulkText("");
    setShowBulk(false);
    await reloadEnv(activeEnv);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const vars = currentVars();

  return (
    <div className="space-y-5">
      {/* ── Environment tabs ── */}
      <Tabs
        value={activeEnv}
        onValueChange={(v) => {
          setActiveEnv(v as Env);
          setAddError("");
          setAddOk("");
        }}
      >
        <TabsList className="grid grid-cols-3 w-full max-w-sm">
          {ENVIRONMENTS.map((env) => (
            <TabsTrigger key={env} value={env} className="text-xs">
              {ENV_LABELS[env]}
              {varsByEnv[env].length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                  {varsByEnv[env].filter((v) => v.isEnabled).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {ENVIRONMENTS.map((env) => (
          <TabsContent key={env} value={env} className="space-y-5 mt-4">
            {/* ── Env var list ── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm">
                    {ENV_LABELS[env]} Variables
                    {varsByEnv[env].length > 0 && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        ({varsByEnv[env].filter((v) => v.isEnabled).length} enabled
                        {varsByEnv[env].some((v) => !v.isEnabled)
                          ? `, ${varsByEnv[env].filter((v) => !v.isEnabled).length} disabled`
                          : ""})
                      </span>
                    )}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Injected into deployments when enabled. Secrets encrypted with AES-256-GCM.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {varsByEnv[env].length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No {ENV_LABELS[env].toLowerCase()} vars yet.
                  </p>
                ) : (
                  <div className="rounded-md border divide-y text-sm">
                    {varsByEnv[env].map((v) => (
                      <div
                        key={v.id}
                        className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                          !v.isEnabled ? "opacity-50 bg-muted/30" : ""
                        }`}
                      >
                        {/* Enable/disable toggle */}
                        <Switch
                          checked={v.isEnabled}
                          disabled={togglingId === v.id}
                          onCheckedChange={() => handleToggle(v)}
                          aria-label={v.isEnabled ? `Disable ${v.name}` : `Enable ${v.name}`}
                          className="shrink-0 scale-75"
                        />

                        {/* Name */}
                        <code className="font-mono font-medium min-w-0 flex-1 truncate text-foreground">
                          {v.name}
                        </code>

                        {/* Masked value */}
                        <code className="font-mono text-xs text-muted-foreground flex-shrink-0 w-28 truncate">
                          {v.maskedValue}
                        </code>

                        {/* Secret / public badge */}
                        {v.isSecret
                          ? <Badge variant="secondary" className="text-xs shrink-0">secret</Badge>
                          : <Badge variant="outline" className="text-xs shrink-0">public</Badge>}

                        {/* Delete */}
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
          </TabsContent>
        ))}
      </Tabs>

      {/* ── Add single var ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add / Update Variable
            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${ENV_BADGE_CLASS[activeEnv]}`}>
              {ENV_LABELS[activeEnv]}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="envName" className="text-xs">Name</Label>
              <Input
                id="envName"
                placeholder="DATABASE_URL"
                className="h-9 font-mono text-sm"
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
            <Plus className="h-3.5 w-3.5" /> Save to {ENV_LABELS[activeEnv]}
          </Button>

          <p className="text-xs text-muted-foreground">
            Names must be UPPER_SNAKE_CASE starting with a letter.
            Updating an existing name overwrites the value for that environment.
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
            <span className={`text-xs px-1.5 py-0.5 rounded ${ENV_BADGE_CLASS[activeEnv]}`}>
              {ENV_LABELS[activeEnv]}
            </span>
            {showBulk ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CardHeader>

        {showBulk && (
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste your .env file contents below. Existing vars with the same name will be
              overwritten for the <strong>{ENV_LABELS[activeEnv]}</strong> environment.
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
              <Upload className="h-3.5 w-3.5" /> Import into {ENV_LABELS[activeEnv]}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* ── Security reminder ── */}
      <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> Security reminders
        </p>
        <ul className="text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside">
          <li>Env vars are injected at deploy time — redeploy after changes.</li>
          <li>Only <strong>enabled</strong> vars are injected.
            Disabled vars are stored but skipped.</li>
          <li>This project's DATABASE_URL never inherits the panel's own DB.</li>
          <li>If a secret was accidentally pasted into chat/logs, rotate it immediately.</li>
          <li>
            <span className="font-mono">NODE_ENV</span>,{" "}
            <span className="font-mono">PORT</span> are always set by the platform and
            cannot be overridden here.
          </li>
        </ul>
      </div>

      {/* suppress unused vars warning */}
      {vars.length === 0 && null}
    </div>
  );
}
