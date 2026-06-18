/**
 * lib/projects/project-monitoring.ts
 *
 * Sprint 14: Read-only per-project monitoring snapshot.
 *
 * Responsibilities:
 *  1. Load project + deploymentConfig + domains + recent deployments + logs
 *  2. Resolve live endpoints via live-endpoint-resolver
 *  3. Check PM2 status for the configured process ONLY (never global list)
 *  4. Check frontend / health / login endpoints with timeout
 *  5. Check DB connection (reuses Sprint 12 logic, never exposes URL)
 *  6. Check required env var presence by key only (values never read)
 *  7. Check domain/SSL status from DB + optional live HEAD check
 *  8. Summarise recent failed deployments and rollbacks
 *  9. Summarise recent WARN/ERROR logs (messages truncated, no secrets)
 * 10. Compute overall severity
 *
 * Safety hard rules:
 *  - Read-only: no PM2 restart / reload / delete
 *  - No DATABASE_URL or env var values are ever returned
 *  - Only inspects the project's own configured PM2 process
 *  - All external HTTP checks have 8 s timeout
 *  - Individual check failures do not crash the whole snapshot
 */

import { db }                             from "@/lib/db";
import { DeploymentStatus, DeploymentSource } from "@prisma/client";
import { runCommand }                     from "@/lib/server/command-runner";
import { resolveProjectLiveEndpoints }    from "@/lib/projects/live-endpoint-resolver";
import { testProjectDbExplorerConnection } from "@/lib/projects/database-explorer";

// ── ActionResult ──────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonitorSeverity     = "healthy" | "warning" | "critical" | "unknown";
export type MonitorCheckStatus  = "pass" | "warn" | "fail" | "unknown";

export type ProjectMonitoringSnapshot = {
  projectId:    string;
  projectSlug:  string;
  generatedAt:  string;     // ISO string
  severity:     MonitorSeverity;
  summary:      string;

  pm2: {
    configured:    boolean;
    processName?:  string | null;
    online:        boolean;
    status?:       string | null;
    /** Process start timestamp (Unix ms). UI computes uptime as Date.now() - uptimeStartedAt. */
    uptimeStartedAt?: number | null;
    restartCount?: number | null;
    cpuPercent?:   number | null;
    memoryBytes?:  number | null;
    pid?:          number | null;
    port?:         number | null;
    message?:      string;
  };

  endpoints: Array<{
    name:        "frontend" | "health" | "login" | "internal-health" | string;
    url?:        string | null;
    method:      "GET" | "HEAD";
    status:      MonitorCheckStatus;
    httpStatus?: number | null;
    latencyMs?:  number | null;
    error?:      string | null;
  }>;

  database: {
    configured:  boolean;
    status:      MonitorCheckStatus;
    latencyMs?:  number | null;
    provider?:   string | null;
    error?:      string | null;
  };

  secrets: {
    status:             MonitorCheckStatus;
    totalCount:         number;
    requiredCount:      number;
    presentCount:       number;
    missingKeys:        string[];
    /** All env var KEY names configured for this project (no values). Used by alert evaluator. */
    configuredKeyNames: string[];
  };

  domains: Array<{
    hostname:    string;
    status?:     string | null;
    sslStatus?:  string | null;
    isPrimary?:  boolean;
    url?:        string | null;
    httpStatus?: number | null;
    latencyMs?:  number | null;
    error?:      string | null;
  }>;

  deployments: {
    activeDeploymentRef?:          string | null;
    lastDeploymentStatus?:         string | null;
    lastDeploymentAt?:             string | null;
    recentFailureCount:            number;
    lastRollbackAt?:               string | null;
    /** True only when the most recent terminal deployment is FAILED (not resolved by a later success). */
    unresolvedDeploymentFailure:   boolean;
    lastSuccessfulDeploymentAt?:   string | null;
    lastFailedDeploymentAt?:       string | null;
  };

  logs: Array<{
    id:        string;
    level:     string;
    source:    string;
    message:   string;
    createdAt: string;
  }>;

  checks: Array<{
    key:        string;
    label:      string;
    status:     MonitorCheckStatus;
    message:    string;
    latencyMs?: number | null;
  }>;
};

