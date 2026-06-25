/**
 * lib/migration/trial-migration-planner.ts
 *
 * Sprint 61: Generate a staging trial migration run plan.
 *
 * Pulls DB state for backup, deployment, env var count, and staging project
 * existence. All other stages are manual/pending (require human verification).
 *
 * Recommended staging target:
 *   slug:   sardar-security-staging
 *   domain: staging-sardar-security-project.doorstepmanchester.uk
 *
 * SAFETY: Never modifies live project. Never applies routes. Never restarts PM2.
 *
 * Server-only.
 */

import { db } from "@/lib/db";
import type {
  TrialMigrationRun,
  TrialMigrationStage,
  TrialMigrationStageGroup,
  TrialMigrationStatus,
  TrialMigrationStep,
} from "./trial-migration-types";

export const STAGING_SLUG   = "sardar-security-staging";
export const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

// ── Stage title map ───────────────────────────────────────────────────────────

const STAGE_TITLES: Record<TrialMigrationStage, string> = {
  source_intake:     "Source Intake",
  staging_import:    "Staging Import",
  services:          "Service Configuration",
  env:               "Env & Secrets",
  database:          "Database",
  routing:           "Routing Preview",
  dry_run:           "Deployment Dry Run",
  external_services: "External Services",
  backup_drill:      "Backup & Restore Drill",
  smoke_checks:      "Smoke Checks",
  manual_review:     "Manual Evidence Review",
};

// ── Status derivation ─────────────────────────────────────────────────────────

function deriveStageStatus(steps: TrialMigrationStep[]): TrialMigrationStatus {
  if (steps.some((s) => s.status === "fail"))    return "failed";
  if (steps.some((s) => s.status === "warning")) return "warning";
  if (steps.every((s) => s.status === "pass"))   return "passed";
  if (steps.some((s) => s.status === "pass"))    return "ready";
  return "not_started";
}

// ── Main planner ──────────────────────────────────────────────────────────────

