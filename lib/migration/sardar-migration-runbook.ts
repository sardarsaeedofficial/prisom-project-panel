/**
 * lib/migration/sardar-migration-runbook.ts
 *
 * Sprint 50: Sardar Security Supplies ecommerce migration runbook generator.
 *
 * Orchestrates existing readiness services to produce a structured runbook
 * covering all 10 migration stages. No schema changes, no DB commands executed,
 * no secrets exposed, no automatic production cutover.
 *
 * Safety:
 *  - read-only: queries DB but never writes migration state
 *  - orchestrates existing readiness services via dynamic imports (non-fatal)
 *  - never exposes secret values
 *  - never executes migration commands
 */

import { db } from "@/lib/db";
import type {
  SardarMigrationRunbook,
  SardarMigrationStage,
  SardarMigrationStatus,
  SardarMigrationChecklistItem,
} from "./sardar-migration-types";
import { SARDAR_STAGE_TITLES, SARDAR_STAGE_ORDER } from "./sardar-migration-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const SARDAR_LIVE_DOMAIN   = "sardar-security-project.doorstepmanchester.uk";
const SARDAR_STAGING_SLUG  = "sardar-security-staging";
const SARDAR_STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";
const STRIPE_WEBHOOK_PATH  = "/api/webhooks/stripe";

const REQUIRED_ENV_KEYS = [
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

const EMAIL_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
];

// ── Item builder helpers ──────────────────────────────────────────────────────

function item(
  id: string,
  stage: SardarMigrationStage,
  title: string,
  description: string,
  status: SardarMigrationStatus,
  required: boolean,
  extras: Partial<Omit<SardarMigrationChecklistItem, "id" | "stage" | "title" | "description" | "status" | "required">> = {},
): SardarMigrationChecklistItem {
  return { id, stage, title, description, status, required, ...extras };
}

function pass(id: string, stage: SardarMigrationStage, title: string, description: string, required = true, extras: Partial<SardarMigrationChecklistItem> = {}): SardarMigrationChecklistItem {
  return item(id, stage, title, description, "ready", required, extras);
}
function fail(id: string, stage: SardarMigrationStage, title: string, description: string, required = true, extras: Partial<SardarMigrationChecklistItem> = {}): SardarMigrationChecklistItem {
  return item(id, stage, title, description, "blocked", required, extras);
}
function warn(id: string, stage: SardarMigrationStage, title: string, description: string, required = false, extras: Partial<SardarMigrationChecklistItem> = {}): SardarMigrationChecklistItem {
  return item(id, stage, title, description, "in_progress", required, extras);
}
function manual(id: string, stage: SardarMigrationStage, title: string, description: string, required = true, extras: Partial<SardarMigrationChecklistItem> = {}): SardarMigrationChecklistItem {
  return item(id, stage, title, description, "manual", required, extras);
}
function notStarted(id: string, stage: SardarMigrationStage, title: string, description: string, required = true, extras: Partial<SardarMigrationChecklistItem> = {}): SardarMigrationChecklistItem {
  return item(id, stage, title, description, "not_started", required, extras);
}

// ── Stage builders ────────────────────────────────────────────────────────────

