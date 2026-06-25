/**
 * lib/go-live/final-go-live-gate.ts
 *
 * Sprint 63: Aggregated go-live gate report.
 *
 * Uses lightweight DB-backed checks to avoid circular imports with
 * ecommerce-test-planner, trial-migration-planner, etc.
 * Links to relevant pages for deep-dive.
 *
 * Safety: read-only, no secrets, no production mutations.
 */

import { db } from "@/lib/db";
import type {
  FinalGoLiveCheck,
  FinalGoLiveGateReport,
  FinalGoLiveStatus,
} from "./final-go-live-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGING_SLUG      = "sardar-security-staging";
const STRIPE_NAMES      = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"];
const CLOUDINARY_NAMES  = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const EMAIL_NAMES       = ["RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_HOST", "SMTP_USER"];
const BLOCKED_DOMAINS   = ["projects.doorstepmanchester.uk", "doorstepmanchester.uk"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function check(c: Omit<FinalGoLiveCheck, "message"> & { message?: string }): FinalGoLiveCheck {
  return { message: "", ...c } as FinalGoLiveCheck;
}

function deriveStatus(checks: FinalGoLiveCheck[]): FinalGoLiveStatus {
  if (checks.some((c) => c.status === "fail" && c.required)) return "blocked";
  if (checks.some((c) => c.status === "warning" && c.required)) return "warning";
  if (checks.every((c) => c.status === "pass" || c.status === "manual")) return "ready";
  return "warning";
}

function readinessScore(checks: FinalGoLiveCheck[]): number {
  const required = checks.filter((c) => c.required);
  if (required.length === 0) return 0;
  const passing = required.filter((c) => c.status === "pass" || c.status === "manual").length;
  return Math.round((passing / required.length) * 100);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateFinalGoLiveGateReport(input: {
  projectId: string;
}): Promise<FinalGoLiveGateReport> {
  const { projectId } = input;

  const p = (href: string) => `/projects/${projectId}${href}`;

  // ── DB queries (parallel) ──────────────────────────────────────────────────

  const [
    project,
    deployConfig,
    successfulDeployCount,
    totalDeployCount,
    latestBackup,
    backupCount,
    envCount,
    stripeVars,
    cloudinaryVars,
    emailVars,
    serviceCount,
    domainRows,
    memberCount,
    stagingProject,
  ] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }).catch(() => null),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        pm2Name: true, port: true,
        dbConnStatus: true,
        routeMode: true,
        primaryDomain: true,
      } as Parameters<typeof db.projectDeploymentConfig.findUnique>[0]["select"],
    }).catch(() => null),
    db.deployment.count({ where: { projectId, status: "SUCCESS" } }).catch(() => 0),
    db.deployment.count({ where: { projectId } }).catch(() => 0),
    db.projectBackup.findFirst({
      where:   { projectId, status: "ready" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, createdAt: true },
    }).catch(() => null),
    db.projectBackup.count({ where: { projectId, status: "ready" } }).catch(() => 0),
    db.projectEnvVar.count({ where: { projectId } }).catch(() => 0),
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: STRIPE_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: CLOUDINARY_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectEnvVar.findMany({
      where:  { projectId, name: { in: EMAIL_NAMES } },
      select: { name: true },
    }).catch(() => []),
    db.projectService.count({ where: { projectId } }).catch(() => 0),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }).catch(() => []),
    db.projectMember.count({ where: { projectId } }).catch(() => 0),
    db.project.findFirst({
      where:  { slug: STAGING_SLUG },
      select: { id: true, slug: true },
    }).catch(() => null),
  ]);

  const stripeSet     = new Set(stripeVars.map((v) => v.name));
  const cloudinarySet = new Set(cloudinaryVars.map((v) => v.name));
  const emailSet      = new Set(emailVars.map((v) => v.name));

  const activeDomainsCount = domainRows.filter((d) => d.status === "ACTIVE").length;
  const primaryDomain      = domainRows.find((d) => d.isPrimary) ?? domainRows[0] ?? null;
  const isDomainBlocked    = primaryDomain && BLOCKED_DOMAINS.includes(primaryDomain.hostname);
  const hasValidSsl        = primaryDomain?.sslStatus === "ACTIVE";

  const backupAgeDays = latestBackup
    ? (Date.now() - new Date(latestBackup.createdAt).getTime()) / 86_400_000
    : Infinity;

  // ── Checks ──────────────────────────────────────────────────────────────────

  const checks: FinalGoLiveCheck[] = [

    // ── Source ────────────────────────────────────────────────────────────
    check({
      id:       "source-config",
      category: "source",
      label:    "Deployment configuration exists",
      status:   deployConfig ? "pass" : "warning",
      required: true,
      message:  deployConfig
        ? `Deployment config found — PM2: ${(deployConfig as { pm2Name?: string }).pm2Name ?? "?"}, port: ${(deployConfig as { port?: number }).port ?? "?"}.`
        : "No deployment configuration found. Set up deployment before go-live.",
      linkHref: p("/publishing"),
      evidence: deployConfig ? ["Deployment config present"] : undefined,
    }),
    check({
      id:       "source-services",
      category: "source",
      label:    `${serviceCount} service(s) configured`,
      status:   serviceCount >= 2 ? "pass" : serviceCount === 1 ? "warning" : "warning",
      required: false,
      message:  serviceCount >= 2
        ? `${serviceCount} services configured (API + frontend expected).`
        : serviceCount === 1
        ? "Only 1 service configured — Sardar Security should have API + static frontend services."
        : "No services configured. Add API and static frontend services.",
      linkHref: p("/publishing"),
      evidence: serviceCount > 0 ? [`${serviceCount} service(s)`] : undefined,
    }),
    check({
      id:       "source-intake",
      category: "source",
      label:    "Source intake — manual review required",
      status:   "manual",
      required: false,
      message:  "Verify source intake report on the Import page — package manager, services, Replit markers.",
      linkHref: p("/import"),
    }),

    // ── Staging ───────────────────────────────────────────────────────────
    check({
      id:       "staging-project",
      category: "staging",
      label:    "Staging project exists",
      status:   stagingProject ? "pass" : "warning",
      required: false,
      message:  stagingProject
        ? `Staging project found: \`${STAGING_SLUG}\`.`
        : `Staging project \`${STAGING_SLUG}\` not found. Create it on the Migration page.`,
      linkHref: p("/migration"),
      evidence: stagingProject ? [`slug: ${STAGING_SLUG}`] : undefined,
    }),
    check({
      id:       "staging-trial",
      category: "staging",
      label:    "Staging trial migration — manual review required",
      status:   "manual",
      required: true,
      message:  "Generate and review trial migration plan on the Migration page. All stages must pass before go-live.",
      linkHref: p("/migration"),
      warning:  "Run MARK TRIAL COMPLETE on the Migration page after all stages pass.",
    }),
    check({
      id:       "staging-smoke",
      category: "staging",
      label:    "Staging smoke checks — manual review required",
      status:   "manual",
      required: true,
      message:  "Staging smoke checks must pass before production go-live. Run RUN STAGING CHECKS on Migration page.",
      linkHref: p("/migration"),
    }),

    // ── Ecommerce ─────────────────────────────────────────────────────────
    check({
      id:       "ecommerce-stripe-env",
      category: "ecommerce",
      label:    `Stripe env names: ${stripeSet.size}/3 configured`,
      status:   stripeSet.size >= 2 ? (stripeSet.size === 3 ? "pass" : "warning") : "fail",
      required: true,
      message:  stripeSet.size === 3
        ? "All 3 Stripe env names configured (names only — verify test vs live keys manually)."
        : stripeSet.size > 0
        ? `Only ${stripeSet.size}/3 Stripe env names found. Add: ${STRIPE_NAMES.filter((n) => !stripeSet.has(n)).join(", ")}.`
        : "No Stripe env vars configured. Checkout will fail.",
      linkHref: p("/env"),
      evidence: stripeSet.size > 0 ? [[...stripeSet].join(", ")] : undefined,
      warning:  "Verify keys are test-mode (sk_test_ / pk_test_) in staging, live (sk_live_) in production.",
    }),
    check({
      id:       "ecommerce-test-plan",
      category: "ecommerce",
      label:    "Ecommerce test plan — manual review required",
      status:   "manual",
      required: true,
      message:  "Generate and complete ecommerce test plan on Migration page. All provider checks and manual items must pass.",
      linkHref: p("/migration"),
      warning:  "Run MARK ECOMMERCE PROOF COMPLETE on Migration page after all items pass.",
    }),
    check({
      id:       "ecommerce-orders",
      category: "ecommerce",
      label:    "Order/admin evidence — manual review required",
      status:   "manual",
      required: false,
      message:  "Manually verify test order creation, admin visibility, and email delivery on staging.",
      linkHref: p("/migration"),
    }),

    // ── Env ───────────────────────────────────────────────────────────────
    check({
      id:       "env-count",
      category: "env",
      label:    `${envCount} env var(s) configured`,
      status:   envCount >= 5 ? "pass" : envCount > 0 ? "warning" : "fail",
      required: true,
      message:  envCount >= 5
        ? `${envCount} env vars configured. Review Env Readiness panel for gaps.`
        : envCount > 0
        ? `Only ${envCount} env var(s) — expected more for a full ecommerce project.`
        : "No env vars configured. Deployment will fail.",
      linkHref: p("/env"),
      evidence: envCount > 0 ? [`${envCount} env var(s)`] : undefined,
    }),
    check({
      id:       "env-review",
      category: "env",
      label:    "Env readiness — manual review required",
      status:   "manual",
      required: true,
      message:  "Review Env Readiness panel on the Env page. No placeholder values, no localhost in APP_URL.",
      linkHref: p("/env"),
    }),

    // ── Database ──────────────────────────────────────────────────────────
    check({
      id:       "database-conn",
      category: "database",
      label:    "Database connection status",
      status:   (() => {
        const s = (deployConfig as { dbConnStatus?: string | null } | null)?.dbConnStatus;
        if (s === "ok" || s === "connected") return "pass";
        if (s === "failed" || s === "missing_url") return "fail";
        return "warning";
      })(),
      required: true,
      message:  (() => {
        const s = (deployConfig as { dbConnStatus?: string | null } | null)?.dbConnStatus;
        if (s === "ok" || s === "connected") return "Database connection verified.";
        if (s === "failed") return "Database connection failed. Fix DB URL before go-live.";
        if (s === "missing_url") return "DATABASE_URL not configured.";
        return "Database connection not verified. Run connection test on the Database page.";
      })(),
      linkHref: p("/database"),
    }),
    check({
      id:       "database-migration",
      category: "database",
      label:    "DB migration commands — manual review required",
      status:   "manual",
      required: true,
      message:  "Review migration commands on the Database page. Run drizzle-kit push against staging DB first. Never auto-run against production.",
      linkHref: p("/database"),
      warning:  "Never run DB migrations automatically. Always back up before any schema change.",
    }),
    check({
      id:       "database-rollback-warn",
      category: "database",
      label:    "DB rollback limitation understood",
      status:   "manual",
      required: true,
      message:  "Application rollback does NOT rollback database schema or data. DB rollback requires manual restoration from a DB dump.",
      warning:  "Create a pg_dump before any migration. Keep the dump outside the project directory.",
    }),

    // ── External services ─────────────────────────────────────────────────
    check({
      id:       "ext-cloudinary",
      category: "external_services",
      label:    `Cloudinary env names: ${cloudinarySet.size}/3 configured`,
      status:   cloudinarySet.size >= 3 ? "pass" : cloudinarySet.size > 0 ? "warning" : "warning",
      required: false,
      message:  cloudinarySet.size >= 3
        ? "All 3 Cloudinary env names configured."
        : `${cloudinarySet.size}/3 Cloudinary env names found. Add: ${CLOUDINARY_NAMES.filter((n) => !cloudinarySet.has(n)).join(", ")}.`,
      linkHref: p("/env"),
      evidence: cloudinarySet.size > 0 ? [[...cloudinarySet].join(", ")] : undefined,
    }),
    check({
      id:       "ext-email",
      category: "external_services",
      label:    `Email provider env: ${emailSet.size > 0 ? "found" : "not found"}`,
      status:   emailSet.size > 0 ? "pass" : "warning",
      required: false,
      message:  emailSet.size > 0
        ? `Email provider env name found: ${[...emailSet][0]}.`
        : "No email provider env found. Add RESEND_API_KEY or SMTP_HOST.",
      linkHref: p("/env"),
    }),
    check({
      id:       "ext-services-review",
      category: "external_services",
      label:    "External services readiness — manual review required",
      status:   "manual",
      required: false,
      message:  "Review External Services Readiness panel on the Env page. Stripe, Cloudinary, and email must be working on staging.",
      linkHref: p("/env"),
    }),

    // ── Routing ───────────────────────────────────────────────────────────
    check({
      id:       "routing-config",
      category: "routing",
      label:    "Route mode configured",
      status:   (deployConfig as { routeMode?: string | null } | null)?.routeMode ? "pass" : "warning",
      required: false,
      message:  (deployConfig as { routeMode?: string | null } | null)?.routeMode
        ? `Route mode: ${(deployConfig as { routeMode?: string | null }).routeMode}.`
        : "Route mode not configured. Set API prefix and routing in Publishing page.",
      linkHref: p("/publishing"),
    }),
    check({
      id:       "routing-review",
      category: "routing",
      label:    "Production routing — manual review required",
      status:   "manual",
      required: true,
      message:  "Review nginx route config in Publishing → Production Routing. Verify /api/* and /* before applying.",
      linkHref: p("/publishing"),
      warning:  "Apply routes only after all readiness checks pass. Confirm with APPLY ROUTES.",
    }),
    check({
      id:       "routing-rollback",
      category: "routing",
      label:    "Route rollback preview reviewed",
      status:   "manual",
      required: false,
      message:  "Confirm nginx backup file exists before applying routes. Route rollback copies .bak → active config.",
      linkHref: p("/publishing"),
    }),

    // ── Domains ───────────────────────────────────────────────────────────
    check({
      id:       "domains-active",
      category: "domains",
      label:    `${activeDomainsCount} active domain(s)`,
      status:   activeDomainsCount >= 1 ? "pass" : "warning",
      required: false,
      message:  activeDomainsCount >= 1
        ? `${activeDomainsCount} active domain(s) configured.`
        : "No active domains. Add and verify your production domain.",
      linkHref: p("/domains"),
    }),
    check({
      id:       "domains-no-panel",
      category: "domains",
      label:    "Panel domain not used as project domain",
      status:   isDomainBlocked ? "fail" : "pass",
      required: true,
      message:  isDomainBlocked
        ? `Primary domain \`${primaryDomain?.hostname}\` is the panel domain — this must not be used as a project domain.`
        : "Primary domain is not the panel domain ✓",
      linkHref: p("/domains"),
      warning:  "Never use projects.doorstepmanchester.uk or doorstepmanchester.uk as a project domain.",
    }),
    check({
      id:       "domains-ssl",
      category: "domains",
      label:    "SSL status",
      status:   hasValidSsl ? "pass" : primaryDomain ? "warning" : "warning",
      required: false,
      message:  hasValidSsl
        ? `SSL active on ${primaryDomain?.hostname}.`
        : primaryDomain
        ? `SSL not active on ${primaryDomain.hostname}. Issue certificate before go-live.`
        : "No domain configured — add and verify domain before SSL setup.",
      linkHref: p("/domains"),
    }),

    // ── Deployment ────────────────────────────────────────────────────────
    check({
      id:       "deployment-count",
      category: "deployment",
      label:    `${successfulDeployCount} successful deployment(s)`,
      status:   successfulDeployCount >= 1 ? "pass" : "warning",
      required: true,
      message:  successfulDeployCount >= 1
        ? `${successfulDeployCount} successful deployment(s) found.`
        : "No successful deployments. Run a deployment before go-live.",
      linkHref: p("/releases"),
      evidence: successfulDeployCount > 0 ? [`${successfulDeployCount} success(es)`] : undefined,
    }),
    check({
      id:       "deployment-dry-run",
      category: "deployment",
      label:    "Deployment dry run — manual review required",
      status:   "manual",
      required: true,
      message:  "Review deployment dry run results on the Publishing page. Build command must succeed.",
      linkHref: p("/publishing"),
    }),

    // ── Backup ────────────────────────────────────────────────────────────
    check({
      id:       "backup-exists",
      category: "backup",
      label:    backupCount > 0 ? `${backupCount} ready backup(s)` : "No ready backups",
      status:   backupCount >= 1 ? (backupAgeDays <= 7 ? "pass" : "warning") : "fail",
      required: true,
      message:  backupCount >= 1
        ? backupAgeDays <= 7
          ? `${backupCount} backup(s) — latest ${Math.round(backupAgeDays * 10) / 10} day(s) old.`
          : `${backupCount} backup(s) — latest is ${Math.round(backupAgeDays)} day(s) old. Create a fresh backup before go-live.`
        : "No backups found. Create a backup before production cutover.",
      linkHref: p("/backups"),
      evidence: backupCount > 0 ? [`${backupCount} backup(s) ready`] : undefined,
    }),
    check({
      id:       "backup-drill",
      category: "backup",
      label:    "Restore drill — manual review required",
      status:   "manual",
      required: true,
      message:  "Complete the restore drill on the Backups page. Confirm MARK DRILL COMPLETE before go-live.",
      linkHref: p("/backups"),
      warning:  "A failed restore drill means you cannot safely recover from production incidents.",
    }),

    // ── Permissions ───────────────────────────────────────────────────────
    check({
      id:       "permissions-team",
      category: "permissions",
      label:    `${memberCount} team member(s)`,
      status:   memberCount >= 1 ? "pass" : "warning",
      required: false,
      message:  memberCount >= 1
        ? `${memberCount} team member(s) configured.`
        : "No team members. Ensure Owner is assigned before go-live.",
      linkHref: p("/team"),
      evidence: memberCount > 0 ? [`${memberCount} member(s)`] : undefined,
    }),
    check({
      id:       "permissions-review",
      category: "permissions",
      label:    "Team permissions — manual review required",
      status:   "manual",
      required: true,
      message:  "Review team roles on the Team page. Deploy, env, and route access must be limited to trusted users.",
      linkHref: p("/team"),
      warning:  "Viewers must not trigger deploys or apply routes. Remove stale/unrecognized members.",
    }),

    // ── Monitoring ────────────────────────────────────────────────────────
    check({
      id:       "monitoring-logs",
      category: "monitoring",
      label:    "Logs / debug page available",
      status:   "pass",
      required: false,
      message:  "Logs page is available for post-cutover monitoring.",
      linkHref: p("/logs"),
    }),
    check({
      id:       "monitoring-health",
      category: "monitoring",
      label:    "Health endpoint documented",
      status:   "pass",
      required: false,
      message:  "Health endpoint: /api/healthz — verify it returns { ok: true } on staging before go-live.",
      linkHref: p("/monitoring"),
    }),

    // ── Rollback ──────────────────────────────────────────────────────────
    check({
      id:       "rollback-target",
      category: "rollback",
      label:    "Rollback target exists",
      status:   successfulDeployCount >= 2 ? "pass" : successfulDeployCount === 1 ? "warning" : "warning",
      required: false,
      message:  successfulDeployCount >= 2
        ? `${successfulDeployCount} successful deployments — rollback target available.`
        : successfulDeployCount === 1
        ? "Only 1 successful deployment — rollback to previous release not possible until a second deploy."
        : "No successful deployments — rollback not possible.",
      linkHref: p("/releases"),
    }),
    check({
      id:       "rollback-plan",
      category: "rollback",
      label:    "Rollback plan — manual review required",
      status:   "manual",
      required: true,
      message:  "Review rollback plan on the Releases page. Know which deployment to roll back to and confirm DB rollback limitation.",
      linkHref: p("/releases"),
      warning:  "Application rollback does NOT rollback DB schema/data. DB rollback requires restoring a pg_dump manually.",
    }),

    // ── Manual ────────────────────────────────────────────────────────────
    check({
      id:       "manual-sign-off",
      category: "manual",
      label:    "Owner final sign-off",
      status:   "manual",
      required: true,
      message:  "Owner must confirm all readiness checks are complete before production cutover.",
      warning:  "Do not proceed to production cutover without explicit owner sign-off.",
    }),
  ];

  // ── Derive aggregate ──────────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!deployConfig)              blockers.push("No deployment configuration found");
  if (stripeSet.size < 2)         blockers.push("Stripe env names not fully configured");
  if (envCount === 0)             blockers.push("No env vars configured");
  if (isDomainBlocked)            blockers.push("Primary domain must not be the panel domain");
  if (backupCount === 0)          blockers.push("No backups — create a backup before go-live");
  if (successfulDeployCount === 0) blockers.push("No successful deployments");

  if (serviceCount < 2)           warnings.push("Less than 2 services configured (expected API + frontend)");
  if (!stagingProject)            warnings.push(`Staging project \`${STAGING_SLUG}\` not found`);
  if (stripeSet.size < 3)         warnings.push("STRIPE_WEBHOOK_SECRET not configured");
  if (cloudinarySet.size < 3)     warnings.push("Cloudinary not fully configured");
  if (emailSet.size === 0)        warnings.push("Email provider not configured");
  if (!hasValidSsl && primaryDomain) warnings.push("SSL not active on primary domain");
  if (backupAgeDays > 7)          warnings.push("Latest backup is more than 7 days old");
  if (successfulDeployCount < 2)  warnings.push("Only 1 successful deployment — rollback not possible");

  const summary = {
    total:    checks.length,
    passed:   checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    failed:   checks.filter((c) => c.status === "fail").length,
    manual:   checks.filter((c) => c.status === "manual").length,
    pending:  checks.filter((c) => c.status === "pending").length,
  };

  const nextSteps: string[] = [
    "Resolve all blockers before go-live",
    "Complete staging trial migration (MARK TRIAL COMPLETE on Migration page)",
    "Complete ecommerce proof (MARK ECOMMERCE PROOF COMPLETE on Migration page)",
    "Complete backup/restore drill (MARK DRILL COMPLETE on Backups page)",
    "Review team permissions on Team page",
    "Run deployment dry run on Publishing page",
    "Review production routing plan (apply only after all checks pass)",
    "Create a final backup immediately before cutover",
    "Apply production routes (APPLY ROUTES — confirm with team)",
    "Run post-cutover smoke checks (RUN SMOKE CHECKS)",
    "Mark cutover complete (MARK CUTOVER COMPLETE)",
  ];

  return {
    projectId,
    generatedAt:    new Date().toISOString(),
    status:         deriveStatus(checks),
    readinessScore: readinessScore(checks),
    checks,
    blockers,
    warnings,
    nextSteps,
    summary,
  };
}
