/**
 * lib/projects/multi-service-runner.ts
 *
 * Sprint 23: Multi-service deployment runner.
 *
 * Handles deployment of projects with one or more ProjectService records.
 * Single-service projects (no ProjectService rows) continue using the
 * existing project-deploy-runner.ts path — this file does NOT touch them.
 *
 * Safety rules:
 *  - All paths are resolved and validated against the project release directory.
 *  - All commands are validated through validateServiceCommand before execution.
 *  - PM2 processes are named: project-<projectSlug>-<serviceSlug>
 *  - Env vars are injected by name only; values are never logged.
 *  - Static output paths are validated to be under the release root.
 *  - Never auto-deploys. Caller must always be a user-triggered action.
 *  - CRITICAL: never modifies Doorsteps/LocalShop processes.
 */

import path from "path";
import { promises as fs } from "fs";
import http from "http";
import crypto from "crypto";
import { runCommand, sanitizeOutput } from "@/lib/server/command-runner";
import { FULL_PATH_PNPM } from "@/lib/projects/deploy-constants";
import {
  copySourceToRelease,
  getPm2AppStatus,
  RELEASE_STORAGE,
} from "@/lib/projects/project-deploy-runner";
import { validateServiceCommand } from "@/lib/projects/service-command-validator";
import {
  generateNginxConfig,
  publishDomain,
  type RouteMode,
} from "@/lib/projects/nginx-manager";
import { publishStaticSite } from "@/lib/projects/static-publisher";

// ── Constants ──────────────────────────────────────────────────────────────────

const PORT_START    = 4100;
const PORT_MAX      = 4999;
const RESERVED_PORTS = new Set([3000, 3001, 3002, 3003]);
const MAX_LOG_BYTES = 60_000;

const TURBOPACK_STRIP_ENV: Record<string, string> = {
  TURBOPACK:                       "",
  NEXT_PRIVATE_TURBOPACK:          "",
  NEXT_PRIVATE_LOCAL_WEBPACK:      "",
  __NEXT_PRIVATE_PREBUNDLED_REACT: "",
  NEXT_TELEMETRY_DEBUG:            "",
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ServiceDeployInput {
  /** From DB: ProjectService record */
  id:             string;
  slug:           string;
  name:           string;
  serviceType:    string;
  workingDir:     string;
  installCommand: string | null;
  buildCommand:   string | null;
  startCommand:   string | null;
  internalPort:   number | null;
  healthPath:     string | null;
  staticOutputDir: string | null;
  spaFallback:    boolean;
  isEnabled:      boolean;
}

export interface MultiServiceDeployInput {
  projectId:    string;
  projectSlug:  string;
  projectName:  string;
  services:     ServiceDeployInput[];
  envVars:      Record<string, string>;   // decrypted — NEVER LOG
  nodeEnv:      string;
  /** Primary domain hostname (may be null if not yet configured) */
  primaryDomain?: string | null;
  /** API prefix for static+api routing (default "/api") */
  apiPrefix?:   string;
}

export interface ServiceDeployResult {
  serviceId:    string;
  serviceSlug:  string;
  ok:           boolean;
  output:       string;
  error?:       string;
  pm2Name?:     string;
  staticPath?:  string;
  port?:        number;
  durationMs:   number;
}

export interface MultiServiceDeployResult {
  ok:            boolean;
  releasePath:   string;
  deploymentRef: string;
  services:      ServiceDeployResult[];
  nginxUpdated:  boolean;
  nginxError?:   string;
  totalDurationMs: number;
  output:        string;
}

// ── PM2 name builder ──────────────────────────────────────────────────────────

export function buildServicePm2Name(projectSlug: string, serviceSlug: string): string {
  return `project-${projectSlug}-${serviceSlug}`;
}

// ── Port assignment ────────────────────────────────────────────────────────────

/**
 * Assigns an available port for a service, checking both ProjectDeploymentConfig
 * and ProjectService tables to avoid collisions.
 */
export async function assignServicePort(
  excludePorts: number[] = [],
): Promise<number> {
  const { db } = await import("@/lib/db");
  const [configPorts, servicePorts] = await Promise.all([
    db.projectDeploymentConfig.findMany({ select: { port: true } }),
    db.projectService.findMany({ where: { internalPort: { not: null } }, select: { internalPort: true } }),
  ]);
  const used = new Set([
    ...RESERVED_PORTS,
    ...configPorts.map((r) => r.port),
    ...servicePorts.map((r) => r.internalPort!),
    ...excludePorts,
  ]);
  for (let p = PORT_START; p <= PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("All ports in range 4100–4999 are in use.");
}

// ── Deployment reference ───────────────────────────────────────────────────────

function generateDeploymentRef(): string {
  const now  = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  return `ms_${date}_${time}_${rand}`;
}

// ── Path resolution ────────────────────────────────────────────────────────────

/**
 * Resolves a service's working directory within the release.
 * Guards against path traversal.
 */
function resolveServiceWorkingDir(releasePath: string, workingDir: string): string {
  const base   = path.resolve(releasePath);
  const target = workingDir && workingDir !== "."
    ? path.resolve(base, workingDir)
    : base;

  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`workingDir "${workingDir}" escapes the release directory.`);
  }
  return target;
}