// ── Internal: PM2 full query ──────────────────────────────────────────────────

interface Pm2FullInfo {
  found:         boolean;
  online:        boolean;
  status:        string;
  cpuPercent:    number | null;
  memoryBytes:   number | null;
  uptimeStartedAt: number | null;
  restartCount:  number | null;
  pid:           number | null;
}

/**
 * Fetches extended PM2 data for one named process in a single jlist call.
 * Returns null if the command fails, or an object with found=false if the
 * process is not registered.
 */
async function getFullPm2Info(pm2Name: string): Promise<Pm2FullInfo | null> {
  try {
    const r = await runCommand("pm2", ["jlist"], {
      cwd:       process.cwd(),
      timeoutMs: 12_000,
    });
    if (r.exitCode !== 0) return null;

    type Entry = {
      name?:     string;
      pid?:      number;
      pm2_env?:  { status?: string; pm_uptime?: number; restart_time?: number };
      monit?:    { memory?: number; cpu?: number };
    };

    const list: Entry[] = JSON.parse(r.stdout.trim() || "[]");
    const app = list.find((a) => a.name === pm2Name);

    if (!app) {
      return {
        found:           false,
        online:          false,
        status:          "not_registered",
        cpuPercent:      null,
        memoryBytes:     null,
        uptimeStartedAt: null,
        restartCount:    null,
        pid:             null,
      };
    }

    const status = app.pm2_env?.status ?? "unknown";
    return {
      found:           true,
      online:          status === "online",
      status,
      cpuPercent:      app.monit?.cpu ?? null,
      memoryBytes:     app.monit?.memory ?? null,   // raw bytes from PM2
      uptimeStartedAt: app.pm2_env?.pm_uptime ?? null,
      restartCount:    app.pm2_env?.restart_time ?? null,
      pid:             app.pid ?? null,
    };
  } catch {
    return null;
  }
}

// ── Internal: URL check ───────────────────────────────────────────────────────

interface UrlCheckResult {
  method:     "HEAD" | "GET";
  httpStatus: number | null;
  latencyMs:  number | null;
  error:      string | null;
  passed:     boolean;
}

/**
 * Checks a URL with HEAD (falling back to GET on 405/403).
 * 8-second timeout. Follows up to the default redirects.
 * cache: "no-store" prevents Next.js from caching the result.
 */
async function checkUrl(url: string): Promise<UrlCheckResult> {
  const makeController = () => {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8_000);
    return { signal: ctrl.signal, clear: () => clearTimeout(tid) };
  };

  const sharedHeaders = {
    "User-Agent": "Prisom-Monitor/1.0",
    Accept:       "*/*",
  };

  // ── HEAD attempt ──────────────────────────────────────────────────────────
  const head = makeController();
  const headStart = Date.now();
  try {
    const res = await fetch(url, {
      method:  "HEAD",
      signal:  head.signal,
      redirect: "follow",
      headers: sharedHeaders,
      cache:   "no-store",
    } as RequestInit);
    head.clear();

    // Servers that don't support HEAD return 405/403 — fallback to GET
    if (res.status !== 405 && res.status !== 403) {
      return {
        method:     "HEAD",
        httpStatus: res.status,
        latencyMs:  Date.now() - headStart,
        error:      null,
        passed:     res.status < 500,
      };
    }
  } catch {
    head.clear();
    // Network failure on HEAD — fall through to GET
  }

  // ── GET fallback ──────────────────────────────────────────────────────────
  const get     = makeController();
  const getStart = Date.now();
  try {
    const res = await fetch(url, {
      method:  "GET",
      signal:  get.signal,
      redirect: "follow",
      headers: sharedHeaders,
      cache:   "no-store",
    } as RequestInit);
    get.clear();
    return {
      method:     "GET",
      httpStatus: res.status,
      latencyMs:  Date.now() - getStart,
      error:      null,
      passed:     res.status < 500,
    };
  } catch (e) {
    get.clear();
    return {
      method:     "GET",
      httpStatus: null,
      latencyMs:  Date.now() - getStart,
      error:      e instanceof Error ? e.message.slice(0, 200) : "Fetch failed",
      passed:     false,
    };
  }
}

