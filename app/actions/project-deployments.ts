"use server";

/**
 * app/actions/project-deployments.ts
 *
 * Server actions for PM2-based project deployment.
 *
 * Safety guarantees:
 *  - Every action verifies project ownership (IDOR prevention)
 *  - All commands pass through validateAndParseCommand allowlist before running
 *  - No arbitrary shell commands — execFile only (via runCommand)
 *  - Logs sanitised for secrets before returning to the client
 *  - No automatic deployment — every action is explicitly triggered by the user
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { DeploymentStatus, DeploymentSource, DomainStatus, SslStatus, LogLevel, LogSource } from "@prisma/client";
import {
  assignNextPort,
  runProjectDeployment,
  getPm2AppStatus,
  getPm2AppLogs,
  pm2StopApp,
  pm2RestartApp,
  validateAndParseCommand,
  type Pm2AppStatus,
} from "@/lib/projects/project-deploy-runner";
import {
  publishDomain,
  assertPublishableHostname,
  isReservedHostname,
  publishIpPreviewPath,
  isValidDomain,
  verifyDnsARecord,
  removeDomainNginxConfig,
  issueSslCertificate,
  type RouteMode,
} from "@/lib/projects/nginx-manager";
import { getDecryptedEnvVarsForDeploy } from "@/app/actions/project-envvars";

// ── Config ─────────────────────────────────────────────────────────────────

/** VPS public IP — used to build the preview URL. Override via env var in production. */
const VPS_IP = process.env.VPS_IP ?? "178.105.105.59";

// ── Return types ───────────────────────────────────────────────────────────

export type DeployActionResult = {
  ok: boolean;
  output: string;
  error: string;
  deploymentId?:    string;
  deploymentRef?:   string | null;
  publicStaticPath?: string | null;
};

export type RuntimeStatusResult = {
  ok: boolean;
  error: string;
  pm2Status: Pm2AppStatus | null;
  latestDeployment: {
    id: string;
    status: DeploymentStatus;
    startedAt: Date;
    finishedAt: Date | null;
    duration: number | null;
    errorMessage: string | null;
    url: string | null;
    metadata: unknown;
  } | null;
};

export type LogsResult = {
  ok: boolean;
  error: string;
  logs: string;
};

export type SaveConfigInput = {
  installCommand:  string;
  buildCommand:    string;
  startCommand:    string;
  rootDirectory:   string;
  healthPath:      string;
  nodeEnv:         string;
  routeMode?:      string;
  staticOutputDir?: string;
  apiPrefix?:      string;
};

// ── Ownership guard ────────────────────────────────────────────────────────

async function verifyOwnership(projectId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      slug: true,
      workspaceId: true,
      deploymentConfig: true,
    },
  });
  if (!project || project.workspaceId !== workspaceId) return null;
  return project;
}

// ── Action: saveDeploymentConfigAction ────────────────────────────────────

/**
 * Validates and saves a deployment config for a project.
 * Assigns a unique port and PM2 name automatically on first save.
 * Safe to call again to update an existing config (port/pm2Name are frozen).
 */
