/**
 * lib/deploy/dry-run-planner.ts
 *
 * Sprint 53: Generates a deployment dry-run plan for a project.
 *
 * Safety rules:
 *  - reads project metadata, services, env/DB/domain/routing status only
 *  - never restarts PM2, applies nginx, runs DB commands, or exposes secrets
 *  - all sub-service integrations are non-fatal (errors → warning check)
 */

import { db }                   from "@/lib/db";
import { classifyCommand }      from "./safe-command-classifier";
import type {
  DeploymentDryRunCheck,
  DeploymentDryRunCategory,
  DeploymentDryRunPlan,
  DeploymentDryRunStatus,
} from "./dry-run-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function check(
  id:        string,
  category:  DeploymentDryRunCategory,
  label:     string,
  status:    DeploymentDryRunCheck["status"],
  message:   string,
  required:  boolean,
  opts?: {
    evidence?: string[];
    command?:  string;
    linkHref?: string;
  },
): DeploymentDryRunCheck {
  return { id, category, label, status, message, required, ...opts };
}

function statusFromChecks(checks: DeploymentDryRunCheck[]): DeploymentDryRunStatus {
  const hasBlocker = checks.some((c) => c.status === "fail" && c.required);
  const hasWarning = checks.some((c) => c.status === "warning" || (c.status === "fail" && !c.required));
  if (hasBlocker) return "blocked";
  if (hasWarning) return "warning";
  return "ready";
}

// ── Source checks ─────────────────────────────────────────────────────────────

function buildSourceChecks(
  rootDirectory: string | null,
  packageJson: boolean,
  lockfile: string | null,
  isMonorepo: boolean,
): DeploymentDryRunCheck[] {
  const checks: DeploymentDryRunCheck[] = [];

  checks.push(check(
    "source.root_path",
    "source",
    "Root directory configured",
    rootDirectory ? "pass" : "warning",
    rootDirectory
      ? `Source root: ${rootDirectory}`
      : "No rootDirectory set — will use repo root.",
    false,
  ));

  checks.push(check(
    "source.package_json",
    "source",
    "package.json detected",
    packageJson ? "pass" : "fail",
    packageJson
      ? "package.json found in deployment config"
      : "No package.json detected — install and build commands cannot run.",
    true,
  ));

  checks.push(check(
    "source.lockfile",
    "source",
    "Lockfile detected",
    lockfile ? "pass" : "warning",
    lockfile
      ? `Lockfile: ${lockfile}`
      : "No lockfile detected — installs may not be reproducible.",
    false,
  ));

  if (isMonorepo) {
    checks.push(check(
      "source.monorepo",
      "source",
      "Monorepo / workspace detected",
      "pass",
      "Workspace structure detected (pnpm-workspace.yaml or workspaces field in package.json).",
      false,
    ));
  }

  return checks;
}

// ── Package manager checks ────────────────────────────────────────────────────

function buildPackageManagerChecks(
  installCmd: string | null,
  buildCmd:   string | null,
  lockfile:   string | null,
): DeploymentDryRunCheck[] {
  const checks: DeploymentDryRunCheck[] = [];
  const pm =
    lockfile === "pnpm-lock.yaml" ? "pnpm" :
    lockfile === "yarn.lock"      ? "yarn" :
    lockfile === "package-lock.json" ? "npm" :
    null;

  const installPm =
    installCmd?.startsWith("pnpm") ? "pnpm" :
    installCmd?.startsWith("yarn") ? "yarn" :
    installCmd?.startsWith("npm")  ? "npm" : null;

  if (pm && installPm && pm !== installPm) {
    checks.push(check(
      "pm.conflict",
      "package_manager",
      "Package manager / lockfile mismatch",
      "warning",
      `Lockfile suggests ${pm} but install command uses ${installPm}. Use ${pm} for reproducible installs.`,
      false,
      { command: installCmd ?? undefined },
    ));
  } else {
    checks.push(check(
      "pm.detected",
      "package_manager",
      "Package manager",
      pm || installPm ? "pass" : "warning",
      pm ? `Detected ${pm} from lockfile.` : installPm ? `Detected ${installPm} from install command.` : "Cannot detect package manager — add an install command.",
      false,
    ));
  }

  // Sardar should prefer pnpm
  if (buildCmd && buildCmd.includes("@workspace/")) {
    if (!buildCmd.startsWith("pnpm")) {
      checks.push(check(
        "pm.sardar_pnpm",
        "package_manager",
        "Sardar workspace should use pnpm",
        "warning",
        "Workspace filter syntax (@workspace/*) is a pnpm feature — use pnpm --filter.",
        false,
        { command: buildCmd },
      ));
    }
  }

  return checks;
}

