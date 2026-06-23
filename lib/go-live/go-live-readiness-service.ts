/**
 * lib/go-live/go-live-readiness-service.ts
 *
 * Sprint 49: Unified go-live readiness report.
 *
 * Orchestrates all existing readiness services to produce a single
 * go/no-go signal for production promotion.
 *
 * Safety rules:
 *  - no secret values in output
 *  - all sub-service calls are non-fatal (errors → warning check)
 *  - domain checks use DB data only (no live DNS lookup — fast path)
 *  - never auto-promote, never execute destructive commands
 */

import { db }               from "@/lib/db";
import type {
  GoLiveReadinessCheck,
  GoLiveReadinessReport,
  GoLiveReadinessStatus,
  GoLiveCheckCategory,
  GoLiveSmokeReport,
  SmokeCheckResult,
} from "./go-live-readiness-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function computeStatus(checks: GoLiveReadinessCheck[]): GoLiveReadinessStatus {
  const hasRequiredFail = checks.some(
    (c) => c.status === "fail" && c.severity === "required",
  );
  if (hasRequiredFail) return "blocked";

  const hasWarn = checks.some(
    (c) => c.status === "warning" || (c.status === "fail" && c.severity !== "required"),
  );
  if (hasWarn) return "warning";

  return "ready";
}

function pass(
  id: string, category: GoLiveCheckCategory, label: string,
  severity: GoLiveReadinessCheck["severity"], message: string,
  opts?: { linkHref?: string; evidence?: string[] },
): GoLiveReadinessCheck {
  return { id, category, label, status: "pass", severity, message, ...opts };
}

function warn(
  id: string, category: GoLiveCheckCategory, label: string,
  severity: GoLiveReadinessCheck["severity"], message: string,
  opts?: { linkHref?: string; evidence?: string[] },
): GoLiveReadinessCheck {
  return { id, category, label, status: "warning", severity, message, ...opts };
}

function fail(
  id: string, category: GoLiveCheckCategory, label: string,
  severity: GoLiveReadinessCheck["severity"], message: string,
  opts?: { linkHref?: string; evidence?: string[] },
): GoLiveReadinessCheck {
  return { id, category, label, status: "fail", severity, message, ...opts };
}

function manual(
  id: string, category: GoLiveCheckCategory, label: string,
  severity: GoLiveReadinessCheck["severity"], message: string,
  opts?: { linkHref?: string },
): GoLiveReadinessCheck {
  return { id, category, label, status: "manual", severity, message, ...opts };
}

// ── Deployment checks ─────────────────────────────────────────────────────────

