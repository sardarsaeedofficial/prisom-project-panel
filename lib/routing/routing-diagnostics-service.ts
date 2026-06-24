/**
 * lib/routing/routing-diagnostics-service.ts
 *
 * Sprint 52: Routing diagnostics — runs 13+ checks to confirm the routing
 * workflow is safe and ready before any apply.
 *
 * Safety:
 *  - Read-only — never writes nginx config
 *  - Never reloads nginx
 *  - Reserved hostnames blocked
 *  - Protected Doorsteps/LocalShop configs detected and blocked
 *  - No secrets in output
 */

import { isReservedHostname }         from "@/lib/projects/nginx-manager";
import { loadPlannerInput }            from "@/lib/routing/planner-loader";
import { generateProjectRouteMap }     from "@/lib/routing/project-route-planner";
import { generateNginxFromRouteMap }   from "@/lib/routing/nginx-route-generator";
import { hasBackupConfig }             from "@/lib/routing/nginx-route-apply";
import type {
  RoutingDiagnosticsReport,
  RoutingDiagnosticCheck,
  RoutingDiagnosticStatus,
}                                      from "@/lib/routing/routing-diagnostics-types";

// ── Check builders ────────────────────────────────────────────────────────────

function pass(id: string, label: string, message: string, evidence?: string[]): RoutingDiagnosticCheck {
  return { id, label, status: "pass", message, evidence };
}

function warn(id: string, label: string, message: string, evidence?: string[], fixHref?: string): RoutingDiagnosticCheck {
  return { id, label, status: "warning", message, evidence, fixHref };
}

function fail(id: string, label: string, message: string, evidence?: string[], fixHref?: string): RoutingDiagnosticCheck {
  return { id, label, status: "fail", message, evidence, fixHref };
}

// ── Main diagnostics runner ───────────────────────────────────────────────────

