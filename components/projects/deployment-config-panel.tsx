"use client";

/**
 * components/projects/deployment-config-panel.tsx
 *
 * Sprint 3: Shows the current deployment config and allows editing
 * the configurable fields (runtime, loginPath, primaryDomain, etc.).
 *
 * Port and PM2 process name are shown as read-only — they are frozen
 * after initial creation to avoid breaking the running process.
 *
 * Dangerous-change warning is shown when the user edits fields that
 * only take effect on the next deploy/restart.
 */

import { useState, useTransition } from "react";
import {
  Settings, CheckCircle2, XCircle, AlertCircle, Loader2,
  ChevronDown, ChevronRight, RefreshCw, Lock,
} from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Badge }   from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  updateProjectDeploymentConfigAction,
  validateProjectDeploymentConfigAction,
  type DeploymentConfigData,
} from "@/app/actions/project-deployment-config";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  config:    DeploymentConfigData;
}

// ── Component ─────────────────────────────────────────────────────────────────

const RUNTIME_OPTIONS = [
  { value: "node",    label: "Node.js" },
  { value: "next",    label: "Next.js" },
  { value: "vite",    label: "Vite / SPA" },
  { value: "express", label: "Express.js" },
  { value: "static",  label: "Static files" },
];

export function DeploymentConfigPanel({ projectId, config }: Props) {
  const [isOpen,       setIsOpen]      = useState(false);
  const [runtime,      setRuntime]     = useState(config.runtime);
  const [loginPath,    setLoginPath]   = useState(config.loginPath);
  const [healthPath,   setHealthPath]  = useState(config.healthPath);
  const [primaryDomain, setPrimaryDomain] = useState(config.primaryDomain ?? "");
  const [nodeEnv,      setNodeEnv]    = useState(config.nodeEnv);

  const [saveMsg,  setSaveMsg]  = useState("");
  const [saveErr,  setSaveErr]  = useState("");
  const [validMsg, setValidMsg] = useState("");
  const [validErr, setValidErr] = useState("");

  const [isSaving,    startSave]     = useTransition();
  const [isValidating, startValidate] = useTransition();

  const validStatus = config.validationStatus;

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveMsg("");
    setSaveErr("");
    startSave(async () => {
      const res = await updateProjectDeploymentConfigAction(projectId, {
        runtime,
        loginPath:    loginPath || "/login",
        healthPath:   healthPath || "/",
        primaryDomain: primaryDomain.trim() || null,
        nodeEnv,
      });
      if (res.ok) {
        setSaveMsg(res.message ?? "Saved.");
        setTimeout(() => setSaveMsg(""), 4000);
      } else {
        setSaveErr(res.error);
      }
    });
  }

  async function handleValidate() {
    setValidMsg("");
    setValidErr("");
    startValidate(async () => {
      const res = await validateProjectDeploymentConfigAction(projectId);
      if (res.ok) {
        setValidMsg(res.data?.message ?? "Configuration is valid.");
        if (res.data?.warnings?.length) {
          setValidMsg(`Valid (${res.data.warnings.length} warning${res.data.warnings.length > 1 ? "s" : ""})`);
        }
      } else {
        setValidErr(res.error);
      }
    });
  }

  // ── Validation status badge ────────────────────────────────────────────────

  function ValidationBadge() {
    if (!validStatus) return <Badge variant="secondary">Not validated</Badge>;
    if (validStatus === "valid")   return <Badge variant="success">Valid</Badge>;
    if (validStatus === "invalid") return <Badge variant="error">Invalid</Badge>;
    return <Badge variant="secondary">Unchecked</Badge>;
  }

  // ── Read-only row ──────────────────────────────────────────────────────────

  function ReadOnlyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
      <div className="flex items-center gap-3 py-2 text-sm">
        <span className="text-muted-foreground w-40 shrink-0 text-xs">{label}</span>
        <span className={`${mono ? "font-mono text-xs" : ""} text-foreground`}>{value}</span>
        <span title="Frozen — contact support to change">
          <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        </span>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Deployment Config</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <ValidationBadge />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={() => setIsOpen((v) => !v)}
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {isOpen ? "Collapse" : "View / Edit"}
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          Runtime settings used for PM2 deployment. Port and PM2 name are frozen after creation.
        </CardDescription>
      </CardHeader>

      {isOpen && (
        <CardContent className="space-y-5">

          {/* ── Read-only frozen fields ── */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Read-only</p>
            <div className="rounded-md border divide-y px-3">
              <ReadOnlyRow label="Port"            value={String(config.port)}    mono />
              <ReadOnlyRow label="PM2 process"     value={config.pm2Name}         mono />
              <ReadOnlyRow label="Internal URL"    value={`http://127.0.0.1:${config.port}`} mono />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Changing port or PM2 name requires re-deploying. Contact the platform administrator.
            </p>
          </div>

          {/* ── Editable fields ── */}
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Editable</p>

            {/* Runtime */}
            <div className="space-y-1">
              <Label htmlFor="runtime" className="text-xs">Runtime</Label>
              <select
                id="runtime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {RUNTIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Health path */}
            <div className="space-y-1">
              <Label htmlFor="healthPath" className="text-xs">Health check path</Label>
              <Input
                id="healthPath"
                value={healthPath}
                onChange={(e) => setHealthPath(e.target.value)}
                placeholder="/api/healthz"
                className="h-9 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Used by the readiness checker. Must start with /</p>
            </div>

            {/* Login path */}
            <div className="space-y-1">
              <Label htmlFor="loginPath" className="text-xs">Login route path</Label>
              <Input
                id="loginPath"
                value={loginPath}
                onChange={(e) => setLoginPath(e.target.value)}
                placeholder="/login"
                className="h-9 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Checked by the readiness smoke test. Must start with /</p>
            </div>

            {/* Primary domain */}
            <div className="space-y-1">
              <Label htmlFor="primaryDomain" className="text-xs">Primary public domain (optional override)</Label>
              <Input
                id="primaryDomain"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="your-project.doorstepmanchester.uk"
                className="h-9 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Used as fallback if no active domain record exists. Leave blank to rely on domain records only.
                Reserved hostnames are rejected.
              </p>
            </div>

            {/* Node env */}
            <div className="space-y-1">
              <Label htmlFor="nodeEnv" className="text-xs">NODE_ENV</Label>
              <select
                id="nodeEnv"
                value={nodeEnv}
                onChange={(e) => setNodeEnv(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </select>
            </div>
          </div>

          {/* ── Status messages ── */}
          {saveErr && (
            <p className="text-xs text-red-600 flex items-start gap-1">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {saveErr}
            </p>
          )}
          {saveMsg && (
            <p className="text-xs text-green-600 flex items-start gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {saveMsg}
            </p>
          )}
          {validErr && (
            <p className="text-xs text-red-600 flex items-start gap-1">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Validation: {validErr}
            </p>
          )}
          {validMsg && (
            <p className="text-xs text-green-600 flex items-start gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Validation: {validMsg}
            </p>
          )}

          {/* ── Warning ── */}
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Changes to health path, login path, and NODE_ENV take effect on the <strong>next deploy or restart</strong>.
              The running process is not modified until then.
            </span>
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save config
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleValidate}
              disabled={isValidating}
              className="gap-2"
            >
              {isValidating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Validate
            </Button>
          </div>

          {/* ── Last validation time ── */}
          {config.lastValidatedAt && (
            <p className="text-xs text-muted-foreground">
              Last validated:{" "}
              {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" })
                .format(new Date(config.lastValidatedAt))}
            </p>
          )}
          {config.validationError && (
            <p className="text-xs text-red-600 font-mono break-words">
              Last error: {config.validationError}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