async function deploymentChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const [latest, active, config] = await Promise.all([
      db.deployment.findFirst({
        where:   { projectId, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select:  { id: true, createdAt: true, metadata: true, isActive: true, branch: true },
      }),
      db.deployment.findFirst({
        where:  { projectId, isActive: true },
        select: { id: true, createdAt: true, metadata: true },
      }),
      db.projectDeploymentConfig.findUnique({
        where:  { projectId },
        select: { port: true, healthPath: true, pm2Name: true },
      }),
    ]);

    if (!latest) {
      checks.push(fail("deploy_exists", "deployment", "Successful deployment exists", "required",
        "No successful deployments found. Deploy the project before promoting.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    } else {
      const meta = latest.metadata as Record<string, unknown> | null;
      const ref  = (meta?.deploymentRef as string) ?? latest.id;
      checks.push(pass("deploy_exists", "deployment", "Successful deployment exists", "required",
        `Latest: ${ref.slice(0, 14)} (${new Date(latest.createdAt).toLocaleDateString("en-GB")})`,
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }

    if (!config) {
      checks.push(fail("deploy_config", "deployment", "Deployment config exists", "required",
        "No deployment configuration found. Configure port and PM2 name in Publishing.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    } else {
      const parts: string[] = [];
      if (config.pm2Name) parts.push(`PM2: ${config.pm2Name}`);
      if (config.port)    parts.push(`Port: ${config.port}`);
      checks.push(pass("deploy_config", "deployment", "Deployment config exists", "required",
        parts.join(", ") || "Configuration found.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }

    if (config?.port && config?.healthPath) {
      const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 5_000);
        const res  = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
          checks.push(pass("health_endpoint", "deployment", "Health endpoint reachable", "recommended",
            `${config.healthPath} returned HTTP ${res.status}.`,
          ));
        } else {
          checks.push(warn("health_endpoint", "deployment", "Health endpoint reachable", "recommended",
            `${config.healthPath} returned HTTP ${res.status} — service may not be healthy.`,
          ));
        }
      } catch {
        checks.push(warn("health_endpoint", "deployment", "Health endpoint reachable", "recommended",
          "Health endpoint unreachable — service may not be running yet.",
        ));
      }
    } else {
      checks.push(warn("health_endpoint", "deployment", "Health endpoint configured", "recommended",
        "No health path configured. Add healthPath in deployment config.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }

    void active; // suppress unused warning — used for context
  } catch {
    checks.push(warn("deploy_error", "deployment", "Deployment status", "required",
      "Could not load deployment status. Check database connection.",
    ));
  }
  return checks;
}

// ── Release checks ────────────────────────────────────────────────────────────

async function releaseChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const [latestPromo, successCount, activeOp] = await Promise.all([
      db.projectReleasePromotion.findFirst({
        where:   { projectId },
        orderBy: { createdAt: "desc" },
        select:  { status: true, rollbackDeploymentRef: true, preflightStatus: true },
      }),
      db.deployment.count({ where: { projectId, status: "SUCCESS" } }),
      db.projectOperation.findFirst({
        where:  { projectId, status: "running" },
        select: { operationType: true, title: true },
      }),
    ]);

    if (latestPromo?.status === "promoted") {
      checks.push(pass("release_promo", "release", "Release promoted before", "recommended",
        "At least one successful promotion exists.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    } else {
      checks.push(warn("release_promo", "release", "No prior promotions", "optional",
        "No promotions yet — this will be the first promoted release.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    }

    if (successCount >= 2) {
      checks.push(pass("rollback_target", "release", "Rollback target available", "recommended",
        `${successCount} successful deployments — rollback target exists.`,
        { linkHref: `/projects/${projectId}/releases` },
      ));
    } else if (successCount === 1) {
      checks.push(warn("rollback_target", "release", "Rollback target", "recommended",
        "Only one successful deployment — no previous release to roll back to.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    } else {
      checks.push(fail("rollback_target", "release", "Rollback target", "recommended",
        "No successful deployments found.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    }

    if (activeOp) {
      checks.push(fail("no_active_op", "release", "No conflicting operation", "required",
        `"${activeOp.title}" is running — wait for it to complete before promoting.`,
      ));
    } else {
      checks.push(pass("no_active_op", "release", "No conflicting operation", "required",
        "No operations currently running.",
      ));
    }

    if (latestPromo?.preflightStatus === "passed" || latestPromo?.preflightStatus === "warning") {
      checks.push(pass("preflight_run", "release", "Preflight checks run", "required",
        `Latest preflight: ${latestPromo.preflightStatus}.`,
        { linkHref: `/projects/${projectId}/releases` },
      ));
    } else {
      checks.push(warn("preflight_run", "release", "Preflight checks run", "required",
        "Run preflight checks before promoting.",
        { linkHref: `/projects/${projectId}/releases` },
      ));
    }
  } catch {
    checks.push(warn("release_error", "release", "Release status", "required",
      "Could not load release status.",
    ));
  }
  return checks;
}

// ── Env checks ────────────────────────────────────────────────────────────────

async function envChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const report = await generateEnvReadinessReport(projectId);

    if (!report || report.findings.length === 0) {
      checks.push(warn("env_readiness", "env", "Secrets readiness", "recommended",
        "No env readiness data — add env vars to the Secrets Vault.",
        { linkHref: `/projects/${projectId}/env` },
      ));
      return checks;
    }

    if (report.status === "blocked") {
      const missing = report.findings
        .filter((f) => f.severity === "required" && (f.status === "missing" || f.status === "placeholder" || f.status === "empty"))
        .map((f) => f.name)
        .slice(0, 5);
      checks.push(fail("env_missing", "env", "Required env vars present", "required",
        `Missing or placeholder: ${missing.join(", ")}.`,
        { linkHref: `/projects/${projectId}/env`, evidence: missing },
      ));
    } else {
      checks.push(pass("env_missing", "env", "Required env vars present", "required",
        `${report.summary.configured}/${report.summary.total} env vars configured.`,
        { linkHref: `/projects/${projectId}/env` },
      ));
    }

    const suspicious = report.findings.filter(
      (f) => f.status === "suspicious" && f.severity === "required",
    );
    if (suspicious.length > 0) {
      checks.push(warn("env_suspicious", "env", "No suspicious production values", "recommended",
        `${suspicious.length} env var(s) may use test/development values: ${suspicious.map((f) => f.name).join(", ")}.`,
        { linkHref: `/projects/${projectId}/env` },
      ));
    } else {
      checks.push(pass("env_suspicious", "env", "No suspicious production values", "recommended",
        "No test or development values detected in required vars.",
        { linkHref: `/projects/${projectId}/env` },
      ));
    }
  } catch {
    checks.push(warn("env_error", "env", "Secrets readiness", "required",
      "Could not check env var readiness.",
      { linkHref: `/projects/${projectId}/env` },
    ));
  }
  return checks;
}

// ── Database checks ───────────────────────────────────────────────────────────

async function databaseChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const [config, dbEnvVar] = await Promise.all([
      db.projectDeploymentConfig.findUnique({
        where:  { projectId },
        select: { dbConnStatus: true, dbConnLastCheckedAt: true, dbConnErrorMessage: true },
      }),
      db.projectEnvVar.findFirst({
        where:  { projectId, name: "DATABASE_URL" },
        select: { name: true, isEnabled: true },
      }),
    ]);

    if (!dbEnvVar) {
      checks.push(warn("db_url", "database", "DATABASE_URL configured", "recommended",
        "DATABASE_URL not found in Secrets Vault. If this project uses a database, add it.",
        { linkHref: `/projects/${projectId}/env` },
      ));
    } else if (!dbEnvVar.isEnabled) {
      checks.push(warn("db_url", "database", "DATABASE_URL configured", "recommended",
        "DATABASE_URL is in the vault but disabled.",
        { linkHref: `/projects/${projectId}/env` },
      ));
    } else {
      checks.push(pass("db_url", "database", "DATABASE_URL configured", "recommended",
        "DATABASE_URL is configured and enabled.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    }

    if (!config) {
      checks.push(warn("db_connection", "database", "Database connection tested", "recommended",
        "No deployment config — cannot check connection test status.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else if (config.dbConnStatus === "ok") {
      const since = config.dbConnLastCheckedAt
        ? Math.round((Date.now() - config.dbConnLastCheckedAt.getTime()) / (1000 * 60 * 60))
        : null;
      checks.push(pass("db_connection", "database", "Database connection tested", "recommended",
        `Connection test passed${since !== null ? ` (${since}h ago)` : ""}.`,
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else if (config.dbConnStatus === "failed") {
      checks.push(fail("db_connection", "database", "Database connection tested", "required",
        `Connection test failed: ${(config.dbConnErrorMessage ?? "unknown error").slice(0, 80)}.`,
        { linkHref: `/projects/${projectId}/database` },
      ));
    } else {
      checks.push(warn("db_connection", "database", "Database connection tested", "recommended",
        "Database connection not yet tested. Run a test in the Database section.",
        { linkHref: `/projects/${projectId}/database` },
      ));
    }
  } catch {
    checks.push(warn("db_error", "database", "Database readiness", "recommended",
      "Could not check database readiness.",
      { linkHref: `/projects/${projectId}/database` },
    ));
  }
  return checks;
}

// ── Domain checks ─────────────────────────────────────────────────────────────

const PANEL_DOMAIN = "projects.doorstepmanchester.uk";

async function domainChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const domains = await db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    if (domains.length === 0) {
      checks.push(warn("domain_active", "domain", "Production domain configured", "recommended",
        "No domains configured — project accessible via internal IP only.",
        { linkHref: `/projects/${projectId}/domains` },
      ));
      return checks;
    }

    const panelDomain = domains.find((d) => d.hostname === PANEL_DOMAIN);
    if (panelDomain) {
      checks.push(fail("domain_panel", "domain", "Panel domain not used", "required",
        `${PANEL_DOMAIN} must not be used as a project domain.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    } else {
      checks.push(pass("domain_panel", "domain", "Panel domain not used", "required",
        "No panel domain conflict.",
      ));
    }

    const primary = domains.find((d) => d.isPrimary) ?? domains[0];

    if (primary.status === "ACTIVE") {
      checks.push(pass("domain_active", "domain", "Primary domain active", "required",
        `${primary.hostname} is active.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    } else {
      checks.push(warn("domain_active", "domain", "Primary domain active", "required",
        `Domain ${primary.hostname} status: ${primary.status}.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    }

    if (primary.sslStatus === "ACTIVE") {
      checks.push(pass("ssl_active", "domain", "SSL certificate active", "required",
        `SSL is active for ${primary.hostname}.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    } else if (primary.sslStatus === "NONE") {
      checks.push(warn("ssl_active", "domain", "SSL certificate active", "required",
        `SSL not issued for ${primary.hostname}. Issue with certbot after DNS is live.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    } else {
      checks.push(warn("ssl_active", "domain", "SSL certificate active", "required",
        `SSL status: ${primary.sslStatus} for ${primary.hostname}.`,
        { linkHref: `/projects/${projectId}/domains` },
      ));
    }
  } catch {
    checks.push(warn("domain_error", "domain", "Domain readiness", "recommended",
      "Could not check domain readiness.",
      { linkHref: `/projects/${projectId}/domains` },
    ));
  }
  return checks;
}

// ── Routing checks ────────────────────────────────────────────────────────────

async function routingChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const [services, config] = await Promise.all([
      db.projectService.findMany({
        where:  { projectId, isEnabled: true },
        select: { serviceType: true, isPrimary: true, internalPort: true },
      }),
      db.projectDeploymentConfig.findUnique({
        where:  { projectId },
        select: { routeMode: true, apiPrefix: true, staticOutputDir: true },
      }),
    ]);

    const hasApi    = services.some((s) => s.serviceType === "API" || s.serviceType === "BACKEND");
    const hasStatic = services.some((s) => s.serviceType === "STATIC" || s.serviceType === "FRONTEND");

    if (!config) {
      checks.push(warn("routing_config", "routing", "Routing configuration", "recommended",
        "No deployment config found — routing cannot be verified.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
      return checks;
    }

    checks.push(pass("routing_exists", "routing", "Route configuration exists", "required",
      `Route mode: ${config.routeMode ?? "default"}`,
      { linkHref: `/projects/${projectId}/publishing` },
    ));

    if (hasApi && config.apiPrefix) {
      checks.push(pass("api_route", "routing", "API route configured", "recommended",
        `API prefix: ${config.apiPrefix}`,
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    } else if (hasApi) {
      checks.push(warn("api_route", "routing", "API route configured", "recommended",
        "API service exists but no API prefix configured.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }

    if (hasStatic && config.staticOutputDir) {
      checks.push(pass("static_route", "routing", "Static route configured", "recommended",
        `Static output: ${config.staticOutputDir}`,
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }
  } catch {
    checks.push(warn("routing_error", "routing", "Routing readiness", "recommended",
      "Could not check routing configuration.",
      { linkHref: `/projects/${projectId}/publishing` },
    ));
  }
  return checks;
}

// ── GitHub checks ─────────────────────────────────────────────────────────────

async function githubChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const { generateGitHubReadinessReport } = await import("@/lib/github/github-readiness-service");
    const report = await generateGitHubReadinessReport(projectId);

    if (!report.repositoryConfigured) {
      checks.push(warn("github_repo", "github", "GitHub repository connected", "optional",
        "No GitHub repository connected. Required for auto-sync.",
        { linkHref: `/projects/${projectId}/github` },
      ));
    } else {
      checks.push(pass("github_repo", "github", "GitHub repository connected", "optional",
        `Connected: ${report.repositoryFullName ?? "repository"}.`,
        { linkHref: `/projects/${projectId}/github` },
      ));
    }

    if (report.autoPullEnabled || report.autoDeployEnabled) {
      if (!report.webhook.secretConfigured) {
        checks.push(fail("github_webhook_secret", "github", "Webhook secret configured", "required",
          "GITHUB_WEBHOOK_SECRET missing — auto-sync cannot verify webhook signatures.",
          { linkHref: `/projects/${projectId}/github` },
        ));
      } else {
        checks.push(pass("github_webhook_secret", "github", "Webhook secret configured", "required",
          "Webhook secret is configured.",
          { linkHref: `/projects/${projectId}/github` },
        ));
      }
    } else {
      checks.push(pass("github_webhook_secret", "github", "Auto-sync not active", "optional",
        "Auto-pull and auto-deploy are disabled.",
        { linkHref: `/projects/${projectId}/github` },
      ));
    }

    if (report.dirtyWorktree && (report.autoPullEnabled || report.autoDeployEnabled)) {
      checks.push(fail("github_dirty", "github", "Worktree clean", "required",
        "Worktree has uncommitted changes — auto-pull is blocked.",
        { linkHref: `/projects/${projectId}/github` },
      ));
    } else if (report.dirtyWorktree) {
      checks.push(warn("github_dirty", "github", "Worktree clean", "recommended",
        "Worktree has uncommitted changes.",
        { linkHref: `/projects/${projectId}/github` },
      ));
    } else {
      checks.push(pass("github_dirty", "github", "Worktree clean", "recommended",
        "No uncommitted changes detected.",
        { linkHref: `/projects/${projectId}/github` },
      ));
    }
  } catch {
    checks.push(warn("github_error", "github", "GitHub readiness", "optional",
      "Could not check GitHub readiness.",
      { linkHref: `/projects/${projectId}/github` },
    ));
  }
  return checks;
}

// ── Backup checks ─────────────────────────────────────────────────────────────

async function backupChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const backup = await db.projectBackup.findFirst({
      where:   { projectId, status: "ready", createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      select:  { createdAt: true },
    });

    if (backup) {
      const ageH = Math.round((Date.now() - backup.createdAt.getTime()) / (60 * 60 * 1000));
      checks.push(pass("backup_recent", "backup", "Recent backup exists", "recommended",
        `Latest backup is ${ageH}h old.`,
        { linkHref: `/projects/${projectId}/backups` },
      ));
    } else {
      checks.push(warn("backup_recent", "backup", "Recent backup exists", "recommended",
        "No backup in the last 7 days. Create a backup before promoting.",
        { linkHref: `/projects/${projectId}/backups` },
      ));
    }

    checks.push(manual("backup_pre_promotion", "backup", "Backup created before this promotion", "recommended",
      "Create a backup immediately before promoting to allow safe rollback.",
      { linkHref: `/projects/${projectId}/backups` },
    ));
  } catch {
    checks.push(warn("backup_error", "backup", "Backup readiness", "recommended",
      "Could not check backup status.",
      { linkHref: `/projects/${projectId}/backups` },
    ));
  }
  return checks;
}

// ── Monitoring checks ─────────────────────────────────────────────────────────

async function monitoringChecks(projectId: string): Promise<GoLiveReadinessCheck[]> {
  const checks: GoLiveReadinessCheck[] = [];
  try {
    const config = await db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { healthPath: true },
    });

    if (config?.healthPath) {
      checks.push(pass("monitoring_health", "monitoring", "Health endpoint configured", "recommended",
        `Health path: ${config.healthPath}`,
        { linkHref: `/projects/${projectId}/monitoring` },
      ));
    } else {
      checks.push(warn("monitoring_health", "monitoring", "Health endpoint configured", "recommended",
        "No health endpoint configured. Add healthPath in deployment config.",
        { linkHref: `/projects/${projectId}/publishing` },
      ));
    }
  } catch {
    checks.push(warn("monitoring_error", "monitoring", "Monitoring configuration", "optional",
      "Could not check monitoring configuration.",
    ));
  }
  return checks;
}

// ── Manual checks ─────────────────────────────────────────────────────────────

function manualChecks(projectId: string): GoLiveReadinessCheck[] {
  return [
    manual("manual_smoke", "manual", "Smoke checks passed", "recommended",
      "Run smoke checks after promoting: domain /, API health, SPA routes.",
      { linkHref: `/projects/${projectId}/releases` },
    ),
    manual("manual_rollback", "manual", "Rollback plan reviewed", "recommended",
      "Confirm the rollback target and understand how to execute it if needed.",
      { linkHref: `/projects/${projectId}/releases` },
    ),
    manual("manual_stakeholders", "manual", "Stakeholders notified", "optional",
      "Notify relevant stakeholders of the go-live.",
    ),
  ];
}

// ── Build report ──────────────────────────────────────────────────────────────

function buildBlockers(checks: GoLiveReadinessCheck[]): string[] {
  return checks
    .filter((c) => c.status === "fail" && c.severity === "required")
    .map((c) => c.message);
}

function buildWarnings(checks: GoLiveReadinessCheck[]): string[] {
  return checks
    .filter((c) => c.status === "warning" || (c.status === "fail" && c.severity !== "required"))
    .map((c) => c.message);
}

function buildNextSteps(checks: GoLiveReadinessCheck[], projectId: string): string[] {
  const steps: string[] = [];
  const failed  = checks.filter((c) => c.status === "fail");
  const warned  = checks.filter((c) => c.status === "warning");
  const manuals = checks.filter((c) => c.status === "manual");

  if (failed.length > 0) {
    steps.push(`Fix ${failed.length} blocker(s): ${failed.map((c) => c.label).slice(0, 3).join(", ")}.`);
  }
  if (warned.length > 0) {
    steps.push(`Review ${warned.length} warning(s) before promoting.`);
  }
  if (manuals.length > 0) {
    steps.push(`Complete ${manuals.length} manual check(s): ${manuals.map((c) => c.label).slice(0, 3).join(", ")}.`);
  }
  if (failed.length === 0 && warned.length === 0) {
    steps.push("All automated checks pass. Complete manual checks and run smoke checks after promoting.");
  }
  return steps;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateGoLiveReadinessReport(
  projectId: string,
): Promise<GoLiveReadinessReport> {
  const generatedAt = new Date().toISOString();

  const [
    depChecks,
    relChecks,
    envCheck,
    dbChecks,
    domChecks,
    rtChecks,
    ghChecks,
    bkChecks,
    monChecks,
  ] = await Promise.all([
    deploymentChecks(projectId),
    releaseChecks(projectId),
    envChecks(projectId),
    databaseChecks(projectId),
    domainChecks(projectId),
    routingChecks(projectId),
    githubChecks(projectId),
    backupChecks(projectId),
    monitoringChecks(projectId),
  ]);

  const automated = [
    ...depChecks,
    ...relChecks,
    ...envCheck,
    ...dbChecks,
    ...domChecks,
    ...rtChecks,
    ...ghChecks,
    ...bkChecks,
    ...monChecks,
  ];

  const mans    = manualChecks(projectId);
  const checks  = [...automated, ...mans];
  const status  = computeStatus(automated);

  return {
    projectId,
    generatedAt,
    status,
    summary: {
      total:    checks.length,
      passed:   checks.filter((c) => c.status === "pass").length,
      warnings: checks.filter((c) => c.status === "warning").length,
      failed:   checks.filter((c) => c.status === "fail").length,
      manual:   checks.filter((c) => c.status === "manual").length,
    },
    checks,
    blockers:  buildBlockers(checks),
    warnings:  buildWarnings(checks),
    nextSteps: buildNextSteps(checks, projectId),
  };
}

// ── Smoke checks ──────────────────────────────────────────────────────────────

export async function runGoLiveSmokeChecks(projectId: string): Promise<GoLiveSmokeReport> {
  const runAt   = new Date().toISOString();
  const results: SmokeCheckResult[] = [];

  try {
    const [domain, config] = await Promise.all([
      db.domain.findFirst({
        where:   { projectId, isPrimary: true },
        select:  { hostname: true, sslStatus: true },
      }),
      db.projectDeploymentConfig.findUnique({
        where:  { projectId },
        select: { port: true, healthPath: true },
      }),
    ]);

    // Check 1: SSL status from DB (fast, no live request)
    if (domain?.sslStatus === "ACTIVE") {
      results.push({ id: "ssl_check", label: "SSL certificate", status: "pass",
        message: `SSL active for ${domain.hostname}.` });
    } else if (domain) {
      results.push({ id: "ssl_check", label: "SSL certificate", status: "warning",
        message: `SSL status: ${domain.sslStatus} for ${domain.hostname}.` });
    } else {
      results.push({ id: "ssl_check", label: "SSL certificate", status: "warning",
        message: "No primary domain configured." });
    }

    // Check 2: Domain root → 200
    if (domain?.hostname) {
      const url = `https://${domain.hostname}/`;
      const t0  = Date.now();
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10_000);
        const res  = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
        clearTimeout(tid);
        const ms = Date.now() - t0;
        if (res.ok || res.status === 307 || res.status === 302 || res.status === 301) {
          results.push({ id: "domain_root", label: "Domain root", url, status: "pass",
            statusCode: res.status, durationMs: ms,
            message: `${url} returned HTTP ${res.status} in ${ms}ms.` });
        } else {
          results.push({ id: "domain_root", label: "Domain root", url, status: "warning",
            statusCode: res.status, durationMs: ms,
            message: `${url} returned HTTP ${res.status}.` });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id: "domain_root", label: "Domain root", url, status: "fail",
          message: msg.includes("abort") ? `${url} timed out after 10s.` : `${url} unreachable: ${msg.slice(0, 80)}.` });
      }
    } else {
      results.push({ id: "domain_root", label: "Domain root", status: "warning",
        message: "No primary domain configured — cannot check domain root." });
    }

    // Check 3: API health via internal port (if configured)
    if (config?.port && config?.healthPath) {
      const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
      const t0  = Date.now();
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 5_000);
        const res  = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        const ms = Date.now() - t0;
        if (res.ok) {
          results.push({ id: "health_endpoint", label: "API health endpoint", url,
            status: "pass", statusCode: res.status, durationMs: ms,
            message: `${config.healthPath} returned ${res.status} in ${ms}ms.` });
        } else {
          results.push({ id: "health_endpoint", label: "API health endpoint", url,
            status: "warning", statusCode: res.status, durationMs: ms,
            message: `${config.healthPath} returned HTTP ${res.status}.` });
        }
      } catch {
        results.push({ id: "health_endpoint", label: "API health endpoint", url,
          status: "warning", message: `${config.healthPath} unreachable — service may not be running.` });
      }
    } else {
      results.push({ id: "health_endpoint", label: "API health endpoint", status: "warning",
        message: "No health endpoint configured." });
    }

    // Check 4: HTTPS domain health via public URL (if domain + healthPath)
    if (domain?.hostname && config?.healthPath) {
      const url = `https://${domain.hostname}${config.healthPath}`;
      const t0  = Date.now();
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10_000);
        const res  = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        const ms = Date.now() - t0;
        if (res.ok) {
          results.push({ id: "public_health", label: "Public health endpoint", url,
            status: "pass", statusCode: res.status, durationMs: ms,
            message: `Public ${config.healthPath} returned ${res.status} in ${ms}ms.` });
        } else {
          results.push({ id: "public_health", label: "Public health endpoint", url,
            status: "warning", statusCode: res.status, durationMs: ms,
            message: `Public ${config.healthPath} returned HTTP ${res.status}.` });
        }
      } catch {
        results.push({ id: "public_health", label: "Public health endpoint", url,
          status: "warning", message: `Public health endpoint unreachable.` });
      }
    }
  } catch {
    results.push({ id: "smoke_error", label: "Smoke check error", status: "fail",
      message: "Failed to run smoke checks. Check database connection." });
  }

  return {
    projectId,
    runAt,
    overallPass: results.every((r) => r.status !== "fail"),
    checks: results,
  };
}
