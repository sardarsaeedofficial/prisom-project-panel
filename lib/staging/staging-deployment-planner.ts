/**
 * lib/staging/staging-deployment-planner.ts
 *
 * Sprint 64: Generate a staging deployment plan for Sardar Security Supplies.
 *
 * Safety: read-only, no secrets returned, no production mutation.
 */

import { db } from "@/lib/db";
import {
  assertSafeStagingTarget,
  DEFAULT_STAGING_SLUG,
  DEFAULT_STAGING_DOMAIN,
} from "./staging-target-guard";
import type {
  StagingDeploymentPlan,
  StagingDeploymentStatus,
  StagingDeploymentStep,
  StagingServicePlan,
} from "./staging-deployment-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE_SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const LIVE_SARDAR_PORT   = 4100;

const SARDAR_SERVICE_PLAN: StagingServicePlan[] = [
  {
    name:         "api",
    kind:         "api",
    root:         "artifacts/api-server",
    buildCommand: "pnpm --filter @workspace/api-server run build",
    startCommand: "node --enable-source-maps artifacts/api-server/dist/index.mjs",
    healthPath:   "/api/healthz",
    route:        "/api/*",
  },
  {
    name:         "web",
    kind:         "static",
    root:         "artifacts/sardar-security",
    buildCommand: "pnpm --filter @workspace/sardar-security run build",
    outputPath:   "artifacts/sardar-security/dist/public",
    route:        "/*",
  },
];

const DB_NAMES   = ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL", "MONGO_URL"];
const STRIPE_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function step(s: Omit<StagingDeploymentStep, "message"> & { message?: string }): StagingDeploymentStep {
  return { message: "", ...s } as StagingDeploymentStep;
}