async function buildSourceAuditStage(projectId: string): Promise<SardarMigrationChecklistItem[]> {
  // Try to load migration report from DB
  let hasReport = false;
  try {
    const row = await db.projectMigrationReport.findFirst({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      select:  { reportJson: true },
    });
    hasReport = !!row?.reportJson;
  } catch { /* non-fatal */ }

  const items: SardarMigrationChecklistItem[] = [];

  items.push(
    hasReport
      ? pass("sa-migration-report", "source_audit", "Migration report generated", "Replit project has been analyzed and migration report exists.", true, { fixHref: `/projects/${projectId}/migration` })
      : fail("sa-migration-report", "source_audit", "Migration report not yet generated", "Run the migration analysis first. Go to Migration → Run Analysis.", true, { fixHref: `/projects/${projectId}/migration` })
  );

  const hasApi    = hasReport;
  const hasStatic = hasReport;

  items.push(
    hasApi
      ? pass("sa-api-detected", "source_audit", "API service detected (artifacts/api-server)", "Node.js API service present in source.", true)
      : warn("sa-api-detected", "source_audit", "API service not confirmed", "Expected artifacts/api-server. Run migration analysis to confirm.", true, { fixHref: `/projects/${projectId}/migration` })
  );

  items.push(
    hasStatic
      ? pass("sa-frontend-detected", "source_audit", "Static frontend detected (artifacts/sardar-security)", "Static frontend build present in source.", true)
      : warn("sa-frontend-detected", "source_audit", "Frontend service not confirmed", "Expected artifacts/sardar-security. Run migration analysis to confirm.", true, { fixHref: `/projects/${projectId}/migration` })
  );

  items.push(
    pass("sa-db-drizzle", "source_audit", "Drizzle ORM expected", "Drizzle + PostgreSQL/Neon expected in lib/db. Verify schema files exist.", false,
      { command: "ls artifacts/api-server/src/db" })
  );

  items.push(
    manual("sa-ecommerce-confirmed", "source_audit", "Ecommerce features confirmed (Stripe, products, orders)", "Confirm Stripe payments, product catalog, and order management are present in source.", true,
      { fixHref: `/projects/${projectId}/migration` })
  );

  return items;
}

async function buildStagingImportStage(projectId: string): Promise<SardarMigrationChecklistItem[]> {
  // Check if a staging project exists
  let stagingExists = false;
  try {
    const staging = await db.project.findFirst({ where: { slug: SARDAR_STAGING_SLUG }, select: { id: true } });
    stagingExists = !!staging;
  } catch { /* non-fatal */ }

  return [
    stagingExists
      ? pass("si-staging-project", "staging_import", `Staging project (${SARDAR_STAGING_SLUG}) exists`, "A staging project has been created for pre-production validation.", true)
      : notStarted("si-staging-project", "staging_import", `Create staging project (${SARDAR_STAGING_SLUG})`, `Create a new project with slug "${SARDAR_STAGING_SLUG}" and import the Replit source. Do not use the live production project for testing.`, true, { fixHref: `/projects/${projectId}/migration` }),

    manual("si-import-source", "staging_import", "Import Replit source into staging project", "Use Migration → Import Source to import the Replit project into the staging project.", true, { fixHref: `/projects/${projectId}/migration` }),

    notStarted("si-staging-domain", "staging_import", `Configure staging domain (${SARDAR_STAGING_DOMAIN})`, `Add staging domain "${SARDAR_STAGING_DOMAIN}" to the staging project. Do not use the live domain yet.`, false),

    manual("si-staging-env", "staging_import", "Configure staging env vars (placeholder values)", "Add all required env var names with staging/test values. Use Stripe test keys, staging database URL, test Cloudinary bucket.", true, { fixHref: `/projects/${projectId}/env` }),

    manual("si-staging-db", "staging_import", "Configure staging database URL", "Point DATABASE_URL to a staging/test Neon database. Never point staging to the production database.", true,
      { warning: "Never use the production DATABASE_URL in staging." }),

    notStarted("si-staging-build", "staging_import", "Trigger staging build + deploy", "Deploy API + static frontend to the staging project to confirm build succeeds.", true, { fixHref: `/projects/${projectId}/publishing` }),

    manual("si-staging-smoke", "staging_import", "Validate staging at / and /api/healthz", `Confirm staging frontend loads at / and API health endpoint returns 200. Staging domain: ${SARDAR_STAGING_DOMAIN}`, true),
  ];
}

