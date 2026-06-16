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
import { DeploymentStatus, DeploymentSource, DomainStatus, LogLevel, LogSource } from "@prisma/client";
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
import { publishDomain, isValidDomain } from "@/lib/projects/nginx-manager";

// ── Config ─────────────────────────────────────────────────────────────────

/** VPS public IP — used to build the preview URL. Override via env var in production. */
const VPS_IP = process.env.VPS_IP ?? "178.105.105.59";

// ── Return types ───────────────────────────────────────────────────────────

export type DeployActionResult = {
  ok: boolean;
  output: string;
  error: string;
  deploymentId?: string;
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
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  rootDirectory: string;
  healthPath: string;
  nodeEnv: string;
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
        nodeEnv: input.nodeEnv.trim() || "production",
      },
      update: {
        // port and pm2Name are intentionally NOT updated after first save
        installCommand:  input.installCommand.trim() || null,
        buildCommand:    input.buildCommand.trim()   || null,
        startCommand:    input.startCommand.trim(),
        rootDirectory:   input.rootDirectory.trim()  || ".",
        healthPath,
        nodeEnv: input.nodeEnv.trim() || "production",
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

  // Run the full pipeline (synchronous — may take several minutes)
  const result = await runProjectDeployment({
    slug:           project.slug,
    installCommand: config.installCommand,
    buildCommand:   config.buildCommand,
    startCommand:   config.startCommand,
    rootDirectory:  config.rootDirectory,
    port:           config.port,
    pm2Name:        config.pm2Name,
    healthPath:     config.healthPath,
    nodeEnv:        config.nodeEnv,
  });

  const internalUrl = `http://127.0.0.1:${config.port}`;
  const finalStatus = result.ok ? DeploymentStatus.SUCCESS : DeploymentStatus.FAILED;

  // Build full metadata for traceability (stored in Deployment.metadata JSON)
  const deployMeta = {
    // Deployment tracing
    deploymentRef:  result.deploymentRef  ?? null,
    sourceRef:      result.sourceRef      ?? null,
    sourceType:     result.sourceType     ?? null,
    // Runtime info
    releasePath:    result.releasePath    ?? null,
    pm2Name:        config.pm2Name,
    port:           config.port,
    internalUrl,
    healthPath:     config.healthPath,
    // Commands used
    installCommand: config.installCommand ?? null,
    buildCommand:   config.buildCommand   ?? null,
    startCommand:   config.startCommand,
    rootDirectory:  config.rootDirectory,
    nodeEnv:        config.nodeEnv,
    // Build output (truncated)
    output:         result.output.slice(0, 10_000),
  };

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
  const nginxResult = await publishDomain(clean, config.port);

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
