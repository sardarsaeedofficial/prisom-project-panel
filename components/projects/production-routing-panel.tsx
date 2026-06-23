"use client";

/**
 * components/projects/production-routing-panel.tsx
 *
 * Sprint 44: Production Routing Panel for /publishing page.
 *
 * Shows:
 *   - Current domain
 *   - Recommended route map
 *   - Nginx preview button
 *   - Validate button
 *   - Apply (requires "APPLY ROUTES")
 *   - Rollback button
 *   - Route health checks
 *   - Help text for Replit-style ecommerce apps
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
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
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ProjectRoutePreview } from "./project-route-preview";
import {
  generateProjectRouteMapAction,
  previewProjectNginxConfigAction,
  validateProjectRouteMapAction,
  applyProjectRouteMapAction,
  rollbackProjectRouteConfigAction,
  checkProjectRouteHealthAction,
} from "@/app/actions/project-routing";
import type { ProjectRouteMap, ProjectRouteHealthReport } from "@/lib/routing/project-route-types";

// ── Props ─────────────────────────────────────────────────────────────────────

export type ProductionRoutingPanelProps = {
  projectId:          string;
  /** Pre-loaded server-side route map (may be null if no services) */
  initialRouteMap?:   ProjectRouteMap | null;
  initialNginx?:      string | null;
  hasBackup?:         boolean;
  domain?:            string | null;
};

