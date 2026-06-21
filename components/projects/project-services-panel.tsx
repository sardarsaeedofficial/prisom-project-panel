"use client";

/**
 * components/projects/project-services-panel.tsx
 *
 * Sprint 23: Multi-service deployment UI panel.
 *
 * Renders either:
 *  - "No services" state (first-time setup with presets)
 *  - Service cards with status, build config, actions
 *  - Deploy all / restart / stop controls
 *
 * Backward-compatible: if a project uses single-service mode (no services),
 * this panel simply shows the "add services" setup flow.
 */

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
} from "react";
import {
  Server,
  Globe,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Play,
  Square,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Settings,
  Zap,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  Activity,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import {
  PermissionGate,
  PermissionTooltip,
  useHasPermission,
} from "@/components/projects/permission-gate";
import {
  listProjectServicesAction,
  createProjectServiceAction,
  updateProjectServiceAction,
  toggleProjectServiceAction,
  deleteProjectServiceAction,
  deployAllServicesAction,
  getServiceStatusAction,
  type ServiceDTO,
  type CreateServiceInput,
} from "@/app/actions/project-services";
import {
  getServicePresets,
  type ServicePreset,
} from "@/lib/projects/service-presets";
import type { ProjectRole } from "@/lib/auth/project-permissions";

// ── Helpers ────────────────────────────────────────────────────────────────────

function reltime(iso: string | null | undefined) {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400)return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ── Service type badge ─────────────────────────────────────────────────────────

function ServiceTypeBadge({ type }: { type: string }) {
  if (type === "node")   return <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/20"><Server className="h-3 w-3 mr-1 inline" />Node</Badge>;
  if (type === "static") return <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-purple-50 dark:bg-purple-950/20"><Globe className="h-3 w-3 mr-1 inline" />Static</Badge>;
  return <Badge variant="secondary" className="text-xs">{type}</Badge>;
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary" className="text-xs">Not deployed</Badge>;
  if (status === "success") return <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20"><CheckCircle2 className="h-3 w-3 mr-1 inline" />OK</Badge>;
  if (status === "failed")  return <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1 inline" />Failed</Badge>;
  if (status === "building") return <Badge variant="outline" className="text-xs"><Loader2 className="h-3 w-3 mr-1 inline animate-spin" />Building</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

// ── Service card ───────────────────────────────────────────────────────────────

interface ServiceCardProps {
  service:     ServiceDTO;
  projectId:   string;
  projectSlug: string;
  role:        ProjectRole | null;
  onEdit:      (s: ServiceDTO) => void;
  onDelete:    (s: ServiceDTO) => void;
  onToggled:   () => void;
}

function ServiceCard({ service, projectId, projectSlug, role, onEdit, onDelete, onToggled }: ServiceCardProps) {
  const canDeploy = useHasPermission(role, "deploy.trigger");
  const [expanded,  setExpanded]  = useState(false);
  const [pm2Status, setPm2Status] = useState<string | null>(null);
  const [health,    setHealth]    = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const [checking,  startCheck]   = useTransition();
  const [toggling,  startToggle]  = useTransition();

  function runHealthCheck() {
    startCheck(async () => {
      const res = await getServiceStatusAction(projectId, service.id);
      if (res.ok) {
        setPm2Status(res.data.pm2Status?.status ?? null);
        if (res.data.health) setHealth(res.data.health);
      }
    });
  }

  function handleToggle(enabled: boolean) {
    startToggle(async () => {
      await toggleProjectServiceAction(projectId, service.id, enabled);
      onToggled();
    });
  }

  const pm2Name = `project-${projectSlug}-${service.slug}`;

  return (
    <div className={`rounded-lg border bg-card overflow-hidden ${!service.isEnabled ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setExpanded((v) => !v)} className="flex-1 flex items-center gap-3 text-left min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{service.name}</span>
              <ServiceTypeBadge type={service.serviceType} />
              <StatusBadge status={service.lastStatus} />
              {service.isPrimary && <Badge variant="secondary" className="text-xs">Primary</Badge>}
              {!service.isEnabled && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              {service.serviceType === "node" && service.internalPort && (
                <span>port {service.internalPort}</span>
              )}
              {service.workingDir !== "." && <span className="font-mono truncate max-w-[160px]">{service.workingDir}</span>}
              {service.lastDeployedAt && <span>deployed {reltime(service.lastDeployedAt)}</span>}
            </div>
          </div>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {service.serviceType === "node" && service.internalPort && service.healthPath && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={runHealthCheck} disabled={checking}>
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              <span className="sr-only">Health check</span>
            </Button>
          )}
          {canDeploy && (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEdit(service)}>
                <Settings className="h-3.5 w-3.5" />
                <span className="sr-only">Edit</span>
              </Button>
              <Switch
                checked={service.isEnabled}
                onCheckedChange={handleToggle}
                disabled={toggling}
                className="scale-75"
              />
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(service)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Delete</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-2.5 bg-muted/20 text-sm">
          {/* PM2 / health status */}
          {(pm2Status || health) && (
            <div className="flex items-center gap-3 text-xs">
              {pm2Status && (
                <span className={`flex items-center gap-1 ${pm2Status === "online" ? "text-emerald-600" : "text-red-500"}`}>
                  <Activity className="h-3 w-3" />
                  PM2: {pm2Status}
                </span>
              )}
              {health && (
                <span className={`flex items-center gap-1 ${health.ok ? "text-emerald-600" : "text-red-500"}`}>
                  {health.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  Health: {health.ok ? `OK (${health.latencyMs}ms)` : "FAIL"}
                </span>
              )}
            </div>
          )}

          <ConfigRow label="PM2 name"    value={service.serviceType === "node" ? pm2Name : "N/A (static)"} mono />
          {service.installCommand  && <ConfigRow label="Install"      value={service.installCommand} mono />}
          {service.buildCommand    && <ConfigRow label="Build"        value={service.buildCommand}   mono />}
          {service.startCommand    && <ConfigRow label="Start"        value={service.startCommand}   mono />}
          {service.staticOutputDir && <ConfigRow label="Static output" value={service.staticOutputDir} mono />}
          {service.healthPath      && <ConfigRow label="Health path"  value={`port ${service.internalPort} ${service.healthPath}`} mono />}
          {service.workingDir && service.workingDir !== "." && <ConfigRow label="Working dir" value={service.workingDir} mono />}
          {service.spaFallback     && <ConfigRow label="SPA fallback" value="Enabled" />}
          {service.requiredEnvKeys.length > 0 && (
            <ConfigRow label="Required env" value={service.requiredEnvKeys.join(", ")} mono />
          )}
          {service.lastError && (
            <div className="rounded border border-red-200 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-700 dark:text-red-400 font-mono">
              Last error: {service.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-muted-foreground w-28 shrink-0 mt-0.5">{label}</span>
      <span className={`text-xs break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// ── Service editor modal ───────────────────────────────────────────────────────

interface ServiceEditorModalProps {
  projectId:    string;
  initial?:     ServiceDTO | null;
  onClose:      () => void;
  onSaved:      () => void;
}

function ServiceEditorModal({ projectId, initial, onClose, onSaved }: ServiceEditorModalProps) {
  const isEdit = !!initial;
  const [name,        setName]        = useState(initial?.name ?? "");
  const [slug,        setSlug]        = useState(initial?.slug ?? "");
  const [svcType,     setSvcType]     = useState(initial?.serviceType ?? "node");
  const [workingDir,  setWorkingDir]  = useState(initial?.workingDir ?? ".");
  const [pkgMgr,      setPkgMgr]      = useState(initial?.packageManager ?? "");
  const [installCmd,  setInstallCmd]  = useState(initial?.installCommand ?? "");
  const [buildCmd,    setBuildCmd]    = useState(initial?.buildCommand ?? "");
  const [startCmd,    setStartCmd]    = useState(initial?.startCommand ?? "");
  const [port,        setPort]        = useState(initial?.internalPort ? String(initial.internalPort) : "");
  const [healthPath,  setHealthPath]  = useState(initial?.healthPath ?? "");
  const [staticDir,   setStaticDir]   = useState(initial?.staticOutputDir ?? "");
  const [spaFallback, setSpaFallback] = useState(initial?.spaFallback ?? true);
  const [isPrimary,   setIsPrimary]   = useState(initial?.isPrimary ?? false);
  const [error,       setError]       = useState<string | null>(null);
  const [pending, startTransition]    = useTransition();

  // Auto-slug from name
  useEffect(() => {
    if (!isEdit && name && !slug) {
      setSlug(name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 30));
    }
  }, [name, isEdit, slug]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload: CreateServiceInput = {
        projectId,
        name, slug, serviceType: svcType,
        workingDir:      workingDir || ".",
        packageManager:  pkgMgr || undefined,
        installCommand:  installCmd || undefined,
        buildCommand:    buildCmd   || undefined,
        startCommand:    startCmd   || undefined,
        internalPort:    port ? parseInt(port, 10) : undefined,
        healthPath:      healthPath || undefined,
        staticOutputDir: staticDir  || undefined,
        spaFallback,
        isPrimary,
      };
      let res;
      if (isEdit) {
        res = await updateProjectServiceAction({ ...payload, serviceId: initial.id });
      } else {
        res = await createProjectServiceAction(payload);
      }
      if (!res.ok) { setError(res.error); return; }
      onSaved();
      onClose();
    });
  }

  return (
    <ModalOverlay onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ModalHeader icon={<Server className="h-5 w-5" />} title={isEdit ? `Edit "${initial.name}"` : "Add service"} onClose={onClose} />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Service name</Label>
            <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="API Server" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-slug">Slug</Label>
            <Input id="svc-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="api" className="font-mono" required disabled={isEdit} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Service type</Label>
          <div className="flex gap-2">
            {(["node", "static"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSvcType(t)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${svcType === t ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50"}`}
              >
                {t === "node"   ? <Server className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                {t === "node"   ? "Node.js" : "Static"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="svc-workdir">Working directory</Label>
            <Input id="svc-workdir" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder="." className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-pkgmgr">Package manager</Label>
            <select
              id="svc-pkgmgr"
              value={pkgMgr}
              onChange={(e) => setPkgMgr(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Auto-detect</option>
              <option value="pnpm">pnpm</option>
              <option value="npm">npm</option>
              <option value="yarn">yarn</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="svc-install">Install command <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Input id="svc-install" value={installCmd} onChange={(e) => setInstallCmd(e.target.value)} placeholder="pnpm install --frozen-lockfile" className="font-mono text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="svc-build">Build command <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Input id="svc-build" value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} placeholder="pnpm --filter @workspace/api-server run build" className="font-mono text-xs" />
        </div>

        {svcType === "node" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="svc-start">Start command</Label>
              <Input id="svc-start" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="node --enable-source-maps dist/index.mjs" className="font-mono text-xs" required={svcType === "node"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-port">Internal port <span className="text-muted-foreground text-xs">(4100–4999)</span></Label>
                <Input id="svc-port" type="number" min={4100} max={4999} value={port} onChange={(e) => setPort(e.target.value)} placeholder="Auto-assigned" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-health">Health path</Label>
                <Input id="svc-health" value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/api/healthz" className="font-mono" />
              </div>
            </div>
          </>
        )}

        {svcType === "static" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="svc-staticdir">Static output directory</Label>
              <Input id="svc-staticdir" value={staticDir} onChange={(e) => setStaticDir(e.target.value)} placeholder="dist/public" className="font-mono" required={svcType === "static"} />
              <p className="text-xs text-muted-foreground">Relative path from release root where the build outputs static files.</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="svc-spa" checked={spaFallback} onCheckedChange={setSpaFallback} />
              <Label htmlFor="svc-spa" className="cursor-pointer">
                SPA fallback
                <span className="ml-1.5 text-xs text-muted-foreground">(serve index.html for all unmatched routes)</span>
              </Label>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Switch id="svc-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
          <Label htmlFor="svc-primary" className="cursor-pointer">
            Primary service
            <span className="ml-1.5 text-xs text-muted-foreground">(used for nginx / default routing)</span>
          </Label>
        </div>

        {error && <ErrorBanner error={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add service"}
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ── Preset picker modal ────────────────────────────────────────────────────────

interface PresetModalProps {
  projectId: string;
  onClose:   () => void;
  onApplied: () => void;
}

function PresetModal({ projectId, onClose, onApplied }: PresetModalProps) {
  const presets = getServicePresets();
  const [selected,  setSelected]  = useState<ServicePreset | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleApply() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      for (const svc of selected.services) {
        const res = await createProjectServiceAction({ ...svc, projectId });
        if (!res.ok) { setError(`Failed to create service "${svc.name}": ${res.error}`); return; }
      }
      onApplied();
      onClose();
    });
  }

  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalHeader icon={<Zap className="h-5 w-5" />} title="Choose a preset" onClose={onClose} />
      <p className="text-sm text-muted-foreground">Select a deployment preset to automatically create the right services for your project type.</p>

      <div className="space-y-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(selected?.id === p.id ? null : p)}
            className={`w-full text-left rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50 ${selected?.id === p.id ? "border-primary bg-primary/5" : ""}`}
          >
            <p className="font-medium text-sm">{p.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {p.services.map((s) => (
                <ServiceTypeBadge key={s.slug} type={s.serviceType} />
              ))}
            </div>
          </button>
        ))}
      </div>

      {error && <ErrorBanner error={error} />}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button onClick={handleApply} disabled={pending || !selected}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Apply preset
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Delete confirm modal ───────────────────────────────────────────────────────

interface DeleteModalProps {
  projectId: string;
  service:   ServiceDTO;
  onClose:   () => void;
  onDeleted: () => void;
}

function DeleteModal({ projectId, service, onClose, onDeleted }: DeleteModalProps) {
  const [error, setError]         = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader icon={<Trash2 className="h-5 w-5 text-destructive" />} title="Delete service" onClose={onClose} />
      <p className="text-sm text-muted-foreground">
        Delete service <span className="font-mono font-medium text-foreground">{service.name}</span>?
        This removes the service config from Prisom but does <strong>not</strong> stop any running PM2 process.
      </p>
      {error && <ErrorBanner error={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant="destructive" onClick={() => {
          startTransition(async () => {
            const res = await deleteProjectServiceAction(projectId, service.id);
            if (!res.ok) { setError(res.error); return; }
            onDeleted(); onClose();
          });
        }} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Delete service
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Deploy output modal ────────────────────────────────────────────────────────

interface DeployOutputModalProps {
  output:   string;
  services: Array<{ slug: string; ok: boolean; error?: string }>;
  ok:       boolean;
  ref_:     string;
  onClose:  () => void;
}

function DeployOutputModal({ output, services, ok, ref_, onClose }: DeployOutputModalProps) {
  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalHeader
        icon={ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
        title={ok ? "Deploy completed" : "Deploy finished with errors"}
        onClose={onClose}
      />
      <div className="text-xs text-muted-foreground font-mono">Ref: {ref_}</div>
      <div className="space-y-1">
        {services.map((s) => (
          <div key={s.slug} className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${s.ok ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-red-50 dark:bg-red-950/20"}`}>
            {s.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
            <span className="font-mono font-medium">{s.slug}</span>
            {s.error && <span className="text-muted-foreground truncate">— {s.error}</span>}
          </div>
        ))}
      </div>
      {!ok && (
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800 px-3 py-2">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          Redeploy to retry. Check the build logs above for details.
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Full build output</summary>
        <pre className="mt-2 rounded border bg-muted px-3 py-2 overflow-x-auto whitespace-pre-wrap text-xs max-h-80 font-mono">{output}</pre>
      </details>
      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </ModalOverlay>
  );
}

// ── Shared modal primitives ────────────────────────────────────────────────────

function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-background rounded-xl border shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
        role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-semibold">{icon}{title}</div>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
        <X className="h-4 w-4" /><span className="sr-only">Close</span>
      </Button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface ProjectServicesPanelProps {
  projectId: string;
}

export function ProjectServicesPanel({ projectId }: ProjectServicesPanelProps) {
  const [services,     setServices]     = useState<ServiceDTO[]>([]);
  const [projectSlug,  setProjectSlug]  = useState<string>("");
  const [role,         setRole]         = useState<ProjectRole | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null);
  const [addModal,     setAddModal]     = useState(false);
  const [presetModal,  setPresetModal]  = useState(false);
  const [editTarget,   setEditTarget]   = useState<ServiceDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [deployOutput, setDeployOutput] = useState<{
    output: string; services: Array<{ slug: string; ok: boolean; error?: string }>; ok: boolean; ref_: string;
  } | null>(null);
  const [deploying, startDeploy] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  const canDeploy = useHasPermission(role, "deploy.trigger");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listProjectServicesAction(projectId);
    if (!res.ok) { setError(res.error); setLoading(false); return; }
    setServices(res.data.services);
    setProjectSlug(res.data.projectSlug);
    setRole(res.data.role);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function refresh() { startRefresh(async () => { await load(); }); }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  }

  function handleDeploy() {
    startDeploy(async () => {
      const res = await deployAllServicesAction(projectId);
      if (!res.ok) { setError(res.error); return; }
      refresh();
      setDeployOutput({ output: res.data.output, services: res.data.services, ok: res.data.ok, ref_: res.data.deploymentRef });
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Services ({services.length})
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing || loading}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          {canDeploy ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setPresetModal(true)}>
                <Zap className="mr-2 h-4 w-4" />Presets
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddModal(true)}>
                <Plus className="mr-2 h-4 w-4" />Add service
              </Button>
              <Button size="sm" onClick={handleDeploy} disabled={deploying || services.filter((s) => s.isEnabled).length === 0}>
                {deploying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Deploy all
              </Button>
            </>
          ) : (
            <PermissionTooltip permission="deploy.trigger">
              <Button size="sm" disabled><Play className="mr-2 h-4 w-4" />Deploy all</Button>
            </PermissionTooltip>
          )}
        </div>
      </div>

      {/* Banners */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />{successMsg}
        </div>
      )}
      {error && <ErrorBanner error={error} />}
      {loading && <LoadingState label="Loading services…" />}

      {!loading && !error && services.length === 0 && (
        <div className="rounded-lg border bg-card py-12">
          <EmptyState
            icon={Layers}
            title="No services configured"
            description="Add services to enable multi-service deployments. Use a preset for common project types like React+Express, Next.js, or static sites."
            actionSlot={
              canDeploy ? (
                <div className="flex gap-2 justify-center">
                  <Button size="sm" variant="outline" onClick={() => setPresetModal(true)}>
                    <Zap className="mr-2 h-4 w-4" />Use preset
                  </Button>
                  <Button size="sm" onClick={() => setAddModal(true)}>
                    <Plus className="mr-2 h-4 w-4" />Add service
                  </Button>
                </div>
              ) : undefined
            }
          />
        </div>
      )}

      {!loading && services.length > 0 && (
        <div className="space-y-2">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              projectId={projectId}
              projectSlug={projectSlug}
              role={role}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              onToggled={() => { refresh(); }}
            />
          ))}

          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Multi-service deploys build all enabled services, then update nginx routing.
            Existing single-service projects are unaffected.
          </p>
        </div>
      )}

      {/* Modals */}
      {addModal    && <ServiceEditorModal projectId={projectId} onClose={() => setAddModal(false)} onSaved={() => { refresh(); showSuccess("Service added."); }} />}
      {editTarget  && <ServiceEditorModal projectId={projectId} initial={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { refresh(); showSuccess("Service updated."); }} />}
      {deleteTarget && <DeleteModal projectId={projectId} service={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { refresh(); showSuccess(`"${deleteTarget.name}" deleted.`); }} />}
      {presetModal && <PresetModal projectId={projectId} onClose={() => setPresetModal(false)} onApplied={() => { refresh(); showSuccess("Preset applied — services created."); }} />}
      {deployOutput && <DeployOutputModal {...deployOutput} onClose={() => { setDeployOutput(null); refresh(); }} />}
    </div>
  );
}
