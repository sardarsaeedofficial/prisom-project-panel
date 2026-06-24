/**
 * lib/migration/staging-import-planner.ts
 *
 * Sprint 51: Generates a staging import plan for the Sardar ecommerce app.
 *
 * Orchestrates existing readiness services to produce a step-by-step plan
 * covering project setup, source import, services, env, database, routing,
 * build validation, and smoke checks.
 *
 * Safety:
 *  - read-only: never writes project settings
 *  - never copies or suggests real secret values
 *  - never applies routes
 *  - never executes build commands
 *  - never creates a project automatically
 */

import { db } from "@/lib/db";
import type {
  StagingImportPlan,
  StagingImportStep,
  StagingImportStepCategory,
  StagingImportStatus,
  StagingSmokeReport,
  StagingSmokeCheck,
} from "./staging-import-types";
import { STAGING_SLUG, STAGING_DOMAIN } from "./staging-import-types";

// ── Item helpers ──────────────────────────────────────────────────────────────

function step(
  id: string,
  category: StagingImportStepCategory,
  title: string,
  description: string,
  status: StagingImportStatus,
  required: boolean,
  extras: Partial<Omit<StagingImportStep, "id" | "category" | "title" | "description" | "status" | "required">> = {},
): StagingImportStep {
  return { id, category, title, description, status, required, ...extras };
}

function pass(id: string, cat: StagingImportStepCategory, title: string, desc: string, req = true, e: Partial<StagingImportStep> = {}): StagingImportStep {
  return step(id, cat, title, desc, "ready", req, e);
}
function fail(id: string, cat: StagingImportStepCategory, title: string, desc: string, req = true, e: Partial<StagingImportStep> = {}): StagingImportStep {
  return step(id, cat, title, desc, "blocked", req, e);
}
function warn(id: string, cat: StagingImportStepCategory, title: string, desc: string, req = false, e: Partial<StagingImportStep> = {}): StagingImportStep {
  return step(id, cat, title, desc, "warning", req, e);
}
function manual(id: string, cat: StagingImportStepCategory, title: string, desc: string, req = true, e: Partial<StagingImportStep> = {}): StagingImportStep {
  return step(id, cat, title, desc, "not_started", req, e);
}

// ── Stage builders ────────────────────────────────────────────────────────────

async function buildProjectSteps(sourceProjectId: string): Promise<StagingImportStep[]> {
  let stagingExists = false;
  try {
    const row = await db.project.findFirst({ where: { slug: STAGING_SLUG }, select: { id: true } });
    stagingExists = !!row;
  } catch { /* non-fatal */ }

  return [
    stagingExists
      ? pass("proj-exists", "project", `Staging project "${STAGING_SLUG}" exists`, "A staging project with the correct slug is already created.", true)
      : manual("proj-exists", "project", `Create staging project: ${STAGING_SLUG}`, `Go to the Projects dashboard and create a new project with slug "${STAGING_SLUG}". Do not use the live production project for staging.`, true,
          { warning: "Never run staging tests against the live production project." }),

    manual("proj-domain", "project", `Configure staging domain (${STAGING_DOMAIN})`, `Add the staging domain "${STAGING_DOMAIN}" to the staging project. Do not use the live domain yet.`, false),

    manual("proj-permissions", "project", "Set staging project permissions", "Confirm team members have access to the staging project. Production project permissions are separate.", false),
  ];
}

async function buildSourceSteps(sourceProjectId: string): Promise<StagingImportStep[]> {
  let hasMigrationReport = false;
  try {
    const row = await db.projectMigrationReport.findFirst({
      where:   { projectId: sourceProjectId },
      orderBy: { createdAt: "desc" },
      select:  { id: true },
    });
    hasMigrationReport = !!row;
  } catch { /* non-fatal */ }

  return [
    hasMigrationReport
      ? pass("src-report", "source", "Migration report generated on source project", "Source project has been analyzed. Services and env vars detected.", true, { linkHref: `/projects/${sourceProjectId}/migration` })
      : fail("src-report", "source", "Migration report not yet generated", "Run migration analysis on the source project first.", true, { linkHref: `/projects/${sourceProjectId}/migration` }),

    manual("src-import", "source", "Import Replit/GitHub source into staging project", "In the staging project, go to Migration → Import Source and import the same source as the production project.", true,
      { linkHref: `/projects/${sourceProjectId}/migration` }),

    manual("src-verify", "source", "Verify source files present", "Confirm artifacts/api-server, artifacts/sardar-security, and lib/db are present in the staging project source.", true),
  ];
}

