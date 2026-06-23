"use client";

/**
 * components/projects/project-route-preview.tsx
 *
 * Sprint 44: Visual preview of a ProjectRouteMap.
 * Shows domain, rules in priority order, badges, health paths, warnings/blockers.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Server,
  FileCode2,
  RefreshCw,
  XCircle,
  Shield,
  Zap,
} from "lucide-react";
import { Badge }  from "@/components/ui/badge";
import type { ProjectRouteMap, ProjectRouteRule } from "@/lib/routing/project-route-types";

// ── Rule row ──────────────────────────────────────────────────────────────────

function RouteRuleRow({
  rule,
  index,
}: {
  rule:  ProjectRouteRule;
  index: number;
}) {
  const isApi    = rule.targetType === "service";
  const isStatic = rule.targetType === "static";

  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      {/* Priority number */}
      <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 text-muted-foreground">
        {index + 1}
      </span>

      <div className="flex-1 min-w-0 space-y-1">
        {/* Pattern + target */}
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-sm font-semibold text-foreground">{rule.pathPattern}</code>
          <span className="text-muted-foreground text-sm">→</span>
          <span className="text-sm font-medium truncate">
            {isApi
              ? `${rule.serviceName ?? "API service"}${rule.targetPort ? ` :${rule.targetPort}` : ""}`
              : (rule.serviceName ?? "Static frontend")}
          </span>
          {isApi    && <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/20">API</Badge>}
          {isStatic && <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-purple-50 dark:bg-purple-950/20">Static</Badge>}
          {rule.spaFallback && (
            <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">
              SPA fallback
            </Badge>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {rule.healthPath && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" />
              Health: <code className="font-mono">{rule.healthPath}</code>
            </span>
          )}
          {rule.staticOutputPath && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <FileCode2 className="h-3 w-3" />
              Output: <code className="font-mono text-[11px] truncate max-w-[200px]">{rule.staticOutputPath}</code>
            </span>
          )}
        </div>

        {/* Notes */}
        {rule.notes && (
          <p className="text-xs text-muted-foreground">{rule.notes}</p>
        )}
      </div>

      {/* Type icon */}
      <div className="shrink-0 mt-0.5">
        {isApi
          ? <Server className="h-4 w-4 text-blue-500" />
          : <Globe  className="h-4 w-4 text-purple-500" />
        }
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type ProjectRoutePreviewProps = {
  routeMap:  ProjectRouteMap;
  /** Show the nginx config text inline (collapsed by default) */
  nginxPreview?:  string;
  onRefresh?: () => void;
  isLoading?: boolean;
};

export function ProjectRoutePreview({
  routeMap,
  nginxPreview,
  onRefresh,
  isLoading,
}: ProjectRoutePreviewProps) {
  const hasBlockers = routeMap.blockers.length > 0;
  const hasWarnings = routeMap.warnings.length > 0;

  return (
    <div className="space-y-3">
      {/* Domain banner */}
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-mono text-sm font-medium">{routeMap.domain || "(no domain)"}</span>
        {!hasBlockers && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        {hasBlockers   && <XCircle      className="h-4 w-4 text-red-500" />}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      </div>

      {/* Blockers */}
      {hasBlockers && (
        <div className="rounded-md border border-red-200/60 bg-red-50/40 dark:bg-red-950/10 px-3 py-2 space-y-1">
          {routeMap.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {b}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="rounded-md border border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10 px-3 py-2 space-y-1">
          {routeMap.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Route rules */}
      {routeMap.rules.length > 0 ? (
        <div className="rounded-md border bg-card">
          {routeMap.rules.map((rule, i) => (
            <RouteRuleRow key={rule.id} rule={rule} index={i} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          <Zap className="h-6 w-6 mx-auto mb-2 opacity-30" />
          No route rules generated yet.
        </div>
      )}

      {/* Nginx config preview (collapsed) */}
      {nginxPreview && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1">
            <FileCode2 className="h-3.5 w-3.5" />
            Show nginx config preview
          </summary>
          <pre className="mt-2 text-xs font-mono bg-muted/40 border rounded px-3 py-2 overflow-x-auto max-h-64 whitespace-pre">
            {nginxPreview}
          </pre>
        </details>
      )}
    </div>
  );
}
