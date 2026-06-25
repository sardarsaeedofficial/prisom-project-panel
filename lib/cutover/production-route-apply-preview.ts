/**
 * lib/cutover/production-route-apply-preview.ts
 *
 * Sprint 65: Read-only preview of the production nginx route plan.
 *
 * Safety:
 *  - no nginx writes
 *  - no reload
 *  - panel domain blocked
 *  - Doorsteps/LocalShop blocked
 *  - live Sardar domain allowed only as the project domain target
 */

import { db } from "@/lib/db";
import type {
  ProductionRouteApplyPreview,
  ProductionExecutionStatus,
} from "./production-execution-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE_SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const PANEL_DOMAIN       = "projects.doorstepmanchester.uk";
const BLOCKED_DOMAINS    = [PANEL_DOMAIN, "doorstepmanchester.uk"];

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateProductionRouteApplyPreview(input: {
  projectId: string;
}): Promise<ProductionRouteApplyPreview> {
  const { projectId } = input;

  const [project, deployConfig, domains, services] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }).catch(() => null),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        pm2Name:      true,
        port:         true,
        routeMode:    true,
        primaryDomain: true,
      } as Parameters<typeof db.projectDeploymentConfig.findUnique>[0]["select"],
    }).catch(() => null),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }).catch(() => []),
    db.projectService.findMany({
      where:  { projectId },
      select: { name: true, serviceType: true },
    }).catch(() => []),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const domain = primaryDomain?.hostname ?? (deployConfig as { primaryDomain?: string } | null)?.primaryDomain ?? LIVE_SARDAR_DOMAIN;

  const blockers: string[] = [];
  const warnings: string[] = [];

  // Safety checks
  for (const blocked of BLOCKED_DOMAINS) {
    if (domain === blocked) {
      blockers.push(`Domain "${domain}" is a blocked production domain. Do not target the panel or Doorsteps root.`);
    }
  }
  if (!project) {
    blockers.push("Source project not found");
  }

  if (!deployConfig) {
    warnings.push("No deployment config — set up in Publishing page");
  }
  if (services.length < 2) {
    warnings.push(`Only ${services.length} service(s) configured — expected API + static frontend`);
  }
  if (primaryDomain?.sslStatus !== "ACTIVE") {
    warnings.push(`SSL not active on ${domain}`);
  }

  // ── Route entries ──────────────────────────────────────────────────────────

  const pm2Name = (deployConfig as { pm2Name?: string } | null)?.pm2Name ?? "project-<slug>";
  const port    = (deployConfig as { port?: number } | null)?.port ?? 4100;

  const routes: ProductionRouteApplyPreview["routes"] = [
    {
      path:    "/api/*",
      target:  `http://127.0.0.1:${port} (${pm2Name})`,
      type:    "api",
      message: `API requests proxied to Node.js service on port ${port}`,
    },
    {
      path:    "/*",
      target:  "artifacts/sardar-security/dist/public (static + SPA fallback)",
      type:    "static",
      message: "All other requests served from static build output with SPA fallback (try_files $uri $uri/ /index.html)",
    },
    {
      path:    "/* (SPA fallback)",
      target:  "artifacts/sardar-security/dist/public/index.html",
      type:    "spa_fallback",
      message: "404 on unknown routes falls back to index.html — required for client-side routing",
    },
  ];

  // ── Nginx preview lines (illustrative, never written) ─────────────────────

  const nginxPreview = [
    `# Production nginx preview for ${domain}`,
    `# PREVIEW ONLY — not written to disk`,
    "",
    `server {`,
    `  listen 443 ssl;`,
    `  server_name ${domain};`,
    "",
    `  # API proxy`,
    `  location /api/ {`,
    `    proxy_pass http://127.0.0.1:${port}/api/;`,
    `    proxy_http_version 1.1;`,
    `    proxy_set_header Upgrade $http_upgrade;`,
    `    proxy_set_header Connection 'upgrade';`,
    `    proxy_set_header Host $host;`,
    `    proxy_cache_bypass $http_upgrade;`,
    `  }`,
    "",
    `  # Static frontend with SPA fallback`,
    `  location / {`,
    `    root /path/to/artifacts/sardar-security/dist/public;`,
    `    try_files $uri $uri/ /index.html;`,
    `  }`,
    `}`,
  ];

  const overallStatus: ProductionExecutionStatus =
    blockers.length > 0 ? "blocked" :
    warnings.length > 0 ? "warning" :
    "ready";

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    domain,
    status:       overallStatus,
    routes,
    nginxPreview,
    blockers,
    warnings,
  };
}