// ── Install checks ────────────────────────────────────────────────────────────

function buildInstallChecks(installCmd: string | null): DeploymentDryRunCheck[] {
  const checks: DeploymentDryRunCheck[] = [];

  if (!installCmd) {
    checks.push(check(
      "install.missing",
      "install",
      "Install command",
      "warning",
      "No install command configured. Dependencies may not be installed before build.",
      false,
    ));
    return checks;
  }

  const cls = classifyCommand(installCmd);
  checks.push(check(
    "install.command",
    "install",
    "Install command",
    cls.safety === "blocked" ? "fail" :
    cls.safety === "warning" ? "warning" : "pass",
    cls.safety === "blocked"
      ? `Install command blocked: ${cls.reason}`
      : cls.safety === "warning"
      ? `Install command needs review: ${cls.reason}`
      : `Install command looks safe: ${installCmd}`,
    cls.safety === "blocked",
    { command: installCmd },
  ));

  if (installCmd.includes("--frozen-lockfile") || installCmd.includes("--ci")) {
    checks.push(check(
      "install.frozen",
      "install",
      "Frozen lockfile flag",
      "pass",
      "Install will use frozen lockfile — reproducible installs enforced.",
      false,
    ));
  }

  if (/\bsudo\b/.test(installCmd)) {
    checks.push(check(
      "install.sudo",
      "install",
      "sudo in install command",
      "fail",
      "Install command contains sudo — not allowed in automated deployment.",
      true,
      { command: installCmd },
    ));
  }

  return checks;
}

// ── Build checks ──────────────────────────────────────────────────────────────

type ServiceShape = {
  id:              string;
  name:            string;
  serviceType:     string;
  buildCommand:    string | null;
  startCommand:    string | null;
  staticOutputDir: string | null;
  internalPort:    number | null;
  healthPath:      string | null;
  spaFallback:     boolean;
  isPrimary:       boolean;
  isEnabled:       boolean;
};

function buildBuildChecks(
  globalBuildCmd: string | null,
  services: ServiceShape[],
): DeploymentDryRunCheck[] {
  const checks: DeploymentDryRunCheck[] = [];

  if (services.length === 0) {
    if (!globalBuildCmd) {
      checks.push(check(
        "build.no_command",
        "build",
        "Build command",
        "warning",
        "No build command configured.",
        false,
      ));
      return checks;
    }

    const cls = classifyCommand(globalBuildCmd);
    checks.push(check(
      "build.command",
      "build",
      "Build command",
      cls.safety === "blocked" ? "fail" : cls.safety === "warning" ? "warning" : "pass",
      cls.safety === "blocked"
        ? `Build command blocked: ${cls.reason}`
        : cls.safety === "warning"
        ? `Build command needs review: ${cls.reason}`
        : `Build command looks safe.`,
      cls.safety === "blocked",
      { command: globalBuildCmd },
    ));
    return checks;
  }

  // Multi-service
  for (const svc of services.filter((s) => s.isEnabled)) {
    const label = `${svc.name} build command`;
    if (!svc.buildCommand) {
      // Static services may not need a build command
      const isStatic = svc.serviceType === "static";
      checks.push(check(
        `build.svc.${svc.id}.missing`,
        "build",
        label,
        isStatic ? "warning" : "warning",
        isStatic
          ? `${svc.name}: no build command — static service may serve pre-built files.`
          : `${svc.name}: no build command configured.`,
        false,
      ));
    } else {
      const cls = classifyCommand(svc.buildCommand);
      checks.push(check(
        `build.svc.${svc.id}.command`,
        "build",
        label,
        cls.safety === "blocked" ? "fail" : cls.safety === "warning" ? "warning" : "pass",
        cls.safety === "blocked"
          ? `${svc.name} build blocked: ${cls.reason}`
          : cls.safety === "warning"
          ? `${svc.name} build needs review: ${cls.reason}`
          : `${svc.name}: build command looks safe.`,
        cls.safety === "blocked",
        { command: svc.buildCommand },
      ));
    }

    // Static service should have output dir
    if (svc.serviceType === "static" || svc.staticOutputDir) {
      if (!svc.staticOutputDir) {
        checks.push(check(
          `build.svc.${svc.id}.output`,
          "build",
          `${svc.name} static output path`,
          "warning",
          `${svc.name} is a static service but has no staticOutputDir configured.`,
          false,
        ));
      } else {
        checks.push(check(
          `build.svc.${svc.id}.output`,
          "build",
          `${svc.name} static output path`,
          "pass",
          `Static output: ${svc.staticOutputDir}`,
          false,
        ));
      }
    }
  }

  return checks;
}

