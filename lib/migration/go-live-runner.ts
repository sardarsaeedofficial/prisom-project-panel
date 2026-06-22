/**
 * lib/migration/go-live-runner.ts
 *
 * Sprint 26: Orchestrates all go-live readiness checks.
 *
 * Data flow:
 *   1. Load DB records (env vars, services, domains, backup)
 *   2. Optionally scan source files (for patch status + feature detection)
 *   3. Optionally check live API health (HTTP to localhost)
 *   4. Optionally check static output on disk
 *   5. Assemble GoLiveReadinessReport
 *
 * Safety:
 *  - Never reads or returns secret values
 *  - Source scan skips .env, .pem, .key files
 *  - HTTP health check uses short 3s timeout, localhost only
 *  - Disk checks use resolved paths under known release storage
 *  - No external calls (Stripe/DNS/email not touched)
 */

import path           from "path";
import http           from "http";
import { promises as fs } from "fs";
import { db }         from "@/lib/db";
import { RELEASE_STORAGE } from "@/lib/projects/project-deploy-runner";
import {
  resolveCheckedSourceDir,
} from "@/lib/migration/portability-patch-safety";
import {
  planPatch,
  listPatchSummaries,
  type PlannerInput,
} from "@/lib/migration/portability-patch-planner";
import type { GoLiveReadinessReport, GoLiveCheck, GoLiveCheckStatus } from "./go-live-types";
import {
  type GoLiveContext,
  checkBackup,
  checkScheduledBackups,
  checkAppUrlPatch,
  checkEmailTransportPatch,
  checkCoreSecrets,
  checkDatabaseSecret,
  checkStripeSecrets,
  checkEmailSecrets,
  checkCloudinarySecrets,
  checkDatabaseReadiness,
  buildServiceChecks,
  checkServiceConfig,
  checkBuildValidation,
  buildApiHealthCheck,
  buildStaticFrontendCheck,
  checkDomainRouting,
  buildExternalTasks,
} from "./go-live-checks";

// ── Source file scanner (same constraints as portability patches) ──────────────

const SCAN_EXTS   = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml"]);
const SKIP_DIRS   = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", ".cache", "releases"]);
const NEVER_READ  = [/^\.env$/i, /^\.env\./i, /\.pem$/i, /\.key$/i];
const MAX_FILES   = 300;
const MAX_BYTES   = 100 * 1024;

async function scanSource(sourceDir: string): Promise<{
  allContent: string;
  fileList:   string[];
  allDeps:    Record<string, string>;
} | null> {
  try { await fs.access(sourceDir); } catch { return null; }

  const fileList:     string[]  = [];
  const contentParts: string[]  = [];
  let   allDeps: Record<string, string> = {};

  async function walk(dir: string, prefix: string): Promise<void> {
    if (fileList.length >= MAX_FILES) return;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (fileList.length >= MAX_FILES) break;
      const name    = entry.name;
      const absPath = path.join(dir, name);
      const relPath = prefix ? `${prefix}/${name}` : name;

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(name)) await walk(absPath, relPath); continue; }
      if (!entry.isFile()) continue;

      fileList.push(relPath);
      if (NEVER_READ.some((r) => r.test(name))) continue;
      if (!SCAN_EXTS.has(path.extname(name)) && name !== "package.json") continue;

      try {
        const stat = await fs.lstat(absPath);
        if (stat.isSymbolicLink() || stat.size > MAX_BYTES) continue;
        const content = await fs.readFile(absPath, "utf8");
        contentParts.push(content);
        if (name === "package.json") {
          try {
            const pkg = JSON.parse(content);
            allDeps = { ...allDeps, ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
          } catch { /* skip */ }
        }
      } catch { /* skip unreadable */ }
    }
  }

  await walk(sourceDir, "");
  return { allContent: contentParts.join("\n"), fileList, allDeps };
}

// ── HTTP health check ─────────────────────────────────────────────────────────

async function checkApiHealth(
  port:       number,
  healthPath: string,
  timeoutMs = 3_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    const path_ = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
    const req = http.get(
      { hostname: "127.0.0.1", port, path: path_, timeout: timeoutMs },
      (res) => {
        clearTimeout(guard);
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
        resolve({ ok, status: res.statusCode });
        res.resume();
      },
    );
    req.on("error", (err) => { clearTimeout(guard); resolve({ ok: false, error: err.message }); });
    const guard = setTimeout(() => { req.destroy(); resolve({ ok: false, error: "timeout" }); }, timeoutMs + 500);
  });
}

// ── Static index.html check ───────────────────────────────────────────────────

