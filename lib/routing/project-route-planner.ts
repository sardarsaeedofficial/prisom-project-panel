/**
 * lib/routing/project-route-planner.ts
 *
 * Sprint 44: Generates a ProjectRouteMap from project services and deployment config.
 *
 * Safety rules:
 *  - Blocks projects.doorstepmanchester.uk (and all reserved hostnames)
 *  - API routes always higher priority than static catch-all
 *  - Only returns paths — never secret values
 *  - Never generates nginx config (that's nginx-route-generator.ts)
 */

import { isReservedHostname } from "@/lib/projects/nginx-manager";
import type { ProjectRouteMap, ProjectRouteRule } from "./project-route-types";

// ── Input shape ───────────────────────────────────────────────────────────────

export type PlannerService = {
  id:              string;
  name:            string;
  slug:            string;
  serviceType:     string;   // "node" | "static"
  internalPort:    number | null;
  healthPath:      string | null;
  staticOutputDir: string | null;
  spaFallback:     boolean;
  isPrimary:       boolean;
  isEnabled:       boolean;
};

export type PlannerDeployConfig = {
  port:           number;
  routeMode:      string;
  apiPrefix:      string;
  staticOutputDir: string | null;
  publicStaticPath: string | null;
  healthPath:     string;
  primaryDomain:  string | null;
};

export type PlannerInput = {
  projectId:      string;
  projectSlug:    string;
  domain:         string | null;
  services:       PlannerService[];
  deployConfig:   PlannerDeployConfig | null;
};

// ── ID generator ──────────────────────────────────────────────────────────────

let _seq = 0;
function ruleId(tag: string): string {
  return `route_${tag}_${(++_seq).toString(36)}`;
}

// ── Path validation ───────────────────────────────────────────────────────────

const SAFE_PATH_RE = /^\/[a-zA-Z0-9_\-*./]*$/;

function isSafePath(p: string): boolean {
  return SAFE_PATH_RE.test(p) && !p.includes("..") && !p.includes("//");
}

// ── Static output path resolution ─────────────────────────────────────────────

function resolveStaticPath(
  deployConfig: PlannerDeployConfig | null,
  service:      PlannerService | null,
): string | null {
  // Absolute published path wins
  if (deployConfig?.publicStaticPath) return deployConfig.publicStaticPath;

  // Static service output dir (relative — needs release base)
  if (service?.staticOutputDir) {
    // Return the relative path — the generator will handle the full path
    return service.staticOutputDir;
  }

  // Deployment config static output dir (relative)
  if (deployConfig?.staticOutputDir) return deployConfig.staticOutputDir;

  return null;
}

// ── Rule builders ─────────────────────────────────────────────────────────────

function buildApiRule(
  svc:        PlannerService,
  apiPrefix:  string,
  warnings:   string[],
): ProjectRouteRule | null {
  if (!svc.internalPort) {
    warnings.push(`Service "${svc.name}" has no port configured — API route skipped.`);
    return null;
  }
  const pattern = apiPrefix.endsWith("/")
    ? apiPrefix + "*"
    : apiPrefix + "/*";

  return {
    id:          ruleId("api"),
    pathPattern: pattern,
    targetType:  "service",
    serviceId:   svc.id,
    serviceName: svc.name,
    targetPort:  svc.internalPort,
    priority:    1,
    healthPath:  svc.healthPath ?? "/api/healthz",
    notes:       `API service — proxied to port ${svc.internalPort}`,
  };
}

function buildStaticRule(
  svc:        PlannerService | null,
  staticPath: string | null,
  warnings:   string[],
): ProjectRouteRule {
  if (!staticPath) {
    warnings.push("No static output path found — static route will fall back to proxy.");
  }

  return {
    id:               ruleId("static"),
    pathPattern:      "/*",
    targetType:       "static",
    serviceId:        svc?.id,
    serviceName:      svc?.name ?? "Static frontend",
    staticOutputPath: staticPath ?? undefined,
    spaFallback:      svc?.spaFallback ?? true,
    priority:         99,
    notes:            staticPath
      ? `Static frontend — root: ${staticPath}${svc?.spaFallback ? " (SPA fallback)" : ""}`
      : "Static frontend — output path not yet configured",
  };
}

function buildProxyOnlyRule(
  port:     number,
  health:   string,
): ProjectRouteRule {
  return {
    id:          ruleId("proxy"),
    pathPattern: "/",
    targetType:  "service",
    targetPort:  port,
    priority:    1,
    healthPath:  health,
    notes:       `Fullstack proxy — all routes → port ${port}`,
  };
}

// ── Conflict detection ────────────────────────────────────────────────────────

function detectConflicts(
  rules:    ProjectRouteRule[],
  blockers: string[],
  warnings: string[],
): void {
  // Duplicate path patterns
  const seenPatterns = new Set<string>();
  for (const r of rules) {
    if (seenPatterns.has(r.pathPattern)) {
      blockers.push(`Duplicate route path pattern: "${r.pathPattern}"`);
    }
    seenPatterns.add(r.pathPattern);
  }

  // Catch-all before API route
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  let foundCatchAll = false;
  for (const r of sorted) {
    if (r.pathPattern === "/" || r.pathPattern === "/*") {
      foundCatchAll = true;
    } else if (foundCatchAll) {
      blockers.push(
        `Route "${r.pathPattern}" (priority ${r.priority}) appears after catch-all — it will never match.`,
      );
    }
  }

  // Missing health path on API service
  for (const r of rules) {
    if (r.targetType === "service" && !r.healthPath) {
      warnings.push(`Route "${r.pathPattern}" has no health path configured.`);
    }
  }

  // Static route without output path
  for (const r of rules) {
    if (r.targetType === "static" && !r.staticOutputPath) {
      warnings.push(`Static route "${r.pathPattern}" has no output path — nginx will not serve files.`);
    }
  }
}