// ── Main component ────────────────────────────────────────────────────────────

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
  const [applyConfirm,  setApplyConfirm]  = useState("");
  const [nginxOutput,   setNginxOutput]   = useState<string | null>(null);
  const [healthReport,  setHealthReport]  = useState<ProjectRouteHealthReport | null>(null);
  const [showHelp,      setShowHelp]      = useState(false);
  const [showRollback,  setShowRollback]  = useState(false);

  const [loadingPlan,   startLoadPlan]   = useTransition();
  const [loadingNginx,  startLoadNginx]  = useTransition();
  const [validating,    startValidate]   = useTransition();
  const [applying,      startApply]      = useTransition();
  const [rollingBack,   startRollback]   = useTransition();
  const [checkingHealth, startHealth]    = useTransition();

  function clearMessages() {
    setError(null);
    setSuccessMsg(null);
    setNginxOutput(null);
  }

  // ── Refresh plan ────────────────────────────────────────────────────────────

  function refreshPlan() {
    clearMessages();
    startLoadPlan(async () => {
      const res = await generateProjectRouteMapAction(projectId);
      if (res.ok) {
        setRouteMap(res.data.routeMap ?? null);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Preview nginx ───────────────────────────────────────────────────────────

  function previewNginx() {
    clearMessages();
    startLoadNginx(async () => {
      const res = await previewProjectNginxConfigAction(projectId);
      if (res.ok) {
        setRouteMap(res.data.routeMap ?? null);
        setNginxPreview(res.data.nginxPreview ?? null);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Validate ────────────────────────────────────────────────────────────────

  function validate() {
    clearMessages();
    startValidate(async () => {
      const res = await validateProjectRouteMapAction(projectId);
      if (res.ok) {
        const d = res.data;
        setRouteMap(d.routeMap ?? null);
        setNginxPreview(d.nginxPreview ?? null);
        setNginxOutput(d.nginxOutput ?? null);
        if (d.ok) {
          setSuccessMsg("nginx -t passed — route config is valid.");
        } else {
          setError(d.error ?? "Validation failed.");
        }
      } else {
        setError(res.error);
      }
    });
  }

  // ── Apply ───────────────────────────────────────────────────────────────────

  function apply() {
    clearMessages();
    startApply(async () => {
      const res = await applyProjectRouteMapAction({ projectId, confirmationText: applyConfirm });
      if (res.ok) {
        setSuccessMsg("Route config applied and nginx reloaded.");
        setHasBackup(true);
        setRouteMap(res.data.routeMap ?? null);
        setNginxPreview(res.data.nginxPreview ?? null);
        setNginxOutput(res.data.nginxOutput ?? null);
        setApplyConfirm("");
      } else {
        setError(res.error);
      }
    });
  }

  // ── Rollback ────────────────────────────────────────────────────────────────

  function rollback() {
    clearMessages();
    startRollback(async () => {
      const res = await rollbackProjectRouteConfigAction(projectId);
      if (res.ok) {
        setSuccessMsg("Route config rolled back to previous version.");
        setNginxOutput(res.data.nginxOutput ?? null);
        setShowRollback(false);
        setHasBackup(false);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Health check ────────────────────────────────────────────────────────────

  function checkHealth() {
    clearMessages();
    startHealth(async () => {
      const res = await checkProjectRouteHealthAction(projectId);
      if (res.ok) {
        setHealthReport(res.data);
      } else {
        setError(res.error);
      }
    });
  }

  const isAnyLoading = loadingPlan || loadingNginx || validating || applying || rollingBack || checkingHealth;
  const needsConfirm = applyConfirm !== "APPLY ROUTES";
  const hasBlockers  = (routeMap?.blockers?.length ?? 0) > 0;

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
            onClick={() => setShowHelp((v) => !v)}
            className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
            title="Help"
          >
            {showHelp ? <ChevronUp className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </button>
        </div>

        {/* Help text */}
        {showHelp && (
          <div className="mt-3 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-2">
            <p>
              <strong>For Replit-style ecommerce apps:</strong> route <code className="font-mono text-xs">/api/*</code> to
              your Node API service and route <code className="font-mono text-xs">/*</code> to the built
              static frontend with SPA fallback.
            </p>
            <p>
              <strong>DNS</strong> must already point to this VPS before routing will work.
              <strong> SSL</strong> must be provisioned from the Domains tab.
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
            <span className="font-mono text-xs text-muted-foreground">Routing domain:</span>
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

        {/* Status messages */}
        {successMsg && (
          <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/10 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            {successMsg}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 rounded-md border border-red-200/60 bg-red-50/40 dark:bg-red-950/10 px-3 py-2">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {/* Route map preview */}
        {routeMap ? (
          <ProjectRoutePreview
            routeMap={routeMap}
            nginxPreview={nginxPreview ?? undefined}
            onRefresh={refreshPlan}
            isLoading={loadingPlan}
          />
        ) : (
          <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            <Zap className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p>Generate a route plan to see how requests will be routed.</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshPlan}
            disabled={isAnyLoading}
          >
            {loadingPlan
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            }
            Generate Plan
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={previewNginx}
            disabled={isAnyLoading}
          >
            {loadingNginx
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
            }
            Preview Config
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={validate}
            disabled={isAnyLoading || !routeMap}
          >
            {validating
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Shield className="h-3.5 w-3.5 mr-1.5" />
            }
            Validate
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={checkHealth}
            disabled={isAnyLoading || !routeMap || !domain}
          >
            {checkingHealth
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Heart className="h-3.5 w-3.5 mr-1.5" />
            }
            Route Health
          </Button>
        </div>

        {/* nginx output */}
        {nginxOutput && (
          <pre className="text-xs font-mono bg-muted/40 border rounded px-3 py-2 overflow-x-auto max-h-32 whitespace-pre">
            {nginxOutput}
          </pre>
        )}

        {/* Health report */}
        {healthReport && (
          <div className="rounded-md border bg-card space-y-0 overflow-hidden">
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
                  : <XCircle      className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <p className={check.ok ? "text-foreground" : "text-red-600 dark:text-red-400"}>
                    {check.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{check.url}</p>
                  {check.error && (
                    <p className="text-xs text-red-500 mt-0.5">{check.error}</p>
                  )}
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
            Writes the nginx config, runs <code className="font-mono">nginx -t</code>, then reloads nginx.
            Type <code className="font-mono font-bold">APPLY ROUTES</code> to confirm.
          </p>

          <input
            type="text"
            value={applyConfirm}
            onChange={(e) => setApplyConfirm(e.target.value)}
            placeholder="Type APPLY ROUTES to confirm"
            disabled={isAnyLoading}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isAnyLoading || needsConfirm || hasBlockers || !routeMap}
              onClick={apply}
              className="flex-1"
            >
              {applying
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Applying…</>
                : <><Zap className="h-4 w-4 mr-1.5" />Apply Routes</>
              }
            </Button>

            {hasBackup && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRollback((v) => !v)}
                disabled={isAnyLoading}
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
                  variant="destructive"
                  size="sm"
                  onClick={rollback}
                  disabled={rollingBack}
                >
                  {rollingBack
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Rolling back…</>
                    : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Confirm Rollback</>
                  }
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowRollback(false)}>
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
