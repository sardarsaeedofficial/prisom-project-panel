"use client";

/**
 * components/projects/production-routing-panel.tsx
 *
 * Sprint 52: Full routing panel with diagnostics, validate dry run, and
 * rollback preview.  Uses fetch → /api/projects/[id]/routing/* for all
 * read-only actions; server actions for apply/rollback (they need the full
 * auth chain and disk access).
 *
 * Safety:
 *  - apply requires "APPLY ROUTES" confirmation
 *  - rollback (execute) requires "ROLLBACK ROUTES" confirmation
 *  - panel domain and protected configs are blocked at the service layer
 *  - no silent mutations
 */

import { useState }              from "react";
import Link                      from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileCode2,
  Globe,
  Heart,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Shield,
  Stethoscope,
  Zap,
  XCircle,
} from "lucide-react";
import { Button }        from "@/components/ui/button";
import { Badge }         from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ProjectRoutePreview }                from "./project-route-preview";
import {
  applyProjectRouteMapAction,
  rollbackProjectRouteConfigAction,
}                                             from "@/app/actions/project-routing";
import type {
  ProjectRouteMap,
  ProjectRouteHealthReport,
}                                             from "@/lib/routing/project-route-types";
import type {
  RoutingDiagnosticsReport,
  RouteRollbackPreview,
}                                             from "@/lib/routing/routing-diagnostics-types";

// ── API response shapes ───────────────────────────────────────────────────────

type RoutingApiResult = {
  ok:            boolean;
  error?:        string;
  data?:         unknown;
  routeMap?:     ProjectRouteMap;
  nginxPreview?: string;
  nginxOutput?:  string;
  warnings?:     string[];
  blockers?:     string[];
  health?:       ProjectRouteHealthReport;
  validation?:   { ok: boolean; warnings: string[]; blockers: string[]; nginxOutput?: string };
};

// ── Props ─────────────────────────────────────────────────────────────────────

export type ProductionRoutingPanelProps = {
  projectId:        string;
  initialRouteMap?: ProjectRouteMap | null;
  initialNginx?:    string | null;
  hasBackup?:       boolean;
  domain?:          string | null;
};

// ── Active action ─────────────────────────────────────────────────────────────

type ActiveAction =
  | "diagnostics"
  | "plan"
  | "preview"
  | "validate"
  | "health"
  | "apply"
  | "rollback"
  | "rollback_preview";

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function postRouting(
  projectId: string,
  path:      string,
  body?:     Record<string, unknown>,
): Promise<RoutingApiResult> {
  const res = await fetch(`/api/projects/${projectId}/routing/${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Routing /${path} returned no JSON (HTTP ${res.status}).`);
  return json as RoutingApiResult;
}

// ── Diagnostics check row ─────────────────────────────────────────────────────

