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

// ── Service classification ────────────────────────────────────────────────────
//
// Services can have serviceType="node" even if they are static frontends
// (e.g. a Vite/React build served by a static file server, or a service whose
// serviceType wasn't set during Replit migration). Use multiple signals to
// classify correctly so that Sardar-style ecommerce projects get API+static
// routing rather than falling back to fullstack_node proxy.

type ServiceClass = "api" | "static_frontend";

function classifyService(svc: PlannerService): ServiceClass {
  // Explicit static serviceType is always static
  if (svc.serviceType === "static") return "static_frontend";

  const nameLower  = svc.name.toLowerCase();
  const slugLower  = svc.slug.toLowerCase();
  const combined   = `${nameLower} ${slugLower}`;
  const outDir     = (svc.staticOutputDir ?? "").toLowerCase();

  // SPA fallback is a strong static signal
  if (svc.spaFallback) return "static_frontend";

  // Static output directories that end with common build output patterns
  // e.g. artifacts/sardar-security/dist/public, dist/public, build, out
  const staticDirPatterns = [
    /\/dist\/public$/,
    /\/dist$/,
    /\/build$/,
    /\/out$/,
    /\/public$/,
    /\/www$/,
    /\/static$/,
  ];
  if (outDir && staticDirPatterns.some((re) => re.test(outDir))) return "static_frontend";

  // Name / slug keywords indicating a static frontend
  const staticKeywords = [
    "frontend",
    "static",
    "vite",
    "react",
    "nextjs",
    "web-app",
    "webapp",
    "spa",
    "client",
    "ui",
    "dist",
  ];
  // API keywords — if a name matches BOTH, API wins
  const apiKeywords = [
    "api",
    "backend",
    "server",
    "express",
    "fastify",
    "hapi",
    "koa",
  ];

  const hasStaticKw = staticKeywords.some((k) => combined.includes(k));
  const hasApiKw    = apiKeywords.some((k) => combined.includes(k));

  if (hasStaticKw && !hasApiKw) return "static_frontend";

  // Health paths containing /api suggest an API service
  const healthPath = (svc.healthPath ?? "").toLowerCase();
  if (healthPath.includes("/api")) return "api";

  // Default: a node service with a port is an API
  return "api";
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

  // 2. Derive route mode + prefix
  const routeMode = deployConfig?.routeMode ?? "fullstack_node";
  const apiPrefix = (deployConfig?.apiPrefix ?? "/api").replace(/\/+$/, "");

  // 3. Active enabled services — classified by heuristic
  const enabledServices = services.filter((s) => s.isEnabled);

  const classifiedServices = enabledServices.map((svc) => ({
    svc,
    cls: classifyService(svc),
  }));

  const apiServices    = classifiedServices.filter((x) => x.cls === "api").map((x) => x.svc);
  const staticServices = classifiedServices.filter((x) => x.cls === "static_frontend").map((x) => x.svc);

  // Legacy-typed services (for backwards compat — nodeServices still used below)
  const nodeServices   = enabledServices.filter((s) => s.serviceType === "node");

  const primaryApi    = apiServices.find((s) => s.isPrimary) ?? apiServices[0] ?? null;
  const primaryStatic = staticServices.find((s) => s.isPrimary) ?? staticServices[0] ?? null;

  // Determine whether to use multi-service (API + static) routing.
  // NEVER fall back to fullstack_node when we can detect a static frontend.
  const hasStaticOutput =
    !!(deployConfig?.staticOutputDir) ||
    !!(deployConfig?.publicStaticPath) ||
    staticServices.length > 0;

  const useMultiService =
    routeMode === "static_plus_api" ||
    (apiServices.length > 0 && hasStaticOutput) ||
    (staticServices.length > 0 && apiServices.length > 0);

  const useStaticOnly =
    routeMode === "static_only" ||
    (staticServices.length > 0 && apiServices.length === 0 && nodeServices.length === 0);

  // 4. Build rules
  if (useMultiService) {
    if (apiServices.length === 0) {
      warnings.push("No API service detected — only static routing will be configured.");
    }
    if (!hasStaticOutput) {
      warnings.push("No static service or static output path found.");
    }

    // API rule (priority 1)
    if (primaryApi) {
      const rule = buildApiRule(primaryApi, apiPrefix, warnings);
      if (rule) rules.push(rule);
    } else if (deployConfig && routeMode === "static_plus_api") {
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

    // Static catch-all (priority 99)
    const staticPath = resolveStaticPath(deployConfig, primaryStatic);
    rules.push(buildStaticRule(primaryStatic, staticPath, warnings));

  } else if (useStaticOnly) {
    const staticPath = resolveStaticPath(deployConfig, primaryStatic);
    rules.push(buildStaticRule(primaryStatic, staticPath, warnings));

    if (!staticPath) {
      blockers.push("Static route mode requires a static output path. Configure staticOutputDir.");
    }

  } else if (routeMode === "api_only" || routeMode === "fullstack_node") {
    // Fullstack / API only — no static frontend detected
    const port   = primaryApi?.internalPort ?? deployConfig?.port ?? null;
    const health = primaryApi?.healthPath ?? deployConfig?.healthPath ?? "/api/healthz";

    if (!port) {
      blockers.push("No port configured for API service. Set internalPort or configure deployment.");
    } else {
      rules.push(buildProxyOnlyRule(port, health));
    }

  } else {
    // Fallback: infer from whatever is available
    if (apiServices.length > 0 && primaryApi) {
      const rule = buildApiRule(primaryApi, apiPrefix, warnings);
      if (rule) rules.push(rule);
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

  // 5. Warn about additional API services not included in the route map
  for (const svc of apiServices.filter((s) => s !== primaryApi)) {
    warnings.push(
      `Additional service "${svc.name}" (port ${svc.internalPort ?? "unset"}) is not included in the route map. Add a manual route rule if needed.`,
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
