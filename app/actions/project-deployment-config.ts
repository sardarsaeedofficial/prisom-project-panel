"use server";

/**
 * app/actions/project-deployment-config.ts
 *
 * Sprint 3: server actions for viewing, editing, and validating a project's
 * deployment configuration stored in ProjectDeploymentConfig.
 *
 * Safety rules:
 *   - All actions verify project ownership (IDOR prevention)
 *   - Port and PM2 process name are frozen after initial creation
 *   - Reserved hostnames are rejected as primaryDomain
 *   - Commands pass through the existing allowlist validator
 *   - No plaintext secrets are ever returned
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { isReservedHostname } from "@/lib/projects/nginx-manager";
import { validateAndParseCommand } from "@/lib/projects/project-deploy-runner";

// ── Shared result type ─────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data?: T;  message?: string }
  | { ok: false; error: string; code?: string };

// ── Ownership guard ────────────────────────────────────────────────────────

async function verifyOwnership(projectId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) return null;
  return project;
}

// ── Return type for config ─────────────────────────────────────────────────

export interface DeploymentConfigData {
  id:               string;
  port:             number;
  pm2Name:          string;
  runtime:          string;
  installCommand:   string | null;
  buildCommand:     string | null;
  startCommand:     string;
  rootDirectory:    string;
  outputDirectory:  string | null;
  healthPath:       string;
  loginPath:        string;
  nodeEnv:          string;
  routeMode:        string;
  staticOutputDir:  string | null;
  apiPrefix:        string;
  primaryDomain:    string | null;
  publicPreviewUrl: string | null;
  publicPreviewMode: string;
  publicPreviewStatus: string;
  lastValidatedAt:  Date | null;
  validationStatus: string | null;
  validationError:  string | null;
}

// ── Input type for updates ─────────────────────────────────────────────────

export interface UpdateDeploymentConfigInput {
  /** "node" | "static" | "vite" | "next" | "express" */
  runtime?:        string;
  rootDirectory?:  string | null;
  installCommand?: string | null;
  buildCommand?:   string | null;
  startCommand?:   string;
  outputDirectory?: string | null;
  healthPath?:     string | null;
  loginPath?:      string | null;
  nodeEnv?:        string;
  routeMode?:      string;
  staticOutputDir?: string | null;
  apiPrefix?:      string;
  /**
   * Primary public domain for this project.
   * Must not be a reserved hostname (projects.doorstepmanchester.uk, localhost, etc.).
   * Set null to clear.
   */
  primaryDomain?:  string | null;
}

// ── Validation helper ──────────────────────────────────────────────────────

const VALID_RUNTIMES = ["node", "static", "vite", "next", "express"] as const;
const PATH_TRAVERSAL_RE = /\.\./;