function DiagnosticRow({ check }: { check: RoutingDiagnosticsReport["checks"][number] }) {
  const [open, setOpen] = useState(check.status !== "pass");
  const hasDetails = (check.evidence?.length ?? 0) > 0 || check.fixHref;

  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        {check.status === "pass"    && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
        {check.status === "warning" && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
        {check.status === "fail"    && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
        <span className="flex-1 text-xs">{check.label}</span>
        <span className={`text-[10px] ${
          check.status === "pass"    ? "text-green-600" :
          check.status === "warning" ? "text-amber-600" :
          "text-destructive"
        }`}>{check.message.slice(0, 60)}{check.message.length > 60 ? "…" : ""}</span>
        {hasDetails && (
          open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
               : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && hasDetails && (
        <div className="px-3 pb-2 pl-9 space-y-1">
          {check.evidence?.map((e, i) => (
            <code key={i} className="block text-[10px] font-mono text-muted-foreground">{e}</code>
          ))}
          {check.fixHref && (
            <Link href={check.fixHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Fix this <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductionRoutingPanel({
  projectId,
  initialRouteMap,
  initialNginx,
  hasBackup: initialHasBackup,
  domain,
}: ProductionRoutingPanelProps) {
  const [routeMap,         setRouteMap]         = useState<ProjectRouteMap | null>(initialRouteMap ?? null);
  const [nginxPreview,     setNginxPreview]     = useState<string | null>(initialNginx ?? null);
  const [hasBackup,        setHasBackup]        = useState(initialHasBackup ?? false);
  const [error,            setError]            = useState<string | null>(null);
  const [successMsg,       setSuccessMsg]       = useState<string | null>(null);
  const [nginxOutput,      setNginxOutput]      = useState<string | null>(null);
  const [healthReport,     setHealthReport]     = useState<ProjectRouteHealthReport | null>(null);
  const [diagnostics,      setDiagnostics]      = useState<RoutingDiagnosticsReport | null>(null);
  const [rollbackPreview,  setRollbackPreview]  = useState<RouteRollbackPreview | null>(null);
  const [showHelp,         setShowHelp]         = useState(false);
  const [showApply,        setShowApply]        = useState(false);
  const [showRollback,     setShowRollback]     = useState(false);
  const [showRbPreview,    setShowRbPreview]    = useState(false);
  const [applyConfirm,     setApplyConfirm]     = useState("");
  const [rollbackConfirm,  setRollbackConfirm]  = useState("");
  const [activeAction,     setActiveAction]     = useState<ActiveAction | null>(null);
  const [lastAction,       setLastAction]       = useState<string | null>(null);

  const busy        = activeAction !== null;
  const hasBlockers = (routeMap?.blockers?.length ?? 0) > 0;
  const applyReady  = applyConfirm === "APPLY ROUTES";
  const rbReady     = rollbackConfirm === "ROLLBACK ROUTES";

  // ── Diagnostics ───────────────────────────────────────────────────────────────

  async function handleDiagnostics() {
    if (busy) return;
    setActiveAction("diagnostics");
    setError(null);
    setLastAction("Diagnostics clicked");
    try {
      const result = await postRouting(projectId, "diagnostics");
      if (!result.ok) {
        setError(result.error ?? "Diagnostics failed.");
        setLastAction("Diagnostics failed");
        return;
      }
      setDiagnostics(result.data as RoutingDiagnosticsReport);
      setLastAction("Diagnostics completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during diagnostics.");
      setLastAction("Diagnostics crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Generate Plan ─────────────────────────────────────────────────────────────

  async function handleGeneratePlan() {
    if (busy) return;
    setActiveAction("plan");
    setError(null);
    setLastAction("Generate Plan clicked");
    try {
      const result = await postRouting(projectId, "plan");
      if (!result.ok) {
        setError(result.error ?? "Failed to generate routing plan.");
        setLastAction("Generate Plan failed");
        return;
      }
      if (!result.routeMap) {
        setError("Generate Plan returned no route map.");
        setLastAction("Generate Plan returned no route map");
        return;
      }
      setRouteMap(result.routeMap);
      setLastAction("Generate Plan completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during plan generation.");
      setLastAction("Generate Plan crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Preview Config ────────────────────────────────────────────────────────────

  async function handlePreviewConfig() {
    if (busy) return;
    setActiveAction("preview");
    setError(null);
    setLastAction("Preview Config clicked");
    try {
      const result = await postRouting(projectId, "preview");
      if (!result.ok) {
        setError(result.error ?? "Failed to generate nginx preview.");
        setLastAction("Preview Config failed");
        return;
      }
      if (result.routeMap)     setRouteMap(result.routeMap);
      if (!result.nginxPreview) {
        setError("Preview Config returned no nginx config.");
        setLastAction("Preview Config returned no config");
        return;
      }
      setNginxPreview(result.nginxPreview);
      setLastAction("Preview Config completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during preview.");
      setLastAction("Preview Config crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Validate Dry Run ──────────────────────────────────────────────────────────

  async function handleValidate() {
    if (busy) return;
    setActiveAction("validate");
    setError(null);
    setSuccessMsg(null);
    setLastAction("Validate Dry Run clicked");
    try {
      const result = await postRouting(projectId, "validate");
      if (result.routeMap)     setRouteMap(result.routeMap);
      if (result.nginxPreview) setNginxPreview(result.nginxPreview);
      if (!result.ok) {
        setError(result.error ?? "Dry-run validation failed.");
        setLastAction("Validate Dry Run failed");
        return;
      }
      const vok = result.validation?.ok ?? true;
      if (vok) {
        setSuccessMsg("Dry-run validation passed — no blockers, no nginx syntax errors.");
        setLastAction("Validate Dry Run passed");
      } else {
        setError(
          result.blockers?.length
            ? `${result.blockers.length} blocker(s): ${result.blockers[0]}`
            : "Dry-run validation found issues.",
        );
        setLastAction("Validate Dry Run found issues");
      }
      if (result.validation?.nginxOutput) setNginxOutput(result.validation.nginxOutput);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during dry-run.");
      setLastAction("Validate Dry Run crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Route Health ──────────────────────────────────────────────────────────────

  async function handleCheckHealth() {
    if (busy) return;
    setActiveAction("health");
    setError(null);
    setLastAction("Route Health clicked");
    try {
      const result = await postRouting(projectId, "health");
      if (!result.ok) {
        setError(result.error ?? "Health check failed.");
        setLastAction("Route Health failed");
        return;
      }
      if (!result.health) {
        setError("Health check returned no report.");
        setLastAction("Route Health returned no report");
        return;
      }
      setHealthReport(result.health);
      setLastAction(
        result.health.allOk
          ? "Route Health: all checks passed"
          : `Route Health: ${result.health.checks.filter((c) => !c.ok).length} check(s) failed`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during health check.");
      setLastAction("Route Health crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Preview Rollback ──────────────────────────────────────────────────────────

  async function handleRollbackPreview() {
    if (busy) return;
    setActiveAction("rollback_preview");
    setError(null);
    setLastAction("Preview Rollback clicked");
    try {
      const result = await postRouting(projectId, "rollback-preview");
      if (!result.ok) {
        setError(result.error ?? "Rollback preview failed.");
        setLastAction("Preview Rollback failed");
        return;
      }
      setRollbackPreview(result.data as RouteRollbackPreview);
      setShowRbPreview(true);
      setLastAction("Preview Rollback completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error during rollback preview.");
      setLastAction("Preview Rollback crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Apply (server action) ─────────────────────────────────────────────────────

  async function handleApply() {
    if (busy || !applyReady || hasBlockers || !routeMap) return;
    setActiveAction("apply");
    setError(null);
    setSuccessMsg(null);
    setNginxOutput(null);
    setLastAction("Apply Routes clicked");
    try {
      const res = await applyProjectRouteMapAction({ projectId, confirmationText: applyConfirm });
      if (!res.ok) {
        setError(res.error ?? "Apply failed.");
        setLastAction("Apply Routes failed");
        return;
      }
      setSuccessMsg("Route config applied and nginx reloaded.");
      setHasBackup(true);
      if (res.data.routeMap)    setRouteMap(res.data.routeMap);
      if (res.data.nginxPreview) setNginxPreview(res.data.nginxPreview);
      if (res.data.nginxOutput)  setNginxOutput(res.data.nginxOutput);
      setApplyConfirm("");
      setShowApply(false);
      setLastAction("Apply Routes completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply crashed — check server logs.");
      setLastAction("Apply Routes crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Rollback execute (server action) ─────────────────────────────────────────

  async function handleRollback() {
    if (busy || !rbReady) return;
    setActiveAction("rollback");
    setError(null);
    setSuccessMsg(null);
    setNginxOutput(null);
    setLastAction("Rollback Routes clicked");
    try {
      const res = await rollbackProjectRouteConfigAction(projectId);
      if (!res.ok) {
        setError(res.error ?? "Rollback failed.");
        setLastAction("Rollback failed");
        return;
      }
      setSuccessMsg("Route config rolled back to previous version.");
      if (res.data.nginxOutput) setNginxOutput(res.data.nginxOutput);
      setShowRollback(false);
      setRollbackConfirm("");
      setHasBackup(false);
      setLastAction("Rollback completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback crashed — check server logs.");
      setLastAction("Rollback crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const diagStatus = diagnostics?.status;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Production Routing
              {diagStatus && (
                <Badge className={`text-[10px] ${
                  diagStatus === "ready"   ? "bg-green-100 text-green-800 border-green-200" :
                  diagStatus === "warning" ? "bg-amber-100 text-amber-800 border-amber-200" :
                  "bg-red-100 text-red-800 border-red-200"
                }`}>
                  {diagStatus === "ready" ? "Ready" : diagStatus === "warning" ? "Warnings" : "Blocked"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-0.5">
              Configure how incoming requests are routed to your API and frontend services.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
            title="Help"
          >
            {showHelp ? <ChevronUp className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </button>
        </div>

        {showHelp && (
          <div className="mt-3 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-2">
            <p>
              <strong>For Replit-style ecommerce apps:</strong> route{" "}
              <code className="font-mono text-xs">/api/*</code> to your Node API service and{" "}
              <code className="font-mono text-xs">/*</code> to the built static frontend with SPA fallback.
            </p>
            <p>
              <strong>DNS</strong> must already point to this VPS.{" "}
              <strong>SSL</strong> must be provisioned from the Domains tab.
              Routing does not copy secrets or database data.
            </p>
            <p className="text-amber-600 dark:text-amber-400">
              <strong>Apply Routes</strong> writes nginx config and reloads nginx.
              Run diagnostics and validate dry run first.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Domain */}
        {domain && (
          <div className="flex items-center gap-2 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-mono text-xs text-muted-foreground">Domain:</span>
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm font-medium text-primary hover:underline flex items-center gap-1"
            >
              {domain} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Last action */}
        {lastAction && (
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">{lastAction}</p>
        )}

        {/* Success */}
        {successMsg && (
          <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/10 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            {successMsg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/10 px-4 py-3">
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          </div>
        )}

        {/* Diagnostics panel */}
        {diagnostics && (
          <div className="rounded-md border overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
              <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">
                Routing Diagnostics
              </span>
              <span className="text-[10px] text-muted-foreground">
                {diagnostics.checks.filter((c) => c.status === "pass").length}/{diagnostics.checks.length} passed
              </span>
            </div>

            {diagnostics.blockers.length > 0 && (
              <div className="px-3 py-2 border-b bg-red-50/40 dark:bg-red-950/10">
                {diagnostics.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
                  </p>
                ))}
              </div>
            )}

            {diagnostics.warnings.length > 0 && (
              <div className="px-3 py-2 border-b bg-amber-50/30 dark:bg-amber-950/10">
                {diagnostics.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}

            <div>
              {diagnostics.checks.map((c) => <DiagnosticRow key={c.id} check={c} />)}
            </div>

            {diagnostics.nextSteps.length > 0 && (
              <div className="px-3 py-2 border-t bg-muted/10 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Next steps</p>
                {diagnostics.nextSteps.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />{s}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Route map preview */}
        {routeMap ? (
          <ProjectRoutePreview
            routeMap={routeMap}
            nginxPreview={nginxPreview ?? undefined}
            onRefresh={handleGeneratePlan}
            isLoading={activeAction === "plan"}
          />
        ) : (
          <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            <Zap className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p>Click <strong>Generate Plan</strong> to see how requests will be routed.</p>
          </div>
        )}

        {/* Action buttons row */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleDiagnostics} disabled={busy}>
            {activeAction === "diagnostics"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Diagnosing…</>
              : <><Stethoscope className="h-3.5 w-3.5 mr-1.5" />Diagnostics</>
            }
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={handleGeneratePlan} disabled={busy}>
            {activeAction === "plan"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Generate Plan</>
            }
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={handlePreviewConfig} disabled={busy}>
            {activeAction === "preview"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating Preview…</>
              : <><FileCode2 className="h-3.5 w-3.5 mr-1.5" />Preview Config</>
            }
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={handleValidate} disabled={busy}>
            {activeAction === "validate"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Validating…</>
              : <><Shield className="h-3.5 w-3.5 mr-1.5" />Validate Dry Run</>
            }
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCheckHealth}
            disabled={busy || !domain}
            title={!domain ? "No domain configured" : undefined}
          >
            {activeAction === "health"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Checking…</>
              : <><Heart className="h-3.5 w-3.5 mr-1.5" />Route Health</>
            }
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={handleRollbackPreview} disabled={busy}>
            {activeAction === "rollback_preview"
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Loading Preview…</>
              : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Preview Rollback</>
            }
          </Button>
        </div>

        {/* nginx -t output */}
        {nginxOutput && (
          <pre className="text-xs font-mono bg-muted/40 border rounded px-3 py-2 overflow-x-auto max-h-32 whitespace-pre">
            {nginxOutput}
          </pre>
        )}

        {/* Route health report */}
        {healthReport && (
          <div className="rounded-md border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
              <Heart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route Health</span>
              {healthReport.allOk
                ? <Badge variant="outline" className="ml-auto text-xs border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">All OK</Badge>
                : <Badge variant="outline" className="ml-auto text-xs border-red-300 text-red-700 bg-red-50 dark:bg-red-950/20">Issues Found</Badge>
              }
            </div>
            {healthReport.checks.map((check, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 border-b last:border-0 text-sm">
                {check.ok
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle      className="h-3.5 w-3.5 text-red-500    shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <p className={check.ok ? "text-foreground text-xs" : "text-red-600 dark:text-red-400 text-xs"}>{check.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{check.url}</p>
                  {check.error && <p className="text-[10px] text-red-500 mt-0.5">{check.error}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {check.statusCode && (
                    <span className={`text-xs font-mono ${check.ok ? "text-emerald-600" : "text-red-600"}`}>{check.statusCode}</span>
                  )}
                  <p className="text-[10px] text-muted-foreground">{check.durationMs}ms</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rollback preview panel */}
        {showRbPreview && rollbackPreview && (
          <div className="rounded-md border overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">Rollback Preview</span>
              <Badge className={`text-[10px] ${rollbackPreview.hasBackup ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200"}`}>
                {rollbackPreview.hasBackup ? "Backup available" : "No backup"}
              </Badge>
              <button type="button" onClick={() => setShowRbPreview(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </div>
            {rollbackPreview.warnings.length > 0 && (
              <div className="px-3 py-2 border-b bg-amber-50/30">
                {rollbackPreview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}
                  </p>
                ))}
              </div>
            )}
            <div className="px-3 py-3 space-y-3">
              <div>
                <p className="text-xs font-semibold mb-1">Manual rollback checklist</p>
                <ol className="space-y-0.5">
                  {rollbackPreview.manualChecklist.map((item, i) => (
                    <li key={i} className="text-xs text-muted-foreground">{item}</li>
                  ))}
                </ol>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold">Commands</p>
                <code className="block text-[11px] font-mono bg-muted px-2 py-1 rounded">{rollbackPreview.nginxTestCommand}</code>
                <code className="block text-[11px] font-mono bg-muted px-2 py-1 rounded">{rollbackPreview.nginxReloadCommand}</code>
              </div>
              {rollbackPreview.backupConfigSnippet && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <FileCode2 className="h-3 w-3" /> Show backup config preview
                  </summary>
                  <pre className="mt-2 text-[10px] font-mono bg-muted/40 border rounded px-3 py-2 overflow-x-auto max-h-48 whitespace-pre">
                    {rollbackPreview.backupConfigSnippet}
                  </pre>
                </details>
              )}
            </div>

            {/* Execute rollback (only when backup exists) */}
            {rollbackPreview.hasBackup && (
              <div className="px-3 pb-3 pt-1 border-t space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  To execute rollback: type <code className="font-mono font-bold">ROLLBACK ROUTES</code> and confirm.
                </p>
                <input
                  type="text"
                  value={rollbackConfirm}
                  onChange={(e) => setRollbackConfirm(e.target.value)}
                  placeholder="Type ROLLBACK ROUTES to confirm"
                  disabled={busy}
                  className="w-full h-8 rounded-md border bg-background px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy || !rbReady}
                    onClick={handleRollback}
                  >
                    {activeAction === "rollback"
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Rolling back…</>
                      : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Execute Rollback</>
                    }
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setShowRbPreview(false); setRollbackConfirm(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Apply section */}
        <div className="border-t pt-3">
          <button
            type="button"
            className="w-full flex items-center gap-2 text-sm font-medium py-1 text-left"
            onClick={() => setShowApply((v) => !v)}
          >
            <Zap className="h-4 w-4 text-amber-500" />
            Apply Route Config
            {hasBlockers && <Badge variant="destructive" className="text-xs ml-auto">Blocked</Badge>}
            {showApply
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            }
          </button>

          {showApply && (
            <div className="mt-3 space-y-3 rounded-md border bg-card px-4 py-3">
              {hasBlockers && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Resolve {routeMap?.blockers?.length} blocker(s) before applying.
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Writes nginx config, runs <code className="font-mono">nginx&nbsp;-t</code>, reloads nginx.
                Type <code className="font-mono font-bold">APPLY ROUTES</code> to confirm.
              </p>

              <input
                type="text"
                value={applyConfirm}
                onChange={(e) => setApplyConfirm(e.target.value)}
                placeholder="Type APPLY ROUTES to confirm"
                disabled={busy}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !applyReady || hasBlockers || !routeMap}
                  onClick={handleApply}
                  className="flex-1"
                >
                  {activeAction === "apply"
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Applying…</>
                    : <><Zap className="h-4 w-4 mr-1.5" />Apply Routes</>
                  }
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { setShowApply(false); setApplyConfirm(""); }}>
                  Cancel
                </Button>
              </div>

              {hasBackup && !showRbPreview && (
                <p className="text-xs text-muted-foreground">
                  A backup is available.{" "}
                  <button type="button" className="text-primary hover:underline" onClick={handleRollbackPreview}>
                    Preview rollback
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