function deriveStatus(steps: StagingDeploymentStep[]): StagingDeploymentStatus {
  if (steps.some((s) => s.status === "fail" && s.required)) return "blocked";
  if (steps.some((s) => s.status === "warning" && s.required)) return "warning";
  const nonManual = steps.filter((s) => s.required);
  if (nonManual.every((s) => s.status === "pass" || s.status === "manual")) return "ready";
  return "warning";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateStagingDeploymentPlan(input: {
  projectId:     string;
  stagingSlug?:  string;
  stagingDomain?: string;
}): Promise<StagingDeploymentPlan> {
  const {
    projectId,
    stagingSlug  = DEFAULT_STAGING_SLUG,
    stagingDomain = DEFAULT_STAGING_DOMAIN,
  } = input;

  const p = (href: string) => `/projects/${projectId}${href}`;

  // Guard (non-fatal — we record the result in the plan)
  let guardError: string | null = null;
  try {
    await assertSafeStagingTarget({ sourceProjectId: projectId, stagingSlug, stagingDomain });
  } catch (err) {
    guardError = err instanceof Error ? err.message : String(err);
  }

  // ── DB queries ──────────────────────────────────────────────────────────────

  const [
    project,
    deployConfig,
    envNames,
    serviceCount,
    stagingProject,
    successfulDeployCount,
  ] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }).catch(() => null),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        pm2Name: true, port: true,
        dbConnStatus: true, routeMode: true,
      } as Parameters<typeof db.projectDeploymentConfig.findUnique>[0]["select"],
    }).catch(() => null),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }).catch(() => []),
    db.projectService.count({ where: { projectId } }).catch(() => 0),
    db.project.findFirst({
      where:  { slug: stagingSlug },
      select: { id: true, slug: true },
    }).catch(() => null),
    db.deployment.count({ where: { projectId, status: "SUCCESS" } }).catch(() => 0),
  ]);

  const envSet    = new Set(envNames.map((e) => e.name));
  const hasDbEnv  = DB_NAMES.some((n) => envSet.has(n));
  const hasStripe = STRIPE_NAMES.filter((n) => envSet.has(n)).length;
  const pm2Name   = (deployConfig as { pm2Name?: string } | null)?.pm2Name ?? "";
  const port      = (deployConfig as { port?: number } | null)?.port ?? 0;

  const isLiveSardarPort = port === LIVE_SARDAR_PORT;
  const liveUrl = project?.liveUrl ?? "";
  const isLiveSardarUrl = liveUrl.includes(LIVE_SARDAR_DOMAIN);

  // ── Build steps ──────────────────────────────────────────────────────────────

  const steps: StagingDeploymentStep[] = [

    // ── Target ─────────────────────────────────────────────────────────────

    step({
      id:       "target-guard",
      stage:    "target",
      label:    "Staging target is safe",
      status:   guardError ? "fail" : "pass",
      required: true,
      message:  guardError ?? `Staging target "${stagingSlug}" / "${stagingDomain}" is safe.`,
      linkHref: p("/migration"),
    }),
    step({
      id:       "target-not-live",
      stage:    "target",
      label:    "Target is not live Sardar production",
      status:   (isLiveSardarPort || isLiveSardarUrl) ? "fail" : "pass",
      required: true,
      message:  (isLiveSardarPort || isLiveSardarUrl)
        ? `Source project appears to be the live Sardar instance (port ${LIVE_SARDAR_PORT} / ${LIVE_SARDAR_DOMAIN}). Do not deploy staging to this target.`
        : "Source project is not targeting live Sardar production.",
      warning:  "Never use staging config against the live Sardar PM2 process or port 4100.",
    }),
    step({
      id:       "target-staging-project",
      stage:    "target",
      label:    `Staging project slug: ${stagingSlug}`,
      status:   stagingProject ? "pass" : "manual",
      required: false,
      message:  stagingProject
        ? `Staging project "${stagingSlug}" already exists in the panel.`
        : `Staging project "${stagingSlug}" not found in the panel. It will be created or set up externally.`,
      linkHref: p("/migration"),
    }),
    step({
      id:       "target-staging-domain",
      stage:    "target",
      label:    `Staging domain: ${stagingDomain}`,
      status:   "manual",
      required: true,
      message:  `Staging domain must resolve to staging server. Verify DNS points to staging before smoke checks.`,
      warning:  "If DNS is not configured, smoke checks will return warnings (not failures).",
    }),

    // ── Source ─────────────────────────────────────────────────────────────

    step({
      id:       "source-project",
      stage:    "source",
      label:    `Source project: ${project?.slug ?? projectId}`,
      status:   project ? "pass" : "warning",
      required: true,
      message:  project
        ? `Source project "${project.name}" found.`
        : "Source project not found. Verify project ID.",
      linkHref: p("/import"),
    }),
    step({
      id:       "source-deploy-config",
      stage:    "source",
      label:    "Deployment config exists",
      status:   deployConfig ? "pass" : "warning",
      required: false,
      message:  deployConfig
        ? `Deployment config found (PM2: ${pm2Name}, port: ${port}).`
        : "No deployment config — set it up on the Publishing page.",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "source-pnpm-workspace",
      stage:    "source",
      label:    "pnpm workspace detected (expected for Sardar)",
      status:   "manual",
      required: true,
      message:  "Verify pnpm-workspace.yaml exists at project root. Sardar Security is a pnpm monorepo.",
      linkHref: p("/import"),
      command:  "cat pnpm-workspace.yaml",
    }),
    step({
      id:       "source-package-json",
      stage:    "source",
      label:    "Root package.json verified",
      status:   "manual",
      required: true,
      message:  "Verify root package.json defines the workspaces and install command.",
      linkHref: p("/import"),
      command:  "cat package.json",
    }),
    step({
      id:       "source-not-overwrite",
      stage:    "source",
      label:    "Live source must not be overwritten",
      status:   "pass",
      required: true,
      message:  "Source preparation is plan-only. No file copy happens without explicit PREPARE STAGING SOURCE confirmation.",
      warning:  "Never overwrite /home/prisom/prisom-project-panel or the live Sardar project directory.",
    }),

    // ── Services ───────────────────────────────────────────────────────────

    step({
      id:       "services-api",
      stage:    "services",
      label:    "API service plan: artifacts/api-server",
      status:   "pass",
      required: true,
      message:  "API service: build pnpm --filter @workspace/api-server run build, start node --enable-source-maps artifacts/api-server/dist/index.mjs, health /api/healthz.",
      command:  "pnpm --filter @workspace/api-server run build",
    }),
    step({
      id:       "services-static",
      stage:    "services",
      label:    "Static frontend plan: artifacts/sardar-security",
      status:   "pass",
      required: true,
      message:  "Static service: build pnpm --filter @workspace/sardar-security run build, output artifacts/sardar-security/dist/public, serve with SPA fallback.",
      command:  "pnpm --filter @workspace/sardar-security run build",
    }),
    step({
      id:       "services-route-split",
      stage:    "services",
      label:    "Route split planned: /api/* → API, /* → static",
      status:   "pass",
      required: true,
      message:  "/api/* routes to API server. /* routes to static frontend with SPA fallback.",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "services-count",
      stage:    "services",
      label:    `${serviceCount} service(s) configured in panel`,
      status:   serviceCount >= 2 ? "pass" : serviceCount === 1 ? "warning" : "warning",
      required: false,
      message:  serviceCount >= 2
        ? `${serviceCount} services configured. API + static expected.`
        : `${serviceCount} service(s) — expected 2 (API + static frontend).`,
      linkHref: p("/publishing"),
    }),

    // ── Env ────────────────────────────────────────────────────────────────

    step({
      id:       "env-placeholders",
      stage:    "env",
      label:    "Staging env placeholders reviewed",
      status:   "manual",
      required: true,
      message:  "All env vars must be reviewed and set to staging-specific values before deployment.",
      linkHref: p("/env"),
      warning:  "Do not copy production secrets into staging automatically.",
    }),
    step({
      id:       "env-app-url",
      stage:    "env",
      label:    `APP_URL should point to staging domain`,
      status:   "manual",
      required: true,
      message:  `Set APP_URL=https://${stagingDomain} in staging env. Never use the production URL.`,
      linkHref: p("/env"),
      command:  `APP_URL=https://${stagingDomain}`,
    }),
    step({
      id:       "env-count",
      stage:    "env",
      label:    `${envSet.size} env var(s) in source project`,
      status:   envSet.size > 0 ? "pass" : "warning",
      required: false,
      message:  envSet.size > 0
        ? `${envSet.size} env var names found. Review each for staging vs production values.`
        : "No env vars configured in source project.",
      linkHref: p("/env"),
    }),
    step({
      id:       "env-no-auto-copy",
      stage:    "env",
      label:    "Secrets not copied automatically",
      status:   "pass",
      required: true,
      message:  "This planner never copies secret values. All env values must be set manually on the staging project.",
      warning:  "Verify STRIPE_SECRET_KEY uses sk_test_ prefix in staging, not sk_live_.",
    }),

    // ── Database ───────────────────────────────────────────────────────────

    step({
      id:       "db-staging-url",
      stage:    "database",
      label:    "Staging DATABASE_URL must be separate from production",
      status:   "manual",
      required: true,
      message:  "Set a separate staging DATABASE_URL. Never reuse the production database without explicit team approval.",
      linkHref: p("/database"),
      warning:  "Using a shared production DB for staging can corrupt live data. Use a separate DB instance or schema.",
    }),
    step({
      id:       "db-env-configured",
      stage:    "database",
      label:    `DB env name found: ${hasDbEnv ? "yes" : "no"}`,
      status:   hasDbEnv ? "pass" : "warning",
      required: false,
      message:  hasDbEnv
        ? "Database URL env name found in source project. Verify staging value is set."
        : "No database URL env name found. Add DATABASE_URL to staging project.",
      linkHref: p("/env"),
    }),
    step({
      id:       "db-migration-review",
      stage:    "database",
      label:    "DB migration review required",
      status:   "manual",
      required: true,
      message:  "Review migration commands on the Database page. Run against staging DB only. Never auto-run against production.",
      linkHref: p("/database"),
      command:  "pnpm drizzle-kit push",
      warning:  "Always back up before any schema change.",
    }),

    // ── Build ──────────────────────────────────────────────────────────────

    step({
      id:       "build-install",
      stage:    "build",
      label:    "Install command documented",
      status:   "pass",
      required: true,
      message:  "Install command: pnpm install --frozen-lockfile",
      command:  "pnpm install --frozen-lockfile",
    }),
    step({
      id:       "build-api",
      stage:    "build",
      label:    "API build command documented",
      status:   "pass",
      required: true,
      message:  "API build: pnpm --filter @workspace/api-server run build",
      command:  "pnpm --filter @workspace/api-server run build",
    }),
    step({
      id:       "build-web",
      stage:    "build",
      label:    "Frontend build command documented",
      status:   "pass",
      required: true,
      message:  "Frontend build: pnpm --filter @workspace/sardar-security run build",
      command:  "pnpm --filter @workspace/sardar-security run build",
    }),
    step({
      id:       "build-dry-run",
      stage:    "build",
      label:    "Build dry run required before deployment",
      status:   "manual",
      required: true,
      message:  "Run full build dry run with RUN STAGING DRY RUN confirmation before promoting to production.",
      linkHref: p("/publishing"),
      confirmationRequired: "RUN STAGING DRY RUN",
    }),
    step({
      id:       "build-success",
      stage:    "build",
      label:    `${successfulDeployCount} successful deployment(s) in panel`,
      status:   successfulDeployCount >= 1 ? "pass" : "warning",
      required: false,
      message:  successfulDeployCount >= 1
        ? `${successfulDeployCount} successful deployment(s) recorded.`
        : "No successful deployments yet — complete a dry run first.",
      linkHref: p("/releases"),
    }),

    // ── Routing preview ────────────────────────────────────────────────────

    step({
      id:       "routing-api-route",
      stage:    "routing_preview",
      label:    "API route preview: /api/* → API server",
      status:   "pass",
      required: true,
      message:  "Nginx: location /api/ { proxy_pass http://127.0.0.1:<staging_port>/; }",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "routing-static-route",
      stage:    "routing_preview",
      label:    "Static route preview: /* → dist/public",
      status:   "pass",
      required: true,
      message:  "Nginx: serve artifacts/sardar-security/dist/public with try_files $uri $uri/ /index.html;",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "routing-no-production-apply",
      stage:    "routing_preview",
      label:    "No production route apply",
      status:   "pass",
      required: true,
      message:  "Routes are preview-only. Production nginx is not modified by this plan.",
      warning:  "Only apply routes after full staging proof is complete and team approves.",
    }),

    // ── Smoke checks ───────────────────────────────────────────────────────

    step({
      id:       "smoke-root",
      stage:    "smoke_checks",
      label:    `Staging root: https://${stagingDomain}/`,
      status:   "manual",
      required: true,
      message:  "Run smoke checks with RUN STAGING DRY RUN confirmation. Missing DNS returns warning, not fail.",
      confirmationRequired: "RUN STAGING DRY RUN",
    }),
    step({
      id:       "smoke-health",
      stage:    "smoke_checks",
      label:    `Staging health: https://${stagingDomain}/api/healthz`,
      status:   "manual",
      required: true,
      message:  "Health endpoint must return 200 OK after staging deployment.",
      confirmationRequired: "RUN STAGING DRY RUN",
    }),
    step({
      id:       "smoke-spa-fallback",
      stage:    "smoke_checks",
      label:    `SPA fallback: https://${stagingDomain}/non-existent-spa-route`,
      status:   "manual",
      required: false,
      message:  "SPA fallback must return 200 (index.html), not 404.",
      confirmationRequired: "RUN STAGING DRY RUN",
    }),

    // ── Manual ─────────────────────────────────────────────────────────────

    step({
      id:       "manual-review",
      stage:    "manual",
      label:    "Owner review of staging deployment plan",
      status:   "manual",
      required: true,
      message:  "Owner must review all plan steps before confirming MARK STAGING READY.",
      confirmationRequired: "MARK STAGING READY",
    }),
  ];

  // ── Aggregate ──────────────────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (guardError)                  blockers.push(guardError);
  if (isLiveSardarPort || isLiveSardarUrl) blockers.push("Source project appears to target live Sardar production");
  if (!project)                    blockers.push("Source project not found");

  if (!deployConfig)               warnings.push("No deployment config — set up on Publishing page");
  if (serviceCount < 2)            warnings.push("Less than 2 services configured");
  if (!hasDbEnv)                   warnings.push("No DATABASE_URL env found");
  if (hasStripe < 2)               warnings.push("Stripe keys not fully configured — add before ecommerce testing");
  if (envSet.size === 0)           warnings.push("No env vars configured");

  const nextSteps = [
    "Confirm staging slug and domain are correct",
    "Set up staging project server (separate from production)",
    "Configure staging DATABASE_URL to separate DB",
    "Review and copy env placeholders to staging (without production secrets)",
    "Clone/import source to staging server",
    `Run: pnpm install --frozen-lockfile`,
    `Run: pnpm --filter @workspace/api-server run build`,
    `Run: pnpm --filter @workspace/sardar-security run build`,
    `Start staging API on a separate port (not 4100)`,
    `Configure staging nginx: /api/* and /*`,
    `Run staging smoke checks: RUN STAGING DRY RUN`,
    `Mark staging ready: MARK STAGING READY`,
    `Export STAGING_DEPLOYMENT_PROOF.md for the Final Go-Live pack`,
  ];

  return {
    projectId,
    generatedAt:       new Date().toISOString(),
    status:            deriveStatus(steps),
    sourceProjectSlug: project?.slug ?? projectId,
    stagingSlug,
    stagingDomain,
    steps,
    blockers,
    warnings,
    nextSteps,
    servicePlan:       SARDAR_SERVICE_PLAN,
  };
}