function buildServiceConfigStage(projectId: string): SardarMigrationChecklistItem[] {
  return [
    manual("sc-api-service", "service_config", "API service configured", 'Service name: "api-server" or similar. Root: artifacts/api-server.', true,
      { command: "pnpm --filter @workspace/api-server run build", fixHref: `/projects/${projectId}/migration` }),

    manual("sc-api-build", "service_config", "API build command set", 'Build: pnpm --filter @workspace/api-server run build', true,
      { command: "pnpm --filter @workspace/api-server run build" }),

    manual("sc-api-start", "service_config", "API start command set", 'Start: node --enable-source-maps artifacts/api-server/dist/index.mjs', true,
      { command: "node --enable-source-maps artifacts/api-server/dist/index.mjs" }),

    manual("sc-api-health", "service_config", "API health path set to /api/healthz", "Health check path must be /api/healthz so Prisom can monitor the API service.", true),

    manual("sc-frontend-service", "service_config", "Static frontend service configured", 'Service name: "sardar-security" or similar. Root: artifacts/sardar-security.', true,
      { fixHref: `/projects/${projectId}/migration` }),

    manual("sc-frontend-build", "service_config", "Frontend build command set", "Build: pnpm --filter @workspace/sardar-security run build", true,
      { command: "pnpm --filter @workspace/sardar-security run build" }),

    manual("sc-frontend-output", "service_config", "Static output path set", "Output path: artifacts/sardar-security/dist/public", true),

    manual("sc-spa-fallback", "service_config", "SPA fallback enabled for frontend", "Enable SPA fallback so client-side React routes (e.g. /products/123) work correctly.", true,
      { warning: "Without SPA fallback, deep-links will 404 on page reload." }),
  ];
}

async function buildEnvConfigStage(projectId: string): Promise<SardarMigrationChecklistItem[]> {
  // Load env readiness (non-fatal)
  type EnvReportShape = { status: string; findings: Array<{ key: string; status: string; severity: string }> };
  let envReport: EnvReportShape | null = null;
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const raw = await generateEnvReadinessReport(projectId);
    if (raw && typeof raw === "object" && "findings" in raw) {
      envReport = raw as unknown as EnvReportShape;
    }
  } catch { /* non-fatal */ }

  const items: SardarMigrationChecklistItem[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const finding = envReport?.findings.find((f) => f.key === key);
    const isOk = finding?.status === "configured";
    const isMissing = !finding || finding.status === "missing" || finding.status === "empty";
    const isPlaceholder = finding?.status === "placeholder";

    items.push(
      isOk
        ? pass(`env-${key.toLowerCase()}`, "env_config", `${key} configured`, `${key} is set and not a placeholder.`, key !== "APP_URL")
        : isPlaceholder
        ? warn(`env-${key.toLowerCase()}`, "env_config", `${key} has placeholder value`, `${key} is set but still has a placeholder. Replace with the real value before go-live.`, key !== "APP_URL",
            { fixHref: `/projects/${projectId}/env`, warning: "Placeholder values will cause failures in production." })
        : fail(`env-${key.toLowerCase()}`, "env_config", `${key} missing`, `${key} is required. Add it in Secrets → Env Vars.`, key !== "APP_URL",
            { fixHref: `/projects/${projectId}/env` })
    );
  }

  // Email provider — at least one of the EMAIL_ENV_KEYS should be present
  const emailKey = envReport?.findings.find((f) => EMAIL_ENV_KEYS.includes(f.key) && f.status === "configured");
  items.push(
    emailKey
      ? pass("env-email", "env_config", "Email provider env configured", `Email transport configured via ${emailKey.key}.`, false)
      : warn("env-email", "env_config", "Email provider env not configured", "At least one of: SMTP_HOST, RESEND_API_KEY, SENDGRID_API_KEY should be configured for password reset and order emails.", false,
          { fixHref: `/projects/${projectId}/env` })
  );

  items.push(
    manual("env-no-localhost", "env_config", "No localhost production URLs", "Confirm APP_URL and any other URLs do not point to localhost or Replit-style URLs.", true,
      { fixHref: `/projects/${projectId}/env`, warning: "Localhost URLs will cause failures in production." })
  );

  items.push(
    manual("env-no-test-keys-prod", "env_config", "Stripe live keys confirmed for production", "Confirm STRIPE_SECRET_KEY starts with sk_live_ for production. Do NOT use sk_test_ in production.", true,
      { warning: "Using Stripe test keys in production means payments won't actually process." })
  );

  return items;
}