// ── Internal: map check result to MonitorCheckStatus ─────────────────────────

function httpStatusToCheck(result: UrlCheckResult): MonitorCheckStatus {
  if (!result.passed && result.httpStatus === null) return "fail";
  if (result.httpStatus === null) return "unknown";
  if (result.httpStatus < 400) return "pass";
  if (result.httpStatus < 500) return "warn";   // 4xx = warn (auth redirect etc.)
  return "fail";
}

// ── Secrets check ─────────────────────────────────────────────────────────────

// Keys that are typically required; only names are compared, values never read
const DB_URL_KEYS    = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "MONGODB_URI", "REDIS_URL"];
const AUTH_KEYS      = ["SESSION_SECRET", "NEXTAUTH_SECRET", "JWT_SECRET", "AUTH_SECRET", "SECRET"];
const TYPICAL_KEYS   = [...DB_URL_KEYS, ...AUTH_KEYS];

async function checkSecrets(
  projectId:   string,
  environment: string,
): Promise<ProjectMonitoringSnapshot["secrets"]> {
  try {
    const rows = await db.projectEnvVar.findMany({
      where:  { projectId, isEnabled: true, environment },
      select: { name: true },
    });

    const presentSet  = new Set(rows.map((r) => r.name));
    const missingKeys = TYPICAL_KEYS.filter((k) => !presentSet.has(k));

    // Only flag as warn/fail if DB key AND auth key are both missing
    const hasDatabaseKey = DB_URL_KEYS.some((k) => presentSet.has(k));
    const hasAuthKey     = AUTH_KEYS.some((k) => presentSet.has(k));

    let status: MonitorCheckStatus = "pass";
    if (!hasDatabaseKey && !hasAuthKey && rows.length === 0) status = "warn";
    else if (!hasDatabaseKey) status = "warn";

    return {
      status,
      totalCount:         rows.length,
      requiredCount:      TYPICAL_KEYS.length,
      presentCount:       TYPICAL_KEYS.filter((k) => presentSet.has(k)).length,
      missingKeys,
      configuredKeyNames: rows.map((r) => r.name),
    };
  } catch {
    return {
      status:             "unknown",
      totalCount:         0,
      requiredCount:      TYPICAL_KEYS.length,
      presentCount:       0,
      missingKeys:        [],
      configuredKeyNames: [],
    };
  }
}

// ── Severity computation ───────────────────────────────────────────────────────

function computeSeverity(
  pm2:       ProjectMonitoringSnapshot["pm2"],
  endpoints: ProjectMonitoringSnapshot["endpoints"],
  database:  ProjectMonitoringSnapshot["database"],
  deployments: ProjectMonitoringSnapshot["deployments"],
  secrets:   ProjectMonitoringSnapshot["secrets"],
): { severity: MonitorSeverity; summary: string } {
  // ── Critical conditions ──────────────────────────────────────────────────
  const criticalReasons: string[] = [];

  if (pm2.configured && !pm2.online) {
    criticalReasons.push("PM2 process is offline");
  }

  const frontend = endpoints.find((e) => e.name === "frontend");
  if (frontend && frontend.status === "fail") {
    criticalReasons.push("frontend URL is unreachable");
  }

  const health = endpoints.find((e) => e.name === "health" || e.name === "internal-health");
  if (health && health.status === "fail") {
    criticalReasons.push("health endpoint is failing");
  }

  if (database.configured && database.status === "fail") {
    criticalReasons.push("database connection failed");
  }

  if (criticalReasons.length > 0) {
    return {
      severity: "critical",
      summary:  `Critical — ${criticalReasons[0]}.`,
    };
  }

  // ── Warning conditions ───────────────────────────────────────────────────
  const warnReasons: string[] = [];

  const login = endpoints.find((e) => e.name === "login");
  if (login && login.status === "fail") {
    warnReasons.push("login route is not responding");
  }

  if (secrets.missingKeys.some((k) => DB_URL_KEYS.includes(k))) {
    warnReasons.push("DATABASE_URL is not configured");
  }

  if (deployments.unresolvedDeploymentFailure) {
    warnReasons.push("latest deployment failed");
  }

  const frontendLatency = frontend?.latencyMs ?? null;
  if (frontendLatency && frontendLatency > 3_000) {
    warnReasons.push("frontend response time is slow (> 3s)");
  }

  if (pm2.restartCount && pm2.restartCount > 10) {
    warnReasons.push(`PM2 process restarted ${pm2.restartCount} times`);
  }

  // Domain with failed SSL
  // (passed separately but compute overall here)

  if (warnReasons.length > 0) {
    return {
      severity: "warning",
      summary:  `Warning — app is online but ${warnReasons.length} check${warnReasons.length > 1 ? "s" : ""} need attention.`,
    };
  }

  // ── Unknown: no PM2 config yet ───────────────────────────────────────────
  if (!pm2.configured) {
    return {
      severity: "unknown",
      summary:  "Unknown — no deployment config found.",
    };
  }

  // ── Healthy ──────────────────────────────────────────────────────────────
  return {
    severity: "healthy",
    summary:  "Healthy — all critical checks passed.",
  };
}