// ── Service checks ────────────────────────────────────────────────────────────

function buildServiceChecks(services: ServiceShape[]): DeploymentDryRunCheck[] {
  const checks: DeploymentDryRunCheck[] = [];

  if (services.length === 0) {
    checks.push(check(
      "services.none",
      "services",
      "Services configured",
      "warning",
      "No services configured. Add services for multi-service deployment (API + static).",
      false,
    ));
    return checks;
  }

  const enabledServices = services.filter((s) => s.isEnabled);

  for (const svc of enabledServices) {
    // API services need a start command
    if (svc.serviceType !== "static") {
      if (!svc.startCommand) {
        checks.push(check(
          `services.${svc.id}.start`,
          "services",
          `${svc.name} start command`,
          "fail",
          `${svc.name} (${svc.serviceType}) has no start command — PM2 cannot start this service.`,
          true,
        ));
      } else {
        const cls = classifyCommand(svc.startCommand);
        checks.push(check(
          `services.${svc.id}.start`,
          "services",
          `${svc.name} start command`,
          cls.safety === "blocked" ? "fail" : "pass",
          cls.safety === "blocked"
            ? `${svc.name} start command blocked: ${cls.reason}`
            : `${svc.name} start: ${svc.startCommand}`,
          cls.safety === "blocked",
          { command: svc.startCommand },
        ));
      }

      // Port
      checks.push(check(
        `services.${svc.id}.port`,
        "services",
        `${svc.name} port`,
        svc.internalPort ? "pass" : "warning",
        svc.internalPort
          ? `Port ${svc.internalPort} configured.`
          : `${svc.name} has no internalPort — nginx cannot proxy to it.`,
        false,
      ));

      // Health path
      checks.push(check(
        `services.${svc.id}.health`,
        "services",
        `${svc.name} health path`,
        svc.healthPath ? "pass" : "warning",
        svc.healthPath
          ? `Health endpoint: ${svc.healthPath}`
          : `${svc.name} has no health path — smoke checks cannot verify it.`,
        false,
      ));
    }

    // Static service: output dir
    if (svc.serviceType === "static") {
      checks.push(check(
        `services.${svc.id}.output`,
        "services",
        `${svc.name} static output`,
        svc.staticOutputDir ? "pass" : "warning",
        svc.staticOutputDir
          ? `Static files: ${svc.staticOutputDir}`
          : `${svc.name} has no staticOutputDir — nginx cannot serve static files.`,
        false,
      ));

      if (svc.spaFallback) {
        checks.push(check(
          `services.${svc.id}.spa`,
          "services",
          `${svc.name} SPA fallback`,
          "pass",
          `SPA fallback enabled — all unmatched routes will serve index.html.`,
          false,
        ));
      }
    }
  }

  return checks;
}

// ── Env checks ────────────────────────────────────────────────────────────────

async function buildEnvChecks(projectId: string): Promise<DeploymentDryRunCheck[]> {
  const checks: DeploymentDryRunCheck[] = [];
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const report = await generateEnvReadinessReport(projectId);
    if (!report) {
      checks.push(check("env.no_report", "env", "Env readiness", "warning", "Env readiness report unavailable.", false));
      return checks;
    }

    type F = { name: string; status: string; severity: string };
    const findings = (report as unknown as { findings: F[] }).findings ?? [];
    const missing  = findings.filter((f) => f.severity === "required" && (f.status === "missing" || f.status === "placeholder" || f.status === "empty"));
    const warnings = findings.filter((f) => f.severity === "recommended" && (f.status === "missing" || f.status === "placeholder"));

    if (missing.length > 0) {
      checks.push(check(
        "env.missing_required",
        "env",
        "Required env vars",
        "fail",
        `${missing.length} required env var(s) missing or placeholder.`,
        true,
        { evidence: missing.map((f) => f.name) },
      ));
    } else {
      checks.push(check(
        "env.required",
        "env",
        "Required env vars",
        "pass",
        "All required env vars are configured.",
        true,
      ));
    }

    if (warnings.length > 0) {
      checks.push(check(
        "env.recommended",
        "env",
        "Recommended env vars",
        "warning",
        `${warnings.length} recommended env var(s) missing.`,
        false,
        { evidence: warnings.map((f) => f.name) },
      ));
    }
  } catch {
    checks.push(check("env.error", "env", "Env readiness", "warning", "Could not load env readiness report.", false));
  }
  return checks;
}

