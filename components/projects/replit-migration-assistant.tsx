"use client";

/**
 * components/projects/replit-migration-assistant.tsx
 *
 * Sprint 24: Multi-step Replit → Prisom migration assistant wizard.
 *
 * Steps:
 *   1. Analyze (trigger analysis server action)
 *   2. Detection Report (cards for all detected features)
 *   3. Required Fixes (blockers + warnings table)
 *   4. Suggested Services (editable, create rows)
 *   5. Secrets Checklist (required env keys, no values)
 *   6. Database Migration Plan
 *   7. Media Migration Plan
 *   8. Final Readiness Checklist
 *
 * Safety:
 *  - No secret values are shown anywhere
 *  - Service creation goes through validated server actions
 *  - No auto-deploys, no auto-DB-migrations
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardCopy,
  Database,
  FileText,
  Globe,
  Image,
  Info,
  Layers,
  Loader2,
  Mail,
  Package,
  Play,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  XCircle,
  Zap,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  analyzeMigrationAction,
  createServicesFromMigrationAction,
  recordMigrationReportCopiedAction,
  type CreateServicesResult,
} from "@/app/actions/project-migration";
import type {
  ReplitMigrationReport,
  SuggestedProjectService,
  MigrationRisk,
  DetectedSecret,
} from "@/lib/migration/replit-detection-types";

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: "analyze",    label: "Analyze"     },
  { id: "detection",  label: "Detection"   },
  { id: "fixes",      label: "Fix Issues"  },
  { id: "services",   label: "Services"    },
  { id: "secrets",    label: "Secrets"     },
  { id: "database",   label: "Database"    },
  { id: "media",      label: "Media"       },
  { id: "checklist",  label: "Checklist"   },
] as const;

type StepId = (typeof STEPS)[number]["id"];

// ── Helper components ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: MigrationRisk["severity"] }) {
  if (severity === "blocker") return <Badge variant="destructive" className="text-xs">Blocker</Badge>;
  if (severity === "warning") return <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/20">Warning</Badge>;
  return <Badge variant="secondary" className="text-xs">Info</Badge>;
}

function DetectionChip({ label, value, icon }: { label: string; value: string | boolean | null | undefined; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{String(value)}</p>
      </div>
    </div>
  );
}

function SecretRow({ secret }: { secret: DetectedSecret }) {
  const catColors: Record<string, string> = {
    database:         "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400",
    payments:         "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400",
    email:            "border-yellow-200 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400",
    media:            "border-purple-200 bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400",
    auth:             "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400",
    app:              "border-gray-200 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    "replit-specific":"border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-950/20 dark:text-orange-400",
    other:            "border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const colorClass = catColors[secret.category] ?? catColors.other;
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      <code className="font-mono text-sm font-medium min-w-0 flex-1">{secret.name}</code>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${colorClass}`}>
          {secret.category}
        </span>
        {secret.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
        {secret.replitReplacement && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            → {secret.replitReplacement}
          </span>
        )}
      </div>
    </div>
  );
}

function RiskRow({ risk }: { risk: MigrationRisk }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 py-3 px-0 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="mt-0.5 shrink-0">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{risk.title}</span>
            <SeverityBadge severity={risk.severity} />
          </div>
        </div>
      </button>
      {open && (
        <div className="pb-3 pl-7 pr-2 space-y-2">
          <p className="text-sm text-muted-foreground">{risk.details}</p>
          <div className="rounded-md bg-muted/40 border px-3 py-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Suggested Fix</p>
            <p className="text-sm">{risk.suggestedFix}</p>
          </div>
          {risk.filesInvolved.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Files involved:</p>
              <div className="flex flex-wrap gap-1">
                {risk.filesInvolved.map((f) => (
                  <code key={f} className="text-xs bg-muted px-1.5 py-0.5 rounded">{f}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editable service row ──────────────────────────────────────────────────────

function ServiceEditor({
  svc,
  onChange,
}: {
  svc: SuggestedProjectService;
  onChange: (updated: SuggestedProjectService) => void;
}) {
  const [open, setOpen] = useState(true);

  function field(label: string, key: keyof SuggestedProjectService, placeholder?: string) {
    const value = (svc[key] ?? "") as string;
    return (
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...svc, [key]: e.target.value || undefined })}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="font-medium text-sm flex-1">{svc.name}</span>
        <Badge variant={svc.serviceType === "node" ? "outline" : "secondary"} className="text-xs">
          {svc.serviceType === "node" ? "Node" : "Static"}
        </Badge>
        {svc.isPrimary && <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700">Primary</Badge>}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 border-t pt-3">
          {field("Name",             "name")}
          {field("Slug",             "slug",            "e.g. api")}
          {field("Working Dir",      "workingDir",      ".")}
          {field("Package Manager",  "packageManager",  "pnpm")}
          {field("Install Command",  "installCommand",  "pnpm install --frozen-lockfile")}
          {field("Build Command",    "buildCommand",    "pnpm run build")}
          {svc.serviceType === "node" && field("Start Command", "startCommand", "node dist/index.js")}
          {svc.serviceType === "node" && field("Health Path",   "healthPath",   "/api/healthz")}
          {svc.serviceType === "static" && field("Static Output Dir", "staticOutputDir", "dist")}
          {svc.notes && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" /> {svc.notes}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step nav pill ─────────────────────────────────────────────────────────────

function StepNav({ current, onGo, report }: {
  current: StepId;
  onGo: (step: StepId) => void;
  report: ReplitMigrationReport | null;
}) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((step, i) => {
        const done    = report && i < idx;
        const active  = step.id === current;
        const locked  = !report && i > 0;
        return (
          <button
            key={step.id}
            disabled={locked}
            onClick={() => !locked && onGo(step.id)}
            className={[
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
              active  ? "bg-primary text-primary-foreground" :
              done    ? "bg-muted text-foreground hover:bg-muted/80" :
              locked  ? "text-muted-foreground cursor-not-allowed" :
                        "text-muted-foreground hover:text-foreground hover:bg-muted",
            ].join(" ")}
          >
            {done ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <span className="h-3 w-3 flex items-center justify-center text-[10px]">{i + 1}</span>}
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReplitMigrationAssistantProps {
  projectId: string;
}

export function ReplitMigrationAssistant({ projectId }: ReplitMigrationAssistantProps) {
  const [step,      setStep]      = useState<StepId>("analyze");
  const [report,    setReport]    = useState<ReplitMigrationReport | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [creating,  startCreate]  = useTransition();
  const [createResult, setCreateResult] = useState<CreateServicesResult | null>(null);
  const [copied,    setCopied]    = useState(false);

  // Editable services (user can tweak before creating)
  const [editableServices, setEditableServices] = useState<SuggestedProjectService[]>([]);

  // Final checklist state
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // ── Actions ────────────────────────────────────────────────────────────────

  function runAnalysis() {
    setError(null);
    startAnalyze(async () => {
      const result = await analyzeMigrationAction(projectId);
      if (result.ok) {
        setReport(result.data);
        setEditableServices(result.data.suggestedServices.map((s) => ({ ...s })));
        setStep("detection");
      } else {
        setError(result.error);
      }
    });
  }

  function handleServiceChange(idx: number, updated: SuggestedProjectService) {
    setEditableServices((prev) => prev.map((s, i) => (i === idx ? updated : s)));
  }

  function createServices() {
    startCreate(async () => {
      const res = await createServicesFromMigrationAction({ projectId, services: editableServices });
      if (res.ok) {
        setCreateResult(res.data);
      } else {
        setError(res.error);
      }
    });
  }

  function copyReport() {
    if (!report) return;
    const text = buildReportText(report);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      void recordMigrationReportCopiedAction(projectId);
    }).catch(() => null);
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Step content ───────────────────────────────────────────────────────────

  function renderAnalyze() {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Ready to analyze</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            The assistant will safely scan your project&apos;s source files and detect its structure,
            dependencies, and Replit-specific patterns.
          </p>
        </div>
        {error && (
          <div className="mx-auto max-w-sm rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive text-left">
            {error}
          </div>
        )}
        <Button onClick={runAnalysis} disabled={analyzing} size="lg">
          {analyzing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</> : <><Play className="h-4 w-4 mr-2" />Analyze Project</>}
        </Button>
        <p className="text-xs text-muted-foreground">
          Scans up to 300 files · Max 100 KB per file · No secrets read
        </p>
      </div>
    );
  }

  function renderDetection() {
    if (!report) return null;
    const r = report;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{r.projectType}</h3>
            <p className="text-sm text-muted-foreground">{r.filesScanned} files scanned · {r.risks.length} risks found</p>
          </div>
          <Button variant="outline" size="sm" onClick={runAnalysis} disabled={analyzing}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Re-analyze</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <DetectionChip label="Package Manager" value={r.packageManager !== "unknown" ? r.packageManager : null} icon={<Package className="h-4 w-4" />} />
          <DetectionChip label="Monorepo"        value={r.isMonorepo ? "Yes" : null}                            icon={<Layers className="h-4 w-4" />} />
          <DetectionChip label="Node Version"    value={r.nodeVersion}                                           icon={<Server className="h-4 w-4" />} />
          <DetectionChip label="Frontend"        value={r.frontend?.framework ?? r.frontend?.name}              icon={<Globe className="h-4 w-4" />} />
          <DetectionChip label="Backend"         value={r.backend?.framework ?? r.backend?.name}                icon={<Server className="h-4 w-4" />} />
          <DetectionChip label="Database"        value={r.database ? `${r.database.type}${r.database.orm && r.database.orm !== "none" ? ` / ${r.database.orm}` : ""}` : null} icon={<Database className="h-4 w-4" />} />
          <DetectionChip label="Media"           value={r.media?.provider && r.media.provider !== "none" ? r.media.provider : null} icon={<Image className="h-4 w-4" />} />
          <DetectionChip label="Payments"        value={r.payments.length > 0 ? r.payments.map((p) => p.provider).join(", ") : null} icon={<Shield className="h-4 w-4" />} />
          <DetectionChip label="Email"           value={r.email?.provider}                                       icon={<Mail className="h-4 w-4" />} />
        </div>

        {r.backgroundJobs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Background Jobs</p>
            <div className="flex flex-wrap gap-2">
              {r.backgroundJobs.map((j) => (
                <span key={j.library} className="text-xs bg-muted border rounded px-2 py-1">{j.library}</span>
              ))}
            </div>
          </div>
        )}

        {r.replitDependencies.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Replit-specific dependencies ({r.replitDependencies.length})
            </p>
            <div className="space-y-1.5">
              {r.replitDependencies.map((dep) => (
                <div key={dep.name} className="flex items-start gap-2 text-sm rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <code className="font-mono font-medium">{dep.name}</code>
                    <span className="ml-2 text-muted-foreground text-xs">({dep.type})</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{dep.detail}</p>
                    {dep.replacement && (
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">→ Replace with: {dep.replacement}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={() => setStep("fixes")} className="flex-1">
            View {report.risks.filter((r) => r.severity === "blocker").length} blockers & {report.risks.filter((r) => r.severity === "warning").length} warnings
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  function renderFixes() {
    if (!report) return null;
    const blockers = report.risks.filter((r) => r.severity === "blocker");
    const warnings = report.risks.filter((r) => r.severity === "warning");
    const infos    = report.risks.filter((r) => r.severity === "info");

    return (
      <div className="space-y-4">
        {blockers.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> Blockers ({blockers.length}) — must fix before deploy
            </p>
            <div className="rounded-lg border border-destructive/30 overflow-hidden">
              {blockers.map((r) => <RiskRow key={r.title} risk={r} />)}
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Warnings ({warnings.length})
            </p>
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
              {warnings.map((r) => <RiskRow key={r.title} risk={r} />)}
            </div>
          </div>
        )}
        {infos.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> Info ({infos.length})
            </p>
            <div className="rounded-lg border overflow-hidden">
              {infos.map((r) => <RiskRow key={r.title} risk={r} />)}
            </div>
          </div>
        )}
        {blockers.length === 0 && warnings.length === 0 && infos.length === 0 && (
          <div className="text-center py-8">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-medium">No migration risks detected</p>
            <p className="text-sm text-muted-foreground">Your project structure looks VPS-compatible.</p>
          </div>
        )}
        <Button onClick={() => setStep("services")} className="w-full">
          Configure services <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  function renderServices() {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Suggested service configuration</p>
            <p className="text-sm text-muted-foreground">Edit commands before creating service rows.</p>
          </div>
          <a href={`/projects/${projectId}/backups`} className="text-xs text-primary hover:underline flex items-center gap-1">
            <Archive className="h-3.5 w-3.5" />Backup first
          </a>
        </div>

        {editableServices.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Layers className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No services detected. Check detection results or add services manually in Publishing → Services.</p>
          </div>
        )}

        {editableServices.map((svc, idx) => (
          <ServiceEditor
            key={idx}
            svc={svc}
            onChange={(updated) => handleServiceChange(idx, updated)}
          />
        ))}

        {createResult && (
          <div className={`rounded-md border px-4 py-3 text-sm ${createResult.errors.length === 0 ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
            {createResult.created > 0 && <p>✅ {createResult.created} service{createResult.created > 1 ? "s" : ""} created</p>}
            {createResult.skipped > 0 && <p>⏭ {createResult.skipped} already existed (skipped)</p>}
            {createResult.errors.map((e) => <p key={e.slug}>❌ {e.slug}: {e.error}</p>)}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={createServices}
            disabled={creating || editableServices.length === 0}
            className="flex-1"
          >
            {creating
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
              : <><Plus className="h-4 w-4 mr-2" />Create services from recommendation</>
            }
          </Button>
          <Button variant="outline" onClick={() => setStep("secrets")}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Existing services with matching slugs are skipped. No deploy is triggered.
        </p>
      </div>
    );
  }

  function renderSecrets() {
    if (!report) return null;
    const required  = report.requiredSecrets.filter((s) => s.required);
    const optional  = report.requiredSecrets.filter((s) => !s.required && s.category !== "replit-specific");
    const replitEnv = report.requiredSecrets.filter((s) => s.category === "replit-specific");

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Key names detected in source code. Values are never shown here. Add them in the Secrets Vault.
        </p>

        {replitEnv.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400 mb-2">
              Replit-specific — must replace ({replitEnv.length})
            </p>
            <div className="rounded-lg border border-orange-200 dark:border-orange-800 overflow-hidden divide-y px-3">
              {replitEnv.map((s) => <SecretRow key={s.name} secret={s} />)}
            </div>
          </div>
        )}

        {required.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2">
              Required secrets ({required.length})
            </p>
            <div className="rounded-lg border overflow-hidden divide-y px-3">
              {required.map((s) => <SecretRow key={s.name} secret={s} />)}
            </div>
          </div>
        )}

        {optional.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Optional / detected ({optional.length})
            </p>
            <div className="rounded-lg border overflow-hidden divide-y px-3">
              {optional.map((s) => <SecretRow key={s.name} secret={s} />)}
            </div>
          </div>
        )}

        {report.requiredSecrets.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No environment variable references detected in source code.</p>
        )}

        <div className="flex gap-2">
          <a href={`/projects/${projectId}/env`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              Open Secrets Vault
            </Button>
          </a>
          <Button onClick={() => setStep("database")} className="flex-1">
            Database plan <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  function renderDatabase() {
    if (!report) return null;
    const plan = report.dbPlan;

    if (!plan || !report.database) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No database detected. No database migration needed.</p>
          <Button className="mt-4" onClick={() => setStep("media")}>Media plan <ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-500" />
          <div>
            <p className="font-medium">{plan.dbType}{plan.orm ? ` / ${plan.orm}` : ""}</p>
            <p className="text-sm text-muted-foreground">
              Connection key: <code className="font-mono text-xs">{report.database.connectionEnvKey ?? "DATABASE_URL"}</code>
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {plan.steps.map((step, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>

        {plan.notes && (
          <div className="rounded-md bg-muted/40 border px-3 py-2 text-sm text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{plan.notes}</p>
          </div>
        )}

        {report.database.migrationsDir && (
          <p className="text-sm">
            Migrations directory: <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{report.database.migrationsDir}</code>
          </p>
        )}

        <Button onClick={() => setStep("media")} className="w-full">
          Media plan <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  function renderMedia() {
    if (!report) return null;
    const plan = report.mediaPlan;

    if (!plan || !report.media) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Image className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No media storage detected. No media migration needed.</p>
          <Button className="mt-4" onClick={() => setStep("checklist")}>Final checklist <ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Image className="h-5 w-5 text-purple-500" />
          <div>
            <p className="font-medium">{plan.provider}</p>
            <p className="text-sm text-muted-foreground">{plan.isExternal ? "External storage — no file migration needed" : "Local storage — files must be migrated"}</p>
          </div>
          {plan.isExternal && <Badge variant="outline" className="ml-auto text-xs border-emerald-300 text-emerald-700">External</Badge>}
        </div>

        {report.media.hasLocalUploads && report.media.localUploadPaths.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Local upload paths</p>
            <div className="flex flex-wrap gap-1">
              {report.media.localUploadPaths.map((p) => (
                <code key={p} className="text-xs bg-muted border rounded px-1.5 py-0.5">{p}</code>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {plan.steps.map((step, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>

        {plan.notes && (
          <div className="rounded-md bg-muted/40 border px-3 py-2 text-sm text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{plan.notes}</p>
          </div>
        )}

        <Button onClick={() => setStep("checklist")} className="w-full">
          Final checklist <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  function renderChecklist() {
    const items = buildFinalChecklist(report);
    const done  = items.filter((i) => checked.has(i.id)).length;
    const pct   = items.length > 0 ? Math.round((done / items.length) * 100) : 0;

    return (
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium">{done}/{items.length} items complete</p>
            <span className="text-sm text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="space-y-1">
          {items.map((item) => {
            const isDone = checked.has(item.id);
            return (
              <label
                key={item.id}
                className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors"
              >
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); toggleCheck(item.id); }}
                  className={`mt-0.5 shrink-0 ${isDone ? "text-emerald-500" : "text-muted-foreground"}`}
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1" onClick={() => toggleCheck(item.id)}>
                  <p className={`text-sm ${isDone ? "line-through text-muted-foreground" : "font-medium"}`}>{item.label}</p>
                  {item.note && <p className="text-xs text-muted-foreground mt-0.5">{item.note}</p>}
                </div>
                {item.required && !isDone && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 shrink-0">Required</span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyReport}
            disabled={!report || copied}
          >
            {copied
              ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />Copied!</>
              : <><ClipboardCopy className="h-3.5 w-3.5 mr-1.5" />Copy migration report</>
            }
          </Button>
          <a href={`/projects/${projectId}/publishing`} className="flex-1">
            <Button className="w-full">
              <Zap className="h-4 w-4 mr-2" />Go to Publishing
            </Button>
          </a>
        </div>
        <p className="text-xs text-muted-foreground">Checklist is browser-only and resets on refresh. The copied report contains no secret values.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderStep() {
    switch (step) {
      case "analyze":   return renderAnalyze();
      case "detection": return renderDetection();
      case "fixes":     return renderFixes();
      case "services":  return renderServices();
      case "secrets":   return renderSecrets();
      case "database":  return renderDatabase();
      case "media":     return renderMedia();
      case "checklist": return renderChecklist();
      default:          return null;
    }
  }

  return (
    <div className="space-y-4">
      {/* Step nav */}
      <StepNav current={step} onGo={setStep} report={report} />

      {/* Main card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {STEPS.find((s) => s.id === step)?.label ?? ""}
          </CardTitle>
          {report && step === "analyze" && (
            <CardDescription>
              Last analyzed: {new Date(report.analyzedAt).toLocaleString()}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>{renderStep()}</CardContent>
      </Card>
    </div>
  );
}

// ── Build final checklist items ───────────────────────────────────────────────

type ChecklistItem = { id: string; label: string; note?: string; required?: boolean };

function buildFinalChecklist(report: ReplitMigrationReport | null): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { id: "code-imported",     label: "Code imported into project workspace",    required: true  },
    { id: "services-created",  label: "Services configured in Services section", required: true  },
    { id: "secrets-added",     label: "Required secrets added to Secrets Vault", required: true,  note: "Add DATABASE_URL, APP_URL, and all other required keys." },
    { id: "backup-created",    label: "Backup created before first deploy",      required: false, note: "Recommended in case you need to restore." },
  ];

  if (report?.database && report.database.type !== "none" && report.database.type !== "unknown") {
    items.push({ id: "db-migrated", label: "Database schema pushed/migrated", required: true,
      note: report.database.orm === "drizzle" ? "Run drizzle-kit push." : report.database.orm === "prisma" ? "Run prisma migrate deploy." : "Run your schema setup script." });
  }

  if (report?.email?.isReplitConnector) {
    items.push({ id: "email-replaced", label: "Email provider replaced (remove Replit connector)", required: true,
      note: "Configure SMTP_HOST or RESEND_API_KEY." });
  }

  if (report?.replitDependencies.some((d) => d.name === "REPLIT_DOMAINS")) {
    items.push({ id: "app-url-set", label: "APP_URL set and REPLIT_DOMAINS replaced", required: true });
  }

  if (report?.payments.some((p) => p.provider === "stripe" && p.hasWebhook)) {
    items.push({ id: "stripe-webhook", label: "Stripe webhook URL updated in Stripe Dashboard", required: false,
      note: "Point to https://yourdomain.com/api/webhooks/stripe after first deploy." });
  }

  if (report?.media?.hasLocalUploads && report.media.provider === "local") {
    items.push({ id: "uploads-migrated", label: "Local uploads migrated to VPS storage or object storage", required: false });
  }

  items.push(
    { id: "domain-configured", label: "Domain configured and SSL issued",   required: false, note: "Add domain in the Domains section." },
    { id: "first-deploy",      label: "First multi-service deploy triggered", required: true,  note: "Use Publishing → Services → Deploy all." },
    { id: "health-ok",         label: "API health check returns 200",        required: false, note: "/api/healthz should return { ok: true }." },
    { id: "frontend-loads",    label: "Frontend loads at /",                 required: false },
    { id: "login-works",       label: "Login / auth flow works",             required: false },
  );

  return items;
}

// ── Build copyable report text ────────────────────────────────────────────────

function buildReportText(report: ReplitMigrationReport): string {
  const lines: string[] = [
    "# Replit Migration Report",
    `Generated: ${new Date(report.analyzedAt).toLocaleString()}`,
    "",
    `## Project`,
    `Type: ${report.projectType}`,
    `Package manager: ${report.packageManager}`,
    `Monorepo: ${report.isMonorepo ? "Yes" : "No"}`,
    report.nodeVersion ? `Node version: ${report.nodeVersion}` : "",
    `Files scanned: ${report.filesScanned}`,
    "",
    `## Detection`,
    report.frontend  ? `Frontend: ${report.frontend.framework ?? report.frontend.name}` : "",
    report.backend   ? `Backend: ${report.backend.framework ?? report.backend.name}` : "",
    report.database  ? `Database: ${report.database.type}${report.database.orm && report.database.orm !== "none" ? ` / ${report.database.orm}` : ""}` : "",
    report.media     ? `Media: ${report.media.provider}` : "",
    report.payments.length > 0 ? `Payments: ${report.payments.map((p) => p.provider).join(", ")}` : "",
    report.email     ? `Email: ${report.email.provider}` : "",
    "",
    `## Risks (${report.risks.length})`,
    ...report.risks.map((r) => `[${r.severity.toUpperCase()}] ${r.title}`),
    "",
    `## Required Secrets (key names only — no values)`,
    ...report.requiredSecrets.filter((s) => s.required).map((s) => `- ${s.name} (${s.category})`),
    "",
    `## Suggested Services`,
    ...report.suggestedServices.map((s) => [
      `### ${s.name} (${s.serviceType})`,
      `slug: ${s.slug}`,
      `workingDir: ${s.workingDir}`,
      s.installCommand ? `install: ${s.installCommand}` : "",
      s.buildCommand   ? `build: ${s.buildCommand}`   : "",
      s.startCommand   ? `start: ${s.startCommand}`   : "",
      s.staticOutputDir ? `output: ${s.staticOutputDir}` : "",
      s.healthPath     ? `health: ${s.healthPath}`   : "",
    ].filter(Boolean).join("\n")),
    "",
    "---",
    "Generated by Prisom Migration Assistant. No secret values included.",
  ];

  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}
