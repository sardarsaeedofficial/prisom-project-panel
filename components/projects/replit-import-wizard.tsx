"use client";

/**
 * components/projects/replit-import-wizard.tsx
 *
 * Multi-step wizard for importing a Replit project into Prisom Project Manager.
 *
 * Steps:
 *   1. Project basics (name, source URL/zip)
 *   2. Commands & routing (install, build, start, route mode, static output dir, health path, port)
 *   3. Domain & SSL
 *   4. Env vars (textarea paste of .env file)
 *   5. Summary & confirm
 *
 * This wizard collects config and calls the existing save + deploy actions.
 * Media migration and DB migration are handled separately via DbMigrationPanel.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PackageOpen,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Terminal,
  KeyRound,
  FolderOpen,
  Info,
  AlertTriangle,
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
import {
  saveDeploymentConfigAction,
  deployProjectAction,
} from "@/app/actions/project-deployments";
import { bulkImportEnvVarsAction } from "@/app/actions/project-envvars";

// ── Types ──────────────────────────────────────────────────────────────────

type RouteMode = "fullstack_node" | "static_plus_api" | "static_only" | "api_only";

const ROUTE_MODE_OPTIONS: { value: RouteMode; label: string; hint: string }[] = [
  { value: "fullstack_node",  label: "Fullstack Node",  hint: "All traffic to Node backend" },
  { value: "static_plus_api", label: "Static + API",    hint: "Static frontend + /api proxied" },
  { value: "static_only",     label: "Static Only",     hint: "Pure static, no backend process" },
  { value: "api_only",        label: "API Only",        hint: "Backend API, all traffic proxied" },
];

interface WizardState {
  // Step 1
  sourceUrl:       string;
  // Step 2
  installCommand:  string;
  buildCommand:    string;
  startCommand:    string;
  rootDirectory:   string;
  healthPath:      string;
  nodeEnv:         string;
  routeMode:       RouteMode;
  staticOutputDir: string;
  apiPrefix:       string;
  // Step 3
  domain:          string;
  // Step 4
  envFileContent:  string;
  // Step 5 — notes only
  notes:           string;
}

const DEFAULT_STATE: WizardState = {
  sourceUrl:       "",
  installCommand:  "npm install",
  buildCommand:    "npm run build",
  startCommand:    "npm start",
  rootDirectory:   ".",
  healthPath:      "/",
  nodeEnv:         "production",
  routeMode:       "fullstack_node",
  staticOutputDir: "",
  apiPrefix:       "/api",
  domain:          "",
  envFileContent:  "",
  notes:           "",
};

// ── Input styles ───────────────────────────────────────────────────────────

const INPUT_CLS =
  "h-9 font-mono text-sm bg-background border border-input rounded-md px-3 py-1 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

const SELECT_CLS =
  "h-9 text-sm bg-background border border-input rounded-md px-2 " +
  "focus:outline-none focus:ring-1 focus:ring-ring w-full";

// ── Step labels ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Source",   icon: FolderOpen },
  { id: 2, label: "Commands", icon: Terminal },
  { id: 3, label: "Domain",   icon: Globe },
  { id: 4, label: "Env Vars", icon: KeyRound },
  { id: 5, label: "Deploy",   icon: PackageOpen },
];

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  projectId:   string;
  projectSlug: string;
  projectName: string;
  hasExistingConfig: boolean;
}

export function ReplitImportWizard({
  projectId,
  projectSlug,
  projectName,
  hasExistingConfig,
}: Props) {
  const router = useRouter();
  const [step,    setStep]    = useState(1);
  const [state,   setState]   = useState<WizardState>(DEFAULT_STATE);
  const [error,   setError]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);
  const [logs,    setLogs]    = useState<string[]>([]);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function addLog(msg: string) {
    setLogs((l) => [...l, msg]);
  }

  async function handleFinish() {
    setError("");
    setBusy(true);
    setLogs([]);

    try {
      // 1. Save deployment config
      addLog("Saving deployment config…");
      const saveRes = await saveDeploymentConfigAction(projectId, {
        installCommand:  state.installCommand,
        buildCommand:    state.buildCommand,
        startCommand:    state.startCommand,
        rootDirectory:   state.rootDirectory,
        healthPath:      state.healthPath,
        nodeEnv:         state.nodeEnv,
        routeMode:       state.routeMode,
        staticOutputDir: state.staticOutputDir || undefined,
        apiPrefix:       state.apiPrefix,
      });
      if (!saveRes.ok) throw new Error(`Config save failed: ${saveRes.error}`);
      addLog("✓ Deployment config saved.");

      // 2. Import env vars if provided
      if (state.envFileContent.trim()) {
        addLog("Importing env vars…");
        const envRes = await bulkImportEnvVarsAction(projectId, state.envFileContent);
        if (!envRes.ok) throw new Error(`Env import failed: ${envRes.error}`);
        addLog(`✓ Imported ${envRes.imported} env var(s)${envRes.skipped ? `, skipped ${envRes.skipped}` : ""}.`);
      }

      // 3. Run deployment
      addLog("Starting deployment (install → build → PM2 start)…");
      const deployRes = await deployProjectAction(projectId);
      if (!deployRes.ok) throw new Error(`Deploy failed: ${deployRes.error}`);
      addLog(`✓ Deploy succeeded. Deployment ref: ${deployRes.deploymentRef ?? "n/a"}`);
      if (deployRes.publicStaticPath) {
        addLog(`✓ Static site published at: ${deployRes.publicStaticPath}`);
      }

      setDone(true);
      setTimeout(() => router.refresh(), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="border-green-200 dark:border-green-800">
        <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div>
            <p className="text-lg font-semibold">Import complete!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your project is running. Check the{" "}
              <span className="font-medium text-foreground">Publishing</span> tab for
              deployment status and the{" "}
              <span className="font-medium text-foreground">Domains</span> tab to publish
              a live URL.
            </p>
          </div>
          <Button onClick={() => router.push(`/projects/${projectId}/publishing`)}>
            View Deployment →
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Step indicator ── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isDone   = step > s.id;
          return (
            <div key={s.id} className="flex items-center gap-1">
              <div
                className={[
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                  isActive ? "bg-primary text-primary-foreground" :
                  isDone   ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" :
                             "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {isDone
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <Icon className="h-3.5 w-3.5" />}
                {s.label}
              </div>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Step content ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">
            {step === 1 && "Step 1 — Source"}
            {step === 2 && "Step 2 — Build & Runtime Config"}
            {step === 3 && "Step 3 — Domain"}
            {step === 4 && "Step 4 — Environment Variables"}
            {step === 5 && "Step 5 — Review & Deploy"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Tell us about the Replit project you're importing."}
            {step === 2 && "How to install, build, and run this project on the VPS."}
            {step === 3 && "Optionally set a domain now — you can also do this later."}
            {step === 4 && "Paste your .env file. Secrets are encrypted before storage."}
            {step === 5 && "Review your settings and kick off the import."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* ── Step 1: Source ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Project</Label>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm font-medium">
                  {projectName}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sourceUrl" className="text-sm">
                  Replit Source URL{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="sourceUrl"
                  className={INPUT_CLS}
                  placeholder="https://replit.com/@username/project-name"
                  value={state.sourceUrl}
                  onChange={(e) => update("sourceUrl", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  For reference only. The actual code should already be in this project&apos;s
                  source (uploaded zip or GitHub).
                </p>
              </div>

              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-3 text-xs space-y-1.5 text-amber-700 dark:text-amber-400">
                <p className="font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Before continuing:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Upload your Replit project zip in the <strong>Files</strong> tab, or connect via <strong>GitHub</strong>.</li>
                  <li>Database migration is done separately via the <strong>DB Migration</strong> panel below.</li>
                  <li>Never paste raw secrets into chat or this source URL field.</li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Step 2: Commands ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-install" className="text-sm">
                    Install Command
                  </Label>
                  <Input
                    id="wiz-install"
                    className={INPUT_CLS}
                    placeholder="npm install"
                    value={state.installCommand}
                    onChange={(e) => update("installCommand", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-build" className="text-sm">
                    Build Command{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="wiz-build"
                    className={INPUT_CLS}
                    placeholder="npm run build"
                    value={state.buildCommand}
                    onChange={(e) => update("buildCommand", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-start" className="text-sm">
                    Start Command <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="wiz-start"
                    className={INPUT_CLS}
                    placeholder="npm start"
                    value={state.startCommand}
                    onChange={(e) => update("startCommand", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-root" className="text-sm">Root Directory</Label>
                  <Input
                    id="wiz-root"
                    className={INPUT_CLS}
                    placeholder="."
                    value={state.rootDirectory}
                    onChange={(e) => update("rootDirectory", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-health" className="text-sm">Health Check Path</Label>
                  <Input
                    id="wiz-health"
                    className={INPUT_CLS}
                    placeholder="/"
                    value={state.healthPath}
                    onChange={(e) => update("healthPath", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-routemode" className="text-sm">Route Mode</Label>
                <select
                  id="wiz-routemode"
                  className={SELECT_CLS}
                  value={state.routeMode}
                  onChange={(e) => update("routeMode", e.target.value as RouteMode)}
                >
                  {ROUTE_MODE_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </select>
              </div>

              {(state.routeMode === "static_plus_api" || state.routeMode === "static_only") && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-static" className="text-sm">Static Output Dir</Label>
                    <Input
                      id="wiz-static"
                      className={INPUT_CLS}
                      placeholder="dist"
                      value={state.staticOutputDir}
                      onChange={(e) => update("staticOutputDir", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">e.g. dist, build, .next/static</p>
                  </div>
                  {state.routeMode === "static_plus_api" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="wiz-api" className="text-sm">API Prefix</Label>
                      <Input
                        id="wiz-api"
                        className={INPUT_CLS}
                        placeholder="/api"
                        value={state.apiPrefix}
                        onChange={(e) => update("apiPrefix", e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor="wiz-nodeenv" className="text-sm">NODE_ENV</Label>
                <select
                  id="wiz-nodeenv"
                  className={SELECT_CLS}
                  value={state.nodeEnv}
                  onChange={(e) => update("nodeEnv", e.target.value)}
                >
                  <option value="production">production</option>
                  <option value="development">development</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Step 3: Domain ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wiz-domain" className="text-sm">
                  Domain{" "}
                  <span className="text-muted-foreground font-normal">(optional — can add after deploy)</span>
                </Label>
                <Input
                  id="wiz-domain"
                  className={INPUT_CLS}
                  placeholder={`${projectSlug}.doorstepmanchester.uk`}
                  value={state.domain}
                  onChange={(e) => update("domain", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to skip. You can publish a domain later from the{" "}
                  <strong>Domains</strong> tab.
                </p>
              </div>

              <div className="rounded-md bg-muted/40 px-3 py-3 text-xs space-y-1.5 text-muted-foreground">
                <p className="font-medium text-foreground/80 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5" />
                  Domain setup notes
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>
                    The suggested sub-domain{" "}
                    <code className="font-mono">{projectSlug}.doorstepmanchester.uk</code>{" "}
                    is auto-available on this VPS.
                  </li>
                  <li>
                    For a custom domain, point its A record to{" "}
                    <code className="font-mono">178.105.105.59</code> first.
                  </li>
                  <li>SSL via Certbot is issued automatically after nginx publish.</li>
                  <li>
                    If you use Stripe, update the webhook URL after the domain is live.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Step 4: Env vars ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Security warning
                </p>
                <p>
                  Do not paste this .env content into chat or any other tool.
                  This form sends it directly to the server — it is encrypted before storage
                  and never logged.
                </p>
                <p>
                  <strong>DATABASE_URL</strong> must point to this project&apos;s own database —
                  never reuse the Prisom panel&apos;s DATABASE_URL.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Paste .env file contents</Label>
                <textarea
                  className="w-full font-mono text-xs bg-zinc-950 text-zinc-200 rounded-md p-3 h-52 resize-none border border-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  placeholder={"DATABASE_URL=postgres://user:pass@host/db\nSTRIPE_SECRET_KEY=sk_live_...\nSESSION_SECRET=...\n# Comments are ignored"}
                  value={state.envFileContent}
                  onChange={(e) => update("envFileContent", e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Optional — you can also add vars individually later via the{" "}
                  <strong>Env Vars</strong> tab. Existing vars with the same name will be
                  overwritten.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 5: Review ── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-md border divide-y text-sm">
                {[
                  ["Install",       state.installCommand  || "(none)"],
                  ["Build",         state.buildCommand    || "(none)"],
                  ["Start",         state.startCommand],
                  ["Root dir",      state.rootDirectory],
                  ["Health path",   state.healthPath],
                  ["NODE_ENV",      state.nodeEnv],
                  ["Route mode",    state.routeMode],
                  ...(state.staticOutputDir
                    ? [["Static dir", state.staticOutputDir] as [string, string]]
                    : []),
                  ...(state.domain
                    ? [["Domain", state.domain] as [string, string]]
                    : []),
                  ["Env vars",      state.envFileContent.trim()
                    ? `${state.envFileContent.trim().split("\n").filter((l) => l.trim() && !l.startsWith("#")).length} line(s) to import`
                    : "(none)"],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 px-3 py-2">
                    <span className="text-muted-foreground w-28 shrink-0">{label}</span>
                    <code className="font-mono text-xs truncate">{value}</code>
                  </div>
                ))}
              </div>

              {hasExistingConfig && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p>
                    This project already has a deployment config. The wizard will update it
                    (port and PM2 name remain the same) and trigger a fresh deploy.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="wiz-notes" className="text-sm">
                  Notes{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="wiz-notes"
                  className={INPUT_CLS}
                  placeholder="e.g. imported from Replit on 2025-06-16"
                  value={state.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </div>

              {/* Logs */}
              {logs.length > 0 && (
                <div className="rounded-md bg-zinc-950 text-zinc-200 px-3 py-3 font-mono text-xs space-y-0.5 max-h-40 overflow-auto">
                  {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Nav buttons ── */}
          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="outline"
              onClick={() => { setStep((s) => s - 1); setError(""); }}
              disabled={step === 1 || busy}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>

            {step < STEPS.length ? (
              <Button
                onClick={() => { setStep((s) => s + 1); setError(""); }}
                disabled={step === 2 && !state.startCommand.trim()}
                className="gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={busy || !state.startCommand.trim()}
                className="gap-2"
              >
                {busy ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
                ) : (
                  <><PackageOpen className="h-4 w-4" /> Import & Deploy</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
