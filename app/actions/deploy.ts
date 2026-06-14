"use server";

/**
 * Server actions for the deployment control panel.
 *
 * These run in the Node.js runtime on the VPS, where child_process execFile
 * can spawn git/npm/pm2. They also write Deployment + ProjectLog records to
 * the database so the publishing page shows a full audit trail.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  DeploymentStatus,
  DeploymentSource,
  LogLevel,
  LogSource,
} from "@prisma/client";
import { getDeploymentConfig } from "@/lib/projects/deployment-config";
import { getCurrentUser } from "@/lib/current-workspace";
import {
  getGitStatus,
  getPm2Status,
  getPm2Logs,
  deployLatest,
  rollbackToCommit,
  type GitStatus,
  type Pm2Status,
} from "@/lib/projects/localshop-deploy";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ActionResult<T = void> = {
  ok: boolean;
  data?: T;
  error?: string;
};

// ─── Internal helper ──────────────────────────────────────────────────────────

async function getDeployableProject(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) throw new Error("Project not found");

  const config = getDeploymentConfig(project.slug);
  if (!config) {
    throw new Error(
      `No deployment config for "${project.name}". ` +
        `Add an entry for slug "${project.slug}" in lib/projects/deployment-config.ts.`
    );
  }

  return { project, config };
}

// ─── Status queries ───────────────────────────────────────────────────────────

export type DeployStatusData = GitStatus & { pm2: Pm2Status };

export async function getDeployStatusAction(
  projectId: string
): Promise<ActionResult<DeployStatusData>> {
  try {
    const { project } = await getDeployableProject(projectId);
    const [gitStatus, pm2] = await Promise.all([
      getGitStatus(project.slug),
      getPm2Status(project.slug),
    ]);
    return { ok: true, data: { ...gitStatus, pm2 } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to fetch status",
    };
  }
}

export async function getPm2LogsAction(
  projectId: string
): Promise<ActionResult<string>> {
  try {
    const { project } = await getDeployableProject(projectId);
    const logs = await getPm2Logs(project.slug);
    return { ok: true, data: logs };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to fetch PM2 logs",
    };
  }
}

// ─── Deploy latest ────────────────────────────────────────────────────────────

export type DeployActionData = { output: string; deploymentId: string };

export async function deployLatestAction(
  projectId: string
): Promise<ActionResult<DeployActionData>> {
  try {
    const { project, config } = await getDeployableProject(projectId);
    const user = await getCurrentUser();

    // Open a BUILDING deployment record immediately
    const deployment = await db.deployment.create({
      data: {
        projectId: project.id,
        status: DeploymentStatus.BUILDING,
        source: DeploymentSource.MANUAL,
        branch: config.branch,
        url: config.domain,
        triggeredById: user.id,
      },
    });

    // Run the deploy pipeline (blocking — may take several minutes)
    const result = await deployLatest(project.slug);

    // Determine final status
    const finalStatus = result.success
      ? DeploymentStatus.SUCCESS
      : DeploymentStatus.FAILED;

    // Trim output to avoid hitting Prisma JSON column limits
    const trimmedOutput = result.output.slice(-12_000);

    // Update the deployment record
    await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: finalStatus,
        commitSha: result.commitSha ?? null,
        duration: result.durationMs,
        finishedAt: new Date(),
        errorMessage: result.success ? null : result.output.slice(-2_000),
        metadata: { output: trimmedOutput } as object,
      },
    });

    // Update project lastDeployedAt on success
    if (result.success) {
      await db.project.update({
        where: { id: project.id },
        data: { lastDeployedAt: new Date() },
      });
    }

    // Write an audit log entry
    await db.projectLog.create({
      data: {
        projectId: project.id,
        deploymentId: deployment.id,
        level: result.success ? LogLevel.INFO : LogLevel.ERROR,
        source: LogSource.DEPLOY,
        message: result.success
          ? `Deploy succeeded (${Math.round(result.durationMs / 1000)}s)`
          : `Deploy failed after ${Math.round(result.durationMs / 1000)}s`,
        metadata: {
          output: trimmedOutput,
          durationMs: result.durationMs,
          commitSha: result.commitSha,
        } as object,
      },
    });

    revalidatePath(`/projects/${projectId}/publishing`);

    return {
      ok: result.success,
      data: { output: result.output, deploymentId: deployment.id },
      ...(result.success ? {} : { error: "Deploy failed — check the output below" }),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unexpected error during deploy",
    };
  }
}

// ─── Rollback to commit ───────────────────────────────────────────────────────

export async function rollbackToCommitAction(
  projectId: string,
  commitHash: string
): Promise<ActionResult<DeployActionData>> {
  // Validate the hash before anything reaches the server command layer
  if (!/^[a-f0-9]{7,40}$/i.test(commitHash)) {
    return { ok: false, error: "Invalid commit hash" };
  }

  try {
    const { project, config } = await getDeployableProject(projectId);
    const user = await getCurrentUser();

    const deployment = await db.deployment.create({
      data: {
        projectId: project.id,
        status: DeploymentStatus.BUILDING,
        source: DeploymentSource.ROLLBACK,
        branch: config.branch,
        commitSha: commitHash,
        commitMessage: `Rollback to ${commitHash}`,
        url: config.domain,
        triggeredById: user.id,
      },
    });

    const result = await rollbackToCommit(project.slug, commitHash);

    const finalStatus = result.success
      ? DeploymentStatus.SUCCESS
      : DeploymentStatus.FAILED;
    const trimmedOutput = result.output.slice(-12_000);

    await db.deployment.update({
      where: { id: deployment.id },
      data: {
        status: finalStatus,
        duration: result.durationMs,
        finishedAt: new Date(),
        errorMessage: result.success ? null : result.output.slice(-2_000),
        metadata: { output: trimmedOutput } as object,
      },
    });

    await db.projectLog.create({
      data: {
        projectId: project.id,
        deploymentId: deployment.id,
        level: result.success ? LogLevel.WARN : LogLevel.ERROR,
        source: LogSource.DEPLOY,
        message: result.success
          ? `Rolled back to ${commitHash}`
          : `Rollback to ${commitHash} failed`,
        metadata: {
          output: trimmedOutput,
          durationMs: result.durationMs,
          commitHash,
        } as object,
      },
    });

    revalidatePath(`/projects/${projectId}/publishing`);

    return {
      ok: result.success,
      data: { output: result.output, deploymentId: deployment.id },
      ...(result.success
        ? {}
        : { error: "Rollback failed — check the output below" }),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unexpected error during rollback",
    };
  }
}
