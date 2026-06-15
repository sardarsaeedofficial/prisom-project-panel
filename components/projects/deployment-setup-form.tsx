"use client";

/**
 * components/projects/deployment-setup-form.tsx
 *
 * First-time setup AND edit form for a project's PM2 deployment config.
 *
 * When `existingConfig` is supplied the form opens in edit mode:
 *   - Fields are pre-filled with the saved values.
 *   - Port and PM2 name are shown as read-only (they never change after first save).
 *   - Title says "Edit Deployment Config".
 *
 * `onSaved` (optional): called after a successful save instead of router.refresh().
 * The parent component can use this to close the inline edit form.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Rocket,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { saveDeploymentConfigAction } from "@/app/actions/project-deployments";
import { FULL_PATH_PNPM } from "@/lib/projects/deploy-constants";

// ── Preset templates ───────────────────────────────────────────────────────

type Preset = {
  id: string;
  label: string;
  description: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
};

const PRESETS: Preset[] = [
  {
    id: "nextjs-npm",
    label: "Next.js",
    description: "npm install + build + start",
    installCommand: "npm install",
    buildCommand:   "npm run build",
    startCommand:   "npm start",
  },
  {
    id: "nextjs-pnpm",
    label: "Next.js (pnpm)",
    description: "pnpm install + build + start",
    installCommand: `${FULL_PATH_PNPM} install`,
    buildCommand:   `${FULL_PATH_PNPM} run build`,
    startCommand:   `${FULL_PATH_PNPM} start`,
  },
  {
    id: "node-npm",
    label: "Node.js",
    description: "npm install → npm start",
    installCommand: "npm install",
    buildCommand:   "",
    startCommand:   "npm start",
  },
  {
    id: "node-pnpm",
    label: "Node.js (pnpm)",
    description: "pnpm install → pnpm start",
    installCommand: `${FULL_PATH_PNPM} install`,
    buildCommand:   "",
    startCommand:   `${FULL_PATH_PNPM} start`,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Enter commands manually",
    installCommand: "",
    buildCommand:   "",
    startCommand:   "",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function detectPreset(
  install: string | null,
  build: string | null,
  start: string
): string {
  const i = install ?? "";
  const b = build   ?? "";
  for (const p of PRESETS) {
    if (p.id === "custom") continue;
    if (p.installCommand === i && p.buildCommand === b && p.startCommand === start)
      return p.id;
  }
  return "custom";
}

// ── Styles ─────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "h-9 font-mono text-sm bg-background border border-input rounded-md px-3 py-1 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

const SELECT_CLS =
  "h-9 text-sm bg-background border border-input rounded-md px-2 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

// ── Types ──────────────────────────────────────────────────────────────────

export type ExistingDeployConfig = {
  installCommand: string | null;
  buildCommand:   string | null;
  startCommand:   string;
  rootDirectory:  string;
  healthPath:     string;
  nodeEnv:        string;
  port:           number;
  pm2Name:        string;
};

interface Props {
  projectId:      string;
  projectSlug:    string;
  /** If provided, form opens in edit mode pre-filled with these values. */
  existingConfig?: ExistingDeployConfig;
  /** Called after a successful save. If omitted, router.refresh() is used. */
  onSaved?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DeploymentSetupForm({
  projectId,
  projectSlug,
  existingConfig,
  onSaved,
}: Props) {
  const router = useRouter();
  const isEdit = !!existingConfig;

  // Derive initial field values
  const initInstall = existingConfig?.installCommand ?? "npm install";
  const initBuild   = existingConfig?.buildCommand   ?? "npm run build";
  const initStart   = existingConfig?.startCommand   ?? "npm start";
  const initRoot    = existingConfig?.rootDirectory  ?? ".";
  const initHealth  = existingConfig?.healthPath     ?? "/";
  const initEnv     = existingConfig?.nodeEnv        ?? "production";
  const initPreset  = existingConfig
    ? detectPreset(existingConfig.installCommand, existingConfig.buildCommand, existingConfig.startCommand)
    : "nextjs-npm";

  const [activePreset,    setActivePreset]    = useState(initPreset);
  const [installCommand,  setInstallCommand]  = useState(initInstall);
  const [buildCommand,    setBuildCommand]    = useState(initBuild);
  const [startCommand,    setStartCommand]    = useState(initStart);
  const [rootDirectory,   setRootDirectory]   = useState(initRoot);
  const [healthPath,      setHealthPath]      = useState(initHealth);
  const [nodeEnv,         setNodeEnv]         = useState(initEnv);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState("");
  const [saved,           setSaved]           = useState(false);

  function applyPreset(presetId: string) {
    setActivePreset(presetId);
    const p = PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setInstallCommand(p.installCommand);
    setBuildCommand(p.buildCommand);
    setStartCommand(p.startCommand);
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await saveDeploymentConfigAction(projectId, {
        installCommand,
        buildCommand,
        startCommand,
        rootDirectory,
        healthPath,
        nodeEnv,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      // Notify parent or refresh the page
      setTimeout(() => {
        if (onSaved) {
          onSaved();
        } else {
          router.refresh();
        }
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {isEdit ? (
            <Pencil className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Settings className="h-5 w-5 text-muted-foreground" />
          )}
          <CardTitle className="text-base">
            {isEdit ? "Edit Deployment Config" : "Configure Deployment"}
          </CardTitle>
        </div>
        <CardDescription>
          {isEdit
            ? "Update how your project is installed, built, and started. Port and PM2 name are fixed."
            : "Set up how your project is installed, built, and started on the VPS."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Port + PM2 name (read-only, only in edit mode) ── */}
        {isEdit && existingConfig && (
          <div className="flex items-center gap-4 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Port</span>
                <code className="ml-2 font-mono font-medium">{existingConfig.port}</code>
              </div>
              <div>
                <span className="text-muted-foreground">PM2 name</span>
                <code className="ml-2 font-mono font-medium">{existingConfig.pm2Name}</code>
              </div>
            </div>
          </div>
        )}

        {/* ── Preset selector ── */}
        <div>
          <Label className="mb-2 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Template
          </Label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={[
                  "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
                  activePreset === p.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-muted-foreground/50 hover:bg-muted/30",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{p.label}</span>
                <span className="mt-0.5 text-xs text-muted-foreground leading-snug">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Commands ── */}
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="installCommand" className="text-sm">
              Install Command{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="installCommand"
              className={INPUT_CLS}
              placeholder="npm install"
              value={installCommand}
              onChange={(e) => { setInstallCommand(e.target.value); setActivePreset("custom"); }}
            />
            <p className="text-xs text-muted-foreground">
              Runs before build. Leave empty to skip.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="buildCommand" className="text-sm">
              Build Command{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="buildCommand"
              className={INPUT_CLS}
              placeholder="npm run build"
              value={buildCommand}
              onChange={(e) => { setBuildCommand(e.target.value); setActivePreset("custom"); }}
            />
            <p className="text-xs text-muted-foreground">
              Compile / bundle step. Leave empty for apps with no build step.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="startCommand" className="text-sm">
              Start Command <span className="text-red-500">*</span>
            </Label>
            <Input
              id="startCommand"
              className={INPUT_CLS}
              placeholder="npm start"
              value={startCommand}
              onChange={(e) => { setStartCommand(e.target.value); setActivePreset("custom"); }}
            />
            <p className="text-xs text-muted-foreground">
              How PM2 starts your app. Allowed: npm / pnpm / yarn / node / full pnpm path.
            </p>
          </div>
        </div>

        {/* ── Advanced settings ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rootDirectory" className="text-sm">
              Root Directory
            </Label>
            <Input
              id="rootDirectory"
              className={INPUT_CLS}
              placeholder="."
              value={rootDirectory}
              onChange={(e) => setRootDirectory(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Relative to project root.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="healthPath" className="text-sm">
              Health Check Path
            </Label>
            <Input
              id="healthPath"
              className={INPUT_CLS}
              placeholder="/"
              value={healthPath}
              onChange={(e) => setHealthPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Must return a non-5xx response.
            </p>
          </div>
        </div>

        <div className="grid gap-1.5 max-w-xs">
          <Label htmlFor="nodeEnv" className="text-sm">
            NODE_ENV
          </Label>
          <select
            id="nodeEnv"
            className={SELECT_CLS}
            value={nodeEnv}
            onChange={(e) => setNodeEnv(e.target.value)}
          >
            <option value="production">production</option>
            <option value="development">development</option>
          </select>
        </div>

        {/* ── Auto-assigned info (create mode only) ── */}
        {!isEdit && (
          <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Port</span> and{" "}
              <span className="font-medium text-foreground">PM2 name</span> are
              assigned automatically on save:{" "}
              <code className="font-mono">project-{projectSlug}</code> on the
              next available port from 4100.
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* ── Save button ── */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving || saved || !startCommand.trim()}
            className="gap-2"
          >
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {isEdit ? "Saved!" : "Saved — loading…"}
              </>
            ) : saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4" />
                {isEdit ? "Save Changes" : "Save & Continue"}
              </>
            )}
          </Button>
          {!startCommand.trim() && (
            <p className="text-xs text-muted-foreground">Start command is required.</p>
          )}
        </div>

        {/* ── Command allowlist reminder ── */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground/70">Allowed commands:</p>
          <p>
            <code className="font-mono">npm</code> / <code className="font-mono">pnpm</code> /{" "}
            <code className="font-mono">yarn</code> — install, ci, start, run &lt;script&gt;
          </p>
          <p>
            <code className="font-mono">node &lt;file.js&gt;</code> — relative path, no extra args
          </p>
          <p>
            <code className="font-mono">{FULL_PATH_PNPM}</code> — install, start, run build/start/preview
          </p>
          <p className="flex items-center gap-1 mt-1 text-amber-600 dark:text-amber-500">
            <Rocket className="h-3 w-3" />
            Shell operators (;&amp;|&gt;&lt;), sudo, rm, curl, wget are blocked.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
