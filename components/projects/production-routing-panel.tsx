"use client";

/**
 * components/projects/production-routing-panel.tsx
 *
 * Sprint 44 Hotfix 2: Uses fetch → /api/projects/[id]/routing/* instead of
 * direct server-action imports for the read-only buttons (plan, preview,
 * validate, health).  Apply / rollback still call server actions because
 * they write to disk and need the existing auth+audit chain.
 */

import { useState }              from "react";
import {
  AlertTriangle,
  CheckCircle2,
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
import { ProjectRoutePreview }          from "./project-route-preview";
import {
  applyProjectRouteMapAction,
  rollbackProjectRouteConfigAction,
}                                       from "@/app/actions/project-routing";
import type {
  ProjectRouteMap,
  ProjectRouteHealthReport,
}                                       from "@/lib/routing/project-route-types";

// ── API response shape ────────────────────────────────────────────────────────

type RoutingApiResult = {
  ok:           boolean;
  error?:       string;
  routeMap?:    ProjectRouteMap;
  nginxPreview?: string;
  nginxOutput?:  string;
  warnings?:    string[];
  blockers?:    string[];
  health?:      ProjectRouteHealthReport;
  validation?:  { ok: boolean; warnings: string[]; blockers: string[]; nginxOutput?: string };
};

// ── Props ─────────────────────────────────────────────────────────────────────

export type ProductionRoutingPanelProps = {
  projectId:        string;
  initialRouteMap?: ProjectRouteMap | null;
  initialNginx?:    string | null;
  hasBackup?:       boolean;
  domain?:          string | null;
};

// ── Active-action discriminant ─────────────────────────────────────────────

type ActiveAction = "plan" | "preview" | "validate" | "health" | "apply" | "rollback";

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function postRouting(
  projectId: string,
  path: string,
): Promise<RoutingApiResult> {
  const res  = await fetch(`/api/projects/${projectId}/routing/${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
  });

  const json = await res.json().catch(() => null);

  if (!json) {
    throw new Error(`Routing /${path} returned no JSON (HTTP ${res.status}).`);
  }

  return json as RoutingApiResult;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductionRoutingPanel({
  projectId,
  initialRouteMap,
  initialNginx,
  hasBackup: initialHasBackup,
  domain,
}: ProductionRoutingPanelProps) {
  const [routeMap,      setRouteMap]      = useState<ProjectRouteMap | null>(initialRouteMap ?? null);
  const [nginxPreview,  setNginxPreview]  = useState<string | null>(initialNginx ?? null);
  const [hasBackup,     setHasBackup]     = useState(initialHasBackup ?? false);
  const [error,         setError]         = useState<string | null>(null);
  const [successMsg,    setSuccessMsg]    = useState<string | null>(null);
  const [nginxOutput,   setNginxOutput]   = useState<string | null>(null);
  const [healthReport,  setHealthReport]  = useState<ProjectRouteHealthReport | null>(null);
  const [showHelp,      setShowHelp]      = useState(false);
  const [showRollback,  setShowRollback]  = useState(false);
  const [applyConfirm,  setApplyConfirm]  = useState("");
  const [activeAction,  setActiveAction]  = useState<ActiveAction | null>(null);
  const [lastAction,    setLastAction]    = useState<string | null>(null);

  // ── Generate Plan ────────────────────────────────────────────────────────────

  async function handleGeneratePlan() {
    if (activeAction) return;
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
        setError("Generate Plan succeeded but returned no route map.");
        setLastAction("Generate Plan returned no route map");
        return;
      }

      setRouteMap(result.routeMap);
      setLastAction("Generate Plan completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown client error.");
      setLastAction("Generate Plan crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Preview Config ────────────────────────────────────────────────────────────

  async function handlePreviewConfig() {
    if (activeAction) return;
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
      if (result.routeMap)    setRouteMap(result.routeMap);
      if (!result.nginxPreview) {
        setError("Preview Config succeeded but returned no nginx config.");
        setLastAction("Preview Config returned no config");
        return;
      }

      setNginxPreview(result.nginxPreview);
      setLastAction("Preview Config completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown client error.");
      setLastAction("Preview Config crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Validate ──────────────────────────────────────────────────────────────────

  async function handleValidate() {
    if (activeAction) return;
    setActiveAction("validate");
    setError(null);
    setLastAction("Validate clicked");

    try {
      const result = await postRouting(projectId, "validate");

      if (!result.ok) {
        setError(result.error ?? "Validation failed.");
        setLastAction("Validate failed");
        return;
      }
      if (result.routeMap)    setRouteMap(result.routeMap);
      if (result.nginxPreview) setNginxPreview(result.nginxPreview);

      const vok = result.validation?.ok ?? true;
      if (vok) {
        setSuccessMsg("Config is valid — no blockers found.");
        setLastAction("Validate passed");
      } else {
        setError(
          result.blockers?.length
            ? `${result.blockers.length} blocker(s): ${result.blockers[0]}`
            : "Validation found issues.",
        );
        setLastAction("Validate found issues");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown client error.");
      setLastAction("Validate crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Route Health ──────────────────────────────────────────────────────────────

  async function handleCheckHealth() {
    if (activeAction) return;
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
        setError("Health check succeeded but returned no report.");
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
      setError(e instanceof Error ? e.message : "Unknown client error.");
      setLastAction("Route Health crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Apply (server action) ─────────────────────────────────────────────────────

  async function handleApply() {
    if (activeAction) return;
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
      setLastAction("Apply Routes completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error during apply.");
      setLastAction("Apply Routes crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Rollback (server action) ──────────────────────────────────────────────────

  async function handleRollback() {
    if (activeAction) return;
    setActiveAction("rollback");
    setError(null);
    setSuccessMsg(null);
    setNginxOutput(null);
    setLastAction("Rollback clicked");

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
      setHasBackup(false);
      setLastAction("Rollback completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error during rollback.");
      setLastAction("Rollback crashed");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const busy        = activeAction !== null;
  const hasBlockers = (routeMap?.blockers?.length ?? 0) > 0;
  const needsConfirm = applyConfirm !== "APPLY ROUTES";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Production Routing
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
              <code className="font-mono text-xs">/*</code> to the built static frontend with SPA
              fallback.
            </p>
            <p>
              <strong>DNS</strong> must already point to this VPS.{" "}
              <strong>SSL</strong> must be provisioned from the Domains tab.
              Routing does not copy secrets or database data.
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
              {domain}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Last action diagnostic */}
        {lastAction && (
          <p className="text-xs text-muted-foreground">
            Last action: {lastAction}
          </p>
        )}

        {/* Success */}
        {successMsg && (
          <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/10 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            {successMsg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
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

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
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
              : <><Shield className="h-3.5 w-3.5 mr-1.5" />Validate</>
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
        </div>

        {/* nginx -t output */}
        {nginxOutput && (
          <pre className="text-xs font-mono bg-muted/40 border rounded px-3 py-2 overflow-x-auto max-h-32 whitespace-pre">
            {nginxOutput}
          </pre>
        )}

        {/* Health report */}
        {healthReport && (
          <div className="rounded-md border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
              <Heart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Route Health
              </span>
              {healthReport.allOk
                ? <Badge variant="outline" className="ml-auto text-xs border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">All OK</Badge>
                : <Badge variant="outline" className="ml-auto text-xs border-red-300 text-red-700 bg-red-50 dark:bg-red-950/20">Issues Found</Badge>
              }
            </div>
            {healthReport.checks.map((check, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 border-b last:border-0 text-sm">
                {check.ok
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle      className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <p className={check.ok ? "text-foreground" : "text-red-600 dark:text-red-400"}>
                    {check.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{check.url}</p>
                  {check.error && <p className="text-xs text-red-500 mt-0.5">{check.error}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {check.statusCode && (
                    <span className={`text-xs font-mono ${check.ok ? "text-emerald-600" : "text-red-600"}`}>
                      {check.statusCode}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">{check.durationMs}ms</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Apply section */}
        <div className="rounded-md border bg-card px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Apply Route Config</span>
            {hasBlockers && (
              <Badge variant="destructive" className="text-xs ml-auto">Blocked</Badge>
            )}
          </div>

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
              disabled={busy || needsConfirm || hasBlockers || !routeMap}
              onClick={handleApply}
              className="flex-1"
            >
              {activeAction === "apply"
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Applying…</>
                : <><Zap className="h-4 w-4 mr-1.5" />Apply Routes</>
              }
            </Button>

            {hasBackup && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRollback((v) => !v)}
                disabled={busy}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Rollback
              </Button>
            )}
          </div>

          {/* Rollback confirmation */}
          {showRollback && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10 px-3 py-2 space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>Roll back to the previous nginx config for this domain?</p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleRollback}
                  disabled={busy}
                >
                  {activeAction === "rollback"
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Rolling back…</>
                    : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Confirm Rollback</>
                  }
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRollback(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