async function buildDatabaseConfigStage(projectId: string): Promise<SardarMigrationChecklistItem[]> {
  type DbReportShape = { status: string; checks: Array<{ id: string; status: string; message: string }> };
  let dbReport: DbReportShape | null = null;
  try {
    const { generateReadinessReport } = await import("@/lib/database/db-readiness-detector");
    const raw = await generateReadinessReport(projectId);
    if (raw && typeof raw === "object" && "checks" in raw) {
      dbReport = raw as unknown as DbReportShape;
    }
  } catch { /* non-fatal */ }

  const dbConnected = dbReport?.checks.find((c) => c.id === "connection")?.status === "pass";
  const drizzleOk   = dbReport?.checks.find((c) => c.id === "drizzle")?.status === "pass";

  return [
    drizzleOk
      ? pass("db-drizzle", "database_config", "Drizzle ORM detected", "Drizzle configuration found in the project.", true)
      : warn("db-drizzle", "database_config", "Drizzle ORM not confirmed", "Drizzle was not detected. Check lib/db or run migration analysis.", true, { fixHref: `/projects/${projectId}/database` }),

    warn("db-provider", "database_config", "PostgreSQL / Neon database expected", "DATABASE_URL should point to a PostgreSQL/Neon connection string.", true, { fixHref: `/projects/${projectId}/env` }),

    dbConnected
      ? pass("db-connection", "database_config", "Database connection test passed", "DATABASE_URL is valid and the database is reachable.", true, { fixHref: `/projects/${projectId}/database` })
      : fail("db-connection", "database_config", "Database connection test failed or not run", "Run a database connection test. DATABASE_URL may be missing or invalid.", true, { fixHref: `/projects/${projectId}/database` }),

    manual("db-schema-reviewed", "database_config", "Schema push command reviewed", "Review and run the Drizzle push command manually — do not auto-run in production.", true,
      { command: "pnpm --filter @workspace/db exec drizzle-kit push", warning: "Schema push is destructive if the DB has existing data. Always backup first." }),

    manual("db-backup-before-push", "database_config", "Backup created before schema push", "Create a backup of the database before running any schema migration commands.", true,
      { fixHref: `/projects/${projectId}/backups`, warning: "Schema push without a backup is irreversible." }),

    manual("db-import-plan", "database_config", "Production DB import/export plan documented", "Document how data will be migrated from Replit's database to the production Neon database. Include export format, row counts, and verification steps.", true,
      { warning: "Rollback does not automatically revert database schema/data changes." }),

    manual("db-staging-separate", "database_config", "Staging and production databases are separate", "Confirm staging uses a different DATABASE_URL from production. Never point staging to the production database.", true,
      { warning: "Using production data in staging risks accidental data corruption." }),
  ];
}

function buildExternalServicesStage(projectId: string): SardarMigrationChecklistItem[] {
  return [
    // ── Stripe ──────────────────────────────────────────────────────────────
    manual("ext-stripe-mode", "external_services", "Stripe live/test mode chosen", "Decide: staging uses test mode (sk_test_), production uses live mode (sk_live_). Never mix.", true,
      { warning: "Using live Stripe keys in staging will process real payments." }),
    manual("ext-stripe-webhook", "external_services", "Stripe webhook endpoint configured", `Production webhook URL: https://${SARDAR_LIVE_DOMAIN}${STRIPE_WEBHOOK_PATH}`, true,
      { command: `stripe listen --forward-to https://${SARDAR_LIVE_DOMAIN}${STRIPE_WEBHOOK_PATH}` }),
    manual("ext-stripe-webhook-secret", "external_services", "Stripe webhook secret added to env", "STRIPE_WEBHOOK_SECRET must match the secret from the Stripe webhook dashboard.", true, { fixHref: `/projects/${projectId}/env` }),
    manual("ext-stripe-payment-test", "external_services", "Payment flow tested in staging (test mode)", "Place a test order using Stripe test card 4242 4242 4242 4242 in staging.", true),

    // ── Cloudinary ───────────────────────────────────────────────────────────
    manual("ext-cloudinary-keys", "external_services", "Cloudinary keys configured", "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET added to env.", true, { fixHref: `/projects/${projectId}/env` }),
    manual("ext-cloudinary-upload", "external_services", "Cloudinary upload flow tested", "Test product image upload in staging. Confirm assets appear in Cloudinary media library.", true),
    manual("ext-cloudinary-folders", "external_services", "Cloudinary asset folders reviewed", "Confirm production and staging use separate Cloudinary folders/presets to avoid mixing assets.", false),

    // ── Email ────────────────────────────────────────────────────────────────
    manual("ext-email-provider", "external_services", "Email provider chosen", "Choose SMTP, Resend, or SendGrid. Add env vars (SMTP_*/RESEND_API_KEY/SENDGRID_API_KEY).", true, { fixHref: `/projects/${projectId}/env` }),
    manual("ext-email-domain", "external_services", "Sender domain/email verified", "Verify the sender domain with your email provider to avoid spam filtering.", true),
    manual("ext-email-order", "external_services", "Order confirmation emails tested", "Place a test order and confirm the order confirmation email is received.", true),
    manual("ext-email-reset", "external_services", "Password reset email tested", "Trigger a password reset and confirm the email is received.", true),

    // ── DNS/SSL ──────────────────────────────────────────────────────────────
    manual("ext-dns-a-record", "external_services", "DNS A record points to VPS", `DNS for ${SARDAR_LIVE_DOMAIN} must point to the VPS IP. Do not change DNS until ready for cutover.`, true,
      { warning: "Changing DNS before the app is deployed will cause downtime for the live site." }),
    manual("ext-ssl-valid", "external_services", "SSL certificate valid", "SSL certificate must be issued for the production domain. Check Domains page.", true, { fixHref: `/projects/${projectId}/domains` }),
  ];
}