export async function generateRoutingDiagnostics(
  projectId: string,
): Promise<RoutingDiagnosticsReport> {
  const checks:   RoutingDiagnosticCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Load planner input ─────────────────────────────────────────────────────

  const input = await loadPlannerInput(projectId).catch(() => null);

  if (!input) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      status:      "blocked",
      domain:      null,
      checks:      [fail("load", "Load project data", "Project not found or DB error.", [])],
      blockers:    ["Could not load project data."],
      warnings:    [],
      nextSteps:   ["Verify the project exists and try again."],
    };
  }

  const domain = input.domain ?? null;

  // ── 1. Domain exists ────────────────────────────────────────────────────────

  if (!domain) {
    checks.push(fail(
      "domain-exists",
      "Domain configured",
      "No domain configured for this project.",
      [],
      `/projects/${projectId}/domains`,
    ));
    blockers.push("No domain configured. Add a domain from the Domains tab.");
  } else {
    checks.push(pass("domain-exists", "Domain configured", `Domain: ${domain}`, [domain]));
  }

  // ── 2. Domain is not panel/reserved ─────────────────────────────────────────

  if (domain) {
    if (isReservedHostname(domain)) {
      checks.push(fail(
        "domain-not-panel",
        "Domain is not a reserved hostname",
        `"${domain}" is a reserved hostname (panel, Doorsteps, or bare IP). Routing to this domain is blocked.`,
        [domain],
        `/projects/${projectId}/domains`,
      ));
      blockers.push(`"${domain}" is a reserved hostname — routing blocked.`);
    } else {
      checks.push(pass("domain-not-panel", "Domain is not a reserved hostname", `${domain} is not a reserved hostname.`));
    }
  }

  // ── 3. Nginx ownership check ─────────────────────────────────────────────────

  if (domain && !isReservedHostname(domain)) {
    try {
      const { scanNginxOwnership } = await import("@/lib/domains/nginx-ownership-scanner");
      const nginx = await scanNginxOwnership({ domain, projectId });

      {
        if (nginx.protectedConfig) {
          checks.push(fail(
            "nginx-ownership",
            "Nginx config ownership",
            `This domain's nginx config is a protected system config (Doorsteps/LocalShop). It must not be overwritten.`,
            [nginx.message],
          ));
          blockers.push("Protected nginx config detected — apply blocked.");
        } else if (nginx.conflict && nginx.ownerProjectId && nginx.ownerProjectId !== projectId) {
          checks.push(warn(
            "nginx-ownership",
            "Nginx config ownership",
            `This domain may already be configured by project "${nginx.ownerProjectSlug ?? nginx.ownerProjectId}". Applying will overwrite their config.`,
            [nginx.message],
          ));
          warnings.push(`Domain "${domain}" is currently owned by another project.`);
        } else {
          checks.push(pass(
            "nginx-ownership",
            "Nginx config ownership",
            nginx.managedByPrisom
              ? `Config is managed by Prisom Projects (${nginx.configPath ?? "this project"}).`
              : "No conflicting config detected.",
            [nginx.message],
          ));
        }
      }
    } catch {
      checks.push(warn(
        "nginx-ownership",
        "Nginx config ownership",
        "Could not scan nginx config ownership (check may be unavailable in this environment).",
      ));
    }
  }

  // ── 4. Services exist ────────────────────────────────────────────────────────

  const enabledServices = input.services.filter((s) => s.isEnabled);

  if (enabledServices.length === 0) {
    checks.push(fail(
      "services-exist",
      "Services configured",
      "No enabled services found. Add at least one service to configure routing.",
      [],
      `/projects/${projectId}/services`,
    ));
    blockers.push("No services configured.");
  } else {
    checks.push(pass(
      "services-exist",
      "Services configured",
      `${enabledServices.length} enabled service${enabledServices.length > 1 ? "s" : ""} found.`,
      enabledServices.map((s) => `${s.name} (${s.serviceType})`),
    ));
  }

  // ── 5. API service detected ──────────────────────────────────────────────────

  const apiServiceHeuristics = enabledServices.filter((svc) => {
    // Strong API signals
    if ((svc.healthPath ?? "").includes("/api")) return true;
    if (/\bnode\s+dist\/index/.test(svc.startCommand ?? "")) return true;
    if (/\bnode\s+src\/index/.test(svc.startCommand ?? "")) return true;
    if (/\bapi/.test(svc.name.toLowerCase() + " " + svc.slug.toLowerCase())) return true;
    if ((svc.serviceType === "node" || svc.serviceType === "api") && svc.internalPort) return true;
    return false;
  });

  if (apiServiceHeuristics.length === 0 && enabledServices.length > 0) {
    checks.push(warn(
      "api-service-detected",
      "API service detected",
      "No API service clearly identified. If this is a static-only project this is fine; otherwise configure a service with /api health path or 'api' in its name.",
    ));
    warnings.push("No API service detected — only static routing may be configured.");
  } else if (apiServiceHeuristics.length > 0) {
    checks.push(pass(
      "api-service-detected",
      "API service detected",
      `API service(s): ${apiServiceHeuristics.map((s) => s.name).join(", ")}`,
      apiServiceHeuristics.map((s) => `${s.name} port:${s.internalPort ?? "unset"}`),
    ));
  }

  // ── 6. Static frontend detected ──────────────────────────────────────────────

  const staticServiceHeuristics = enabledServices.filter((svc) => {
    if (svc.serviceType === "static") return true;
    if (svc.spaFallback) return true;
    if (/\bvite\b/.test(svc.buildCommand ?? "")) return true;
    if (/react-scripts\s+build/.test(svc.buildCommand ?? "")) return true;
    if ((svc.staticOutputDir ?? "").includes("/dist/") || (svc.staticOutputDir ?? "").includes("/build/")) return true;
    const combined = svc.name.toLowerCase() + " " + svc.slug.toLowerCase();
    if (["frontend", "static", "vite", "spa", "client", "ui"].some((k) => combined.includes(k))) return true;
    return false;
  });

  if (staticServiceHeuristics.length === 0 && enabledServices.length > 0) {
    checks.push(warn(
      "static-frontend-detected",
      "Static frontend detected",
      "No static frontend service detected. For API-only projects this is expected; for ecommerce apps ensure the frontend service is configured.",
    ));
  } else if (staticServiceHeuristics.length > 0) {
    checks.push(pass(
      "static-frontend-detected",
      "Static frontend detected",
      `Static frontend(s): ${staticServiceHeuristics.map((s) => s.name).join(", ")}`,
      staticServiceHeuristics.map((s) => s.staticOutputDir ?? `${s.name} (output path not set)`),
    ));
  }

  // ── 7. SPA fallback ──────────────────────────────────────────────────────────

  const spaService = staticServiceHeuristics.find((s) => s.spaFallback);
  const couldBeSpa = staticServiceHeuristics.length > 0 && !spaService;

  if (couldBeSpa) {
    checks.push(warn(
      "spa-fallback",
      "SPA fallback enabled",
      "Static frontend detected but SPA fallback is not enabled. React/Vite apps require SPA fallback for client-side routing.",
      [],
      `/projects/${projectId}/services`,
    ));
    warnings.push("SPA fallback not enabled on static frontend service.");
  } else if (spaService) {
    checks.push(pass(
      "spa-fallback",
      "SPA fallback enabled",
      `SPA fallback is enabled on "${spaService.name}".`,
    ));
  } else {
    checks.push(pass(
      "spa-fallback",
      "SPA fallback",
      "No static frontend — SPA fallback check not applicable.",
    ));
  }

  // ── 8. Route plan: generates without blockers ───────────────────────────────

  let routeMap = null;
  try {
    routeMap = generateProjectRouteMap(input);

    if (routeMap.blockers.length > 0) {
      checks.push(fail(
        "route-plan",
        "Route plan valid",
        `Route plan has ${routeMap.blockers.length} blocker(s): ${routeMap.blockers[0]}`,
        routeMap.blockers,
      ));
      blockers.push(...routeMap.blockers.filter((b) => !blockers.includes(b)));
    } else if (routeMap.rules.length === 0) {
      checks.push(fail(
        "route-plan",
        "Route plan valid",
        "Route plan is empty — no routes generated.",
        [],
        `/projects/${projectId}/services`,
      ));
      blockers.push("Route plan is empty.");
    } else {
      checks.push(pass(
        "route-plan",
        "Route plan valid",
        `${routeMap.rules.length} route rule(s) generated.`,
        routeMap.rules.map((r) => `${r.pathPattern} → ${r.targetType}${r.targetPort ? ` :${r.targetPort}` : ""}`),
      ));
    }
  } catch (e) {
    checks.push(fail(
      "route-plan",
      "Route plan valid",
      `Route plan generation failed: ${e instanceof Error ? e.message : String(e)}`,
    ));
    blockers.push("Route plan generation failed.");
  }

  // ── 9. API route includes /api/* ─────────────────────────────────────────────

  if (routeMap && apiServiceHeuristics.length > 0) {
    const apiRule = routeMap.rules.find(
      (r) => r.targetType === "service" && r.pathPattern.startsWith("/api"),
    );
    if (!apiRule) {
      checks.push(warn(
        "route-plan-api",
        "Route plan includes /api/*",
        "API service detected but no /api/* route rule found in the plan. Check apiPrefix configuration.",
        [],
        `/projects/${projectId}/services`,
      ));
      warnings.push("API service detected but no /api/* route rule.");
    } else {
      checks.push(pass(
        "route-plan-api",
        "Route plan includes /api/*",
        `API route: ${apiRule.pathPattern} → port ${apiRule.targetPort}`,
        [apiRule.notes ?? ""],
      ));
    }
  }

  // ── 10. Static route includes /* ────────────────────────────────────────────

  if (routeMap && staticServiceHeuristics.length > 0) {
    const staticRule = routeMap.rules.find((r) => r.targetType === "static");
    if (!staticRule) {
      checks.push(warn(
        "route-plan-static",
        "Route plan includes /* static",
        "Static frontend detected but no static catch-all route found in the plan.",
        [],
        `/projects/${projectId}/services`,
      ));
      warnings.push("Static frontend detected but no static catch-all route.");
    } else {
      checks.push(pass(
        "route-plan-static",
        "Route plan includes /* static",
        `Static route: ${staticRule.pathPattern}${staticRule.staticOutputPath ? ` → ${staticRule.staticOutputPath}` : ""}${staticRule.spaFallback ? " (SPA fallback)" : ""}`,
        staticRule.staticOutputPath ? [staticRule.staticOutputPath] : [],
      ));
    }
  }

  // ── 11. Nginx preview generates ──────────────────────────────────────────────

  if (routeMap && routeMap.blockers.length === 0) {
    try {
      const genResult = generateNginxFromRouteMap(routeMap);
      if (!genResult.ok) {
        checks.push(fail(
          "nginx-preview",
          "Nginx config preview",
          `Nginx config generation failed: ${genResult.error}`,
          genResult.warnings,
        ));
        blockers.push("Nginx config preview generation failed.");
      } else {
        checks.push(pass(
          "nginx-preview",
          "Nginx config preview",
          `Preview generated (${genResult.config.split("\n").length} lines).`,
          genResult.warnings.length > 0 ? genResult.warnings : undefined,
        ));
        if (genResult.warnings.length > 0) {
          warnings.push(...genResult.warnings.filter((w) => !warnings.includes(w)));
        }
      }
    } catch (e) {
      checks.push(fail(
        "nginx-preview",
        "Nginx config preview",
        `Nginx config generation threw: ${e instanceof Error ? e.message : String(e)}`,
      ));
    }
  }

  // ── 12. Sardar ecommerce: both API + static routes present ──────────────────

  if (routeMap) {
    try {
      const { isSardarProject } = await import("@/lib/migration/sardar-migration-types");
      const isSardar =
        input.services.some((s) => isSardarProject(s.name) || isSardarProject(s.slug)) ||
        (domain ? isSardarProject(domain) : false);

      if (isSardar) {
        const hasApiRoute    = routeMap.rules.some((r) => r.targetType === "service" && r.pathPattern.startsWith("/api"));
        const hasStaticRoute = routeMap.rules.some((r) => r.targetType === "static");

        if (!hasApiRoute || !hasStaticRoute) {
          checks.push(fail(
            "sardar-split",
            "Sardar ecommerce API + static split",
            `Sardar ecommerce project should have /api/* (API) + /* (static frontend). Missing: ${[!hasApiRoute && "/api/*", !hasStaticRoute && "/*"].filter(Boolean).join(", ")}.`,
            [],
            `/projects/${projectId}/services`,
          ));
          blockers.push("Sardar ecommerce project does not have the expected API + static route split.");
        } else {
          checks.push(pass(
            "sardar-split",
            "Sardar ecommerce API + static split",
            "Route plan correctly splits /api/* to API service and /* to static frontend.",
          ));
        }
      }
    } catch { /* non-fatal — Sardar check is best-effort */ }
  }

  // ── 13. Rollback snapshot exists ─────────────────────────────────────────────

  if (domain && !isReservedHostname(domain)) {
    const hasBackup = await hasBackupConfig(domain).catch(() => false);
    if (hasBackup) {
      checks.push(pass(
        "rollback-snapshot",
        "Rollback snapshot available",
        "A backup nginx config exists and can be restored if apply fails.",
      ));
    } else {
      checks.push(warn(
        "rollback-snapshot",
        "Rollback snapshot available",
        "No backup config found. After applying routes for the first time, a rollback snapshot will be created automatically.",
      ));
      warnings.push("No rollback snapshot available yet (created automatically on first apply).");
    }
  }

  // ── 14. Health endpoint configured ──────────────────────────────────────────

  const hasHealthEndpoint = enabledServices.some((s) => s.healthPath);
  if (!hasHealthEndpoint && apiServiceHeuristics.length > 0) {
    checks.push(warn(
      "health-endpoint",
      "Health endpoint configured",
      "No health endpoint (healthPath) is configured on any service. Health checks will use /api/healthz as default.",
    ));
    warnings.push("No explicit health endpoint configured on any service.");
  } else if (hasHealthEndpoint) {
    checks.push(pass(
      "health-endpoint",
      "Health endpoint configured",
      `Health path(s): ${enabledServices.filter((s) => s.healthPath).map((s) => s.healthPath).join(", ")}`,
    ));
  }

  // ── Compute overall status ────────────────────────────────────────────────────

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warning");

  const status: RoutingDiagnosticStatus = hasFail ? "blocked" : hasWarn ? "warning" : "ready";

  // ── Next steps ────────────────────────────────────────────────────────────────

  const nextSteps: string[] = [];

  if (blockers.length > 0) {
    nextSteps.push("Resolve all blockers before attempting to apply routes.");
  }
  if (!domain) {
    nextSteps.push("Add a domain from the Domains tab.");
  }
  if (enabledServices.length === 0) {
    nextSteps.push("Configure at least one service.");
  }
  if (status === "ready") {
    nextSteps.push("Run 'Validate Dry Run' to confirm nginx config syntax is valid.");
    nextSteps.push("Review nginx preview config before applying.");
    nextSteps.push("Type APPLY ROUTES to apply routes when ready.");
  } else if (status === "warning") {
    nextSteps.push("Review warnings above — most can be resolved before applying.");
    nextSteps.push("Run 'Validate Dry Run' to confirm no blockers remain.");
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    domain,
    checks,
    blockers,
    warnings,
    nextSteps,
  };
}
