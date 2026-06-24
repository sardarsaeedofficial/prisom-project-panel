/**
 * lib/cutover/production-cutover-planner.ts
 *
 * Sprint 55: Generates a production cutover plan by aggregating signals from
 * all prior readiness sub-systems.
 *
 * Safety rules:
 *  - read-only DB access
 *  - no PM2/nginx mutations
 *  - no DB migrations
 *  - no secret values exposed
 *  - all sub-system imports are dynamic and non-fatal
 */

import { db } from "@/lib/db";
import { generateRollbackReadiness } from "./rollback-readiness";
import type {
  ProductionCutoverPlan,
  ProductionCutoverStage,
  ProductionCutoverStatus,
  ProductionCutoverStep,
} from "./production-cutover-types";

// ── Stage metadata ─────────────────────────────────────────────────────────────

const STAGE_TITLES: Record<ProductionCutoverStage, string> = {
  preflight:         "1. Preflight",
  freeze:            "2. Freeze Window",
  backup:            "3. Backup",
  database:          "4. Database",
  services:          "5. Services",
  routing:           "6. Routing",
  external_services: "7. External Services",
  smoke_checks:      "8. Smoke Checks",
  monitoring:        "9. Monitoring",
  rollback:          "10. Rollback",
  post_go_live:      "11. Post Go-Live",
};

const STAGE_ORDER: ProductionCutoverStage[] = [
  "preflight", "freeze", "backup", "database", "services",
  "routing", "external_services", "smoke_checks", "monitoring",
  "rollback", "post_go_live",
];

// ── Step builders ──────────────────────────────────────────────────────────────

function passStep(
  id: string, stage: ProductionCutoverStage, title: string,
  description: string, opts?: Partial<ProductionCutoverStep>,
): ProductionCutoverStep {
  return { id, stage, title, description, status: "pass", required: true, ...opts };
}

function warnStep(
  id: string, stage: ProductionCutoverStage, title: string,
  description: string, opts?: Partial<ProductionCutoverStep>,
): ProductionCutoverStep {
  return { id, stage, title, description, status: "warning", required: false, ...opts };
}

function failStep(
  id: string, stage: ProductionCutoverStage, title: string,
  description: string, opts?: Partial<ProductionCutoverStep>,
): ProductionCutoverStep {
  return { id, stage, title, description, status: "fail", required: true, ...opts };
}