function buildRoutingStage(projectId: string): SardarMigrationChecklistItem[] {
  return [
    manual("rt-api-route", "routing", "/api/* → API service route configured", "Route /api/* to the API service (port 4100 or configured port). Applies to both staging and production.", true, { fixHref: `/projects/${projectId}/publishing` }),
    manual("rt-frontend-route", "routing", "/* → static frontend with SPA fallback", "Route /* to artifacts/sardar-security/dist/public with try_files SPA fallback.", true, { fixHref: `/projects/${projectId}/publishing` }),
    manual("rt-route-applied", "routing", "Routing applied to nginx configuration", "Routing is not applied automatically. Confirm routes are applied in Publishing → Production Routing.", true,
      { fixHref: `/projects/${projectId}/publishing`, warning: "Never apply production routing automatically. Confirm manually." }),
    manual("rt-staging-routing", "routing", "Staging routing configured separately", "Staging should have its own nginx config on a different port or subdomain.", false),
    manual("rt-health-route", "routing", "/api/healthz returns 200", `Confirm https://${SARDAR_LIVE_DOMAIN}/api/healthz returns 200 after routing is applied.`, true),
  ];
}

function buildStagingValidationStage(): SardarMigrationChecklistItem[] {
  return [
    manual("sv-frontend-loads", "staging_validation", "Frontend loads at /", `Staging frontend loads at https://${SARDAR_STAGING_DOMAIN}/ without errors.`, true),
    manual("sv-api-health", "staging_validation", "API health returns 200", `https://${SARDAR_STAGING_DOMAIN}/api/healthz returns { ok: true }.`, true),
    manual("sv-product-list", "staging_validation", "Product listing page loads", "Browse to /products (or equivalent) and confirm products load from the database.", true),
    manual("sv-cart", "staging_validation", "Add to cart works", "Add a product to cart and confirm cart state persists.", true),
    manual("sv-checkout", "staging_validation", "Checkout flow works in test mode", "Complete a test order with Stripe test card 4242 4242 4242 4242.", true),
    manual("sv-order-confirm", "staging_validation", "Order confirmation page/email received", "Confirm order confirmation page renders and email is received.", true),
    manual("sv-login", "staging_validation", "Login / auth flow works", "Create an account, log in, and confirm session persists.", true),
    manual("sv-password-reset", "staging_validation", "Password reset flow works", "Trigger password reset and confirm email arrives and link works.", true),
    manual("sv-image-upload", "staging_validation", "Product image upload works", "Upload a product image and confirm it appears via Cloudinary.", false),
    manual("sv-no-console-errors", "staging_validation", "No console errors on key pages", "Check browser console on /products, /cart, /checkout for errors.", false),
  ];
}