/**
 * Resolves the static output directory within the release.
 * Must be under releasePath.
 */
function resolveStaticOutputPath(releasePath: string, staticOutputDir: string): string {
  const base   = path.resolve(releasePath);
  const target = path.resolve(base, staticOutputDir);
  if (!target.startsWith(base + path.sep) && target !== base) {
    throw new Error(`staticOutputDir "${staticOutputDir}" escapes the release directory.`);
  }
  return target;
}

// ── Install deduplication ──────────────────────────────────────────────────────

/**
 * Deduplicates install commands: if multiple services share the same
 * workingDir + installCommand, only the first triggers an install.
 * Returns the set of (workingDir, installCommand) pairs already run.
 */
function makeInstallKey(workingDir: string, cmd: string): string {
  return `${workingDir.trim()}::${cmd.trim()}`;
}

// ── Command executor ───────────────────────────────────────────────────────────

async function runServiceBuildStep(
  label: string,
  rawCommand: string,
  cwd: string,
  envVars: Record<string, string>,
  log: string[],
): Promise<{ ok: boolean }> {
  const parsed = validateServiceCommand(rawCommand);
  if (!parsed.ok) {
    log.push(`✗ ${label}: command validation failed: ${parsed.error}`);
    return { ok: false };
  }

  log.push(`▶ [${label}] ${parsed.display}`);

  const r = await runCommand(parsed.cmd.binary, parsed.cmd.args, {
    cwd,
    timeoutMs: 300_000, // 5 min per step
    env: {
      ...envVars,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      ...TURBOPACK_STRIP_ENV,
    },
  });

  if (r.stdout.trim()) log.push(sanitizeOutput(r.stdout).slice(0, 5_000));
  if (r.stderr.trim()) log.push(sanitizeOutput(r.stderr).slice(0, 2_000));

  if (r.exitCode !== 0) {
    log.push(`✗ [${label}] exited with code ${r.exitCode}`);
    return { ok: false };
  }
  log.push(`✓ [${label}] done`);
  return { ok: true };
}

// ── PM2 start for a node service ───────────────────────────────────────────────