async function checkStaticIndex(
  projectSlug:      string,
  deploymentRef:    string | null,
  staticOutputDir:  string,
): Promise<boolean | null> {
  if (!deploymentRef) return null;
  try {
    const candidate = path.join(RELEASE_STORAGE, projectSlug, deploymentRef, staticOutputDir, "index.html");
    // Security: ensure candidate is within RELEASE_STORAGE
    const resolved  = path.resolve(candidate);
    const base      = path.resolve(RELEASE_STORAGE);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runGoLiveChecks(
  projectId: string,
): Promise<GoLiveReadinessReport> {
  // ── 1. Load project ──────────────────────────────────────────────────────────
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, slug: true, name: true },
  });
  if (!project) throw new Error("Project not found");

  // ── 2. Load production env var names (never values) ───────────────────────
  const envVarRows = await db.projectEnvVar.findMany({
    where:  { projectId, isEnabled: true, environment: "production" },
    select: { name: true },
  });
  const configuredKeys = new Set(envVarRows.map((e) => e.name));

  // ── 3. Load services ───────────────────────────────────────────────────────
  const services = await db.projectService.findMany({
    where:   { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, slug: true, serviceType: true,
      installCommand: true, buildCommand: true, startCommand: true,
      internalPort: true, healthPath: true, staticOutputDir: true,
      spaFallback: true, isEnabled: true, workingDir: true,
      requiredEnvKeysJson: true, lastStatus: true, lastDeploymentRef: true,
    },
  });

  // ── 4. Load domains ────────────────────────────────────────────────────────
  const domains = await db.domain.findMany({
    where:  { projectId },
    select: { id: true, hostname: true, status: true, isPrimary: true },
  });

  // ── 5. Latest backup + schedule status ────────────────────────────────────
  const [latestBackupRow, backupScheduleRow] = await Promise.all([
    db.projectBackup.findFirst({
      where:   { projectId, status: "ready" },
      orderBy: { completedAt: "desc" },
      select:  { completedAt: true },
    }),
    db.projectBackupSchedule.findUnique({
      where:  { projectId },
      select: { enabled: true },
    }),
  ]);
  // completedAt is nullable in schema; only treat as "exists" if non-null
  const latestBackup = latestBackupRow?.completedAt
    ? { completedAt: latestBackupRow.completedAt }
    : null;
  const scheduledBackupEnabled = backupScheduleRow?.enabled ?? false;

  // ── 6. Source scan (optional) ──────────────────────────────────────────────
  const sourceDir = resolveCheckedSourceDir(project.slug);
  const scan      = sourceDir ? await scanSource(sourceDir) : null;

  let patchSummaries = null;
  if (scan && sourceDir) {
    try {
      const input: PlannerInput = {
        projectId,
        sourceDir,
        allContent: scan.allContent,
        fileList:   scan.fileList,
        allDeps:    scan.allDeps,
      };
      patchSummaries = await listPatchSummaries(input);
    } catch { /* non-fatal */ }
  }

  // ── 7. Feature detection from source ──────────────────────────────────────
  const allContent = scan?.allContent ?? null;
  const hasStripe       = allContent ? /stripe/i.test(allContent) : false;
  const hasCloudinary   = allContent ? /cloudinary/i.test(allContent) : false;
  const hasEmail        = allContent ? /nodemailer|smtp|sendgrid|resend/i.test(allContent) : false;
  const hasReplitDeps   = allContent ? /@replit\/|replitdb|REPLIT_DOMAINS/i.test(allContent) : false;
  const hasFrontend     = services.some((s) => s.serviceType === "static") ||
                          (allContent ? /vite|react|next/i.test(allContent) : false);

  // DB type detection
  let detectedDbType: string | null = null;
  if (allContent) {
    if (/\bpg\b|postgres|postgresql/i.test(allContent)) detectedDbType = "postgres";
    else if (/\bmysql\b/i.test(allContent)) detectedDbType = "mysql";
    else if (/\bsqlite\b/i.test(allContent)) detectedDbType = "sqlite";
  }

  // Static output dir detection
  const detectedOutputDir = services.find((s) => s.serviceType === "static")?.staticOutputDir ?? null;

  // ── 8. Health checks (node services) ──────────────────────────────────────
  type HealthResult = { ok: boolean | null; status?: number };
  const healthResults = new Map<string, HealthResult>();

  for (const svc of services.filter((s) => s.serviceType === "node" && s.isEnabled && s.internalPort)) {
    if (svc.lastStatus !== "success") {
      healthResults.set(svc.id, { ok: null });
      continue;
    }
    try {
      const r = await checkApiHealth(svc.internalPort!, svc.healthPath ?? "/api/healthz");
      healthResults.set(svc.id, r);
    } catch {
      healthResults.set(svc.id, { ok: null });
    }
  }

  // ── 9. Static index check ──────────────────────────────────────────────────
  const staticIndexResults = new Map<string, boolean | null>();
  for (const svc of services.filter((s) => s.serviceType === "static" && s.isEnabled)) {
    const exists = await checkStaticIndex(project.slug, svc.lastDeploymentRef, svc.staticOutputDir ?? "dist");
    staticIndexResults.set(svc.id, exists);
  }

  // ── 10. Build context ──────────────────────────────────────────────────────
  const ctx: GoLiveContext = {
    projectId,
    projectSlug:   project.slug,
    projectName:   project.name,
    configuredKeys,
    services,
    domains: domains as GoLiveContext["domains"],
    latestBackup,
    patchSummaries,
    allContent,
    hasStripe,
    hasCloudinary,
    hasEmail,
    hasReplitDeps,
    hasFrontend,
    detectedDbType,
    detectedOutputDir,
    staticIndexExists: null,
  };

  // ── 11. Run checks ─────────────────────────────────────────────────────────
  const checks: GoLiveCheck[] = [];

  // Backup
  checks.push(checkBackup(ctx, projectId));
  checks.push(checkScheduledBackups(ctx, projectId, scheduledBackupEnabled));

  // Portability patches (only if source available)
  if (patchSummaries !== null) {
    checks.push(checkAppUrlPatch(ctx, projectId));
    checks.push(checkEmailTransportPatch(ctx, projectId));
  }

  // Secrets
  checks.push(checkCoreSecrets(ctx, projectId));
  checks.push(checkDatabaseSecret(ctx, projectId));
  checks.push(checkStripeSecrets(ctx, projectId));
  checks.push(checkEmailSecrets(ctx, projectId));
  checks.push(checkCloudinarySecrets(ctx, projectId));

  // Database readiness
  checks.push(checkDatabaseReadiness(ctx, projectId));

  // Services
  checks.push(checkServiceConfig(ctx, projectId));
  checks.push(checkBuildValidation(ctx, projectId));

  // Per-service: API health
  for (const svc of services.filter((s) => s.serviceType === "node" && s.isEnabled)) {
    const hr = healthResults.get(svc.id);
    checks.push(buildApiHealthCheck(svc, project.slug, hr?.ok ?? null, hr?.status));
  }

  // Per-service: static frontend
  for (const svc of services.filter((s) => s.serviceType === "static" && s.isEnabled)) {
    const exists = staticIndexResults.get(svc.id) ?? null;
    checks.push(buildStaticFrontendCheck(svc, exists));
  }

  // Domain
  checks.push(checkDomainRouting(ctx, projectId));

  // ── 12. External tasks ────────────────────────────────────────────────────
  const externalTasks = buildExternalTasks(ctx);

  // ── 13. Service checks ────────────────────────────────────────────────────
  const serviceChecks = buildServiceChecks(ctx);

  // ── 14. Overall status ────────────────────────────────────────────────────
  const actionable   = checks.filter((c) => c.status !== "skip" && c.status !== "manual");
  const failCount    = actionable.filter((c) => c.status === "fail").length;
  const warningCount = actionable.filter((c) => c.status === "warning").length;
  const passCount    = actionable.filter((c) => c.status === "pass").length;

  const overallStatus =
    failCount    > 0 ? "blocked" :
    warningCount > 0 ? "needs_attention" :
                       "ready";

  // ── 15. Recommended next commands ─────────────────────────────────────────
  const nextCommands: string[] = [];
  if (!latestBackup) {
    nextCommands.push("# Create a backup first");
  }
  if (services.length > 0) {
    const installCmds = services
      .filter((s) => s.isEnabled && s.installCommand)
      .map((s) => `# ${s.name}: ${s.installCommand}`);
    if (installCmds.length > 0) {
      nextCommands.push(...installCmds);
    }
  }
  if (ctx.configuredKeys.has("DATABASE_URL")) {
    if (allContent?.includes("drizzle")) {
      nextCommands.push("pnpm exec drizzle-kit push   # or: pnpm --filter @workspace/db exec drizzle-kit push");
    } else if (allContent?.includes("@prisma/client")) {
      nextCommands.push("pnpm prisma db push");
    }
  }
  if (services.some((s) => s.isEnabled && s.lastStatus !== "success")) {
    nextCommands.push("# Go to Publishing → Deploy to start services");
  }

  return {
    projectId,
    projectName:   project.name,
    projectSlug:   project.slug,
    overallStatus,
    checks,
    services:      serviceChecks,
    externalTasks,
    nextCommands,
    failCount,
    warningCount,
    passCount,
    generatedAt:   new Date().toISOString(),
  };
}