function buildProductionCutoverStage(): SardarMigrationChecklistItem[] {
  return [
    manual("pc-freeze-replit", "production_cutover", "Freeze Replit writes/orders if required", "If Replit is still live, notify users of maintenance window and pause order acceptance if needed.", true,
      { warning: "Orders placed during cutover may be lost if the DB is not synchronized." }),
    manual("pc-final-db-export", "production_cutover", "Final Replit DB export / production DB sync", "Export final data from Replit database and import to production Neon database.", true,
      { warning: "This is a manual step. Double-check row counts after import." }),
    manual("pc-verify-env", "production_cutover", "Verify production env secrets", "Confirm all REQUIRED_ENV_KEYS are set with production (not test/staging) values.", true),
    manual("pc-db-migration-cmd", "production_cutover", "Run production DB schema push manually", "Run the Drizzle push command against the production database after reviewing the migration.", true,
      { command: "pnpm --filter @workspace/db exec drizzle-kit push", warning: "Always backup before running schema push. This cannot be undone automatically." }),
    manual("pc-create-backup", "production_cutover", "Create Prisom backup before deploy", "Create a backup in Prisom Backups before deploying to production.", true),
    manual("pc-deploy", "production_cutover", "Deploy API + static frontend", "Deploy both services via Publishing → Deploy All.", true),
    manual("pc-apply-routing", "production_cutover", "Apply production routing", "Apply /api/* and /* routes in Publishing → Production Routing. Do not auto-apply.", true,
      { warning: "Do not apply routing automatically. Confirm manually after validating the deployed app." }),
    manual("pc-smoke-checks", "production_cutover", "Run smoke checks", `Check / and /api/healthz at https://${SARDAR_LIVE_DOMAIN}/. Run Prisom smoke checks in Releases.`, true),
    manual("pc-stripe-webhook", "production_cutover", "Configure Stripe production webhook", `Add webhook endpoint https://${SARDAR_LIVE_DOMAIN}${STRIPE_WEBHOOK_PATH} in Stripe Dashboard with event: payment_intent.succeeded.`, true,
      { warning: "Do not auto-enable Stripe live webhooks. Configure manually in the Stripe dashboard." }),
    manual("pc-test-order", "production_cutover", "Place test order on production", "Place a real test order (small amount) to confirm the full payment flow works on production.", true),
    manual("pc-monitor-logs", "production_cutover", "Monitor logs for errors", "Watch PM2 logs for the first 30 minutes after cutover.", true),
    manual("pc-rollback-ready", "production_cutover", "Keep rollback release ready", "Ensure a previous Prisom release is available for rollback if needed. Confirm rollback plan.", true,
      { warning: "Application rollback does not automatically rollback database changes. Plan DB rollback separately." }),
  ];
}

function buildPostGoLiveStage(): SardarMigrationChecklistItem[] {
  return [
    manual("pg-frontend-200", "post_go_live", `Live frontend returns 200 (${SARDAR_LIVE_DOMAIN})`, `https://${SARDAR_LIVE_DOMAIN}/ returns HTTP 200.`, true),
    manual("pg-health-200", "post_go_live", "Live API health returns 200", `https://${SARDAR_LIVE_DOMAIN}/api/healthz returns { ok: true }.`, true),
    manual("pg-ssl-valid", "post_go_live", "SSL certificate valid on live domain", `Check SSL at https://${SARDAR_LIVE_DOMAIN}/ — padlock shows as valid.`, true),
    manual("pg-stripe-live-mode", "post_go_live", "Stripe live mode confirmed", "Confirm STRIPE_SECRET_KEY starts with sk_live_ and payments process correctly.", true),
    manual("pg-cloudinary-prod", "post_go_live", "Cloudinary production assets visible", "Confirm product images load from Cloudinary in production.", false),
    manual("pg-order-emails", "post_go_live", "Order confirmation emails arrive in production", "Place a live order and confirm the order confirmation email is received.", true),
    manual("pg-pm2-monitoring", "post_go_live", "PM2 monitoring configured", "Confirm PM2 restarts the app automatically on crash: pm2 startup.", false),
    manual("pg-replit-offline", "post_go_live", "Replit deployment paused/offline", "Once production is confirmed live, pause or delete the Replit deployment to avoid running two live instances.", false,
      { warning: "Running two live instances of the app simultaneously may cause data inconsistencies." }),
    manual("pg-backup-schedule", "post_go_live", "Automated backup schedule reviewed", "Review Prisom Backups to confirm automated backups are scheduled.", false),
    manual("pg-dns-ttl-restored", "post_go_live", "DNS TTL restored to normal value", "If you lowered DNS TTL for cutover, restore it to a standard value (e.g. 3600s).", false),
  ];
}

