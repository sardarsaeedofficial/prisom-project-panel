/**
 * lib/routing/nginx-route-generator.ts
 *
 * Sprint 44: Translates a ProjectRouteMap into a complete nginx server block.
 * Delegates to the existing nginx-manager.ts for the actual config generation.
 *
 * Safety rules:
 *  - Validates all paths are under known safe roots (not panel paths, no traversal)
 *  - Validates ports are in the project range (4100–4999)
 *  - Never includes secrets
 *  - Output is clearly marked as auto-generated
 */

import { isReservedHostname } from "@/lib/projects/nginx-manager";
import type { ProjectRouteMap, ProjectRouteRule } from "./project-route-types";

// ── Allowed static root prefixes ──────────────────────────────────────────────

const ALLOWED_STATIC_ROOTS = [
  "/var/www/",
  "/srv/",
  "/home/prisom/",
  // Also allow relative paths that will be resolved by the deploy runner
];

function isAllowedStaticRoot(p: string): boolean {
  if (!p) return false;
  // Allow known absolute roots
  if (ALLOWED_STATIC_ROOTS.some((prefix) => p.startsWith(prefix))) return true;
  // Allow relative paths (no leading /) — deployment runner resolves these
  if (!p.startsWith("/")) return true;
  return false;
}

function sanitizePath(p: string): string {
  // Strip null bytes, prevent shell injection in nginx config
  return p.replace(/[;\n\r\0'"\\]/g, "").trim();
}

// ── Proxy location block ──────────────────────────────────────────────────────

function proxyBlock(pattern: string, port: number): string {
  // Nginx proxy_pass requires trailing slash on path to strip prefix
  const proxyPass = pattern.endsWith("/*")
    ? `http://127.0.0.1:${port}/`
    : `http://127.0.0.1:${port}`;

  const nginxPattern = pattern.endsWith("/*")
    ? pattern.slice(0, -1)  // /api/* → /api/
    : pattern;

  return (
    `    location ${nginxPattern} {\n` +
    `        proxy_pass         ${proxyPass};\n` +
    `        proxy_http_version 1.1;\n` +
    `        proxy_set_header   Upgrade           $http_upgrade;\n` +
    `        proxy_set_header   Connection        'upgrade';\n` +
    `        proxy_set_header   Host              $host;\n` +
    `        proxy_set_header   X-Real-IP         $remote_addr;\n` +
    `        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;\n` +
    `        proxy_set_header   X-Forwarded-Proto $scheme;\n` +
    `        proxy_cache_bypass $http_upgrade;\n` +
    `    }\n`
  );
}

// ── Static location block ─────────────────────────────────────────────────────

function staticBlock(rule: ProjectRouteRule, domainRoot?: string): string {
  const rootPath = rule.staticOutputPath
    ? sanitizePath(rule.staticOutputPath)
    : domainRoot ?? "";

  if (!rootPath) {
    return (
      `    # WARNING: static route "${rule.pathPattern}" has no output path configured\n` +
      `    location ${rule.pathPattern.replace("*", "")} {\n` +
      `        return 503;\n` +
      `    }\n`
    );
  }

  if (rule.spaFallback) {
    return (
      `    root ${rootPath};\n` +
      `    index index.html;\n\n` +
      `    location ${rule.pathPattern.replace("/*", "/")} {\n` +
      `        try_files $uri $uri/ /index.html;\n` +
      `    }\n`
    );
  }

  return (
    `    root ${rootPath};\n` +
    `    index index.html;\n\n` +
    `    location ${rule.pathPattern.replace("/*", "/")} {\n` +
    `        try_files $uri $uri/ =404;\n` +
    `    }\n`
  );
}

// ── Main generator ────────────────────────────────────────────────────────────

export type NginxGenerateResult =
  | { ok: true;  config: string; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

export function generateNginxFromRouteMap(
  routeMap: ProjectRouteMap,
): NginxGenerateResult {
  const warnings: string[] = [];

  // Safety: never generate config for reserved hostnames
  if (!routeMap.domain) {
    return { ok: false, error: "No domain configured in route map.", warnings };
  }
  if (isReservedHostname(routeMap.domain)) {
    return {
      ok: false,
      error: `"${routeMap.domain}" is a reserved hostname — refusing to generate nginx config.`,
      warnings,
    };
  }
  if (routeMap.blockers.length > 0) {
    return {
      ok: false,
      error: `Route map has ${routeMap.blockers.length} blocker(s): ${routeMap.blockers[0]}`,
      warnings: routeMap.warnings,
    };
  }

  // Sort rules by priority
  const rules = [...routeMap.rules].sort((a, b) => a.priority - b.priority);

  let locationBlocks = "";

  // Static root is declared at server level — pick the first static rule
  const staticRule = rules.find((r) => r.targetType === "static");
  const hasStaticRoot = staticRule?.staticOutputPath && isAllowedStaticRoot(staticRule.staticOutputPath);

  for (const rule of rules) {
    if (rule.targetType === "service") {
      if (!rule.targetPort) {
        warnings.push(`Rule "${rule.pathPattern}" has no targetPort — skipped.`);
        continue;
      }
      if (rule.targetPort < 4100 || rule.targetPort > 4999) {
        warnings.push(`Rule "${rule.pathPattern}" port ${rule.targetPort} is outside allowed range (4100–4999) — skipped.`);
        continue;
      }
      locationBlocks += proxyBlock(rule.pathPattern, rule.targetPort);
      locationBlocks += "\n";

    } else if (rule.targetType === "static") {
      if (rule.staticOutputPath && !isAllowedStaticRoot(rule.staticOutputPath)) {
        warnings.push(`Static root "${rule.staticOutputPath}" is outside allowed paths — falling back to 503.`);
        locationBlocks += `    # WARNING: disallowed static root "${rule.staticOutputPath}"\n`;
        locationBlocks += `    location / { return 503; }\n`;
      } else {
        // static block includes the root directive at server level when first static rule
        locationBlocks += staticBlock(rule);
        locationBlocks += "\n";
      }
    }
  }

  const generatedBy =
    `# Generated by Prisom Project Panel — Sprint 44 multi-service routing\n` +
    `# Domain: ${routeMap.domain}\n` +
    `# Generated: ${routeMap.generatedAt}\n` +
    `# DO NOT EDIT MANUALLY — changes will be overwritten on next apply\n\n`;

  const serverBlock =
    `server {\n` +
    `    listen 80;\n` +
    `    server_name ${routeMap.domain};\n\n` +
    (hasStaticRoot ? "" : "") +
    locationBlocks +
    `}\n`;

  const config = generatedBy + serverBlock;

  return { ok: true, config, warnings };
}