// ── Database checks ───────────────────────────────────────────────────────────

async function buildDatabaseChecks(projectId: string): Promise<DeploymentDryRunCheck[]> {
  const checks: DeploymentDryRunCheck[] = [];
  try {
    const { generateReadinessReport } = await import("@/lib/database/db-readiness-detector");
    const report = await generateReadinessReport(projectId);
    if (!report) {
      checks.push(check("db.no_report", "database", "Database readiness", "warning", "Database readiness report unavailable.", false));
      return checks;
    }

    const hasDbUrl = report.envFindings.some(
      (f) => f.name === "DATABASE_URL" && f.valueConfigured,
    );

    checks.push(check(
      "db.url",
      "database",
      "DATABASE_URL configured",
      hasDbUrl ? "pass" : "fail",
      hasDbUrl
        ? "DATABASE_URL is configured in the secrets vault."
        : "DATABASE_URL is not configured — the app will fail to connect.",
      true,
      { linkHref: `/projects/${projectId}/database` },
    ));

    if (report.connectionStatus?.tested) {
      checks.push(check(
        "db.connection",
        "database",
        "Database connection tested",
        report.connectionStatus.ok ? "pass" : "warning",
        report.connectionStatus.ok
          ? `Connection verified (${report.connectionStatus.latencyMs ?? "?"}ms).`
          : `Last connection test failed: ${report.connectionStatus.error?.slice(0, 120) ?? "unknown error"}`,
        false,
      ));
    } else {
      checks.push(check(
        "db.connection",
        "database",
        "Database connection",
        "manual",
        "Connection not verified — run a connection test before deploying.",
        false,
        { linkHref: `/projects/${projectId}/database` },
      ));
    }

    // Migration commands: list but do NOT execute
    const migrationCmds = report.commands.filter(
      (c) => c.command.includes("migrate") || c.command.includes("db push"),
    );
    if (migrationCmds.length > 0) {
      checks.push(check(
        "db.migration_cmds",
        "database",
        "Database migration commands",
        "manual",
        `${migrationCmds.length} migration command(s) found — review and run manually before deploying.`,
        false,
        { evidence: migrationCmds.map((c) => c.command) },
      ));
    }

    if (report.blockers.length > 0) {
      checks.push(check(
        "db.blockers",
        "database",
        "Database blockers",
        "fail",
        report.blockers[0] ?? "Database readiness blocked.",
        true,
        { evidence: report.blockers },
      ));
    }
  } catch {
    checks.push(check("db.error", "database", "Database readiness", "warning", "Could not load database readiness report.", false));
  }
  return checks;
}

// ── Routing checks ────────────────────────────────────────────────────────────

async function buildRoutingChecks(projectId: string): Promise<DeploymentDryRunCheck[]> {
  const checks: DeploymentDryRunCheck[] = [];
  try {
    const { generateRoutingDiagnostics } = await import("@/lib/routing/routing-diagnostics-service");
    const report = await generateRoutingDiagnostics(projectId);

    checks.push(check(
      "routing.overall",
      "routing",
      "Routing diagnostics",
      report.status === "ready" ? "pass" : report.status === "warning" ? "warning" : "fail",
      report.status === "ready"
        ? `Route map ready for ${report.domain ?? "domain"}.`
        : report.status === "warning"
        ? `Routing warnings: ${report.warnings[0] ?? "see details"}`
        : `Routing blocked: ${report.blockers[0] ?? "see diagnostics"}`,
      report.status === "blocked",
      { linkHref: `/projects/${projectId}/publishing` },
    ));

    // API/static split for Sardar
    const hasSplit = report.checks.find((c) => c.id === "route.api_static_split");
    if (hasSplit) {
      checks.push(check(
        "routing.api_static_split",
        "routing",
        "/api/* and /* route split",
        hasSplit.status === "pass" ? "pass" : hasSplit.status === "warning" ? "warning" : "fail",
        hasSplit.message,
        false,
      ));
    }
  } catch {
    checks.push(check("routing.error", "routing", "Routing diagnostics", "warning", "Could not load routing diagnostics.", false));
  }
  return checks;
}