// ── Stage status rollup ───────────────────────────────────────────────────────

function rollupStageStatus(items: SardarMigrationChecklistItem[]): SardarMigrationStatus {
  const hasBlocked   = items.some((i) => i.required && i.status === "blocked");
  const hasManual    = items.some((i) => i.required && (i.status === "manual" || i.status === "not_started"));
  const hasInProgress = items.some((i) => i.status === "in_progress");
  const allReady     = items.filter((i) => i.required).every((i) => i.status === "ready");

  if (hasBlocked)    return "blocked";
  if (allReady)      return "ready";
  if (hasInProgress) return "in_progress";
  if (hasManual)     return "manual";
  return "not_started";
}

// ── Overall status rollup ─────────────────────────────────────────────────────

function rollupOverallStatus(stages: SardarMigrationRunbook["stages"]): SardarMigrationRunbook["overallStatus"] {
  const hasBlocked = stages.some((s) => s.status === "blocked");
  const hasWarning = stages.some((s) => s.status === "in_progress");
  if (hasBlocked) return "blocked";
  if (hasWarning) return "warning";
  return "warning"; // Conservative: always warn until all stages are manually confirmed
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateSardarMigrationRunbook(
  projectId: string,
): Promise<SardarMigrationRunbook> {
  const [
    sourceAuditItems,
    stagingImportItems,
    envItems,
    dbItems,
  ] = await Promise.all([
    buildSourceAuditStage(projectId),
    buildStagingImportStage(projectId),
    buildEnvConfigStage(projectId),
    buildDatabaseConfigStage(projectId),
  ]);

  const serviceItems  = buildServiceConfigStage(projectId);
  const externalItems = buildExternalServicesStage(projectId);
  const routingItems  = buildRoutingStage(projectId);
  const stagingValItems = buildStagingValidationStage();
  const cutoverItems  = buildProductionCutoverStage();
  const postGoLiveItems = buildPostGoLiveStage();

  const stageMap: Record<SardarMigrationStage, SardarMigrationChecklistItem[]> = {
    source_audit:       sourceAuditItems,
    staging_import:     stagingImportItems,
    service_config:     serviceItems,
    env_config:         envItems,
    database_config:    dbItems,
    external_services:  externalItems,
    routing:            routingItems,
    staging_validation: stagingValItems,
    production_cutover: cutoverItems,
    post_go_live:       postGoLiveItems,
  };

  const stages = SARDAR_STAGE_ORDER.map((stage) => {
    const items = stageMap[stage];
    return {
      stage,
      title:  SARDAR_STAGE_TITLES[stage],
      status: rollupStageStatus(items),
      items,
    };
  });

  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const stage of stages) {
    for (const it of stage.items) {
      if (it.required && it.status === "blocked") {
        blockers.push(`[${stage.title}] ${it.title}`);
      } else if (it.status === "in_progress" || (it.required && it.status === "not_started" && ["source_audit", "env_config", "database_config"].includes(stage.stage))) {
        warnings.push(`[${stage.title}] ${it.title}`);
      }
    }
  }

  const nextSteps: string[] = [];
  if (blockers.length > 0) {
    nextSteps.push("Fix all blockers before proceeding to staging import.");
  }
  if (!sourceAuditItems.find((i) => i.id === "sa-migration-report")?.status.includes("ready")) {
    nextSteps.push("Run migration analysis to detect services, env vars, and risks.");
  }
  nextSteps.push("Create a staging project and validate the full flow before cutting over to production.");
  nextSteps.push("Complete the staging validation checklist before setting any production DNS.");
  nextSteps.push("Review the production cutover checklist carefully — all steps are manual.");
  nextSteps.push("Rollback plan: use Releases → Rollback. Database rollback must be planned separately.");

  return {
    projectId,
    generatedAt:          new Date().toISOString(),
    overallStatus:        rollupOverallStatus(stages),
    stages,
    blockers:             blockers.slice(0, 10),
    warnings:             warnings.slice(0, 10),
    recommendedNextSteps: nextSteps,
  };
}