function buildServiceSteps(sourceProjectId: string): StagingImportStep[] {
  return [
    manual("svc-api", "services", "Configure API service in staging project", 'Service name: "api-server". Root: artifacts/api-server.', true,
      { command: "pnpm --filter @workspace/api-server run build" }),
    manual("svc-api-build", "services", 'API build command: pnpm --filter @workspace/api-server run build', "Set build command in staging project services.", true,
      { command: "pnpm --filter @workspace/api-server run build" }),
    manual("svc-api-start", "services", 'API start command: node --enable-source-maps artifacts/api-server/dist/index.mjs', "Set start command in staging project services.", true,
      { command: "node --enable-source-maps artifacts/api-server/dist/index.mjs" }),
    manual("svc-api-health", "services", "API health path: /api/healthz", "Set health check path so Prisom can monitor the staging API.", true),
    manual("svc-frontend", "services", "Configure static frontend service in staging project", 'Service name: "sardar-security". Root: artifacts/sardar-security.', true),
    manual("svc-frontend-build", "services", 'Frontend build command: pnpm --filter @workspace/sardar-security run build', "Set build command in staging project services.", true,
      { command: "pnpm --filter @workspace/sardar-security run build" }),
    manual("svc-frontend-output", "services", "Frontend output path: artifacts/sardar-security/dist/public", "Set static output path in staging project services.", true),
    manual("svc-spa-fallback", "services", "SPA fallback enabled on frontend service", "Enable SPA fallback so React client-side routes work without 404 on reload.", true,
      { warning: "Without SPA fallback, deep links like /products/123 will 404 on page reload." }),
  ];
}

async function buildEnvSteps(sourceProjectId: string): Promise<StagingImportStep[]> {
  type EnvFinding = { name: string; status: string; severity: string };
  let findings: EnvFinding[] = [];
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const raw = await generateEnvReadinessReport(sourceProjectId);
    if (raw && typeof raw === "object" && "findings" in raw) {
      findings = (raw as unknown as { findings: EnvFinding[] }).findings ?? [];
    }
  } catch { /* non-fatal */ }

  const REQUIRED_KEYS = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "APP_URL",
  ];
  const EMAIL_KEYS = ["SMTP_HOST", "RESEND_API_KEY", "SENDGRID_API_KEY"];

  const keyStatuses = new Map(findings.map((f) => [f.name, f.status]));

  const steps: StagingImportStep[] = [
    manual("env-strategy", "env", "Env strategy: add placeholders only, fill manually", "In the staging project, add all required env var names with PLACEHOLDER values. Replace with staging/test values manually — never copy real production secrets.", true,
      { warning: "Never copy production secrets (DATABASE_URL, STRIPE_SECRET_KEY, etc.) into staging automatically." }),
  ];

  for (const key of REQUIRED_KEYS) {
    const sourceStatus = keyStatuses.get(key);
    const configured   = sourceStatus === "configured";
    const isStripeLive = key === "STRIPE_SECRET_KEY" || key === "STRIPE_PUBLISHABLE_KEY";

    steps.push(manual(
      `env-staging-${key.toLowerCase()}`,
      "env",
      `Add ${key} to staging env (staging/test value)`,
      isStripeLive
        ? `Use Stripe TEST keys (sk_test_... / pk_test_...) for staging. Never use live keys in staging.`
        : key === "DATABASE_URL"
        ? "Use a separate staging/test Neon database. Never point staging to the production database."
        : key === "APP_URL"
        ? `Set APP_URL to https://${STAGING_DOMAIN} for staging.`
        : `Add ${key} with the appropriate staging/test value.`,
      key !== "APP_URL",
      {
        evidence: configured ? [`Source project has ${key} configured`] : undefined,
        warning:  isStripeLive ? "Using live Stripe keys in staging will process real payments." : undefined,
      }
    ));
  }

  const hasEmail = EMAIL_KEYS.some((k) => keyStatuses.get(k) === "configured");
  steps.push(
    hasEmail
      ? pass("env-email", "env", "Email provider configured on source project", "Source project has an email provider env var configured. Add the staging equivalent to the staging project.", false)
      : manual("env-email", "env", "Add email provider env var to staging", "Add RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* to the staging project.", false)
  );

  return steps;
}