function validateInput(
  input: UpdateDeploymentConfigInput
): string | null {
  // runtime
  if (input.runtime !== undefined) {
    if (!VALID_RUNTIMES.includes(input.runtime as (typeof VALID_RUNTIMES)[number])) {
      return `Invalid runtime "${input.runtime}". Allowed: ${VALID_RUNTIMES.join(", ")}`;
    }
  }

  // paths
  for (const [field, value] of [
    ["rootDirectory",  input.rootDirectory],
    ["outputDirectory", input.outputDirectory],
    ["staticOutputDir", input.staticOutputDir],
  ] as [string, string | null | undefined][]) {
    if (value && PATH_TRAVERSAL_RE.test(value)) {
      return `${field} must not contain ".."`;
    }
  }

  // health/login paths
  if (input.healthPath !== undefined && input.healthPath !== null) {
    const h = input.healthPath.trim();
    if (h && !h.startsWith("/")) return "healthPath must start with /";
  }
  if (input.loginPath !== undefined && input.loginPath !== null) {
    const l = input.loginPath.trim();
    if (l && !l.startsWith("/")) return "loginPath must start with /";
  }

  // commands
  for (const [label, cmd] of [
    ["installCommand", input.installCommand],
    ["buildCommand",   input.buildCommand],
    ["startCommand",   input.startCommand],
  ] as [string, string | null | undefined][]) {
    if (cmd === null || cmd === undefined) continue;
    const trimmed = cmd.trim();
    if (!trimmed) {
      if (label === "startCommand") return "startCommand cannot be empty.";
      continue; // null / empty is OK for install/build
    }
    const v = validateAndParseCommand(trimmed);
    if (!v.ok) return `${label}: ${v.error}`;
  }

  // primaryDomain — must not be reserved
  if (input.primaryDomain !== undefined && input.primaryDomain !== null) {
    const domain = input.primaryDomain.trim();
    if (domain) {
      // Strip protocol if present
      const hostname = domain.replace(/^https?:\/\//i, "").split("/")[0];
      if (isReservedHostname(hostname)) {
        return `"${hostname}" is a reserved hostname and cannot be used as a project domain.`;
      }
    }
  }

  return null;
}

// ── Action: get ────────────────────────────────────────────────────────────

/**
 * Returns the full deployment config for a project (no secrets).
 */
export async function getProjectDeploymentConfigAction(
  projectId: string
): Promise<ActionResult<DeploymentConfigData>> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", code: "FORBIDDEN" };

  const config = await db.projectDeploymentConfig.findUnique({
    where: { projectId },
  });

  if (!config) {
    return { ok: false, error: "No deployment config found for this project.", code: "NOT_FOUND" };
  }

  return {
    ok: true,
    data: {
      id:                  config.id,
      port:                config.port,
      pm2Name:             config.pm2Name,
      runtime:             config.runtime,
      installCommand:      config.installCommand,
      buildCommand:        config.buildCommand,
      startCommand:        config.startCommand,
      rootDirectory:       config.rootDirectory,
      outputDirectory:     config.outputDirectory,
      healthPath:          config.healthPath,
      loginPath:           config.loginPath,
      nodeEnv:             config.nodeEnv,
      routeMode:           config.routeMode,
      staticOutputDir:     config.staticOutputDir,
      apiPrefix:           config.apiPrefix,
      primaryDomain:       config.primaryDomain,
      publicPreviewUrl:    config.publicPreviewUrl,
      publicPreviewMode:   config.publicPreviewMode,
      publicPreviewStatus: config.publicPreviewStatus,
      lastValidatedAt:     config.lastValidatedAt,
      validationStatus:    config.validationStatus,
      validationError:     config.validationError,
    },
  };
}

// ── Action: update ─────────────────────────────────────────────────────────

/**
 * Updates configurable fields of the deployment config.
 *
 * Port and PM2 process name are intentionally NOT updatable — they are frozen
 * after first creation to avoid breaking the running process.
 *
 * A warning is shown in the UI for any field change that takes effect only
 * after the next deploy/restart.
 */
export async function updateProjectDeploymentConfigAction(
  projectId: string,
  input: UpdateDeploymentConfigInput
): Promise<ActionResult> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", code: "FORBIDDEN" };

  // Must have an existing config
  const existing = await db.projectDeploymentConfig.findUnique({ where: { projectId } });
  if (!existing) {
    return { ok: false, error: "No deployment config found. Run initial setup first.", code: "NOT_FOUND" };
  }

  // Validate input
  const validationErr = validateInput(input);
  if (validationErr) return { ok: false, error: validationErr, code: "VALIDATION_ERROR" };

  // Build update data (only include defined fields)
  const data: Record<string, unknown> = {};

  if (input.runtime        !== undefined) data.runtime        = input.runtime;
  if (input.rootDirectory  !== undefined) data.rootDirectory  = input.rootDirectory ?? ".";
  if (input.installCommand !== undefined) data.installCommand = input.installCommand?.trim() || null;
  if (input.buildCommand   !== undefined) data.buildCommand   = input.buildCommand?.trim()   || null;
  if (input.startCommand   !== undefined && input.startCommand.trim()) {
    data.startCommand = input.startCommand.trim();
  }
  if (input.outputDirectory !== undefined) data.outputDirectory = input.outputDirectory?.trim() || null;
  if (input.healthPath     !== undefined) data.healthPath     = input.healthPath?.trim() || "/";
  if (input.loginPath      !== undefined) data.loginPath      = input.loginPath?.trim()  || "/login";
  if (input.nodeEnv        !== undefined) data.nodeEnv        = input.nodeEnv;
  if (input.routeMode      !== undefined) data.routeMode      = input.routeMode;
  if (input.staticOutputDir !== undefined) data.staticOutputDir = input.staticOutputDir?.trim() || null;
  if (input.apiPrefix      !== undefined) data.apiPrefix      = input.apiPrefix?.trim() || "/api";
  if (input.primaryDomain  !== undefined) {
    const domain = input.primaryDomain?.trim() || null;
    data.primaryDomain = domain;
  }

  if (Object.keys(data).length === 0) {
    return { ok: true, message: "No changes to save." };
  }

  try {
    await db.projectDeploymentConfig.update({
      where: { projectId },
      data,
    });
  } catch (e) {
    return { ok: false, error: `Failed to update config: ${(e as Error).message}` };
  }

  revalidatePath(`/projects/${projectId}/publishing`);
  return { ok: true, message: "Deployment config updated. Changes take effect on next deploy/restart." };
}