function manualStep(
  id: string, stage: ProductionCutoverStage, title: string,
  description: string, opts?: Partial<ProductionCutoverStep>,
): ProductionCutoverStep {
  return { id, stage, title, description, status: "manual", required: false, ...opts };
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function computeStageStatus(steps: ProductionCutoverStep[]): ProductionCutoverStatus {
  const hasRequiredFail = steps.some((s) => s.status === "fail" && s.required);
  if (hasRequiredFail) return "blocked";
  const hasWarn = steps.some((s) => s.status === "warning" || (s.status === "fail" && !s.required));
  if (hasWarn) return "warning";
  const hasManual = steps.some((s) => s.status === "manual" || s.status === "pending");
  if (hasManual) return "warning";
  return "ready";
}

function computeOverallStatus(
  stageStatuses: ProductionCutoverStatus[],
): ProductionCutoverStatus {
  if (stageStatuses.some((s) => s === "blocked")) return "blocked";
  if (stageStatuses.some((s) => s === "warning")) return "warning";
  return "ready";
}

// ── Stage builders ─────────────────────────────────────────────────────────────

async function buildPreflightStage(
  projectId: string,
): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  // Go-live readiness
  try {
    const { generateGoLiveReadinessReport } = await import("@/lib/go-live/go-live-readiness-service");
    const glReport = await generateGoLiveReadinessReport(projectId);
    if (glReport.status === "blocked") {
      steps.push(failStep("preflight_golive", "preflight",
        "Go-Live Readiness",
        `Go-live readiness is blocked: ${glReport.blockers.slice(0, 2).join("; ")}`,
        { evidence: glReport.blockers.slice(0, 3), linkHref: `/projects/${projectId}/releases` },
      ));
    } else if (glReport.status === "warning") {
      steps.push(warnStep("preflight_golive", "preflight",
        "Go-Live Readiness",
        `Go-live readiness has warnings: ${glReport.warnings.slice(0, 2).join("; ")}`,
        { evidence: glReport.warnings.slice(0, 3), linkHref: `/projects/${projectId}/releases` },
      ));
    } else {
      steps.push(passStep("preflight_golive", "preflight",
        "Go-Live Readiness",
        "Go-live readiness checks passed.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    }
  } catch {
    steps.push(warnStep("preflight_golive", "preflight",
      "Go-Live Readiness",
      "Could not load go-live readiness — check Releases page.",
      { linkHref: `/projects/${projectId}/releases` },
    ));
  }

  // Deployment dry run
  try {
    const { generateDeploymentDryRunPlan } = await import("@/lib/deploy/dry-run-planner");
    const dryRun = await generateDeploymentDryRunPlan(projectId);
    if (dryRun.status === "blocked" || dryRun.status === "failed") {
      steps.push(failStep("preflight_dryrun", "preflight",
        "Deployment Dry Run",
        "Deployment dry run has blockers. Fix before proceeding with cutover.",
        { evidence: dryRun.blockers.slice(0, 3), linkHref: `/projects/${projectId}/publishing` },
      ));
    } else if (dryRun.status === "warning") {
      steps.push(warnStep("preflight_dryrun", "preflight",
        "Deployment Dry Run",
        "Deployment dry run has warnings.",
        { evidence: dryRun.warnings.slice(0, 3), linkHref: `/projects/${projectId}/publishing` },
      ));
    } else {
      steps.push(passStep("preflight_dryrun", "preflight",
        "Deployment Dry Run",
        "Deployment dry run passed.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }
  } catch {
    steps.push(warnStep("preflight_dryrun", "preflight",
      "Deployment Dry Run",
      "Could not load deployment dry run — run it from the Publishing page.",
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  }

  // External services readiness
  try {
    const { generateExternalServicesReadiness } = await import("@/lib/external-services/external-services-readiness");
    const extReport = await generateExternalServicesReadiness(projectId);
    if (extReport.status === "blocked") {
      steps.push(failStep("preflight_external", "preflight",
        "External Services Readiness",
        `External services missing required secrets: ${extReport.blockers.slice(0, 2).join("; ")}`,
        { evidence: extReport.blockers.slice(0, 3), linkHref: `/projects/${projectId}/env` },
      ));
    } else if (extReport.status === "warning") {
      steps.push(warnStep("preflight_external", "preflight",
        "External Services Readiness",
        "External services have warnings (Stripe/Cloudinary/Email).",
        { evidence: extReport.warnings.slice(0, 3), linkHref: `/projects/${projectId}/env` },
      ));
    } else {
      steps.push(passStep("preflight_external", "preflight",
        "External Services Readiness",
        "External services (Stripe/Cloudinary/Email) look ready.",
        { linkHref: `/projects/${projectId}/env` },
      ));
    }
  } catch {
    steps.push(warnStep("preflight_external", "preflight",
      "External Services Readiness",
      "Could not load external services readiness — review Env page.",
      { linkHref: `/projects/${projectId}/env` },
    ));
  }

  // Staging import passed (manual confirmation)
  steps.push(manualStep("preflight_staging", "preflight",
    "Staging Import Confirmed",
    "Confirm staging import passed and staging smoke checks are green.",
    { linkHref: `/projects/${projectId}/migration` },
  ));

  return steps;
}

async function buildFreezeStage(projectId: string): Promise<ProductionCutoverStep[]> {
  return [
    warnStep("freeze_window", "freeze",
      "Freeze Window",
      "No freeze window has been marked. Mark when writes/orders on the old system are frozen.",
      { warning: "Freeze writes on old system before starting DB migration to avoid data loss." },
    ),
    manualStep("freeze_confirm", "freeze",
      "Confirm Writes Frozen",
      "Freeze writes and orders on old system if required. Confirm before continuing.",
    ),
    manualStep("freeze_notify", "freeze",
      "Notify Stakeholders",
      "Notify team and stakeholders of cutover start time and expected downtime window.",
    ),
  ];
}

async function buildBackupStage(projectId: string): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  // Check for recent backup in DB (backup config)
  try {
    const recentBackup = await db.projectBackup.findFirst({
      where:   { projectId, status: "ready" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, createdAt: true },
    }).catch(() => null);

    if (recentBackup) {
      const days = Math.floor((Date.now() - new Date(recentBackup.createdAt).getTime()) / 86_400_000);
      if (days <= 1) {
        steps.push(passStep("backup_exists", "backup",
          "Recent Backup Exists",
          `A backup was created within the last ${days === 0 ? "24 hours" : `${days} day(s)`}.`,
          { linkHref: `/projects/${projectId}/backups` },
        ));
      } else {
        steps.push(warnStep("backup_exists", "backup",
          "Backup May Be Stale",
          `Last backup: ${days} day(s) ago. Create a fresh backup before cutover.`,
          { linkHref: `/projects/${projectId}/backups` },
        ));
      }
    } else {
      steps.push(failStep("backup_exists", "backup",
        "No Backup Found",
        "No backup configuration found. Create a database and files backup before cutover.",
        { linkHref: `/projects/${projectId}/backups` },
      ));
    }
  } catch {
    steps.push(warnStep("backup_exists", "backup",
      "Backup Status Unknown",
      "Could not check backup status. Verify a recent backup exists before proceeding.",
      { linkHref: `/projects/${projectId}/backups` },
    ));
  }

  steps.push(manualStep("backup_db", "backup",
    "Final Database Backup",
    "Create a final database dump before applying migrations. Store in a safe location.",
    { command: "pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql" },
  ));
  steps.push(manualStep("backup_files", "backup",
    "Final Files Backup",
    "Backup any uploaded files, media, or user content before cutover.",
  ));

  return steps;
}

async function buildDatabaseStage(projectId: string): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  try {
    const { generateReadinessReport } = await import("@/lib/database/db-readiness-detector");
    const dbReport = await generateReadinessReport(projectId);
    if (!dbReport) {
      steps.push(warnStep("db_readiness", "database",
        "Database Readiness",
        "Could not load database readiness — review Database page.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else if (dbReport.blockers.length > 0) {
      steps.push(failStep("db_readiness", "database",
        "Database Readiness",
        `Database readiness is blocked: ${dbReport.blockers.slice(0, 2).join("; ")}`,
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else if (!dbReport.isReady || dbReport.warnings.length > 0) {
      steps.push(warnStep("db_readiness", "database",
        "Database Readiness",
        "Database readiness has warnings.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else {
      steps.push(passStep("db_readiness", "database",
        "Database Readiness",
        "Database readiness checks passed.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    }
  } catch {
    steps.push(warnStep("db_readiness", "database",
      "Database Readiness",
      "Could not check database readiness — review Database page.",
      { linkHref: `/projects/${projectId}/database` },
    ));
  }

  steps.push(manualStep("db_migration", "database",
    "Run DB Migration (if required)",
    "If the release includes a schema migration, run it manually against production DB. Never auto-run.",
    {
      warning: "Never run DB migrations automatically. Confirm with team before running.",
      command: "pnpm --filter @workspace/db exec drizzle-kit push",
    },
  ));
  steps.push(manualStep("db_verify", "database",
    "Verify DB Schema",
    "After migration, verify the database schema is correct and the app can connect.",
  ));

  return steps;
}

async function buildServicesStage(projectId: string): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  // Deployment config exists
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { port: true, healthPath: true, pm2Name: true },
  }).catch(() => null);

  if (!config?.pm2Name) {
    steps.push(failStep("services_config", "services",
      "Deployment Config Missing",
      "No deployment config found (PM2 name, port, health path). Configure before cutover.",
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  } else {
    steps.push(passStep("services_config", "services",
      "Deployment Config Present",
      `PM2 process: ${config.pm2Name}, port: ${config.port ?? "not set"}, health: ${config.healthPath ?? "not set"}`,
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  }

  steps.push(manualStep("services_deploy", "services",
    "Deploy Services",
    "Deploy services using the existing deploy workflow. Do not use the cutover assistant to restart PM2.",
    {
      confirmationRequired: "PROMOTE",
      linkHref:             `/projects/${projectId}/publishing`,
      warning:              "Use the Publishing page to promote/deploy. Never restart PM2 from the cutover assistant.",
    },
  ));
  steps.push(manualStep("services_health_check", "services",
    "Verify Service Health",
    "After deployment, verify the service is responding on its configured port.",
  ));

  return steps;
}

async function buildRoutingStage(projectId: string): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  // Domain readiness
  try {
    const primaryDomain = await db.domain.findFirst({
      where:  { projectId, isPrimary: true },
      select: { hostname: true },
    });
    if (primaryDomain?.hostname) {
      const { generateDomainReadinessReport } = await import("@/lib/domains/domain-readiness-service");
      const domainReport = await generateDomainReadinessReport({
        projectId,
        domain: primaryDomain.hostname,
      });
      if (domainReport.status === "blocked") {
        steps.push(failStep("routing_domain", "routing",
          "Domain Readiness",
          `Domain readiness is blocked for ${primaryDomain.hostname}`,
          { evidence: domainReport.blockers?.slice(0, 3), linkHref: `/projects/${projectId}/domains` },
        ));
      } else if (domainReport.status === "warning") {
        steps.push(warnStep("routing_domain", "routing",
          "Domain Readiness",
          `Domain readiness has warnings for ${primaryDomain.hostname}`,
          { linkHref: `/projects/${projectId}/domains` },
        ));
      } else {
        steps.push(passStep("routing_domain", "routing",
          "Domain Readiness",
          `Domain ${primaryDomain.hostname} is ready.`,
          { linkHref: `/projects/${projectId}/domains` },
        ));
      }

      // Nginx route backup
      const { hasBackupConfig } = await import("@/lib/routing/nginx-route-apply");
      const hasBackup = await hasBackupConfig(primaryDomain.hostname).catch(() => false);
      if (hasBackup) {
        steps.push(passStep("routing_backup", "routing",
          "Nginx Route Backup",
          "Nginx route backup exists — rollback is available.",
          { linkHref: `/projects/${projectId}/publishing` },
        ));
      } else {
        steps.push(warnStep("routing_backup", "routing",
          "No Nginx Route Backup",
          "No nginx route backup found. Save current config before applying new routes.",
          { linkHref: `/projects/${projectId}/publishing` },
        ));
      }
    } else {
      steps.push(failStep("routing_domain", "routing",
        "No Primary Domain",
        "No primary domain configured. Configure a domain before applying routes.",
        { linkHref: `/projects/${projectId}/domains` },
      ));
    }
  } catch {
    steps.push(warnStep("routing_domain", "routing",
      "Domain Check Failed",
      "Could not check domain readiness — review Domains page.",
      { linkHref: `/projects/${projectId}/domains` },
    ));
  }

  steps.push(manualStep("routing_apply", "routing",
    "Apply Production Routes",
    "Apply nginx routes using the existing routing workflow. Confirm with APPLY ROUTES.",
    {
      confirmationRequired: "APPLY ROUTES",
      linkHref:             `/projects/${projectId}/publishing`,
      warning:              "Never apply routes automatically. Use the Publishing page routing panel.",
    },
  ));
  steps.push(manualStep("routing_verify", "routing",
    "Verify Routing",
    "After applying routes, verify the domain routes to the correct service.",
  ));

  return steps;
}

async function buildExternalServicesStage(
  projectId: string,
): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];

  try {
    const { generateExternalServicesReadiness } = await import("@/lib/external-services/external-services-readiness");
    const extReport = await generateExternalServicesReadiness(projectId);

    if (extReport.status === "blocked") {
      steps.push(failStep("ext_services", "external_services",
        "External Services",
        `External services are not ready: ${extReport.blockers.slice(0, 2).join("; ")}`,
        { evidence: extReport.blockers.slice(0, 4), linkHref: `/projects/${projectId}/env` },
      ));
    } else if (extReport.status === "warning") {
      steps.push(warnStep("ext_services", "external_services",
        "External Services",
        "External services have warnings — review before cutover.",
        { evidence: extReport.warnings.slice(0, 4), linkHref: `/projects/${projectId}/env` },
      ));
    } else {
      steps.push(passStep("ext_services", "external_services",
        "External Services",
        "Stripe, Cloudinary, and email configuration reviewed.",
        { linkHref: `/projects/${projectId}/env` },
      ));
    }
  } catch {
    steps.push(warnStep("ext_services", "external_services",
      "External Services",
      "Could not check external services — review Env page.",
      { linkHref: `/projects/${projectId}/env` },
    ));
  }

  steps.push(manualStep("ext_stripe_webhook", "external_services",
    "Configure Stripe Webhook in Dashboard",
    "In Stripe Dashboard → Developers → Webhooks, add production endpoint and copy the webhook secret.",
    {
      warning:  "Never create Stripe webhooks automatically. Do this manually in the Stripe Dashboard.",
      evidence: [
        "Production webhook: https://sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe",
      ],
    },
  ));
  steps.push(warnStep("ext_stripe_live_check", "external_services",
    "Stripe Live Mode",
    "Confirm Stripe live keys are configured for production (sk_live_*, pk_live_*).",
    {
      required: true,
      linkHref: `/projects/${projectId}/env`,
      warning:  "Do not enable Stripe live mode automatically. Confirm keys match production.",
    },
  ));

  return steps;
}

function buildSmokeChecksStage(projectId: string): ProductionCutoverStep[] {
  return [
    manualStep("smoke_run", "smoke_checks",
      "Run Smoke Checks",
      "Run smoke checks using the Production Cutover Assistant after deploying and applying routes.",
      {
        confirmationRequired: "RUN SMOKE CHECKS",
        evidence: [
          "https://sardar-security-project.doorstepmanchester.uk/",
          "https://sardar-security-project.doorstepmanchester.uk/api/healthz",
          "https://sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe (HEAD only)",
        ],
        warning: "Smoke checks run HTTP GET/HEAD only. No Stripe charges or webhook mutations.",
      },
    ),
    manualStep("smoke_test_order", "smoke_checks",
      "Place Manual Test Order",
      "Place a real test order using Stripe test card 4242 4242 4242 4242 in staging, or verify checkout in production.",
      { warning: "Do not place real orders with live cards until you have confirmed the system is working." },
    ),
    manualStep("smoke_auth", "smoke_checks",
      "Verify Login / Auth Flow",
      "Test login, session, and auth flows after deployment.",
    ),
  ];
}

function buildMonitoringStage(projectId: string): ProductionCutoverStep[] {
  return [
    warnStep("monitoring_check", "monitoring",
      "Monitoring / Alerting",
      "No monitoring or alerting configuration verified. Check PM2 logs and nginx logs after cutover.",
      { linkHref: `/projects/${projectId}/publishing` },
    ),
    manualStep("monitoring_logs", "monitoring",
      "Monitor Logs",
      "Monitor PM2 and nginx logs for errors for at least 1 hour after cutover.",
      { command: "pm2 logs project-sardar-security-project --lines 100" },
    ),
    manualStep("monitoring_alerts", "monitoring",
      "Set Up Alerting",
      "Configure uptime monitoring and error alerting for the production URL.",
    ),
  ];
}

async function buildRollbackStage(projectId: string): Promise<ProductionCutoverStep[]> {
  const steps: ProductionCutoverStep[] = [];
  const rollback = await generateRollbackReadiness(projectId);

  if (rollback.hasPreviousRelease) {
    steps.push(passStep("rollback_target", "rollback",
      "Rollback Target Available",
      `Rollback deployment: ${rollback.rollbackDeploymentRef?.slice(0, 16) ?? "available"}`,
      { linkHref: `/projects/${projectId}/releases` },
    ));
  } else {
    steps.push(failStep("rollback_target", "rollback",
      "No Rollback Target",
      "No previous release found. Promote a build first to establish a rollback target.",
      { linkHref: `/projects/${projectId}/releases` },
    ));
  }

  if (rollback.routeSnapshotAvailable) {
    steps.push(passStep("rollback_routes", "rollback",
      "Route Snapshot Available",
      "Nginx route backup exists — previous routing can be restored.",
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  } else {
    steps.push(warnStep("rollback_routes", "rollback",
      "No Route Snapshot",
      "No nginx route backup found. Save current routing config before applying new routes.",
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  }

  steps.push({
    id: "rollback_db_warning", stage: "rollback",
    title: "Database Rollback Warning",
    description: rollback.dbRollbackWarning,
    status: "manual", required: false,
    warning: rollback.dbRollbackWarning,
  });

  steps.push(manualStep("rollback_plan_reviewed", "rollback",
    "Rollback Plan Reviewed",
    "Review rollback procedures with the team. Confirm rollback requires typing ROLLBACK.",
    { confirmationRequired: "ROLLBACK" },
  ));

  return steps;
}

function buildPostGoLiveStage(projectId: string): ProductionCutoverStep[] {
  return [
    manualStep("postlive_smoke", "post_go_live",
      "Post-Cutover Smoke Checks",
      "Run full smoke checks 15 minutes after cutover to confirm stability.",
      { confirmationRequired: "RUN SMOKE CHECKS" },
    ),
    manualStep("postlive_monitor_24h", "post_go_live",
      "Monitor for 24 Hours",
      "Monitor PM2 logs, error rates, and uptime for 24 hours post-cutover.",
    ),
    manualStep("postlive_stripe_verify", "post_go_live",
      "Verify Stripe Webhook in Dashboard",
      "Check Stripe Dashboard → Developers → Webhooks → recent events to confirm webhook is firing.",
    ),
    manualStep("postlive_announce", "post_go_live",
      "Announce Go-Live",
      "Notify stakeholders and team that production cutover is complete.",
    ),
    manualStep("postlive_complete", "post_go_live",
      "Mark Cutover Complete",
      "Once all checks pass and the system is stable, mark cutover as complete.",
      { confirmationRequired: "MARK CUTOVER COMPLETE" },
    ),
  ];
}

// ── Next steps builder ─────────────────────────────────────────────────────────

function buildNextSteps(
  blockers: string[],
  warnings: string[],
  stageStatuses: { stage: ProductionCutoverStage; status: ProductionCutoverStatus }[],
): string[] {
  const steps: string[] = [];
  if (blockers.length > 0) {
    steps.push(`Fix ${blockers.length} blocker(s) before proceeding: ${blockers.slice(0, 2).join("; ")}.`);
  }
  const firstBlockedStage = stageStatuses.find((s) => s.status === "blocked");
  if (firstBlockedStage) {
    steps.push(`Blocked at stage: ${STAGE_TITLES[firstBlockedStage.stage]}.`);
  }
  if (blockers.length === 0 && warnings.length > 0) {
    steps.push(`Review ${warnings.length} warning(s) before cutover.`);
  }
  if (blockers.length === 0) {
    steps.push("Complete all manual checklist items in order.");
    steps.push("Run smoke checks after deploying and applying routes (requires RUN SMOKE CHECKS).");
    steps.push("Mark cutover complete only after smoke checks pass (requires MARK CUTOVER COMPLETE).");
    steps.push("Keep rollback plan ready and reviewed with the team.");
  }
  return steps;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateProductionCutoverPlan(
  projectId: string,
): Promise<ProductionCutoverPlan> {
  const generatedAt = new Date().toISOString();

  const [
    preflightSteps,
    freezeSteps,
    backupSteps,
    databaseSteps,
    servicesSteps,
    routingSteps,
    externalSteps,
    rollbackSteps,
  ] = await Promise.all([
    buildPreflightStage(projectId),
    buildFreezeStage(projectId),
    buildBackupStage(projectId),
    buildDatabaseStage(projectId),
    buildServicesStage(projectId),
    buildRoutingStage(projectId),
    buildExternalServicesStage(projectId),
    buildRollbackStage(projectId),
  ]);

  const smokeSteps      = buildSmokeChecksStage(projectId);
  const monitoringSteps = buildMonitoringStage(projectId);
  const postLiveSteps   = buildPostGoLiveStage(projectId);

  const stageStepMap: Record<ProductionCutoverStage, ProductionCutoverStep[]> = {
    preflight:         preflightSteps,
    freeze:            freezeSteps,
    backup:            backupSteps,
    database:          databaseSteps,
    services:          servicesSteps,
    routing:           routingSteps,
    external_services: externalSteps,
    smoke_checks:      smokeSteps,
    monitoring:        monitoringSteps,
    rollback:          rollbackSteps,
    post_go_live:      postLiveSteps,
  };

  const stages = STAGE_ORDER.map((stage) => {
    const steps  = stageStepMap[stage] ?? [];
    const status = computeStageStatus(steps);
    return { stage, title: STAGE_TITLES[stage], status, steps };
  });

  const blockers: string[] = stages
    .flatMap((s) => s.steps.filter((step) => step.status === "fail" && step.required))
    .map((step) => step.description.slice(0, 100));

  const warnings: string[] = stages
    .flatMap((s) => s.steps.filter((step) => step.status === "warning"))
    .map((step) => step.description.slice(0, 100))
    .slice(0, 10);

  const stageStatuses = stages.map((s) => ({ stage: s.stage, status: s.status }));
  const status        = computeOverallStatus(stages.map((s) => s.status));
  const nextSteps     = buildNextSteps(blockers, warnings, stageStatuses);

  return { projectId, generatedAt, status, stages, blockers, warnings, nextSteps };
}