// ── Domain checks ─────────────────────────────────────────────────────────────

const PANEL_DOMAIN = "projects.doorstepmanchester.uk";

async function buildDomainChecks(projectId: string): Promise<DeploymentDryRunCheck[]> {
  const checks: DeploymentDryRunCheck[] = [];
  try {
    const domain = await db.domain.findFirst({
      where:   { projectId, isPrimary: true },
      select:  { hostname: true },
    });

    if (!domain?.hostname) {
      checks.push(check(
        "domain.no_domain",
        "domain",
        "Primary domain",
        "warning",
        "No primary domain configured.",
        false,
        { linkHref: `/projects/${projectId}/domains` },
      ));
      return checks;
    }

    // Panel domain guard
    if (domain.hostname === PANEL_DOMAIN) {
      checks.push(check(
        "domain.panel_blocked",
        "domain",
        "Panel domain conflict",
        "fail",
        `Domain ${PANEL_DOMAIN} is the Prisom panel domain and cannot be used for project deployment.`,
        true,
      ));
      return checks;
    }

    const { generateDomainReadinessReport } = await import("@/lib/domains/domain-readiness-service");
    const report = await generateDomainReadinessReport({ projectId, domain: domain.hostname, projectSlug: "" });

    checks.push(check(
      "domain.readiness",
      "domain",
      `Domain readiness (${domain.hostname})`,
      report.status === "ready" ? "pass" : report.status === "warning" ? "warning" : "fail",
      report.status === "ready"
        ? `${domain.hostname} DNS and SSL look ready.`
        : report.status === "warning"
        ? `Domain warnings: ${report.warnings[0] ?? "see domain settings"}`
        : `Domain blocked: ${report.blockers[0] ?? "see domain settings"}`,
      report.status === "blocked",
      { linkHref: `/projects/${projectId}/domains` },
    ));
  } catch {
    checks.push(check("domain.error", "domain", "Domain readiness", "warning", "Could not load domain readiness report.", false));
  }
  return checks;
}

// ── Smoke-check plan ──────────────────────────────────────────────────────────

async function buildSmokeChecks(
  projectId: string,
  services:  ServiceShape[],
): Promise<DeploymentDryRunCheck[]> {
  const checks: DeploymentDryRunCheck[] = [];

  const domain = await db.domain.findFirst({
    where:  { projectId, isPrimary: true },
    select: { hostname: true },
  }).catch(() => null);
  const host = domain?.hostname ?? null;

  checks.push(check(
    "smoke.root",
    "smoke",
    "Root URL smoke check (planned)",
    "manual",
    host
      ? `Plan: curl -I https://${host}/ → expect 200 OK`
      : "Plan: verify root URL returns 200 OK after deploy.",
    false,
    { command: host ? `curl -I https://${host}/` : undefined },
  ));

  for (const svc of services.filter((s) => s.isEnabled && s.healthPath)) {
    checks.push(check(
      `smoke.health.${svc.id}`,
      "smoke",
      `${svc.name} health check (planned)`,
      "manual",
      host
        ? `Plan: curl -I https://${host}${svc.healthPath} → expect 200 OK`
        : `Plan: verify ${svc.healthPath} returns 200 OK after deploy.`,
      false,
      { command: host ? `curl -I https://${host}${svc.healthPath}` : undefined },
    ));
  }

  // SPA fallback check
  const spaSvc = services.find((s) => s.isEnabled && s.spaFallback);
  if (spaSvc) {
    checks.push(check(
      "smoke.spa_fallback",
      "smoke",
      "SPA fallback check (planned)",
      "manual",
      host
        ? `Plan: curl -I https://${host}/any-deep-route → expect 200 OK (SPA fallback)`
        : "Plan: verify deep SPA routes return 200 OK (SPA fallback).",
      false,
      { command: host ? `curl -I https://${host}/some-spa-route` : undefined },
    ));
  }

  return checks;
}

// ── Manual checks ─────────────────────────────────────────────────────────────