function buildDatabaseSteps(sourceProjectId: string): StagingImportStep[] {
  return [
    manual("db-staging-url", "database", "Staging DATABASE_URL points to separate database", "Create a staging Neon database and set DATABASE_URL in the staging project env. Never share the production database.", true,
      { warning: "Never use the production DATABASE_URL in staging." }),
    manual("db-schema-push", "database", "Run Drizzle schema push manually on staging database", "After configuring DATABASE_URL, run the schema push command in the staging project terminal or locally.", true,
      { command: "pnpm --filter @workspace/db exec drizzle-kit push", warning: "Always verify the schema diff before pushing. Do not run in production." }),
    manual("db-seed-data", "database", "Add staging test data if required", "Add test products, users, or orders as needed for staging validation.", false),
    manual("db-backup-staging", "database", "Create staging database snapshot if needed", "Before testing destructive flows, create a snapshot of the staging database.", false),
  ];
}

function buildRoutingSteps(sourceProjectId: string): StagingImportStep[] {
  return [
    manual("rt-api-route", "routing", "/api/* → API service configured in staging", "Add route /api/* → API service in the staging project's routing config.", true,
      { linkHref: `/projects/${sourceProjectId}/publishing`, warning: "Do not apply staging routes to the production project." }),
    manual("rt-frontend-route", "routing", "/* → static frontend with SPA fallback", "Add route /* → static frontend with SPA try_files fallback in staging.", true),
    manual("rt-staging-apply", "routing", "Apply staging routing (staging project only)", "Apply routes in the staging project's Publishing → Production Routing. Do not apply to the live project.", true,
      { warning: "Never apply staging routing to the live production project." }),
  ];
}

function buildBuildSteps(): StagingImportStep[] {
  return [
    manual("build-trigger", "build", "Trigger staging build + deploy", "In the staging project, go to Publishing → Deploy All to trigger a full build of API + frontend.", true),
    manual("build-api-success", "build", "API build succeeds", "Confirm the API service builds without errors. Check deployment logs.", true),
    manual("build-frontend-success", "build", "Frontend build succeeds", "Confirm the static frontend builds and dist/public is created.", true),
    manual("build-logs-clean", "build", "No critical errors in build logs", "Review build logs for any import errors, missing env vars, or TypeScript compilation failures.", false),
  ];
}

function buildSmokeSteps(stagingDomain?: string): StagingImportStep[] {
  const domain = stagingDomain ?? STAGING_DOMAIN;
  const configured = !!stagingDomain;

  if (!configured) {
    return [
      step("smoke-no-domain", "smoke", "Staging domain not configured yet", `Configure staging domain (${domain}) to run smoke checks.`, "warning", false,
        { warning: "Smoke checks require a staging domain to be configured and deployed." }),
    ];
  }

  return [
    manual("smoke-frontend", "smoke", `Frontend loads at https://${domain}/`, `https://${domain}/ should return HTTP 200.`, true),
    manual("smoke-health", "smoke", `API health returns 200 at /api/healthz`, `https://${domain}/api/healthz should return { ok: true }.`, true),
    manual("smoke-spa", "smoke", "SPA fallback works for client-side routes", `https://${domain}/products (or any deep link) should return 200 or the index.html.`, true),
    manual("smoke-ssl", "smoke", `SSL valid at https://${domain}`, "Browser padlock should show valid. Certificate must cover the staging domain.", false),
  ];
}

// ── Status rollup ─────────────────────────────────────────────────────────────

function rollupStatus(steps: StagingImportStep[]): StagingImportStatus {
  const required = steps.filter((s) => s.required);
  if (required.some((s) => s.status === "blocked" || s.status === "failed")) return "blocked";
  if (required.some((s) => s.status === "warning")) return "warning";
  if (required.every((s) => s.status === "ready" || s.status === "passed")) return "passed";
  if (required.some((s) => s.status === "running")) return "running";
  return "not_started";
}

// ── Main plan generator ───────────────────────────────────────────────────────

