/**
 * lib/projects/deployment-history.ts
 *
 * Sprint 13: Deployment history and safe rollback implementation.
 *
 * Safety rules:
 *  - Protected PM2 processes are blocked from rollback
 *  - Release path validated via assertReleasePathExists
 *  - Only project's own PM2 process is restarted
 *  - confirm=true required for rollback execution
 *  - Failed deployments cannot be rolled back
 *  - Active deployment is excluded from rollback targets
 *  - No DB schema migration or package install during rollback
 *  - Audit logs written to ProjectLog
 */

import { db }              from "@/lib/db";
import { DeploymentStatus, DeploymentSource, LogLevel, LogSource } from "@prisma/client";
import { assertReleasePathExists }  from "@/lib/projects/release-safety";
import { activateReleaseWithPm2, runHealthCheck, getPm2AppStatus } from "@/lib/projects/project-deploy-runner";
import { getDecryptedEnvVarsForDeploy } from "@/app/actions/project-envvars";

// ── Protected PM2 process names — MUST NEVER be restarted via rollback ─────────

const PROTECTED_PM2_NAMES = new Set([
  "prisom-projects",
  "prisom-manager",
  "prisom-backend",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code?: string };

/** Safe metadata extracted from Deployment.metadata JSON. */
export type DeploymentMetaJson = {
  deploymentRef?:    string | null;
  releasePath?:      string | null;
  pm2Name?:          string | null;
  port?:             number | null;
  healthPath?:       string | null;
  sourceType?:       string | null;
  sourceRef?:        string | null;
  buildCommand?:     string | null;
  startCommand?:     string | null;
  installCommand?:   string | null;
  rootDirectory?:    string | null;
  nodeEnv?:          string | null;
  internalUrl?:      string | null;
  output?:           string | null;
  // rollback-specific
  rolledBackFromId?: string | null;
  rolledBackToId?:   string | null;
};

export type DeploymentHistoryItem = {
  id:            string;
  projectId:     string;
  status:        string;
  source:        string;
  deploymentRef: string | null;
  sourceType:    string | null;
  sourceRef:     string | null;
  releasePath:   string | null;
  pm2Name:       string | null;
  port:          number | null;
  healthPath:    string | null;
  liveUrl:       string | null;
  errorMessage:  string | null;
  createdAt:     Date;
  startedAt:     Date;
  finishedAt:    Date | null;
  durationMs:    number | null;
  isActive:      boolean;
  activatedAt:   Date | null;
  /** Whether the release folder currently exists on disk. */
  releaseExists: boolean;
  /** Safe display path (slug + ref only). */
  releasePathDisplay: string | null;
  rolledBackFromId: string | null;
  rolledBackToId:   string | null;
};

export type DeploymentHistoryResponse = {
  activeDeploymentId: string | null;
  items:              DeploymentHistoryItem[];
};

export type DeploymentLogEntry = {
  id:        string;
  level:     string;
  source:    string;
  message:   string;
  createdAt: string;
};

export type DeploymentHistoryDetail = {
  deployment:         DeploymentHistoryItem;
  logs:               DeploymentLogEntry[];
  releaseExists:      boolean;
  releasePathDisplay: string | null;
};

export type RollbackReadinessCheck = {
  name:    string;
  ok:      boolean;
  message?: string;
};

export type RollbackResult = {
  previousDeploymentId: string | null;
  activeDeploymentId:   string;
  targetDeploymentId:   string;
  pm2ProcessName:       string;
  output:               string;
  readiness?: {
    ok:     boolean;
    checks: RollbackReadinessCheck[];
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMeta(raw: unknown): DeploymentMetaJson {
  if (!raw || typeof raw !== "object") return {};
  return raw as DeploymentMetaJson;
}

function safeDisplayPath(slug: string, deploymentRef: string | null | undefined): string | null {
  if (!deploymentRef) return null;
  return `storage/releases/${slug}/${deploymentRef}`;
}

async function checkReleaseExists(
  projectSlug:   string,
  deploymentRef: string | null | undefined,
): Promise<boolean> {
  if (!deploymentRef) return false;
  const result = await assertReleasePathExists({ projectSlug, deploymentRef }).catch(() => ({ ok: false as const }));
  return result.ok;
}

/** Build a DeploymentHistoryItem from a raw DB row, enriched with release existence. */
async function enrichDeployment(
  row: {
    id: string;
    projectId: string;
    status: DeploymentStatus;
    source: DeploymentSource;
    url: string | null;
    errorMessage: string | null;
    metadata: unknown;
    startedAt: Date;
    finishedAt: Date | null;
    duration: number | null;
    createdAt: Date;
    isActive: boolean;
    activatedAt: Date | null;
  },
  projectSlug: string,
): Promise<DeploymentHistoryItem> {
  const meta = extractMeta(row.metadata);
  const deploymentRef = meta.deploymentRef ?? null;
  const releaseExists = await checkReleaseExists(projectSlug, deploymentRef);

  return {
    id:             row.id,
    projectId:      row.projectId,
    status:         row.status,
    source:         row.source,
    deploymentRef,
    sourceType:     meta.sourceType ?? null,
    sourceRef:      meta.sourceRef  ?? null,
    releasePath:    meta.releasePath ?? null,
    pm2Name:        meta.pm2Name     ?? null,
    port:           typeof meta.port === "number" ? meta.port : null,
    healthPath:     meta.healthPath  ?? null,
    liveUrl:        row.url,
    errorMessage:   row.errorMessage,
    createdAt:      row.createdAt,
    startedAt:      row.startedAt,
    finishedAt:     row.finishedAt,
    durationMs:     row.duration,
    isActive:       row.isActive,
    activatedAt:    row.activatedAt,
    releaseExists,
    releasePathDisplay: safeDisplayPath(projectSlug, deploymentRef),
    rolledBackFromId: meta.rolledBackFromId ?? null,
    rolledBackToId:   meta.rolledBackToId   ?? null,
  };
}

// ── List history ───────────────────────────────────────────────────────────────

export async function listProjectDeploymentHistory(input: {
  projectId: string;
  limit?:    number;
}): Promise<ActionResult<DeploymentHistoryResponse>> {
  const { projectId, limit = 20 } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
  if (!project) return { ok: false, error: "Project not found.", code: "NOT_FOUND" };

  const rows = await db.deployment.findMany({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
    take:    Math.min(limit, 50),
    select: {
      id: true, projectId: true, status: true, source: true,
      url: true, errorMessage: true, metadata: true,
      startedAt: true, finishedAt: true, duration: true, createdAt: true,
      isActive: true, activatedAt: true,
    },
  });

  const items = await Promise.all(rows.map((r) => enrichDeployment(r, project.slug)));

  // Active deployment = explicitly marked OR latest SUCCESS/ROLLBACK if none marked
  let activeDeploymentId = items.find((i) => i.isActive)?.id ?? null;
  if (!activeDeploymentId) {
    const latestSuccess = items.find(
      (i) => i.status === DeploymentStatus.SUCCESS,
    );
    activeDeploymentId = latestSuccess?.id ?? null;
  }

  return { ok: true, data: { activeDeploymentId, items } };
}

// ── Get detail ─────────────────────────────────────────────────────────────────

export async function getProjectDeploymentDetail(input: {
  projectId:    string;
  deploymentId: string;
}): Promise<ActionResult<DeploymentHistoryDetail>> {
  const { projectId, deploymentId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
  if (!project) return { ok: false, error: "Project not found.", code: "NOT_FOUND" };

  const row = await db.deployment.findUnique({
    where:  { id: deploymentId },
    select: {
      id: true, projectId: true, status: true, source: true,
      url: true, errorMessage: true, metadata: true,
      startedAt: true, finishedAt: true, duration: true, createdAt: true,
      isActive: true, activatedAt: true,
    },
  });
  if (!row || row.projectId !== projectId) {
    return { ok: false, error: "Deployment not found.", code: "NOT_FOUND" };
  }

  const deployment = await enrichDeployment(row, project.slug);

  const logRows = await db.projectLog.findMany({
    where:   { projectId, deploymentId },
    orderBy: { timestamp: "asc" },
    take:    200,
    select:  { id: true, level: true, source: true, message: true, timestamp: true },
  });

  const logs: DeploymentLogEntry[] = logRows.map((l) => ({
    id:        l.id,
    level:     l.level,
    source:    l.source,
    message:   l.message,
    createdAt: l.timestamp.toISOString(),
  }));

  return {
    ok:   true,
    data: {
      deployment,
      logs,
      releaseExists:      deployment.releaseExists,
      releasePathDisplay: deployment.releasePathDisplay,
    },
  };
}

// ── Rollback ───────────────────────────────────────────────────────────────────

export async function rollbackProjectDeployment(input: {
  projectId:          string;
  targetDeploymentId: string;
  confirm:            boolean;
}): Promise<ActionResult<RollbackResult>> {
  const { projectId, targetDeploymentId, confirm } = input;

  // ── Require explicit confirmation ──────────────────────────────────────────
  if (!confirm) {
    return { ok: false, error: "Rollback requires explicit confirmation (confirm=true).", code: "NOT_CONFIRMED" };
  }

  // ── Load project ───────────────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true },
  });
  if (!project) return { ok: false, error: "Project not found.", code: "NOT_FOUND" };

  // ── Load deployment config ─────────────────────────────────────────────────
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { pm2Name: true, port: true, healthPath: true, nodeEnv: true, startCommand: true },
  });
  if (!config) {
    return { ok: false, error: "No deployment config found. Deploy the project first.", code: "NO_CONFIG" };
  }

  // ── Block protected PM2 processes ─────────────────────────────────────────
  if (PROTECTED_PM2_NAMES.has(config.pm2Name)) {
    return {
      ok:    false,
      error: `Cannot rollback: PM2 process "${config.pm2Name}" is a protected system process.`,
      code:  "PROTECTED_PROCESS",
    };
  }

  // ── Load target deployment ────────────────────────────────────────────────
  const target = await db.deployment.findUnique({
    where:  { id: targetDeploymentId },
    select: {
      id: true, projectId: true, status: true, source: true,
      metadata: true, isActive: true,
    },
  });
  if (!target || target.projectId !== projectId) {
    return { ok: false, error: "Target deployment not found or belongs to another project.", code: "NOT_FOUND" };
  }

  // ── Block rollback to failed deployments ──────────────────────────────────
  if (target.status === DeploymentStatus.FAILED || target.status === DeploymentStatus.CANCELLED) {
    return {
      ok:    false,
      error: `Cannot rollback to a ${target.status.toLowerCase()} deployment.`,
      code:  "INVALID_STATUS",
    };
  }

  // ── Block rollback to currently active ───────────────────────────────────
  if (target.isActive) {
    return {
      ok:    false,
      error: "This deployment is already active.",
      code:  "ALREADY_ACTIVE",
    };
  }

  // ── Extract release info from target metadata ─────────────────────────────
  const meta = extractMeta(target.metadata);
  const deploymentRef = meta.deploymentRef ?? null;

  if (!deploymentRef) {
    return {
      ok:    false,
      error: "Target deployment has no deploymentRef — cannot locate release folder.",
      code:  "NO_DEPLOYMENT_REF",
    };
  }

  // ── Validate release path exists ──────────────────────────────────────────
  const releaseCheck = await assertReleasePathExists({
    projectSlug:   project.slug,
    deploymentRef,
  });
  if (!releaseCheck.ok) {
    return { ok: false, error: releaseCheck.error, code: "RELEASE_MISSING" };
  }
  const releasePath = releaseCheck.releasePath;

  // ── Find current active deployment (for audit trail) ─────────────────────
  const previousActive = await db.deployment.findFirst({
    where:   { projectId, isActive: true },
    orderBy: { createdAt: "desc" },
    select:  { id: true },
  });
  // Fall back to latest SUCCESS if no explicit active marker
  const previousActiveFallback = previousActive ?? await db.deployment.findFirst({
    where:   { projectId, status: DeploymentStatus.SUCCESS, id: { not: targetDeploymentId } },
    orderBy: { createdAt: "desc" },
    select:  { id: true },
  });
  const previousDeploymentId = previousActiveFallback?.id ?? null;

  // ── Create rollback deployment record ─────────────────────────────────────
  const rollbackRecord = await db.deployment.create({
    data: {
      projectId,
      status:    DeploymentStatus.BUILDING,
      source:    DeploymentSource.ROLLBACK,
      startedAt: new Date(),
      metadata: {
        deploymentRef,
        releasePath:      releasePath,
        pm2Name:          config.pm2Name,
        port:             config.port,
        healthPath:       config.healthPath,
        nodeEnv:          config.nodeEnv,
        startCommand:     config.startCommand,
        sourceType:       "rollback",
        sourceRef:        deploymentRef,
        rolledBackFromId: previousDeploymentId,
        rolledBackToId:   targetDeploymentId,
      },
    },
  });

  // ── Audit log: rollback started ───────────────────────────────────────────
  await db.projectLog.create({
    data: {
      projectId,
      deploymentId: rollbackRecord.id,
      level:        LogLevel.INFO,
      source:       LogSource.DEPLOY,
      message:      `Rollback started → deploymentRef: ${deploymentRef} | PM2: ${config.pm2Name}`,
      metadata:     {
        targetDeploymentId,
        deploymentRef,
        pm2Name: config.pm2Name,
      } as object,
    },
  }).catch(() => {});

  // ── Get decrypted env vars ────────────────────────────────────────────────
  const envVars = await getDecryptedEnvVarsForDeploy(projectId, "production");

  // ── Activate release with PM2 ─────────────────────────────────────────────
  const pm2Result = await activateReleaseWithPm2({
    pm2Name:      config.pm2Name,
    startCommand: config.startCommand,
    releasePath,
    port:         config.port,
    nodeEnv:      config.nodeEnv,
    envVars,
  });

  if (!pm2Result.ok) {
    // Mark rollback record as FAILED
    await db.deployment.update({
      where: { id: rollbackRecord.id },
      data: {
        status:      DeploymentStatus.FAILED,
        finishedAt:  new Date(),
        errorMessage: "PM2 activation failed — see logs.",
        metadata: {
          deploymentRef, releasePath, pm2Name: config.pm2Name,
          port: config.port, healthPath: config.healthPath, nodeEnv: config.nodeEnv,
          startCommand: config.startCommand, sourceType: "rollback", sourceRef: deploymentRef,
          rolledBackFromId: previousDeploymentId, rolledBackToId: targetDeploymentId,
          output: pm2Result.output.slice(0, 5_000),
        },
      },
    }).catch(() => {});

    await db.projectLog.create({
      data: {
        projectId,
        deploymentId: rollbackRecord.id,
        level:        LogLevel.ERROR,
        source:       LogSource.DEPLOY,
        message:      `Rollback FAILED: PM2 activation failed for ${config.pm2Name}`,
        metadata:     { pm2Name: config.pm2Name, deploymentRef } as object,
      },
    }).catch(() => {});

    return {
      ok:    false,
      error: `Rollback failed: PM2 activation failed. Output: ${pm2Result.output.slice(0, 500)}`,
      code:  "PM2_FAILED",
    };
  }

  // ── Health check ──────────────────────────────────────────────────────────
  const healthy = await runHealthCheck(config.port, config.healthPath, 5, 3_000);

  // ── Mark rollback SUCCESS ─────────────────────────────────────────────────
  const now = new Date();

  // Deactivate previous active
  if (previousDeploymentId) {
    await db.deployment.update({
      where: { id: previousDeploymentId },
      data:  { isActive: false },
    }).catch(() => {});
  }

  // Activate rollback record
  await db.deployment.update({
    where: { id: rollbackRecord.id },
    data: {
      status:      DeploymentStatus.SUCCESS,
      isActive:    true,
      activatedAt: now,
      finishedAt:  now,
      duration:    0,
      metadata: {
        deploymentRef, releasePath, pm2Name: config.pm2Name,
        port: config.port, healthPath: config.healthPath, nodeEnv: config.nodeEnv,
        startCommand: config.startCommand, sourceType: "rollback", sourceRef: deploymentRef,
        rolledBackFromId: previousDeploymentId, rolledBackToId: targetDeploymentId,
        output: pm2Result.output.slice(0, 5_000),
      },
    },
  }).catch(() => {});

  // Update project lastDeployedAt
  await db.project.update({
    where: { id: projectId },
    data:  { lastDeployedAt: now },
  }).catch(() => {});

  // ── Readiness check ───────────────────────────────────────────────────────
  const readinessChecks: RollbackReadinessCheck[] = [];

  // PM2 online
  try {
    const pm2Status = await getPm2AppStatus(config.pm2Name);
    readinessChecks.push({
      name:    "App process",
      ok:      pm2Status?.status === "online",
      message: pm2Status
        ? `PM2 status: ${pm2Status.status}`
        : "Process not found in PM2",
    });
  } catch {
    readinessChecks.push({ name: "App process", ok: false, message: "PM2 query failed" });
  }

  // Health endpoint
  readinessChecks.push({
    name:    "Health endpoint",
    ok:      healthy,
    message: healthy ? `Health check passed on port ${config.port}` : "Health check timed out",
  });

  const readinessOk = readinessChecks.every((c) => c.ok);

  // ── Audit logs ────────────────────────────────────────────────────────────
  await db.projectLog.create({
    data: {
      projectId,
      deploymentId: rollbackRecord.id,
      level:        readinessOk ? LogLevel.INFO : LogLevel.WARN,
      source:       LogSource.DEPLOY,
      message:      readinessOk
        ? `Rollback completed and readiness passed → ${deploymentRef}`
        : `Rollback completed but readiness check failed → ${deploymentRef}`,
      metadata: {
        deploymentRef,
        pm2Name:          config.pm2Name,
        targetDeploymentId,
        readinessOk,
        healthOk: healthy,
      } as object,
    },
  }).catch(() => {});

  return {
    ok: true,
    data: {
      previousDeploymentId,
      activeDeploymentId: rollbackRecord.id,
      targetDeploymentId,
      pm2ProcessName: config.pm2Name,
      output: pm2Result.output,
      readiness: {
        ok:     readinessOk,
        checks: readinessChecks,
      },
    },
  };
}