function buildManualChecks(): DeploymentDryRunCheck[] {
  return [
    check(
      "manual.review_secrets",
      "manual",
      "Review all secrets before deploying",
      "manual",
      "Manually verify all required env vars are set to production values (not placeholders or dev values).",
      false,
    ),
    check(
      "manual.backup_db",
      "manual",
      "Backup database before schema changes",
      "manual",
      "If running database migrations, ensure a backup exists before applying them.",
      false,
    ),
    check(
      "manual.run_migrations",
      "manual",
      "Run database migrations manually",
      "manual",
      "Run pending migrations manually before or after deploy, as required by your migration strategy.",
      false,
    ),
    check(
      "manual.verify_live",
      "manual",
      "Verify live app after deploy",
      "manual",
      "After deploy, run smoke checks and verify all critical user flows work.",
      false,
    ),
  ];
}

// ── Main planner ──────────────────────────────────────────────────────────────

export async function generateDeploymentDryRunPlan(projectId: string): Promise<DeploymentDryRunPlan> {
  const generatedAt = new Date().toISOString();

  const [project, config, services] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        installCommand:  true,
        buildCommand:    true,
        startCommand:    true,
        rootDirectory:   true,
        outputDirectory: true,
        routeMode:       true,
      },
    }),
    db.projectService.findMany({
      where:  { projectId },
      select: {
        id: true, name: true, serviceType: true,
        buildCommand: true, startCommand: true,
        staticOutputDir: true, internalPort: true,
        healthPath: true, spaFallback: true,
        isPrimary: true, isEnabled: true,
      },
    }),
  ]);

  if (!project) {
    return {
      projectId,
      generatedAt,
      status:    "blocked",
      checks:    [check("source.not_found", "source", "Project", "fail", "Project not found.", true)],
      blockers:  ["Project not found."],
      warnings:  [],
      nextSteps: [],
    };
  }

  const rootDir     = (config as { rootDirectory?: string | null } | null)?.rootDirectory ?? null;
  const installCmd  = config?.installCommand  ?? null;
  const buildCmd    = config?.buildCommand    ?? null;

  // Detect lockfile from install command heuristic
  const lockfile =
    installCmd?.includes("pnpm") ? "pnpm-lock.yaml" :
    installCmd?.includes("yarn") ? "yarn.lock" :
    installCmd?.includes("npm")  ? "package-lock.json" : null;

  const isMonorepo = (buildCmd ?? "").includes("--filter") || (buildCmd ?? "").includes("workspace");
  const hasPackageJson = !!(installCmd || buildCmd || startCommand);

  function startCommand() { return config?.startCommand ?? null; }

  const allChecks: DeploymentDryRunCheck[] = [
    ...buildSourceChecks(rootDir, hasPackageJson, lockfile, isMonorepo),
    ...buildPackageManagerChecks(installCmd, buildCmd, lockfile),
    ...buildInstallChecks(installCmd),
    ...buildBuildChecks(buildCmd, services as ServiceShape[]),
    ...buildServiceChecks(services as ServiceShape[]),
    ...(await buildEnvChecks(projectId)),
    ...(await buildDatabaseChecks(projectId)),
    ...(await buildRoutingChecks(projectId)),
    ...(await buildDomainChecks(projectId)),
    ...(await buildSmokeChecks(projectId, services as ServiceShape[])),
    ...buildManualChecks(),
  ];

  const status    = statusFromChecks(allChecks);
  const blockers  = allChecks.filter((c) => c.status === "fail" && c.required).map((c) => c.message);
  const warnings  = allChecks.filter((c) => c.status === "warning").map((c) => c.message);

  const nextSteps: string[] = [];
  if (blockers.length > 0) {
    nextSteps.push(`Resolve ${blockers.length} blocker(s) before deploying.`);
  }
  if (warnings.length > 0) {
    nextSteps.push(`Review ${warnings.length} warning(s).`);
  }
  const manualItems = allChecks.filter((c) => c.status === "manual");
  if (manualItems.length > 0) {
    nextSteps.push(`Complete ${manualItems.length} manual step(s) before and after deploy.`);
  }
  if (status === "ready") {
    nextSteps.push("Dry run passed — proceed to Deploy from the Publishing page.");
  }

  return { projectId, generatedAt, status, checks: allChecks, blockers, warnings, nextSteps };
}