export async function generateTrialMigrationRun(input: {
  projectId: string;
}): Promise<TrialMigrationRun> {
  const { projectId } = input;

  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  // ── DB-backed checks ───────────────────────────────────────────────────────

  const [
    readyBackupCount,
    deploymentCount,
    stagingProject,
    envVarCount,
    project,
  ] = await Promise.all([
    db.projectBackup.count({ where: { projectId, status: "ready" } }),
    db.deployment.count({ where: { projectId, status: "SUCCESS" } }),
    db.project.findFirst({
      where:  { slug: STAGING_SLUG },
      select: { id: true, name: true, slug: true, createdAt: true },
    }),
    db.projectEnvVar.count({ where: { projectId } }),
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true },
    }),
  ]);

  const sourceRoot    = `storage/projects/${project?.slug ?? projectId}`;
  const stagingExists = !!stagingProject;

  // ── Stage 1: Source Intake ─────────────────────────────────────────────────

  const sourceIntakeSteps: TrialMigrationStep[] = [
    {
      id:          "si-1-source-imported",
      stage:       "source_intake",
      title:       "Source files imported into panel",
      description: `Check that ${project?.slug ?? "the project"} has source files in the panel storage.`,
      status:      "manual",
      required:    true,
      linkHref:    `/projects/${projectId}/import`,
    },
    {
      id:          "si-2-source-intake-report",
      stage:       "source_intake",
      title:       "Source Intake Report generated",
      description: "Run Source Intake analysis to detect PM, services, env names, and Replit markers.",
      status:      "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/import`,
      evidence:    [sourceRoot],
    },
    {
      id:          "si-3-monorepo-detected",
      stage:       "source_intake",
      title:       "Monorepo / workspace structure detected",
      description: "Confirm pnpm workspace with @workspace/api-server and @workspace/sardar-security packages.",
      status:      "manual",
      required:    true,
      command:     "ls artifacts/ && cat pnpm-workspace.yaml",
    },
  ];

  // ── Stage 2: Staging Import ────────────────────────────────────────────────

  const stagingImportSteps: TrialMigrationStep[] = [
    {
      id:          "stg-1-staging-project",
      stage:       "staging_import",
      title:       `Staging project exists (slug: ${STAGING_SLUG})`,
      description: `Create a separate project in the panel with slug "${STAGING_SLUG}" as the staging target.`,
      status:      stagingExists ? "pass" : "pending",
      required:    true,
      evidence:    stagingExists ? [`Project found: ${stagingProject.name} (created ${stagingProject.createdAt.toISOString().slice(0, 10)})`] : undefined,
      warning:     stagingExists ? undefined : `Project "${STAGING_SLUG}" not found. Create it in the panel first.`,
    },
    {
      id:          "stg-2-source-imported-to-staging",
      stage:       "staging_import",
      title:       "Source files imported into staging project",
      description: "Import or copy the Sardar source into the staging project. Do not overwrite live Sardar source.",
      status:      "manual",
      required:    true,
      linkHref:    stagingExists ? `/projects/${stagingProject!.id}/import` : `/projects/${projectId}/import`,
      warning:     "Never restore or import into the live Sardar project slug (sardar-security-project).",
    },
    {
      id:          "stg-3-staging-import-panel",
      stage:       "staging_import",
      title:       "Staging Import panel completed",
      description: "Use the Staging Import panel on the Migration page to validate and complete the staging import.",
      status:      "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/migration`,
    },
  ];

  if (!stagingExists) {
    warnings.push(`Staging project "${STAGING_SLUG}" not found — create it before running staging import.`);
  }

  // ── Stage 3: Services ──────────────────────────────────────────────────────

  const servicesSteps: TrialMigrationStep[] = [
    {
      id:          "svc-1-api-service",
      stage:       "services",
      title:       "API service configured",
      description: "Add API service: root=artifacts/api-server, build=pnpm --filter @workspace/api-server run build, start=node --enable-source-maps artifacts/api-server/dist/index.mjs",
      status:      "manual",
      required:    true,
      command:     "pnpm --filter @workspace/api-server run build",
    },
    {
      id:          "svc-2-frontend-service",
      stage:       "services",
      title:       "Static frontend service configured",
      description: "Add frontend service: root=artifacts/sardar-security, build=pnpm --filter @workspace/sardar-security run build, output=artifacts/sardar-security/dist/public, SPA fallback=enabled",
      status:      "manual",
      required:    true,
      command:     "pnpm --filter @workspace/sardar-security run build",
    },
    {
      id:          "svc-3-health-endpoint",
      stage:       "services",
      title:       "API health endpoint responds",
      description: `API service should respond at /api/healthz once deployed to staging.`,
      status:      "pending",
      required:    true,
      command:     `curl -I https://${STAGING_DOMAIN}/api/healthz`,
    },
  ];

  // ── Stage 4: Env & Secrets ─────────────────────────────────────────────────

  const envSteps: TrialMigrationStep[] = [
    {
      id:          "env-1-vars-configured",
      stage:       "env",
      title:       "Staging env variables configured",
      description: `${envVarCount} env var(s) exist for this project. For staging, add test/sandbox values only — never copy production secrets.`,
      status:      envVarCount > 0 ? "pass" : "warning",
      required:    true,
      message:     envVarCount > 0 ? undefined : "No env vars configured for this project.",
      linkHref:    `/projects/${projectId}/env`,
      evidence:    envVarCount > 0 ? [`${envVarCount} env var(s) configured`] : undefined,
    } as TrialMigrationStep,
    {
      id:          "env-2-db-url",
      stage:       "env",
      title:       "DATABASE_URL configured for staging DB",
      description: "Enter the staging database URL. Use a separate staging DB — never use the production DATABASE_URL.",
      status:      "manual",
      required:    true,
      warning:     "Never copy the production DATABASE_URL into the staging project.",
    },
    {
      id:          "env-3-app-url",
      stage:       "env",
      title:       `APP_URL set to https://${STAGING_DOMAIN}`,
      description: "Set APP_URL, NEXTAUTH_URL (if applicable) to the staging domain.",
      status:      "manual",
      required:    true,
    },
    {
      id:          "env-4-stripe-test",
      stage:       "env",
      title:       "Stripe keys are test mode (sk_test_*)",
      description: "Confirm STRIPE_SECRET_KEY begins with sk_test_ and STRIPE_PUBLISHABLE_KEY with pk_test_ for staging.",
      status:      "manual",
      required:    true,
      warning:     "Never use Stripe live keys in staging.",
    },
  ];

  if (envVarCount === 0) {
    warnings.push("No env vars configured for this project. Add staging values before import.");
  }

  // ── Stage 5: Database ──────────────────────────────────────────────────────

  const databaseSteps: TrialMigrationStep[] = [
    {
      id:          "db-1-staging-db",
      stage:       "database",
      title:       "Staging database provisioned",
      description: "Create a separate staging Postgres database. Do not run against the production DB.",
      status:      "manual",
      required:    true,
      warning:     "Never run schema changes or migrations against the production database.",
    },
    {
      id:          "db-2-migration-reviewed",
      stage:       "database",
      title:       "Drizzle migration reviewed manually",
      description: "Review all pending Drizzle migrations before running them. Understand every schema change.",
      status:      "manual",
      required:    true,
      command:     "pnpm --filter @workspace/db exec drizzle-kit status",
    },
    {
      id:          "db-3-connection-test",
      stage:       "database",
      title:       "Database connection test passed",
      description: "Run the Database connection test from the panel to confirm the staging DB URL is correct.",
      status:      "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/database`,
    },
    {
      id:          "db-4-migration-run",
      stage:       "database",
      title:       "Schema migration run on staging DB (manual)",
      description: "Run Drizzle migration against staging DB only after reviewing output.",
      status:      "manual",
      required:    true,
      command:     "pnpm --filter @workspace/db exec drizzle-kit push",
      warning:     "Never run drizzle-kit push against production. Staging only.",
    },
  ];

  // ── Stage 6: Routing ───────────────────────────────────────────────────────

  const routingSteps: TrialMigrationStep[] = [
    {
      id:          "rt-1-route-plan-reviewed",
      stage:       "routing",
      title:       "Route plan reviewed",
      description: "Route plan: /api/* → API service, /* → static frontend with SPA fallback.",
      status:      "manual",
      required:    true,
      linkHref:    `/projects/${projectId}/publishing`,
    },
    {
      id:          "rt-2-nginx-preview",
      stage:       "routing",
      title:       "Nginx config preview checked (staging only)",
      description: "Review the nginx config preview in the Publishing page. Do NOT apply production routes.",
      status:      "manual",
      required:    true,
      warning:     "Never apply nginx routes to production during the staging trial. Use staging domain only.",
    },
    {
      id:          "rt-3-no-production-route",
      stage:       "routing",
      title:       "Production routes NOT applied",
      description: "Confirm that no production nginx routes have been applied during this trial run.",
      status:      "manual",
      required:    true,
    },
  ];

  // ── Stage 7: Deployment Dry Run ────────────────────────────────────────────

  const dryRunSteps: TrialMigrationStep[] = [
    {
      id:          "dr-1-dry-run-passed",
      stage:       "dry_run",
      title:       "Deployment dry run passed",
      description: "Run the deployment dry run from the Publishing page to confirm services are configured correctly.",
      status:      deploymentCount > 0 ? "pass" : "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/releases`,
      evidence:    deploymentCount > 0 ? [`${deploymentCount} successful deployment(s) exist`] : undefined,
    },
    {
      id:          "dr-2-build-dry-run",
      stage:       "dry_run",
      title:       "Build dry run passed",
      description: "Run the build dry run to confirm the build command completes without errors.",
      status:      deploymentCount > 0 ? "pass" : "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/releases`,
    },
  ];

  if (deploymentCount === 0) {
    warnings.push("No successful deployments recorded. Run a deployment dry run before the staging trial.");
  }

  // ── Stage 8: External Services ─────────────────────────────────────────────

  const extServicesSteps: TrialMigrationStep[] = [
    {
      id:          "ext-1-stripe-test",
      stage:       "external_services",
      title:       "Stripe test mode configured and tested",
      description: "Run a test Stripe checkout with card 4242 4242 4242 4242 in staging. Confirm webhook fires.",
      status:      "manual",
      required:    true,
      linkHref:    `/projects/${projectId}/env`,
    },
    {
      id:          "ext-2-cloudinary",
      stage:       "external_services",
      title:       "Cloudinary upload manually tested",
      description: "Upload a test product image via the staging admin panel. Confirm it appears in Cloudinary.",
      status:      "manual",
      required:    false,
    },
    {
      id:          "ext-3-email",
      stage:       "external_services",
      title:       "Email provider manually tested",
      description: "Trigger a test password reset email in staging. Confirm delivery.",
      status:      "manual",
      required:    false,
    },
    {
      id:          "ext-4-ext-services-panel",
      stage:       "external_services",
      title:       "External Services Readiness panel reviewed",
      description: "Check the External Services Readiness panel on the Migration page for live status.",
      status:      "pending",
      required:    true,
      linkHref:    `/projects/${projectId}/migration`,
    },
  ];

  // ── Stage 9: Backup Drill ──────────────────────────────────────────────────

  const backupDrillSteps: TrialMigrationStep[] = [
    {
      id:          "bkp-1-backup-exists",
      stage:       "backup_drill",
      title:       "At least one ready backup exists",
      description: "Create a backup of the staging source before running smoke checks.",
      status:      readyBackupCount > 0 ? "pass" : "warning",
      required:    true,
      linkHref:    `/projects/${projectId}/backups`,
      evidence:    readyBackupCount > 0 ? [`${readyBackupCount} ready backup(s)`] : undefined,
      warning:     readyBackupCount === 0 ? "No ready backup found. Create a backup before the trial." : undefined,
    },
    {
      id:          "bkp-2-restore-drill",
      stage:       "backup_drill",
      title:       "Restore drill completed on staging",
      description: "Run the Disaster Recovery drill from the Backups page to confirm backup recovery works.",
      status:      "pending",
      required:    false,
      linkHref:    `/projects/${projectId}/backups`,
      confirmationRequired: "MARK DRILL COMPLETE",
    },
    {
      id:          "bkp-3-integrity-check",
      stage:       "backup_drill",
      title:       "Backup integrity verified",
      description: "Use Verify Backup Integrity on the Backups page to confirm the archive is intact.",
      status:      "pending",
      required:    false,
      linkHref:    `/projects/${projectId}/backups`,
      confirmationRequired: "VERIFY BACKUP",
    },
  ];

  if (readyBackupCount === 0) {
    warnings.push("No ready backup found. Create a backup before completing the staging trial.");
  }

  // ── Stage 10: Smoke Checks ─────────────────────────────────────────────────

  const smokeSteps: TrialMigrationStep[] = [
    {
      id:          "smk-1-root",
      stage:       "smoke_checks",
      title:       `Staging root URL returns 200`,
      description: `GET https://${STAGING_DOMAIN}/ should return HTTP 200.`,
      status:      "pending",
      required:    true,
      command:     `curl -I https://${STAGING_DOMAIN}/`,
      confirmationRequired: "RUN STAGING CHECKS",
    },
    {
      id:          "smk-2-api-health",
      stage:       "smoke_checks",
      title:       `Staging API health endpoint returns 200`,
      description: `GET https://${STAGING_DOMAIN}/api/healthz should return HTTP 200.`,
      status:      "pending",
      required:    true,
      command:     `curl -I https://${STAGING_DOMAIN}/api/healthz`,
    },
    {
      id:          "smk-3-spa-fallback",
      stage:       "smoke_checks",
      title:       `Staging SPA fallback returns 200 (not 404)`,
      description: `GET https://${STAGING_DOMAIN}/non-existent-spa-route should return HTTP 200 with SPA fallback.`,
      status:      "pending",
      required:    false,
      command:     `curl -I https://${STAGING_DOMAIN}/non-existent-spa-route`,
    },
    {
      id:          "smk-4-live-sardar-unaffected",
      stage:       "smoke_checks",
      title:       "Live Sardar production remains 200",
      description: "Confirm the live Sardar project was not disrupted by the staging trial.",
      status:      "manual",
      required:    true,
      command:     "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    },
  ];

  // ── Stage 11: Manual Review ────────────────────────────────────────────────

  const manualReviewSteps: TrialMigrationStep[] = [
    {
      id:          "mr-1-login-tested",
      stage:       "manual_review",
      title:       "Login / auth flow tested in staging",
      description: "Navigate to staging login, create a test account, confirm auth works.",
      status:      "manual",
      required:    true,
    },
    {
      id:          "mr-2-product-browse",
      stage:       "manual_review",
      title:       "Product browse and add-to-cart tested",
      description: "Browse the product catalogue and add items to cart on staging.",
      status:      "manual",
      required:    true,
    },
    {
      id:          "mr-3-checkout-test",
      stage:       "manual_review",
      title:       "Test checkout with Stripe test card",
      description: "Complete a test checkout using card 4242 4242 4242 4242. Confirm order appears in admin.",
      status:      "manual",
      required:    true,
    },
    {
      id:          "mr-4-admin-panel",
      stage:       "manual_review",
      title:       "Admin panel accessible and functional",
      description: "Log into the staging admin panel. Confirm products, orders, and settings are accessible.",
      status:      "manual",
      required:    true,
    },
    {
      id:          "mr-5-no-prod-leak",
      stage:       "manual_review",
      title:       "No production data visible in staging",
      description: "Confirm staging shows no production customer data, orders, or payment info.",
      status:      "manual",
      required:    true,
      warning:     "Never expose production customer data in staging.",
    },
    {
      id:          "mr-6-logs-clean",
      stage:       "manual_review",
      title:       "PM2 logs clean — no startup errors",
      description: "Review PM2 logs on staging server to confirm no ERROR lines on startup.",
      status:      "manual",
      required:    true,
      linkHref:    `/projects/${projectId}/logs`,
    },
    {
      id:          "mr-7-rollback-tested",
      stage:       "manual_review",
      title:       "Rollback plan reviewed",
      description: "Confirm you know how to roll back the staging deployment if the trial fails.",
      status:      "manual",
      required:    false,
      linkHref:    `/projects/${projectId}/releases`,
    },
  ];

  // ── Assemble stages ────────────────────────────────────────────────────────

  const allStageData: Array<{ stage: TrialMigrationStage; steps: TrialMigrationStep[] }> = [
    { stage: "source_intake",     steps: sourceIntakeSteps },
    { stage: "staging_import",    steps: stagingImportSteps },
    { stage: "services",          steps: servicesSteps },
    { stage: "env",               steps: envSteps },
    { stage: "database",          steps: databaseSteps },
    { stage: "routing",           steps: routingSteps },
    { stage: "dry_run",           steps: dryRunSteps },
    { stage: "external_services", steps: extServicesSteps },
    { stage: "backup_drill",      steps: backupDrillSteps },
    { stage: "smoke_checks",      steps: smokeSteps },
    { stage: "manual_review",     steps: manualReviewSteps },
  ];

  const stages: TrialMigrationStageGroup[] = allStageData.map(({ stage, steps }) => ({
    stage,
    title:  STAGE_TITLES[stage],
    status: deriveStageStatus(steps),
    steps,
  }));

  // ── Blockers ───────────────────────────────────────────────────────────────

  if (!stagingExists) {
    blockers.push(`Staging project "${STAGING_SLUG}" does not exist. Create it before running the staging trial.`);
  }

  // ── Next steps ─────────────────────────────────────────────────────────────

  nextSteps.push("Create staging project with slug sardar-security-staging if it doesn't exist.");
  nextSteps.push("Import source into staging project from the Import page.");
  nextSteps.push("Configure staging env values (staging DB URL, APP_URL, Stripe test keys).");
  nextSteps.push("Run the deployment dry run to confirm services and build config are correct.");
  nextSteps.push("Run staging smoke checks with RUN STAGING CHECKS to validate the trial.");
  nextSteps.push("Complete the manual evidence checklist items.");
  nextSteps.push(`Mark trial complete with MARK TRIAL COMPLETE when all stages pass.`);
  nextSteps.push("Only proceed to production cutover after this trial passes fully.");

  // ── Overall status ─────────────────────────────────────────────────────────

  const overallStatus: TrialMigrationStatus = blockers.length > 0
    ? "blocked"
    : stages.some((s) => s.status === "failed")
    ? "failed"
    : stages.some((s) => s.status === "warning")
    ? "warning"
    : stages.every((s) => s.status === "passed" || s.status === "complete")
    ? "passed"
    : "not_started";

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status: overallStatus,
    recommendedStagingSlug:   STAGING_SLUG,
    recommendedStagingDomain: STAGING_DOMAIN,
    stages,
    blockers,
    warnings,
    nextSteps,
  };
}
