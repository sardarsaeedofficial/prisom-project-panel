"use client";

/**
 * components/projects/deployment-setup-form.tsx
 *
 * First-time deployment configuration form for uploaded / blank / GitHub projects.
 * Preset templates auto-fill the command fields; the user can customise any field.
 * Port and PM2 name are assigned by the server on first save.
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
    id: "nextjs",
    label: "Next.js",
    description: "npm install → build → npm start",
    installCommand: "npm install",
    buildCommand: "npm run build",
    startCommand: "npm start",
  },
  {
    id: "node",
    label: "Node.js",
    description: "npm install → npm start (no build step)",
    installCommand: "npm install",
    buildCommand: "",
    startCommand: "npm start",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Enter commands manually",
    installCommand: "",
    buildCommand: "",
    startCommand: "",
  },
];

// ── Styles ─────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "h-9 font-mono text-sm bg-background border border-input rounded-md px-3 py-1 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

const SELECT_CLASS =
  "h-9 text-sm bg-background border border-input rounded-md px-2 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  projectSlug: string;
}

export function DeploymentSetupForm({ projectId, projectSlug }: Props) {
  const router = useRouter();
  const [activePreset, setActivePreset] = useState<string>("nextjs");
  const [installCommand, setInstallCommand] = useState("npm install");
  const [buildCommand, setBuildCommand]     = useState("npm run build");
  const [startCommand, setStartCommand]     = useState("npm start");
  const [rootDirectory, setRootDirectory]   = useState(".");
  const [healthPath, setHealthPath]         = useState("/");
  const [nodeEnv, setNodeEnv]               = useState("production");
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState("");
  const [saved, setSaved]                   = useState(false);

  function applyPreset(presetId: string) {
    setActivePreset(presetId);
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setInstallCommand(preset.installCommand);
    setBuildCommand(preset.buildCommand);
    setStartCommand(preset.startCommand);
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
      // Allow the success state to show briefly, then refresh the page
      setTimeout(() => router.refresh(), 600);
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
          <Settings className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Configure Deployment</CardTitle>
        </div>
        <CardDescription>
          Set up how your project is installed, built, and started on the VPS.
          Port and PM2 process name are assigned automatically.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Preset selector ── */}
        <div>
          <Label className="mb-2 block text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Template
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={[
                  "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
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
              className={INPUT_CLASS}
              placeholder="npm install"
              value={installCommand}
              onChange={(e) => setInstallCommand(e.target.value)}
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
              className={INPUT_CLASS}
              placeholder="npm run build"
              value={buildCommand}
              onChange={(e) => setBuildCommand(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Compile / bundle step. Leave empty for apps that don&apos;t need a build.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="startCommand" className="text-sm">
              Start Command <span className="text-red-500">*</span>
            </Label>
            <Input
              id="startCommand"
              className={INPUT_CLASS}
              placeholder="npm start"
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              How PM2 starts your app. Allowed: npm / pnpm / yarn / node.
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
              className={INPUT_CLASS}
              placeholder="."
              value={rootDirectory}
              onChange={(e) => setRootDirectory(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Relative to your project root.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="healthPath" className="text-sm">
              Health Check Path
            </Label>
            <Input
              id="healthPath"
              className={INPUT_CLASS}
              placeholder="/"
              value={healthPath}
              onChange={(e) => setHealthPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Must return a non-5xx status.
            </p>
          </div>
        </div>

        <div className="grid gap-1.5 max-w-xs">
          <Label htmlFor="nodeEnv" className="text-sm">
            NODE_ENV
          </Label>
          <select
            id="nodeEnv"
            className={SELECT_CLASS}
            value={nodeEnv}
            onChange={(e) => setNodeEnv(e.target.value)}
          >
            <option value="production">production</option>
            <option value="development">development</option>
          </select>
        </div>

        {/* ── Auto-assigned info ── */}
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Port</span> and{" "}
            <span className="font-medium text-foreground">PM2 name</span> are
            assigned automatically when you save:{" "}
            <code className="font-mono">project-{projectSlug}</code> on the
            next available port starting from 4100.
          </p>
        </div>

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
                Saved — loading deploy panel…
              </>
            ) : saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4" />
                Save &amp; Continue
              </>
            )}
          </Button>
          {!startCommand.trim() && (
            <p className="text-xs text-muted-foreground">
              Start command is required.
            </p>
          )}
        </div>

        {/* ── Command allowlist reminder ── */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p className="font-medium text-foreground/70">Allowed commands:</p>
          <p>
            <code className="font-mono">npm install</code>,{" "}
            <code className="font-mono">npm ci</code>,{" "}
            <code className="font-mono">npm run &lt;script&gt;</code>,{" "}
            <code className="font-mono">npm start</code>,{" "}
            <code className="font-mono">pnpm …</code>,{" "}
            <code className="font-mono">yarn …</code>,{" "}
            <code className="font-mono">node &lt;file.js&gt;</code>
          </p>
          <p className="flex items-center gap-1 mt-1 text-amber-600 dark:text-amber-500">
            <Rocket className="h-3 w-3" />
            Shell operators, sudo, rm, curl, wget are blocked.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
