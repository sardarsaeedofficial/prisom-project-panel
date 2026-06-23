/**
 * lib/routing/planner-loader.ts
 *
 * Shared DB loader for the route planner — used by both the server actions
 * (app/actions/project-routing.ts) and the API routes
 * (app/api/projects/[projectId]/routing/*).
 *
 * Fetches buildCommand + startCommand so classifyService() can distinguish
 * an API Node process from a Vite/React static frontend even when both have
 * serviceType = "node".
 */

import { db }                                 from "@/lib/db";
import type { PlannerInput, PlannerService }  from "./project-route-planner";

export async function loadPlannerInput(projectId: string): Promise<PlannerInput | null> {
  const [project, config, services, domain] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, liveUrl: true },
    }),

    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        port:             true,
        routeMode:        true,
        apiPrefix:        true,
        staticOutputDir:  true,
        publicStaticPath: true,
        healthPath:       true,
        primaryDomain:    true,
      },
    }),

    db.projectService.findMany({
      where:  { projectId },
      select: {
        id:              true,
        name:            true,
        slug:            true,
        serviceType:     true,
        internalPort:    true,
        healthPath:      true,
        staticOutputDir: true,
        spaFallback:     true,
        isPrimary:       true,
        isEnabled:       true,
        buildCommand:    true,
        startCommand:    true,
      },
    }),

    db.domain.findFirst({
      where:   { projectId, status: "ACTIVE", isPrimary: true },
      select:  { hostname: true },
      orderBy: { isPrimary: "desc" },
    }),
  ]);

  if (!project) return null;

  const cfg = config as {
    port: number;
    routeMode: string;
    apiPrefix: string;
    staticOutputDir: string | null;
    publicStaticPath?: string | null;
    healthPath: string;
    primaryDomain?: string | null;
  } | null;

  return {
    projectId,
    projectSlug: project.slug,
    domain:
      domain?.hostname ??
      cfg?.primaryDomain ??
      project.liveUrl?.replace(/^https?:\/\//, "").replace(/\/.*/, "") ??
      null,
    services: services as unknown as PlannerService[],
    deployConfig: cfg
      ? {
          port:             cfg.port,
          routeMode:        cfg.routeMode,
          apiPrefix:        cfg.apiPrefix,
          staticOutputDir:  cfg.staticOutputDir,
          publicStaticPath: cfg.publicStaticPath ?? null,
          healthPath:       cfg.healthPath,
          primaryDomain:    cfg.primaryDomain ?? null,
        }
      : null,
  };
}