async function startNodeServicePm2(
  pm2Name:   string,
  rawStart:  string,
  cwd:       string,
  port:      number,
  nodeEnv:   string,
  envVars:   Record<string, string>,
  log:       string[],
): Promise<{ ok: boolean }> {
  const parsed = validateServiceCommand(rawStart);
  if (!parsed.ok) {
    log.push(`✗ PM2 start: command validation failed: ${parsed.error}`);
    return { ok: false };
  }

  const fullEnv: Record<string, string> = {
    ...envVars,
    PORT:                    String(port),
    NODE_ENV:                nodeEnv,
    NEXT_TELEMETRY_DISABLED: "1",
    ...TURBOPACK_STRIP_ENV,
  };

  // Log injected env var names only — never values
  log.push(`▶ Injecting env vars: ${Object.keys(fullEnv).join(", ")}`);

  // Build ecosystem app entry
  const ecoApp = parsed.cmd.binary === "node"
    ? {
        name:        pm2Name,
        script:      path.resolve(cwd, parsed.cmd.args.find((a) => !a.startsWith("-"))!),
        node_args:   parsed.cmd.args.filter((a) => a.startsWith("-")).join(" ") || undefined,
        cwd,
        interpreter: "node",
        env:         fullEnv,
      }
    : {
        name:        pm2Name,
        script:      parsed.cmd.binary,
        args:        parsed.cmd.args.join(" "),
        cwd,
        interpreter: "none",
        env:         fullEnv,
      };

  const ecoPath    = path.join(cwd, `ecosystem.${pm2Name}.config.cjs`);
  const ecoContent =
    `// Auto-generated by Prisom Project Panel — do not edit.\n` +
    `// Contains project secrets — readable by owner only (chmod 600).\n` +
    `module.exports = { apps: [${JSON.stringify(ecoApp, null, 2)}] };\n`;

  try {
    await fs.writeFile(ecoPath, ecoContent, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(ecoPath, 0o600);
  } catch (e) {
    log.push(`✗ Failed to write PM2 ecosystem file: ${(e as Error).message}`);
    return { ok: false };
  }

  // Delete existing process if present
  const checkR = await runCommand("pm2", ["id", pm2Name], { cwd, timeoutMs: 10_000 });
  const exists = checkR.exitCode === 0 && checkR.stdout.trim() !== "" && checkR.stdout.trim() !== "[]";
  if (exists) {
    log.push(`▶ pm2 delete ${pm2Name}`);
    await runCommand("pm2", ["delete", pm2Name], { cwd, timeoutMs: 15_000 });
  }

  log.push(`▶ pm2 start ${path.basename(ecoPath)} --only ${pm2Name}`);
  const startR = await runCommand(
    "pm2",
    ["start", ecoPath, "--only", pm2Name, "--update-env"],
    { cwd, timeoutMs: 30_000 },
  );
  if (startR.stdout.trim()) log.push(sanitizeOutput(startR.stdout).slice(0, 3_000));
  if (startR.stderr.trim()) log.push(sanitizeOutput(startR.stderr).slice(0, 1_000));

  if (startR.exitCode !== 0) {
    log.push(`✗ PM2 start failed (exit ${startR.exitCode})`);
    return { ok: false };
  }

  // Save PM2 process list
  await runCommand("pm2", ["save"], { cwd, timeoutMs: 10_000 });
  log.push(`✓ PM2 process "${pm2Name}" started and saved`);
  return { ok: true };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function httpHealthCheck(
  port:      number,
  healthPath: string,
  timeoutMs  = 8_000,
): Promise<{ ok: boolean; status?: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
    const req = http.get(
      { hostname: "127.0.0.1", port, path: healthPath, timeout: timeoutMs },
      (res) => {
        clearTimeout(timer);
        resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode });
        res.resume();
      },
    );
    req.on("error", () => { clearTimeout(timer); resolve({ ok: false }); });
  });
}

// ── nginx multi-service config ────────────────────────────────────────────────

interface ServiceNginxSpec {
  serviceType:    string;
  slug:           string;
  port?:          number | null;
  staticPath?:    string | null;
  spaFallback?:   boolean;
  apiPrefix?:     string;
}

/**
 * Generates an nginx config block routing traffic to multiple services.
 *
 * Priority:
 *   1. If there is a "static" service + a "node" service → static_plus_api mode
 *      location /api/ → proxy to node service port
 *      location / → static root with SPA fallback
 *   2. If only a "node" service → fullstack_node (proxy all to node port)
 *   3. If only a "static" service → static_only
 */
export function generateMultiServiceNginxConfig(
  hostname:  string,
  services:  ServiceNginxSpec[],
  apiPrefix  = "/api",
): string {
  const nodeService   = services.find((s) => s.serviceType === "node" && s.port);
  const staticService = services.find((s) => s.serviceType === "static" && s.staticPath);

  if (staticService && nodeService) {
    return generateNginxConfig({
      hostname,
      port:        nodeService.port!,
      routeMode:   "static_plus_api",
      staticRoot:  staticService.staticPath!,
      apiPrefix,
    });
  }
  if (nodeService) {
    return generateNginxConfig({ hostname, port: nodeService.port!, routeMode: "fullstack_node" });
  }
  if (staticService) {
    return generateNginxConfig({
      hostname,
      port:       0,
      routeMode:  "static_only",
      staticRoot: staticService.staticPath!,
    });
  }
  return `# No deployable services configured for ${hostname}\n`;
}

// ── Main multi-service deploy ──────────────────────────────────────────────────