export async function saveDeploymentConfigAction(
  projectId: string,
  input: SaveConfigInput
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  // Start command is required
  if (!input.startCommand.trim()) {
    return { ok: false, error: "Start command is required." };
  }

  // Validate each non-empty command
  const toValidate: [string, string][] = [
    ["install", input.installCommand.trim()],
    ["build",   input.buildCommand.trim()],
    ["start",   input.startCommand.trim()],
  ];
  for (const [label, cmd] of toValidate) {
    if (!cmd) continue;
    const v = validateAndParseCommand(cmd);
    if (!v.ok) return { ok: false, error: `${label} command: ${v.error}` };
  }

  // Validate health path
  const healthPath = input.healthPath.trim() || "/";
  if (!healthPath.startsWith("/")) {
    return { ok: false, error: "Health path must start with /" };
  }

  // Assign port and pm2Name on first save; preserve them on updates
  let port: number;
  let pm2Name: string;

  if (project.deploymentConfig) {
    port    = project.deploymentConfig.port;
    pm2Name = project.deploymentConfig.pm2Name;
  } else {
    try {
      port = await assignNextPort();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Port assignment failed." };
    }
    pm2Name = `project-${project.slug}`;
  }

  const isUpdate = !!project.deploymentConfig;

  const routeMode      = input.routeMode      ?? "fullstack_node";
  const staticOutputDir = input.staticOutputDir?.trim() || null;
  const apiPrefix      = input.apiPrefix?.trim() || "/api";

  try {
    await db.projectDeploymentConfig.upsert({
      where: { projectId },
      create: {
        projectId,
        installCommand:  input.installCommand.trim() || null,
        buildCommand:    input.buildCommand.trim()   || null,
        startCommand:    input.startCommand.trim(),
        rootDirectory:   input.rootDirectory.trim()  || ".",
        outputDirectory: null,
        port,
        pm2Name,
        healthPath,
        nodeEnv:         input.nodeEnv.trim() || "production",
        routeMode,
        staticOutputDir,
        apiPrefix,
      },
      update: {
        // port and pm2Name are intentionally NOT updated after first save
        installCommand:  input.installCommand.trim() || null,
        buildCommand:    input.buildCommand.trim()   || null,
        startCommand:    input.startCommand.trim(),
        rootDirectory:   input.rootDirectory.trim()  || ".",
        healthPath,
        nodeEnv:         input.nodeEnv.trim() || "production",
        routeMode,
        staticOutputDir,
        apiPrefix,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return { ok: false, error: `Failed to save deployment config: ${msg}` };
  }

  // Audit log
  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: isUpdate ? "Deployment config updated" : "Deployment config created",
      metadata: {
        startCommand:   input.startCommand.trim(),
        installCommand: input.installCommand.trim() || null,
        buildCommand:   input.buildCommand.trim()   || null,
        port,
        pm2Name,
      } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, error: "" };
}

// ── Action: deployProjectAction ────────────────────────────────────────────

/**
 * Runs the full deployment pipeline for a project:
 *   copy source → install → build → PM2 start → health check
 *
 * Creates a Deployment record in the DB and updates project.liveUrl on success.
 * Blocks concurrent deployments (one BUILDING record at a time).
 */
export async function deployProjectAction(
  projectId: string
): Promise<DeployActionResult> {
  const project = await verifyOwnership(projectId);
  if (!project) {
    return { ok: false, output: "", error: "Project not found or access denied." };
  }

  const config = project.deploymentConfig;
  if (!config) {
    return {
      ok: false,
      output: "",
      error: "No deployment config saved. Configure deployment settings first.",
    };
  }

  // Prevent concurrent deployments
  const inFlight = await db.deployment.findFirst({
    where: { projectId, status: DeploymentStatus.BUILDING },
    select: { id: true },
  });
  if (inFlight) {
    return {
      ok: false,
      output: "",
      error: "A deployment is already in progress. Wait for it to finish.",
    };
  }

  // Create a BUILDING record so the UI reflects in-progress state
  const deployment = await db.deployment.create({
    data: {
      projectId,
      status: DeploymentStatus.BUILDING,
      source: DeploymentSource.MANUAL,
      startedAt: new Date(),
    },
  });

  // Fetch decrypted env vars — NEVER log or return these to the client
  const envVars = await getDecryptedEnvVarsForDeploy(projectId);

  // Run the full pipeline (synchronous — may take several minutes)
  const result = await runProjectDeployment({
    slug:            project.slug,
    installCommand:  config.installCommand,
    buildCommand:    config.buildCommand,
    startCommand:    config.startCommand,
    rootDirectory:   config.rootDirectory,
    port:            config.port,
    pm2Name:         config.pm2Name,
    healthPath:      config.healthPath,
    nodeEnv:         config.nodeEnv,
    envVars,
    routeMode:       (config.routeMode as import("@/lib/projects/project-deploy-runner").RouteMode) ?? "fullstack_node",
    staticOutputDir: config.staticOutputDir,
    apiPrefix:       config.apiPrefix,
  });

  const internalUrl = `http://127.0.0.1:${config.port}`;
  const finalStatus = result.ok ? DeploymentStatus.SUCCESS : DeploymentStatus.FAILED;

  // Build full metadata for traceability (stored in Deployment.metadata JSON)
  const deployMeta = {
    // Deployment tracing
    deploymentRef:    result.deploymentRef    ?? null,
    sourceRef:        result.sourceRef        ?? null,
    sourceType:       result.sourceType       ?? null,
    // Runtime info
    releasePath:      result.releasePath      ?? null,
    publicStaticPath: result.publicStaticPath ?? null,
    pm2Name:          config.pm2Name,
    port:             config.port,
    internalUrl,
    healthPath:       config.healthPath,
    routeMode:        config.routeMode        ?? "fullstack_node",
    // Commands used
    installCommand:   config.installCommand   ?? null,
    buildCommand:     config.buildCommand     ?? null,
    startCommand:     config.startCommand,
    rootDirectory:    config.rootDirectory,
    nodeEnv:          config.nodeEnv,
    // Env var names injected (NOT values — never store those)
    envVarNames:      Object.keys(envVars),
    // Build output (truncated)
    output:           result.output.slice(0, 10_000),
  };

  // Persist the publicStaticPath on the config for nginx to use
  if (result.publicStaticPath && config.id) {
    await db.projectDeploymentConfig.update({
      where: { id: config.id },
      data:  { publicStaticPath: result.publicStaticPath },
    }).catch(() => {}); // non-fatal
  }

  // ── Auto-publish IP preview (path-based, non-fatal) ─────────────────────
  // Only attempt if the deploy succeeded and no existing preview is active at root_ip
  // (root_ip means it was set up manually and we must not overwrite it with path_ip).
  let previewUrl: string | null    = null;
  let previewMode: string          = "disabled";
  let previewStatus: string        = "inactive";

  if (result.ok) {
    const existingMode = (config as unknown as { publicPreviewMode?: string }).publicPreviewMode ?? "disabled";

    if (existingMode === "root_ip") {
      // Root IP was configured manually — preserve it, just mark active
      previewUrl    = (config as unknown as { publicPreviewUrl?: string }).publicPreviewUrl ?? null;
      previewMode   = "root_ip";
      previewStatus = "active";
    } else {
      // Attempt automatic path-based IP preview setup
      const ipResult = await publishIpPreviewPath(project.slug, config.port, {
        routeMode:   (config.routeMode as RouteMode) ?? "fullstack_node",
        staticRoot:  result.publicStaticPath ?? undefined,
        apiPrefix:   config.apiPrefix ?? "/api",
        serverIp:    VPS_IP,
      });

      previewUrl    = ipResult.ok ? (ipResult.url ?? null) : null;
      previewMode   = ipResult.ok ? "path_ip"  : "disabled";
      previewStatus = ipResult.ok ? "active"   : "error";

      // Log IP preview outcome (non-fatal either way)
      await db.projectLog.create({
        data: {
          projectId,
          level:   ipResult.ok ? LogLevel.INFO : LogLevel.WARN,
          source:  LogSource.DEPLOY,
          message: ipResult.ok
            ? `IP preview set up at ${ipResult.url}`
            : `IP preview auto-setup failed (non-fatal): ${ipResult.error ?? "unknown"}`,
        },
      }).catch(() => {});
    }

    // Persist preview URL/mode/status back onto the config
    await db.projectDeploymentConfig.update({
      where: { projectId },
      data: {
        publicPreviewUrl:    previewUrl,
        publicPreviewMode:   previewMode,
        publicPreviewStatus: previewStatus,
      },
    }).catch(() => {}); // non-fatal — deploy already succeeded
  }

  // Update deployment record with outcome.
  // url is intentionally left null — it's set by publishProjectDomainAction when
  // a public domain is connected.  Internal port URLs are not "live" URLs.
  await db.deployment.update({
    where: { id: deployment.id },
    data: {
      status:       finalStatus,
      finishedAt:   new Date(),
      duration:     result.durationMs,
      url:          null,
      errorMessage: result.ok ? null : result.error,
      metadata:     deployMeta as object,
    },
  });

  // Update lastDeployedAt on success (do NOT set liveUrl to raw port — only
  // set liveUrl when a domain is explicitly published via publishProjectDomainAction)
  if (result.ok) {
    await db.project.update({
      where: { id: projectId },
      data: { lastDeployedAt: new Date() },
    });
  }

  // Audit log
  await db.projectLog.create({
    data: {
      projectId,
      deploymentId: deployment.id,
      level:   result.ok ? LogLevel.INFO : LogLevel.ERROR,
      source:  LogSource.DEPLOY,
      message: result.ok
        ? `Deployment ${result.deploymentRef ?? "?"} successful — running internally on port ${config.port}`
        : `Deployment failed: ${result.error}`,
      metadata: {
        deploymentRef: result.deploymentRef ?? null,
        sourceRef:     result.sourceRef     ?? null,
        port:          config.port,
        pm2Name:       config.pm2Name,
        durationMs:    result.durationMs,
      } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/publishing`);

  return {
    ok:           result.ok,
    output:       result.output,
    error:        result.error,
    deploymentId: deployment.id,
  };
}

// ── Action: restartProjectRuntimeAction ───────────────────────────────────

/**
 * Restarts the running PM2 process without re-deploying from source.
 * Use this for quick env-var reloads. For a full redeploy, use deployProjectAction.
 */
export async function restartProjectRuntimeAction(
  projectId: string
): Promise<DeployActionResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, output: "", error: "Project not found or access denied." };

  const config = project.deploymentConfig;
  if (!config) return { ok: false, output: "", error: "No deployment config found." };

  const result = await pm2RestartApp(config.pm2Name);

  await db.projectLog.create({
    data: {
      projectId,
      level:   result.ok ? LogLevel.INFO : LogLevel.WARN,
      source:  LogSource.DEPLOY,
      message: result.ok
        ? `Runtime restarted: ${config.pm2Name}`
        : `Restart failed for ${config.pm2Name}`,
    },
  });

  revalidatePath(`/projects/${projectId}/publishing`);
  return {
    ok:     result.ok,
    output: result.output,
    error:  result.ok ? "" : "PM2 restart failed — see output.",
  };
}

// ── Action: stopProjectRuntimeAction ──────────────────────────────────────

/** Stops the running PM2 process (does not delete the PM2 entry). */
export async function stopProjectRuntimeAction(
  projectId: string
): Promise<DeployActionResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, output: "", error: "Project not found or access denied." };

  const config = project.deploymentConfig;
  if (!config) return { ok: false, output: "", error: "No deployment config found." };

  const result = await pm2StopApp(config.pm2Name);

  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: result.ok
        ? `Runtime stopped: ${config.pm2Name}`
        : `Stop command failed for ${config.pm2Name}`,
    },
  });

  revalidatePath(`/projects/${projectId}/publishing`);
  return {
    ok:     result.ok,
    output: result.output,
    error:  result.ok ? "" : "PM2 stop failed — see output.",
  };
}

// ── Action: refreshDeploymentStatusAction ─────────────────────────────────

/**
 * Returns the current PM2 status and the latest Deployment record.
 * Called by the client to poll for updates after an action completes.
 */
export async function refreshDeploymentStatusAction(
  projectId: string
): Promise<RuntimeStatusResult> {
  const project = await verifyOwnership(projectId);
  if (!project) {
    return {
      ok: false,
      error: "Project not found or access denied.",
      pm2Status: null,
      latestDeployment: null,
    };
  }

  const config = project.deploymentConfig;
  if (!config) {
    return {
      ok: false,
      error: "No deployment config found.",
      pm2Status: null,
      latestDeployment: null,
    };
  }

  const [pm2Status, latestDeployment] = await Promise.all([
    getPm2AppStatus(config.pm2Name),
    db.deployment.findFirst({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      select: {
        id:           true,
        status:       true,
        startedAt:    true,
        finishedAt:   true,
        duration:     true,
        errorMessage: true,
        url:          true,
        metadata:     true,
      },
    }),
  ]);

  return { ok: true, error: "", pm2Status, latestDeployment };
}

// ── Action: getProjectRuntimeLogsAction ───────────────────────────────────

/** Fetches the last 200 lines of PM2 logs for the project's runtime process. */
export async function getProjectRuntimeLogsAction(
  projectId: string
): Promise<LogsResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied.", logs: "" };

  const config = project.deploymentConfig;
  if (!config) return { ok: false, error: "No deployment config found.", logs: "" };

  const logs = await getPm2AppLogs(config.pm2Name, 200);
  return { ok: true, error: "", logs };
}

// ── Action: setPublicPreviewUrlAction ────────────────────────────────────

/**
 * Manually sets the public preview URL for a project.
 * Use this to backfill existing deployments or override the auto-detected URL.
 *
 * mode values:
 *   "root_ip"           — served at http://IP/ (manually set up on VPS)
 *   "path_ip"           — served at http://IP/<slug>/ (auto or manual)
 *   "preview_subdomain" — served at https://<slug>.domain.com
 *   "raw_port"          — served at http://IP:PORT (raw, not recommended publicly)
 *   "disabled"          — no public IP preview
 */
export async function setPublicPreviewUrlAction(
  projectId: string,
  {
    publicPreviewUrl,
    publicPreviewMode,
    publicPreviewStatus,
  }: {
    publicPreviewUrl:    string;
    publicPreviewMode:   string;
    publicPreviewStatus: string;
  }
): Promise<{ ok: boolean; error: string }> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  if (!project.deploymentConfig) {
    return { ok: false, error: "No deployment config found. Deploy the project first." };
  }

  const VALID_MODES = ["root_ip", "path_ip", "preview_subdomain", "raw_port", "disabled"] as const;
  const VALID_STATUSES = ["active", "inactive", "error"] as const;
  if (!VALID_MODES.includes(publicPreviewMode as typeof VALID_MODES[number])) {
    return { ok: false, error: `Invalid mode: ${publicPreviewMode}` };
  }
  if (!VALID_STATUSES.includes(publicPreviewStatus as typeof VALID_STATUSES[number])) {
    return { ok: false, error: `Invalid status: ${publicPreviewStatus}` };
  }

  // Validate URL if not disabling
  const urlTrimmed = publicPreviewUrl.trim();
  if (publicPreviewMode !== "disabled") {
    if (!urlTrimmed.startsWith("http://") && !urlTrimmed.startsWith("https://")) {
      return { ok: false, error: "Preview URL must start with http:// or https://" };
    }
  }

  await db.projectDeploymentConfig.update({
    where: { projectId },
    data: {
      publicPreviewUrl:    publicPreviewMode === "disabled" ? null : urlTrimmed,
      publicPreviewMode,
      publicPreviewStatus: publicPreviewMode === "disabled" ? "inactive" : publicPreviewStatus,
    },
  });

  // If setting root_ip or path_ip, also update project.liveUrl so it's consistent
  if ((publicPreviewMode === "root_ip" || publicPreviewMode === "path_ip") && urlTrimmed) {
    // Only set liveUrl if there's no active custom domain overriding it
    const activeDomain = await db.domain.findFirst({
      where: { projectId, status: "ACTIVE" },
      select: { hostname: true, sslStatus: true },
    });
    if (!activeDomain) {
      await db.project.update({
        where: { id: projectId },
        data:  { liveUrl: urlTrimmed },
      });
    }
  }

  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: publicPreviewMode === "disabled"
        ? "Public IP preview disabled"
        : `Public IP preview set: ${urlTrimmed} (${publicPreviewMode})`,
    },
  });

  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, error: "" };
}

// ── Action: publishProjectDomainAction ────────────────────────────────────

export type PublishDomainResult = {
  ok:    boolean;
  error: string;
};

/**
 * Publishes a domain for a project by writing an nginx reverse-proxy config
 * that routes `hostname` → `127.0.0.1:<port>` (port from ProjectDeploymentConfig).
 *
 * Steps:
 *   1. Verify ownership + ensure deployment config exists
 *   2. Validate hostname
 *   3. Call publishDomain() → write config, symlink, nginx -t, reload
 *   4. Upsert Domain record with ACTIVE status and nginx metadata
 *   5. Update project.liveUrl to http://<hostname>
 */
export async function publishProjectDomainAction(
  projectId: string,
  hostname:  string
): Promise<PublishDomainResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  const config = project.deploymentConfig;
  if (!config) {
    return {
      ok: false,
      error: "No deployment config found. Deploy the project first before publishing a domain.",
    };
  }

  // Validate hostname
  const clean = hostname.trim().toLowerCase();
  if (!isValidDomain(clean)) {
    return { ok: false, error: `Invalid domain name: "${clean}"` };
  }

  // Publish via nginx (safe fs writes + execFile — no shell)
  const nginxResult = await publishDomain(clean, config.port, {
    routeMode:      (config.routeMode as RouteMode) ?? "fullstack_node",
    staticRoot:     config.publicStaticPath ?? undefined,
    apiPrefix:      config.apiPrefix        ?? "/api",
  });

  if (!nginxResult.ok) {
    // Record the error on the Domain row so the UI can surface it
    await db.domain.upsert({
      where: { hostname: clean },
      update: {
        status:    DomainStatus.FAILED,
        lastError: nginxResult.error ?? "Unknown nginx error",
        targetPort: config.port,
        projectId,
      },
      create: {
        hostname:   clean,
        projectId,
        status:     DomainStatus.FAILED,
        lastError:  nginxResult.error ?? "Unknown nginx error",
        targetPort: config.port,
      },
    });
    return { ok: false, error: nginxResult.error ?? "Nginx publishing failed." };
  }

  // Upsert Domain record — mark as ACTIVE with nginx metadata
  await db.domain.upsert({
    where: { hostname: clean },
    update: {
      status:          DomainStatus.ACTIVE,
      nginxConfigPath: nginxResult.configPath ?? null,
      targetPort:      config.port,
      lastError:       null,
      isPrimary:       true,
      projectId,
    },
    create: {
      hostname:        clean,
      projectId,
      status:          DomainStatus.ACTIVE,
      nginxConfigPath: nginxResult.configPath ?? null,
      targetPort:      config.port,
      isPrimary:       true,
    },
  });

  // Update project.liveUrl to the published domain (HTTP for now — SSL is manual)
  await db.project.update({
    where: { id: projectId },
    data:  { liveUrl: `http://${clean}` },
  });

  // Audit log
  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: `Domain published: http://${clean} → 127.0.0.1:${config.port}`,
      metadata: {
        domain:     clean,
        port:       config.port,
        configPath: nginxResult.configPath ?? null,
      } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/domains`);
  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, error: "" };
}

// ── Action: addCustomDomainAction ─────────────────────────────────────────

export type AddDomainResult = {
  ok:       boolean;
  error:    string;
  domainId?: string;
};

/**
 * Adds a custom domain to a project in PENDING state.
 * Does NOT write nginx config yet — the user must verify DNS first via
 * checkDnsAndPublishDomainAction.
 *
 * For `*.doorstepmanchester.uk` subdomains (wildcard DNS already in place),
 * callers should use the existing publishProjectDomainAction to skip DNS check.
 */
export async function addCustomDomainAction(
  projectId: string,
  hostname:  string
): Promise<AddDomainResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  const config = project.deploymentConfig;
  if (!config) {
    return { ok: false, error: "No deployment config found. Deploy the project first." };
  }

  const clean = hostname.trim().toLowerCase();

  // reservedDomainCheck_addCustomDomainAction
  const publishable = assertPublishableHostname(clean);
  if (!publishable.ok) {
    return { ok: false, error: publishable.error };
  }
  if (!isValidDomain(clean)) {
    return { ok: false, error: `Invalid domain name: "${clean}"` };
  }

  // Check for duplicates across all projects
  const existing = await db.domain.findUnique({ where: { hostname: clean } });
  if (existing && existing.projectId !== projectId) {
    return { ok: false, error: `"${clean}" is already used by another project.` };
  }
  if (existing) {
    return { ok: false, error: `"${clean}" is already connected to this project.` };
  }

  const domain = await db.domain.create({
    data: {
      hostname:   clean,
      projectId,
      status:     DomainStatus.PENDING,
      targetPort: config.port,
    },
  });

  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: `Custom domain added (pending DNS): ${clean}`,
    },
  });

  revalidatePath(`/projects/${projectId}/domains`);
  return { ok: true, error: "", domainId: domain.id };
}

// ── Action: checkDnsAndPublishDomainAction ────────────────────────────────

export type CheckDnsResult = {
  ok:          boolean;
  error:       string;
  resolvedIp?: string;
};

/**
 * Verifies the DNS A record for `hostname` resolves to the VPS IP,
 * then writes an nginx config and marks the domain ACTIVE.
 *
 * Domain must already exist in PENDING state (created via addCustomDomainAction).
 */
export async function checkDnsAndPublishDomainAction(
  projectId: string,
  hostname:  string
): Promise<CheckDnsResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  const config = project.deploymentConfig;
  if (!config) {
    return { ok: false, error: "No deployment config found." };
  }

  const clean = hostname.trim().toLowerCase();

  // reservedDomainCheck_checkDnsAndPublishDomainAction
  const publishable = assertPublishableHostname(clean);
  if (!publishable.ok) {
    return { ok: false, error: publishable.error };
  }

  const domain = await db.domain.findFirst({ where: { hostname: clean, projectId } });
  if (!domain) {
    return { ok: false, error: `Domain "${clean}" not found for this project.` };
  }

  // ── Step 1: Verify DNS ──────────────────────────────────────────────────

  const dnsResult = await verifyDnsARecord(clean, VPS_IP);
  if (!dnsResult.ok) {
    await db.domain.update({
      where: { id: domain.id },
      data:  { status: DomainStatus.FAILED, lastError: dnsResult.error ?? "DNS verification failed" },
    });
    return {
      ok:          false,
      error:       dnsResult.error ?? "DNS verification failed",
      resolvedIp:  dnsResult.resolvedIp,
    };
  }

  // ── Step 2: Publish nginx config ───────────────────────────────────────

  const nginxResult = await publishDomain(clean, config.port, {
    routeMode:  (config.routeMode as RouteMode) ?? "fullstack_node",
    staticRoot: config.publicStaticPath ?? undefined,
    apiPrefix:  config.apiPrefix ?? "/api",
  });

  if (!nginxResult.ok) {
    await db.domain.update({
      where: { id: domain.id },
      data:  { status: DomainStatus.FAILED, lastError: nginxResult.error ?? "nginx publish failed" },
    });
    return { ok: false, error: nginxResult.error ?? "nginx publish failed" };
  }

  // ── Step 3: Mark domain ACTIVE ─────────────────────────────────────────

  await db.domain.update({
    where: { id: domain.id },
    data:  {
      status:          DomainStatus.ACTIVE,
      nginxConfigPath: nginxResult.configPath ?? null,
      lastError:       null,
    },
  });

  // Update project.liveUrl to HTTP (only if no HTTPS domain already set)
  const httpsActive = await db.domain.findFirst({
    where: { projectId, sslStatus: SslStatus.ACTIVE },
  });
  if (!httpsActive) {
    await db.project.update({
      where: { id: projectId },
      data:  { liveUrl: `http://${clean}` },
    });
  }

  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: `Domain DNS verified and published: http://${clean} → 127.0.0.1:${config.port}`,
      metadata: {
        domain:     clean,
        port:       config.port,
        resolvedIp: dnsResult.resolvedIp,
        configPath: nginxResult.configPath ?? null,
      } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/domains`);
  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, error: "", resolvedIp: dnsResult.resolvedIp };
}

// ── Action: requestSslCertAction ──────────────────────────────────────────

export type SslCertResult = {
  ok:    boolean;
  error: string;
  logs?: string;
};

/**
 * Issues an SSL certificate for `hostname` via certbot --nginx.
 * Domain must have status=ACTIVE (nginx HTTP working) before calling this.
 * On success, updates sslStatus=ACTIVE and sets project.liveUrl to https://
 */
export async function requestSslCertAction(
  projectId: string,
  hostname:  string
): Promise<SslCertResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  const clean = hostname.trim().toLowerCase();

  const domain = await db.domain.findFirst({ where: { hostname: clean, projectId } });
  if (!domain) {
    return { ok: false, error: `Domain "${clean}" not found for this project.` };
  }
  if (domain.status !== DomainStatus.ACTIVE) {
    return {
      ok:    false,
      error: "Domain must have HTTP active before requesting SSL. Verify DNS and publish first.",
    };
  }

  // Derive certbot email: CERTBOT_EMAIL env var, or admin@<root-domain>
  const rootDomain = clean.split(".").slice(-2).join(".");
  const certbotEmail = process.env.CERTBOT_EMAIL ?? `admin@${rootDomain}`;

  const sslResult = await issueSslCertificate(clean, certbotEmail);

  if (!sslResult.ok) {
    await db.domain.update({
      where: { id: domain.id },
      data:  { sslStatus: SslStatus.FAILED, lastError: sslResult.error ?? "SSL issuance failed" },
    });
    return { ok: false, error: sslResult.error ?? "SSL issuance failed", logs: sslResult.logs };
  }

  // Mark SSL active + update project liveUrl to HTTPS
  await db.domain.update({
    where: { id: domain.id },
    data:  { sslStatus: SslStatus.ACTIVE, lastError: null },
  });

  await db.project.update({
    where: { id: projectId },
    data:  { liveUrl: `https://${clean}` },
  });

  await db.projectLog.create({
    data: {
      projectId,
      level:   LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: `SSL certificate issued: https://${clean}`,
      metadata: { domain: clean } as object,
    },
  });

  revalidatePath(`/projects/${projectId}/domains`);
  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, error: "", logs: sslResult.logs };
}

