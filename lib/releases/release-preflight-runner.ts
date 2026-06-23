/**
 * lib/releases/release-preflight-runner.ts
 *
 * Sprint 39: Preflight check runner for release promotions.
 *
 * Safety rules:
 *  - no secret values in any check result or message
 *  - env var checks only validate presence of key names, not values
 *  - health endpoint check times out after 5 seconds
 *  - network/fs failures return "warning" — never crash the runner
 */

import { promises as fs }           from "fs";
import path                          from "path";
import { db }                        from "@/lib/db";
import { RELEASE_STORAGE }           from "@/lib/projects/project-deploy-runner";
import type {
  ReleaseReadinessCheck,
  ReleaseReadinessReport,
  CheckStatus,
} from "./release-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(id: string, label: string, message: string, href?: string): ReleaseReadinessCheck {
  return { id, label, status: "pass", message, href };
}
function warn(id: string, label: string, message: string, href?: string): ReleaseReadinessCheck {
  return { id, label, status: "warning", message, href };
}
function fail(id: string, label: string, message: string, href?: string): ReleaseReadinessCheck {
  return { id, label, status: "fail", message, href };
}

function overallStatus(checks: ReleaseReadinessCheck[]): ReleaseReadinessReport["overallStatus"] {
  if (checks.some((c) => c.status === "fail"))    return "blocked";
  if (checks.some((c) => c.status === "warning")) return "warning";
  return "ready";
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkDeploymentSucceeded(
  projectId: string,
  deploymentId: string,
): Promise<ReleaseReadinessCheck> {
  const dep = await db.deployment.findUnique({
    where:  { id: deploymentId },
    select: { status: true, startedAt: true },
  });
  if (!dep) return fail("deployment_status", "Deployment found", "Deployment record not found.");
  if (dep.status === "SUCCESS") return pass("deployment_status", "Deployment succeeded", "Latest deployment completed successfully.");
  if (dep.status === "FAILED")  return fail("deployment_status", "Deployment succeeded", `Deployment failed — cannot promote a failed release.`);
  return fail("deployment_status", "Deployment succeeded", `Deployment is in state "${dep.status}" — only SUCCESS deployments can be promoted.`);
}

async function checkReleaseDirectoryExists(
  slug: string,
  deploymentRef: string,
): Promise<ReleaseReadinessCheck> {
  if (!deploymentRef || deploymentRef === "unknown") {
    return warn("release_dir", "Release directory", "Deployment ref is not recorded — cannot verify release directory.");
  }
  try {
    const relPath = path.join(RELEASE_STORAGE, slug, deploymentRef);
    await fs.access(relPath);
    return pass("release_dir", "Release directory", `Release snapshot exists at storage/releases/${slug}/${deploymentRef}.`);
  } catch {
    return fail("release_dir", "Release directory", `Release directory not found at storage/releases/${slug}/${deploymentRef}.`);
  }
}

async function checkHealthEndpoint(
  port: number,
  healthPath: string,
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (res.ok) {
      return pass("health_endpoint", "Health endpoint", `${healthPath} returned ${res.status}.`);
    }
    return warn("health_endpoint", "Health endpoint", `${healthPath} returned HTTP ${res.status} — service may not be healthy.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      return warn("health_endpoint", "Health endpoint", `Health check timed out after 5s — service may be slow.`);
    }
    return warn("health_endpoint", "Health endpoint", `Health endpoint unreachable — project may not be running yet.`);
  }
}

async function checkProductionDomain(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const domains = await db.domain.findMany({
    where:  { projectId, status: "ACTIVE" },
    select: { hostname: true, isPrimary: true, sslStatus: true },
  });
  if (domains.length === 0) {
    return warn(
      "production_domain",
      "Production domain",
      "No active domain configured — project is only accessible via internal IP.",
      `/projects/${projectId}/domains`,
    );
  }
  const primary = domains.find((d) => d.isPrimary) ?? domains[0];
  return pass("production_domain", "Production domain", `Domain ${primary.hostname} is active.`);
}

async function checkSslActive(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const domain = await db.domain.findFirst({
    where:  { projectId, isPrimary: true },
    select: { hostname: true, sslStatus: true },
  });
  if (!domain) {
    return warn("ssl_active", "SSL certificate", "No primary domain configured.", `/projects/${projectId}/domains`);
  }
  if (domain.sslStatus === "ACTIVE") {
    return pass("ssl_active", "SSL certificate", `SSL is active for ${domain.hostname}.`);
  }
  return warn(
    "ssl_active",
    "SSL certificate",
    `SSL status is "${domain.sslStatus}" for ${domain.hostname}.`,
    `/projects/${projectId}/domains`,
  );
}

async function checkEnvVarsConfigured(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const config = await db.projectDeploymentConfig.findUnique({
    where:  { projectId },
    select: { id: true, port: true, pm2Name: true, healthPath: true },
  });
  if (!config) {
    return fail("env_config", "Deployment config", "No deployment config found — project cannot be deployed.", `/projects/${projectId}/publishing`);
  }
  const envCount = await db.projectEnvVar.count({ where: { projectId } });
  if (envCount === 0) {
    return warn("env_config", "Environment variables", "No environment variables set — check if the project requires any.", `/projects/${projectId}/env`);
  }
  return pass("env_config", "Environment variables", `${envCount} environment variable(s) configured.`);
}

async function checkEnvReadiness(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  try {
    const { generateEnvReadinessReport } = await import("@/lib/env/env-readiness-detector");
    const report = await generateEnvReadinessReport(projectId);

    if (!report || report.findings.length === 0) {
      return pass("env_readiness", "Secrets readiness", "No env readiness data — skipping.", `/projects/${projectId}/env`);
    }

    if (report.status === "blocked") {
      const names = report.findings
        .filter((f) => f.severity === "required" && (f.status === "missing" || f.status === "placeholder" || f.status === "empty"))
        .map((f) => f.name)
        .slice(0, 5)
        .join(", ");
      return fail(
        "env_readiness",
        "Secrets readiness",
        `Missing required env vars: ${names || "see Secrets Vault"}.`,
        `/projects/${projectId}/env`,
      );
    }

    if (report.status === "warning") {
      const count = report.summary.placeholders + report.summary.suspicious;
      return warn(
        "env_readiness",
        "Secrets readiness",
        `${count} env var(s) need attention (placeholder or suspicious values).`,
        `/projects/${projectId}/env`,
      );
    }

    return pass(
      "env_readiness",
      "Secrets readiness",
      `${report.summary.configured}/${report.summary.total} env vars configured and ready.`,
      `/projects/${projectId}/env`,
    );
  } catch {
    // Non-fatal — return warning if check fails
    return warn("env_readiness", "Secrets readiness", "Could not check env var readiness.", `/projects/${projectId}/env`);
  }
}

async function checkRecentBackup(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const backup = await db.projectBackup.findFirst({
    where:   { projectId, status: "ready", createdAt: { gte: sevenDaysAgo } },
    orderBy: { createdAt: "desc" },
    select:  { createdAt: true },
  });
  if (backup) {
    const age = Math.round((Date.now() - backup.createdAt.getTime()) / (60 * 60 * 1000));
    return pass("recent_backup", "Recent backup", `Latest backup is ${age}h old.`);
  }
  return warn(
    "recent_backup",
    "Recent backup",
    "No backup in the last 7 days — a recent backup is recommended before promoting.",
    `/projects/${projectId}/backups`,
  );
}

async function checkRollbackTarget(
  projectId: string,
  deploymentId: string,
): Promise<{ check: ReleaseReadinessCheck; rollbackTarget?: { deploymentId: string; deploymentRef: string; createdAt: string; status: string } }> {
  const previous = await db.deployment.findFirst({
    where:   { projectId, status: "SUCCESS", id: { not: deploymentId } },
    orderBy: { createdAt: "desc" },
    select:  { id: true, metadata: true, createdAt: true, status: true },
  });
  if (!previous) {
    return {
      check: warn("rollback_target", "Rollback target", "No previous successful deployment to fall back to — first deployment cannot be rolled back."),
    };
  }
  const meta = previous.metadata as Record<string, unknown> | null;
  const ref  = (meta?.deploymentRef as string) ?? previous.id;
  return {
    check: pass("rollback_target", "Rollback target", `Previous release ${ref.slice(0, 12)} is available as a rollback target.`),
    rollbackTarget: {
      deploymentId:  previous.id,
      deploymentRef: ref,
      createdAt:     previous.createdAt.toISOString(),
      status:        previous.status,
    },
  };
}

async function checkNoActiveOperation(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const op = await db.projectOperation.findFirst({
    where:  { projectId, status: "running" },
    select: { operationType: true, title: true },
  });
  if (!op) return pass("no_active_op", "No conflicting operation", "No operations currently running for this project.");
  return fail("no_active_op", "No conflicting operation", `"${op.title}" is currently running — wait for it to complete before promoting.`);
}

async function checkNoRecentJobFailures(
  projectId: string,
): Promise<ReleaseReadinessCheck> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failures = await db.backgroundJob.count({
    where: {
      projectId,
      status:    "failed",
      jobType:   { in: ["alert_check", "domain_health"] as string[] },
      updatedAt: { gte: since },
    },
  });
  if (failures === 0) {
    return pass("job_failures", "No critical job failures", "No critical background job failures in the last 24h.");
  }
  return warn(
    "job_failures",
    "No critical job failures",
    `${failures} critical job failure(s) in the last 24h — review the Jobs dashboard.`,
    `/projects/${projectId}/operations`,
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runReleasePreflight(
  projectId:    string,
  deploymentId: string,
): Promise<ReleaseReadinessReport> {
  // Fetch project + config for slug/port/healthPath
  const [project, config, deployment] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true },
    }),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: { port: true, healthPath: true },
    }),
    db.deployment.findUnique({
      where:  { id: deploymentId },
      select: { metadata: true },
    }),
  ]);

  const slug          = project?.slug ?? "unknown";
  const meta          = deployment?.metadata as Record<string, unknown> | null;
  const deploymentRef = (meta?.deploymentRef as string) ?? deploymentId;

  // Run all checks in parallel (where safe)
  const [
    depCheck,
    dirCheck,
    envCheck,
    envReadinessCheck,
    domainCheck,
    sslCheck,
    backupCheck,
    opCheck,
    jobCheck,
    rollbackResult,
  ] = await Promise.all([
    checkDeploymentSucceeded(projectId, deploymentId),
    checkReleaseDirectoryExists(slug, deploymentRef),
    checkEnvVarsConfigured(projectId),
    checkEnvReadiness(projectId),
    checkProductionDomain(projectId),
    checkSslActive(projectId),
    checkRecentBackup(projectId),
    checkNoActiveOperation(projectId),
    checkNoRecentJobFailures(projectId),
    checkRollbackTarget(projectId, deploymentId),
  ]);

  // Health endpoint check depends on config (serial — needs port + healthPath)
  let healthCheck: ReleaseReadinessCheck;
  if (config?.port && config?.healthPath) {
    healthCheck = await checkHealthEndpoint(config.port, config.healthPath, projectId);
  } else {
    healthCheck = warn("health_endpoint", "Health endpoint", "No deployment config — health endpoint cannot be checked.");
  }

  const checks: ReleaseReadinessCheck[] = [
    depCheck,
    dirCheck,
    healthCheck,
    domainCheck,
    sslCheck,
    envCheck,
    envReadinessCheck,
    backupCheck,
    rollbackResult.check,
    opCheck,
    jobCheck,
  ];

  return {
    projectId,
    deploymentId,
    deploymentRef,
    generatedAt:   new Date().toISOString(),
    overallStatus: overallStatus(checks),
    checks,
    rollbackTarget: rollbackResult.rollbackTarget,
  };
}