// ── Action: validate ───────────────────────────────────────────────────────

/**
 * Runs a validation check on the current deployment config and updates the
 * validationStatus / lastValidatedAt fields.
 *
 * Checks:
 *   - Config exists
 *   - startCommand is valid
 *   - Port is in range and not a reserved port
 *   - pm2Name starts with "project-"
 *   - healthPath starts with /
 *   - loginPath starts with /
 *   - primaryDomain (if set) is not reserved
 */
export async function validateProjectDeploymentConfigAction(
  projectId: string
): Promise<ActionResult<{ message: string; warnings: string[] }>> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found or access denied.", code: "FORBIDDEN" };

  const config = await db.projectDeploymentConfig.findUnique({ where: { projectId } });
  if (!config) {
    return { ok: false, error: "No deployment config found.", code: "NOT_FOUND" };
  }

  const errors:   string[] = [];
  const warnings: string[] = [];

  // Port range
  if (config.port < 1024 || config.port > 65535) {
    errors.push(`Port ${config.port} is out of the valid range 1024–65535.`);
  } else if ([3000, 3001, 3002, 3003].includes(config.port)) {
    errors.push(`Port ${config.port} is reserved for the Prisom platform.`);
  }

  // PM2 name
  if (!config.pm2Name.startsWith("project-")) {
    errors.push(`PM2 process name "${config.pm2Name}" must start with "project-".`);
  }

  // Start command
  const startCheck = validateAndParseCommand(config.startCommand);
  if (!startCheck.ok) {
    errors.push(`startCommand: ${startCheck.error}`);
  }

  // Health path
  if (!config.healthPath.startsWith("/")) {
    errors.push(`healthPath "${config.healthPath}" must start with /`);
  }

  // Login path
  if (!config.loginPath.startsWith("/")) {
    errors.push(`loginPath "${config.loginPath}" must start with /`);
  }

  // Primary domain
  if (config.primaryDomain) {
    const hostname = config.primaryDomain.replace(/^https?:\/\//i, "").split("/")[0];
    if (isReservedHostname(hostname)) {
      errors.push(`primaryDomain "${hostname}" is a reserved hostname.`);
    }
  }

  // Install / build commands (warn if invalid but don't block)
  if (config.installCommand?.trim()) {
    const v = validateAndParseCommand(config.installCommand.trim());
    if (!v.ok) warnings.push(`installCommand warning: ${v.error}`);
  }
  if (config.buildCommand?.trim()) {
    const v = validateAndParseCommand(config.buildCommand.trim());
    if (!v.ok) warnings.push(`buildCommand warning: ${v.error}`);
  }

  const isValid   = errors.length === 0;
  const status    = isValid ? "valid" : "invalid";
  const errString = errors.join("; ") || null;

  await db.projectDeploymentConfig.update({
    where: { projectId },
    data: {
      lastValidatedAt:  new Date(),
      validationStatus: status,
      validationError:  errString,
    },
  }).catch(() => {/* non-fatal */});

  revalidatePath(`/projects/${projectId}/publishing`);

  if (!isValid) {
    return {
      ok:    false,
      error: errors.join("; "),
      code:  "VALIDATION_FAILED",
    };
  }

  return {
    ok:   true,
    data: { message: "Configuration is valid.", warnings },
  };
}