// ── Main snapshot function ────────────────────────────────────────────────────

export async function getProjectMonitoringSnapshot(input: {
  projectId:    string;
  environment?: "production" | "preview" | "development";
}): Promise<ActionResult<ProjectMonitoringSnapshot>> {
  const { projectId, environment = "production" } = input;

  // ── Load project + config ─────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) return { ok: false, error: "Project not found.", code: "NOT_FOUND" };

  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: {
      pm2Name: true, port: true, healthPath: true, loginPath: true,
      nodeEnv: true, startCommand: true, primaryDomain: true,
      publicPreviewUrl: true, publicPreviewStatus: true,
      dbConnStatus: true, dbConnLastCheckedAt: true,
    },
  });

  const generatedAt = new Date().toISOString();

  // ── Resolve live endpoints ────────────────────────────────────────────────
  const endpoints = config ? await resolveProjectLiveEndpoints(projectId).catch(() => null) : null;

  // ── Run all checks concurrently ───────────────────────────────────────────
  const [
    pm2InfoResult,
    frontendResult,
    healthResult,
    internalHealthResult,
    loginResult,
    dbResult,
    secretsResult,
    deploymentsResult,
    logsResult,
    domainsResult,
  ] = await Promise.allSettled([

    // PM2 check
    config?.pm2Name
      ? getFullPm2Info(config.pm2Name)
      : Promise.resolve(null),

    // Frontend URL check
    endpoints?.primaryUrl
      ? checkUrl(endpoints.primaryUrl)
      : Promise.resolve(null),

    // Public health endpoint check
    endpoints?.healthUrl
      ? checkUrl(endpoints.healthUrl)
      : Promise.resolve(null),

    // Internal health endpoint check (always available if config exists)
    config
      ? checkUrl(`http://127.0.0.1:${config.port}${config.healthPath ?? "/"}`)
      : Promise.resolve(null),

    // Login route check (optional)
    endpoints?.loginUrl
      ? checkUrl(endpoints.loginUrl)
      : Promise.resolve(null),

    // Database check
    testProjectDbExplorerConnection(projectId, environment),

    // Secrets check (keys only, no values)
    checkSecrets(projectId, environment),

    // Recent deployments
    db.deployment.findMany({
      where:   { projectId },
      orderBy: { createdAt: "desc" },
      take:    20,
      select:  {
        id: true, status: true, source: true, createdAt: true,
        finishedAt: true, errorMessage: true, isActive: true, metadata: true,
      },
    }),

    // Recent WARN/ERROR logs
    db.projectLog.findMany({
      where: {
        projectId,
        level: { in: ["WARN", "ERROR", "FATAL"] },
      },
      orderBy: { timestamp: "desc" },
      take:    10,
      select:  { id: true, level: true, source: true, message: true, timestamp: true },
    }),

    // Domains
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, status: true, sslStatus: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  // ── Unwrap results ────────────────────────────────────────────────────────

  const pm2Raw  = pm2InfoResult.status  === "fulfilled" ? pm2InfoResult.value  : null;
  const frontend = frontendResult.status === "fulfilled" ? frontendResult.value : null;
  const health   = healthResult.status   === "fulfilled" ? healthResult.value   : null;
  const intHealth = internalHealthResult.status === "fulfilled" ? internalHealthResult.value : null;
  const login    = loginResult.status    === "fulfilled" ? loginResult.value    : null;
  const dbCheck  = dbResult.status       === "fulfilled" && dbResult.value.ok ? dbResult.value.data : null;
  const secretsData = secretsResult.status === "fulfilled" ? secretsResult.value : null;
  const deployRows  = deploymentsResult.status === "fulfilled" ? deploymentsResult.value : [];
  const logRows     = logsResult.status === "fulfilled" ? logsResult.value : [];
  const domainRows  = domainsResult.status === "fulfilled" ? domainsResult.value : [];

  // ── Build pm2 section ─────────────────────────────────────────────────────

  const pm2Section: ProjectMonitoringSnapshot["pm2"] = (() => {
    if (!config?.pm2Name) {
      return { configured: false, online: false, message: "No PM2 process configured." };
    }
    if (!pm2Raw) {
      return {
        configured:  true,
        processName: config.pm2Name,
        online:      false,
        port:        config.port,
        message:     "PM2 status unavailable — daemon may not be running.",
      };
    }
    return {
      configured:      true,
      processName:     config.pm2Name,
      online:          pm2Raw.online,
      status:          pm2Raw.status,
      uptimeStartedAt: pm2Raw.uptimeStartedAt,
      restartCount:    pm2Raw.restartCount,
      cpuPercent:      pm2Raw.cpuPercent,
      memoryBytes:     pm2Raw.memoryBytes,
      pid:             pm2Raw.pid,
      port:            config.port,
      message:         pm2Raw.found ? undefined : "Process not registered in PM2.",
    };
  })();

  // ── Build endpoints section ───────────────────────────────────────────────

  const endpointChecks: ProjectMonitoringSnapshot["endpoints"] = [];

  if (endpoints?.primaryUrl && frontend) {
    endpointChecks.push({
      name:       "frontend",
      url:        endpoints.primaryUrl,
      method:     frontend.method,
      status:     httpStatusToCheck(frontend),
      httpStatus: frontend.httpStatus,
      latencyMs:  frontend.latencyMs,
      error:      frontend.error,
    });
  } else if (!endpoints?.primaryUrl && config) {
    endpointChecks.push({
      name:   "frontend",
      url:    null,
      method: "GET",
      status: "unknown",
      error:  "No public URL configured.",
    });
  }

  // Prefer public health check, fall back to internal
  if (endpoints?.healthUrl && health) {
    endpointChecks.push({
      name:       "health",
      url:        endpoints.healthUrl,
      method:     health.method,
      status:     httpStatusToCheck(health),
      httpStatus: health.httpStatus,
      latencyMs:  health.latencyMs,
      error:      health.error,
    });
  } else if (config && intHealth) {
    endpointChecks.push({
      name:       "internal-health",
      url:        `http://127.0.0.1:${config.port}${config.healthPath ?? "/"}`,
      method:     intHealth.method,
      status:     httpStatusToCheck(intHealth),
      httpStatus: intHealth.httpStatus,
      latencyMs:  intHealth.latencyMs,
      error:      intHealth.error,
    });
  }

  if (endpoints?.loginUrl && login) {
    // 200/30x = pass, 401/403 = warn (expected for auth), 500 = fail
    const loginStatus: MonitorCheckStatus =
      login.httpStatus === null    ? "fail"    :
      login.httpStatus < 400       ? "pass"    :
      login.httpStatus === 401 ||
      login.httpStatus === 403 ||
      login.httpStatus === 302     ? "warn"    :
      login.httpStatus >= 500      ? "fail"    : "warn";

    endpointChecks.push({
      name:       "login",
      url:        endpoints.loginUrl,
      method:     login.method,
      status:     loginStatus,
      httpStatus: login.httpStatus,
      latencyMs:  login.latencyMs,
      error:      login.error,
    });
  }

  // ── Build database section ────────────────────────────────────────────────

  const dbSection: ProjectMonitoringSnapshot["database"] = (() => {
    if (dbResult.status === "fulfilled" && dbResult.value.ok === false) {
      const code = (dbResult.value as { code?: string }).code;
      if (code === "NO_DATABASE_URL") {
        return { configured: false, status: "unknown", error: "No DATABASE_URL configured." };
      }
      return { configured: true, status: "fail", error: dbResult.value.error.slice(0, 200) };
    }
    if (!dbCheck) {
      return { configured: false, status: "unknown", error: "Database check unavailable." };
    }
    return {
      configured: true,
      status:     dbCheck.connected ? "pass" : "fail",
      latencyMs:  dbCheck.latencyMs ?? null,
      provider:   dbCheck.provider ?? null,
      error:      dbCheck.error ?? null,
    };
  })();

  // ── Build secrets section ─────────────────────────────────────────────────

  const secretsSection: ProjectMonitoringSnapshot["secrets"] = secretsData ?? {
    status:             "unknown",
    totalCount:         0,
    requiredCount:      TYPICAL_KEYS.length,
    presentCount:       0,
    missingKeys:        [],
    configuredKeyNames: [],
  };

  // ── Build domains section ─────────────────────────────────────────────────

  const domainChecks: ProjectMonitoringSnapshot["domains"] = domainRows.map((d) => {
    const scheme = d.sslStatus === "ACTIVE" ? "https" : "http";
    const url    = d.status === "ACTIVE" ? `${scheme}://${d.hostname}` : null;
    return {
      hostname:  d.hostname,
      status:    d.status  as string,
      sslStatus: d.sslStatus as string,
      isPrimary: d.isPrimary,
      url,
    };
  });

  // ── Build deployments section ─────────────────────────────────────────────

  const activeRow    = deployRows.find((d) => d.isActive);
  const latestRow    = deployRows[0] ?? null;
  const failCount    = deployRows.filter((d) => d.status === DeploymentStatus.FAILED).length;
  const lastRollback = deployRows.find((d) => d.source === DeploymentSource.ROLLBACK);

  // Determine whether the most recent TERMINAL deployment is a failure.
  // Terminal = SUCCESS | FAILED | CANCELLED (excludes BUILDING/PENDING/QUEUED).
  const TERMINAL: DeploymentStatus[] = [DeploymentStatus.SUCCESS, DeploymentStatus.FAILED, DeploymentStatus.CANCELLED];
  const latestTerminal  = deployRows.find((d) => TERMINAL.includes(d.status));
  const latestSuccess   = deployRows.find((d) => d.status === DeploymentStatus.SUCCESS);
  const latestFailed    = deployRows.find((d) => d.status === DeploymentStatus.FAILED);
  const unresolvedDeploymentFailure = latestTerminal?.status === DeploymentStatus.FAILED;

  type MetaMaybe = { deploymentRef?: string | null } | null | undefined;
  function safeRef(meta: unknown): string | null {
    const m = meta as MetaMaybe;
    return m?.deploymentRef ?? null;
  }

  const deploymentsSection: ProjectMonitoringSnapshot["deployments"] = {
    activeDeploymentRef:         activeRow ? safeRef(activeRow.metadata) : null,
    lastDeploymentStatus:        latestRow?.status ?? null,
    lastDeploymentAt:            latestRow?.createdAt.toISOString() ?? null,
    recentFailureCount:          failCount,
    lastRollbackAt:              lastRollback?.createdAt.toISOString() ?? null,
    unresolvedDeploymentFailure,
    lastSuccessfulDeploymentAt:  latestSuccess?.createdAt.toISOString() ?? null,
    lastFailedDeploymentAt:      latestFailed?.createdAt.toISOString()  ?? null,
  };

  // ── Build logs section ────────────────────────────────────────────────────

  const logSection: ProjectMonitoringSnapshot["logs"] = logRows.map((l) => ({
    id:        l.id,
    level:     l.level,
    source:    l.source,
    message:   l.message.slice(0, 500),  // truncate — no secrets
    createdAt: l.timestamp.toISOString(),
  }));

  // ── Build unified checks table ─────────────────────────────────────────────

  const checksTable: ProjectMonitoringSnapshot["checks"] = [];

  // PM2
  if (pm2Section.configured) {
    checksTable.push({
      key:     "pm2",
      label:   `PM2 — ${pm2Section.processName}`,
      status:  pm2Section.online ? "pass" : (pm2Section.message ? "fail" : "warn"),
      message: pm2Section.online
        ? `Online (status: ${pm2Section.status})`
        : (pm2Section.message ?? `Offline (status: ${pm2Section.status ?? "unknown"})`),
    });
  }

  // Endpoints
  for (const ep of endpointChecks) {
    const label =
      ep.name === "frontend" ? "Frontend URL" :
      ep.name === "health"   ? "Health endpoint" :
      ep.name === "internal-health" ? "Health (internal)" :
      ep.name === "login"    ? "Login route"     : ep.name;

    checksTable.push({
      key:       `endpoint-${ep.name}`,
      label,
      status:    ep.status,
      message:   ep.error
        ? ep.error.slice(0, 150)
        : ep.httpStatus
        ? `HTTP ${ep.httpStatus}`
        : "No URL configured",
      latencyMs: ep.latencyMs,
    });
  }

  // Database
  if (dbSection.configured || dbSection.status !== "unknown") {
    checksTable.push({
      key:       "database",
      label:     "Database connection",
      status:    dbSection.status,
      message:   dbSection.error
        ? dbSection.error.slice(0, 150)
        : dbSection.status === "pass" ? "Connected" : "Not configured",
      latencyMs: dbSection.latencyMs,
    });
  }

  // Secrets
  if (secretsSection.totalCount > 0 || secretsSection.status !== "unknown") {
    checksTable.push({
      key:     "secrets",
      label:   "Environment variables",
      status:  secretsSection.status,
      message: `${secretsSection.totalCount} var${secretsSection.totalCount !== 1 ? "s" : ""} configured`,
    });
  }

  // Domain SSL
  const failedSslDomains = domainChecks.filter(
    (d) => d.status === "ACTIVE" && d.sslStatus !== "ACTIVE"
  );
  if (domainChecks.length > 0) {
    checksTable.push({
      key:     "domains",
      label:   "Domain/SSL",
      status:  failedSslDomains.length > 0 ? "warn" : "pass",
      message: failedSslDomains.length > 0
        ? `${failedSslDomains.length} domain(s) without active SSL`
        : `${domainChecks.length} domain(s) configured`,
    });
  }

  // Deployment health
  if (deployRows.length > 0) {
    checksTable.push({
      key:     "deployments",
      label:   "Deployment health",
      status:  unresolvedDeploymentFailure ? "fail" : failCount > 0 ? "warn" : "pass",
      message: unresolvedDeploymentFailure
        ? `Latest deployment failed. ${failCount} failure${failCount !== 1 ? "s" : ""} in recent history.`
        : failCount > 0
        ? `Latest deployment is successful. ${failCount} historical failure${failCount !== 1 ? "s" : ""} — no action required.`
        : "No recent deployment failures.",
    });
  }

  // ── Compute severity ──────────────────────────────────────────────────────

  const { severity, summary } = computeSeverity(
    pm2Section,
    endpointChecks,
    dbSection,
    deploymentsSection,
    secretsSection,
  );

  return {
    ok: true,
    data: {
      projectId,
      projectSlug: project.slug,
      generatedAt,
      severity,
      summary,
      pm2:         pm2Section,
      endpoints:   endpointChecks,
      database:    dbSection,
      secrets:     secretsSection,
      domains:     domainChecks,
      deployments: deploymentsSection,
      logs:        logSection,
      checks:      checksTable,
    },
  };
}