export async function deployMultiServiceProject(
  input: MultiServiceDeployInput,
): Promise<MultiServiceDeployResult> {
  const t0 = Date.now();
  const log: string[] = [];
  const { projectSlug, envVars, nodeEnv } = input;
  const deploymentRef = generateDeploymentRef();
  const releasePath   = path.join(RELEASE_STORAGE, projectSlug, deploymentRef);

  log.push(`═══ Multi-service deploy: ${input.projectName} [${deploymentRef}] ═══`);

  // ── 1. Create release snapshot ─────────────────────────────────────────────
  log.push("▶ Copying source to release snapshot…");
  try {
    await copySourceToRelease(projectSlug, releasePath);
    log.push(`✓ Release snapshot at: ${releasePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`✗ Failed to create release: ${msg}`);
    return {
      ok: false, releasePath, deploymentRef,
      services: [], nginxUpdated: false,
      totalDurationMs: Date.now() - t0,
      output: log.join("\n").slice(0, MAX_LOG_BYTES),
    };
  }

  const enabledServices = input.services.filter((s) => s.isEnabled);
  if (enabledServices.length === 0) {
    log.push("✗ No enabled services to deploy.");
    return {
      ok: false, releasePath, deploymentRef,
      services: [], nginxUpdated: false,
      totalDurationMs: Date.now() - t0,
      output: log.join("\n").slice(0, MAX_LOG_BYTES),
    };
  }

  // ── 2. Run installs (deduplicated by workingDir + installCommand) ──────────
  const ranInstalls = new Set<string>();
  for (const svc of enabledServices) {
    if (!svc.installCommand) continue;
    const key = makeInstallKey(svc.workingDir, svc.installCommand);
    if (ranInstalls.has(key)) {
      log.push(`⊘ Skipping duplicate install for "${svc.slug}" (already ran for same dir + command)`);
      continue;
    }
    ranInstalls.add(key);
    let workCwd: string;
    try {
      workCwd = resolveServiceWorkingDir(releasePath, svc.workingDir);
    } catch (e) {
      log.push(`✗ [${svc.slug}] Invalid workingDir: ${(e as Error).message}`);
      continue;
    }
    const step = await runServiceBuildStep(
      `${svc.slug}:install`, svc.installCommand, workCwd, envVars, log,
    );
    if (!step.ok) {
      log.push(`⚠ Install failed for "${svc.slug}" — continuing with other services`);
    }
  }

  // ── 3. Deploy each service ─────────────────────────────────────────────────
  const serviceResults: ServiceDeployResult[] = [];
  const nginxSpecs: ServiceNginxSpec[] = [];

  for (const svc of enabledServices) {
    const st = Date.now();
    const svcLog: string[] = [];
    svcLog.push(`\n─── Service: ${svc.name} [${svc.slug}] type=${svc.serviceType} ───`);

    let workCwd: string;
    try {
      workCwd = resolveServiceWorkingDir(releasePath, svc.workingDir);
    } catch (e) {
      const err = `Invalid workingDir: ${(e as Error).message}`;
      svcLog.push(`✗ ${err}`);
      serviceResults.push({
        serviceId: svc.id, serviceSlug: svc.slug, ok: false,
        output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
      });
      log.push(...svcLog);
      continue;
    }

    // ── Build step ──────────────────────────────────────────────────────────
    if (svc.buildCommand) {
      const step = await runServiceBuildStep(
        `${svc.slug}:build`, svc.buildCommand, workCwd, envVars, svcLog,
      );
      if (!step.ok) {
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: "Build failed", durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }
    }

    // ── Node service ────────────────────────────────────────────────────────
    if (svc.serviceType === "node") {
      if (!svc.startCommand) {
        const err = "Node service requires a startCommand.";
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }
      const port = svc.internalPort;
      if (!port || port < PORT_START || port > PORT_MAX) {
        const err = `Node service port ${port} is invalid or unassigned.`;
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      const pm2Name = buildServicePm2Name(input.projectSlug, svc.slug);
      const startOk = await startNodeServicePm2(
        pm2Name, svc.startCommand, workCwd, port, nodeEnv, envVars, svcLog,
      );

      if (!startOk.ok) {
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false, pm2Name, port,
          output: svcLog.join("\n"), error: "PM2 start failed", durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      // Health check
      if (svc.healthPath) {
        svcLog.push(`▶ Health check: http://127.0.0.1:${port}${svc.healthPath}`);
        // Give process 3 seconds to bind
        await new Promise((r) => setTimeout(r, 3_000));
        const health = await httpHealthCheck(port, svc.healthPath, 8_000);
        if (health.ok) {
          svcLog.push(`✓ Health check passed (HTTP ${health.status})`);
        } else {
          svcLog.push(`⚠ Health check failed (HTTP ${health.status ?? "timeout"}) — process may still be starting`);
        }
      }

      nginxSpecs.push({ serviceType: "node", slug: svc.slug, port });
      serviceResults.push({
        serviceId: svc.id, serviceSlug: svc.slug, ok: true, pm2Name, port,
        output: svcLog.join("\n"), durationMs: Date.now() - st,
      });
      log.push(...svcLog);
    }

    // ── Static service ──────────────────────────────────────────────────────
    else if (svc.serviceType === "static") {
      if (!svc.staticOutputDir) {
        const err = "Static service requires staticOutputDir.";
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      let staticAbsPath: string;
      try {
        staticAbsPath = resolveStaticOutputPath(releasePath, svc.staticOutputDir);
      } catch (e) {
        const err = `Invalid staticOutputDir: ${(e as Error).message}`;
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      // Verify build output exists before publishing
      try {
        const stat = await fs.stat(staticAbsPath);
        if (!stat.isDirectory()) throw new Error("Not a directory");
        svcLog.push(`✓ Static output directory found: ${staticAbsPath}`);
      } catch {
        const err = `Static output directory not found after build: ${svc.staticOutputDir}`;
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      // Publish static files to /var/www using the existing publisher
      // publishStaticSite(releasePath, slug, deploymentRef, staticOutputDir)
      const publishResult = await publishStaticSite(
        releasePath,
        projectSlug,
        deploymentRef,
        svc.staticOutputDir,
      );
      if (!publishResult.ok) {
        const err = publishResult.error ?? "Static publish failed";
        svcLog.push(`✗ ${err}`);
        serviceResults.push({
          serviceId: svc.id, serviceSlug: svc.slug, ok: false,
          output: svcLog.join("\n"), error: err, durationMs: Date.now() - st,
        });
        log.push(...svcLog);
        continue;
      }

      const publishedPath = publishResult.publishPath;
      svcLog.push(`✓ Static files published to: ${publishedPath}`);
      nginxSpecs.push({ serviceType: "static", slug: svc.slug, staticPath: publishedPath, spaFallback: svc.spaFallback });
      serviceResults.push({
        serviceId: svc.id, serviceSlug: svc.slug, ok: true,
        output: svcLog.join("\n"), staticPath: publishedPath, durationMs: Date.now() - st,
      });
      log.push(...svcLog);
    }

    else {
      const err = `Unknown serviceType "${svc.serviceType}". Only "node" and "static" are supported.`;
      log.push(`✗ [${svc.slug}] ${err}`);
      serviceResults.push({
        serviceId: svc.id, serviceSlug: svc.slug, ok: false,
        output: err, error: err, durationMs: Date.now() - st,
      });
    }
  }

  // ── 4. Update nginx routing for primary domain ─────────────────────────────
  let nginxUpdated  = false;
  let nginxError: string | undefined;

  if (input.primaryDomain && nginxSpecs.length > 0) {
    log.push(`\n▶ Updating nginx routing for: ${input.primaryDomain}`);
    try {
      const nginxResult = await publishDomain(
        input.primaryDomain,
        // For static_plus_api, port comes from the node service — publishDomain picks mode via opts
        nginxSpecs.find((s) => s.serviceType === "node")?.port ?? 0,
        {
          routeMode:   nginxSpecs.some((s) => s.serviceType === "static") ? "static_plus_api" : "fullstack_node",
          staticRoot:  nginxSpecs.find((s) => s.serviceType === "static")?.staticPath ?? undefined,
          apiPrefix:   input.apiPrefix ?? "/api",
        },
      );
      if (nginxResult.ok) {
        nginxUpdated = true;
        log.push(`✓ nginx config updated: ${nginxResult.configPath}`);
      } else {
        nginxError = nginxResult.error;
        log.push(`⚠ nginx update failed: ${nginxError}`);
      }
    } catch (e) {
      nginxError = (e as Error).message;
      log.push(`⚠ nginx update error: ${nginxError}`);
    }
  } else {
    log.push("⊘ No primary domain configured — skipping nginx update");
  }

  const allOk = serviceResults.every((s) => s.ok);
  log.push(`\n═══ Deploy ${allOk ? "succeeded" : "completed with failures"} in ${Date.now() - t0}ms ═══`);

  return {
    ok:              allOk,
    releasePath,
    deploymentRef,
    services:        serviceResults,
    nginxUpdated,
    nginxError,
    totalDurationMs: Date.now() - t0,
    output:          log.join("\n").slice(0, MAX_LOG_BYTES),
  };
}

// ── PM2 service status ─────────────────────────────────────────────────────────

export async function getServicePm2Status(projectSlug: string, serviceSlug: string) {
  const pm2Name = buildServicePm2Name(projectSlug, serviceSlug);
  return getPm2AppStatus(pm2Name);
}

// ── Service health check (on-demand) ─────────────────────────────────────────

export async function checkServiceHealth(
  port:       number,
  healthPath: string,
): Promise<{ ok: boolean; status?: number; latencyMs: number }> {
  const t0 = Date.now();
  const result = await httpHealthCheck(port, healthPath, 8_000);
  return { ...result, latencyMs: Date.now() - t0 };
}