// ── Action: removeDomainAndNginxAction ────────────────────────────────────

export type RemoveDomainResult = {
  ok:    boolean;
  error: string;
};

/**
 * Removes a domain from a project: deletes the nginx config + symlink,
 * reloads nginx, and deletes the Domain record.
 *
 * Nginx cleanup is non-fatal — domain is always removed from the DB.
 */
export async function removeDomainAndNginxAction(
  projectId: string,
  domainId:  string
): Promise<RemoveDomainResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Project not found or access denied." };

  const domain = await db.domain.findFirst({ where: { id: domainId, projectId } });
  if (!domain) return { ok: false, error: "Domain not found." };

  // Remove nginx config (non-fatal: log warning but continue)
  let nginxWarning = "";
  if (domain.nginxConfigPath || domain.status === DomainStatus.ACTIVE) {
    const removeResult = await removeDomainNginxConfig(domain.hostname);
    if (!removeResult.ok) {
      nginxWarning = removeResult.error ?? "nginx cleanup warning";
    }
  }

  // Delete domain record
  await db.domain.delete({ where: { id: domainId } });

  // Clear project.liveUrl if it pointed to this domain
  const proj = await db.project.findUnique({
    where: { id: projectId },
    select: { liveUrl: true },
  });
  if (proj?.liveUrl?.includes(domain.hostname)) {
    await db.project.update({
      where: { id: projectId },
      data:  { liveUrl: null },
    });
  }

  await db.projectLog.create({
    data: {
      projectId,
      level:   nginxWarning ? LogLevel.WARN : LogLevel.INFO,
      source:  LogSource.DEPLOY,
      message: nginxWarning
        ? `Domain removed: ${domain.hostname} (nginx cleanup warning: ${nginxWarning})`
        : `Domain removed: ${domain.hostname}`,
    },
  });

  revalidatePath(`/projects/${projectId}/domains`);
  revalidatePath(`/projects/${projectId}/publishing`);
  return {
    ok:    true,
    error: nginxWarning ? `Domain removed (nginx warning: ${nginxWarning})` : "",
  };
}


export async function cleanupReservedDomainRecordsAction(projectId: string) {
  try {
    const project = await verifyOwnership(projectId);

    if (!project) {
      return { ok: false, error: "Project not found or access denied." };
    }

    const domains = await db.domain.findMany({
      where: { projectId },
    });

    const reservedDomains = domains.filter((domain) =>
      isReservedHostname(domain.hostname)
    );

    if (reservedDomains.length === 0) {
      return { ok: true, removedCount: 0, removedHostnames: [] };
    }

    const ids = reservedDomains.map((domain) => domain.id);
    const hostnames = reservedDomains.map((domain) => domain.hostname);

    await db.domain.deleteMany({
      where: {
        id: { in: ids },
        projectId,
      },
    });

    await db.projectLog.create({
      data: {
        projectId,
        level: "WARN",
        source: LogSource.DEPLOY,
        message: `Removed reserved domain records: ${hostnames.join(", ")}`,
      },
    });

    return {
      ok: true,
      removedCount: ids.length,
      removedHostnames: hostnames,
    };
  } catch (error) {
    console.error("[cleanupReservedDomainRecordsAction]", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