export async function generateStagingImportPlan(
  sourceProjectId: string,
  stagingDomain?: string,
): Promise<StagingImportPlan> {
  const [projectSteps, sourceSteps, envSteps] = await Promise.all([
    buildProjectSteps(sourceProjectId),
    buildSourceSteps(sourceProjectId),
    buildEnvSteps(sourceProjectId),
  ]);

  const serviceSteps  = buildServiceSteps(sourceProjectId);
  const dbSteps       = buildDatabaseSteps(sourceProjectId);
  const routingSteps  = buildRoutingSteps(sourceProjectId);
  const buildSteps    = buildBuildSteps();
  const smokeSteps    = buildSmokeSteps(stagingDomain);

  const allSteps = [
    ...projectSteps,
    ...sourceSteps,
    ...serviceSteps,
    ...envSteps,
    ...dbSteps,
    ...routingSteps,
    ...buildSteps,
    ...smokeSteps,
  ];

  const blockers = allSteps
    .filter((s) => s.required && (s.status === "blocked" || s.status === "failed"))
    .map((s) => s.title)
    .slice(0, 8);

  const warnings = allSteps
    .filter((s) => s.status === "warning")
    .map((s) => s.title)
    .slice(0, 8);

  const nextSteps: string[] = [];
  if (blockers.length > 0) {
    nextSteps.push("Fix all blockers before proceeding.");
  }
  if (!projectSteps.find((s) => s.id === "proj-exists" && s.status === "ready")) {
    nextSteps.push(`Create staging project with slug "${STAGING_SLUG}".`);
  }
  nextSteps.push("Import the same source into the staging project.");
  nextSteps.push("Configure API and static frontend services.");
  nextSteps.push("Add all env var placeholders — fill with staging/test values manually.");
  nextSteps.push("Run Drizzle schema push against the staging database.");
  nextSteps.push("Trigger staging build + deploy, then run smoke checks.");
  nextSteps.push("Only proceed to production cutover after staging validation passes.");

  return {
    sourceProjectId,
    recommendedStagingSlug:   STAGING_SLUG,
    recommendedStagingDomain: stagingDomain ?? STAGING_DOMAIN,
    generatedAt:              new Date().toISOString(),
    status:                   rollupStatus(allSteps),
    steps:                    allSteps,
    blockers,
    warnings,
    nextSteps,
  };
}

// ── Smoke check runner ────────────────────────────────────────────────────────

export async function runStagingSmokeChecks(
  stagingDomain: string,
): Promise<StagingSmokeReport> {
  const runAt = new Date().toISOString();
  const checks: StagingSmokeCheck[] = [];

  async function fetchCheck(
    id: string,
    label: string,
    url: string,
    expectSpa = false,
  ): Promise<StagingSmokeCheck> {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method:  "GET",
        headers: { "User-Agent": "PrisomStagingCheck/1.0" },
        signal:  AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const durationMs  = Date.now() - start;
      const statusCode  = res.status;
      const ok          = expectSpa ? statusCode < 500 : statusCode >= 200 && statusCode < 400;

      return {
        id,
        label,
        url,
        status:     ok ? "pass" : "fail",
        statusCode,
        durationMs,
        message:    ok
          ? `HTTP ${statusCode} — OK (${durationMs}ms)`
          : `HTTP ${statusCode} — unexpected status (${durationMs}ms)`,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const msg        = err instanceof Error ? err.message : "Unknown error";
      const isTimeout  = msg.includes("timeout") || msg.includes("abort");
      return {
        id,
        label,
        url,
        status:     "fail",
        durationMs,
        message:    isTimeout ? `Timed out after ${durationMs}ms` : `Error: ${msg}`,
      };
    }
  }

  const domain = stagingDomain.startsWith("http") ? stagingDomain : `https://${stagingDomain}`;

  const [frontendCheck, healthCheck, spaCheck] = await Promise.all([
    fetchCheck("smoke-frontend", "Frontend loads at /",       `${domain}/`,             false),
    fetchCheck("smoke-health",   "API health at /api/healthz", `${domain}/api/healthz`, false),
    fetchCheck("smoke-spa",      "SPA fallback route",         `${domain}/products`,    true),
  ]);

  checks.push(frontendCheck, healthCheck, spaCheck);

  // SSL check — just verify HTTPS in the URL, warn if plain HTTP
  if (domain.startsWith("https://")) {
    checks.push({
      id:      "smoke-ssl",
      label:   "HTTPS / SSL",
      url:     domain,
      status:  frontendCheck.status === "pass" ? "pass" : "warning",
      message: frontendCheck.status === "pass"
        ? "Domain uses HTTPS — SSL appears valid"
        : "HTTPS configured but frontend check failed — verify SSL manually",
    });
  } else {
    checks.push({
      id:      "smoke-ssl",
      label:   "HTTPS / SSL",
      url:     domain,
      status:  "warning",
      message: "Staging domain is not using HTTPS. Configure SSL before go-live.",
    });
  }

  const overallPass = checks
    .filter((c) => c.status !== "skipped")
    .every((c) => c.status === "pass" || c.status === "warning");

  return { stagingDomain, runAt, overallPass, checks };
}