// ── Main planner ──────────────────────────────────────────────────────────────

export function generateProjectRouteMap(input: PlannerInput): ProjectRouteMap {
  _seq = 0;
  const { projectId, domain, services, deployConfig } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const rules:    ProjectRouteRule[] = [];

  // 1. Domain validation
  const effectiveDomain = domain ?? deployConfig?.primaryDomain ?? "";
  if (!effectiveDomain) {
    blockers.push("No domain configured for this project. Add a domain from the Domains tab.");
  } else if (isReservedHostname(effectiveDomain)) {
    blockers.push(
      `"${effectiveDomain}" is a reserved control hostname and cannot be used as a project routing domain.`,
    );
  }

  // 2. Derive route mode
  const routeMode = deployConfig?.routeMode ?? "fullstack_node";
  const apiPrefix = (deployConfig?.apiPrefix ?? "/api").replace(/\/+$/, "");

  // 3. Active enabled services
  const enabledServices = services.filter((s) => s.isEnabled);

  const nodeServices   = enabledServices.filter((s) => s.serviceType === "node");
  const staticServices = enabledServices.filter((s) => s.serviceType === "static");

  const primaryApi    = nodeServices.find((s) => s.isPrimary) ?? nodeServices[0] ?? null;
  const primaryStatic = staticServices.find((s) => s.isPrimary) ?? staticServices[0] ?? null;

  // 4. Build rules based on route mode
  if (routeMode === "static_plus_api" || (nodeServices.length > 0 && staticServices.length > 0)) {
    // Multi-service: API + static
    if (nodeServices.length === 0) {
      warnings.push("No Node.js API service found — only static routing will be configured.");
    }
    if (staticServices.length === 0 && !deployConfig?.staticOutputDir && !deployConfig?.publicStaticPath) {
      warnings.push("No static service or static output path found.");
    }

    // API rule first (higher priority)
    if (primaryApi) {
      const rule = buildApiRule(primaryApi, apiPrefix, warnings);
      if (rule) rules.push(rule);
    } else if (deployConfig && routeMode === "static_plus_api") {
      // Use deployment config port for API
      const rule = buildApiRule(
        {
          id:              "deploy_config",
          name:            "API Service",
          slug:            "api",
          serviceType:     "node",
          internalPort:    deployConfig.port,
          healthPath:      deployConfig.healthPath,
          staticOutputDir: null,
          spaFallback:     false,
          isPrimary:       true,
          isEnabled:       true,
        },
        apiPrefix,
        warnings,
      );
      if (rule) rules.push(rule);
    }

    // Static catch-all (lower priority)
    const staticPath = resolveStaticPath(deployConfig, primaryStatic);
    rules.push(buildStaticRule(primaryStatic, staticPath, warnings));

  } else if (routeMode === "static_only" || (staticServices.length > 0 && nodeServices.length === 0)) {
    // Static only
    const staticPath = resolveStaticPath(deployConfig, primaryStatic);
    rules.push(buildStaticRule(primaryStatic, staticPath, warnings));

    if (!staticPath) {
      blockers.push("Static route mode requires a static output path. Configure staticOutputDir.");
    }

  } else if (routeMode === "api_only" || routeMode === "fullstack_node") {
    // Fullstack / API only
    const port   = primaryApi?.internalPort ?? deployConfig?.port ?? null;
    const health = primaryApi?.healthPath ?? deployConfig?.healthPath ?? "/api/healthz";

    if (!port) {
      blockers.push("No port configured for API service. Set internalPort or configure deployment.");
    } else {
      rules.push(buildProxyOnlyRule(port, health));
    }

  } else {
    // Fallback: try to infer from available services
    if (nodeServices.length > 0) {
      if (primaryApi) {
        const rule = buildApiRule(primaryApi, apiPrefix, warnings);
        if (rule) rules.push(rule);
      }
    }
    if (staticServices.length > 0) {
      const staticPath = resolveStaticPath(deployConfig, primaryStatic);
      rules.push(buildStaticRule(primaryStatic, staticPath, warnings));
    }
    if (rules.length === 0 && deployConfig) {
      rules.push(buildProxyOnlyRule(deployConfig.port, deployConfig.healthPath));
    }
    if (rules.length === 0) {
      blockers.push("Cannot determine route configuration. Configure at least one service or deployment config.");
    }
  }

  // 5. Check if any additional API services need routes (beyond primary)
  for (const svc of nodeServices.filter((s) => s !== primaryApi)) {
    warnings.push(
      `Additional service "${svc.name}" (port ${svc.internalPort ?? "unset"}) is not included in route map. Add a manual route rule if needed.`,
    );
  }

  // 6. Conflict detection
  detectConflicts(rules, blockers, warnings);

  // 7. Sort rules by priority (ascending)
  rules.sort((a, b) => a.priority - b.priority);

  return {
    projectId,
    domain:      effectiveDomain,
    generatedAt: new Date().toISOString(),
    rules,
    warnings,
    blockers,
  };
}
