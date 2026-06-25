/**
 * lib/cutover/production-execution-planner.ts
 *
 * Sprint 65: Generate a production cutover execution plan.
 *
 * Safety: read-only, no secrets, no production mutation.
 */

import { db } from "@/lib/db";
import { generateProductionRouteApplyPreview } from "./production-route-apply-preview";
import type {
  ProductionExecutionPlan,
  ProductionExecutionStep,
  ProductionExecutionStatus,
} from "./production-execution-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE_SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const DB_NAMES           = ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL"];
const STAGING_SLUG       = "sardar-security-staging";

// ── Helpers ───────────────────────────────────────────────────────────────────

function step(s: Omit<ProductionExecutionStep, "message"> & { message?: string }): ProductionExecutionStep {
  return { message: "", ...s } as ProductionExecutionStep;
}

function deriveStatus(steps: ProductionExecutionStep[]): ProductionExecutionStatus {
  if (steps.some((s) => s.status === "fail" && s.required)) return "blocked";
  if (steps.some((s) => s.status === "warning" && s.required)) return "warning";
  const required = steps.filter((s) => s.required);
  if (required.every((s) => s.status === "pass" || s.status === "manual")) return "ready";
  return "warning";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateProductionExecutionPlan(input: {
  projectId: string;
}): Promise<ProductionExecutionPlan> {
  const { projectId } = input;

  const p = (href: string) => `/projects/${projectId}${href}`;

  // ── DB queries (parallel) ──────────────────────────────────────────────────

  const [
    project,
    deployConfig,
    backupCount,
    latestBackup,
    envNames,
    memberCount,
    domains,
    successfulDeployCount,
    stagingProject,
    serviceCount,
  ] = await Promise.all([
    db.project.findUnique({
      where:  { id: projectId },
      select: { slug: true, name: true, liveUrl: true },
    }).catch(() => null),
    db.projectDeploymentConfig.findUnique({
      where:  { projectId },
      select: {
        pm2Name: true, port: true, dbConnStatus: true, routeMode: true,
      } as Parameters<typeof db.projectDeploymentConfig.findUnique>[0]["select"],
    }).catch(() => null),
    db.projectBackup.count({ where: { projectId, status: "ready" } }).catch(() => 0),
    db.projectBackup.findFirst({
      where:   { projectId, status: "ready" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, createdAt: true },
    }).catch(() => null),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }).catch(() => []),
    db.projectMember.count({ where: { projectId } }).catch(() => 0),
    db.domain.findMany({
      where:   { projectId },
      select:  { hostname: true, isPrimary: true, status: true, sslStatus: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }).catch(() => []),
    db.deployment.count({ where: { projectId, status: "SUCCESS" } }).catch(() => 0),
    db.project.findFirst({
      where:  { slug: STAGING_SLUG },
      select: { id: true, slug: true },
    }).catch(() => null),
    db.projectService.count({ where: { projectId } }).catch(() => 0),
  ]);

  const envSet    = new Set(envNames.map((e) => e.name));
  const hasDbEnv  = DB_NAMES.some((n) => envSet.has(n));
  const dbConn    = (deployConfig as { dbConnStatus?: string | null } | null)?.dbConnStatus;
  const pm2Name   = (deployConfig as { pm2Name?: string } | null)?.pm2Name ?? "";
  const port      = (deployConfig as { port?: number } | null)?.port ?? 0;

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const domainHostname = primaryDomain?.hostname ?? LIVE_SARDAR_DOMAIN;
  const hasActiveDomain = domains.some((d) => d.status === "ACTIVE");
  const hasSsl = primaryDomain?.sslStatus === "ACTIVE";

  const backupAgeDays = latestBackup
    ? (Date.now() - new Date(latestBackup.createdAt).getTime()) / 86_400_000
    : Infinity;

  // Route preview (non-fatal)
  const routePreview = await generateProductionRouteApplyPreview({ projectId }).catch((err) => ({
    projectId,
    generatedAt: new Date().toISOString(),
    domain:       domainHostname,
    status:       "unknown" as const,
    routes:       [],
    blockers:     [err instanceof Error ? err.message : "Route preview failed"],
    warnings:     [],
  }));

  // ── Steps ──────────────────────────────────────────────────────────────────

  const steps: ProductionExecutionStep[] = [

    // ── Final gate ──────────────────────────────────────────────────────────
    step({
      id:       "gate-report",
      stage:    "final_gate",
      label:    "Final go-live gate report generated and reviewed",
      status:   "manual",
      required: true,
      message:  "Generate the final go-live gate on the Releases page. Readiness score must be acceptable.",
      linkHref: p("/releases"),
      confirmationRequired: "APPLY PRODUCTION CUTOVER",
    }),
    step({
      id:       "gate-evidence",
      stage:    "final_gate",
      label:    "All 14 gate evidence items reviewed",
      status:   "manual",
      required: true,
      message:  "All evidence checklist items in the Final Go-Live Control Room must be reviewed.",
      linkHref: p("/releases"),
    }),
    step({
      id:       "gate-blockers",
      stage:    "final_gate",
      label:    "No blocking issues in gate report",
      status:   "manual",
      required: true,
      message:  "Verify zero blockers in the Final Go-Live Control Room before proceeding.",
      linkHref: p("/releases"),
    }),

    // ── Staging proof ────────────────────────────────────────────────────────
    step({
      id:       "staging-trial",
      stage:    "staging_proof",
      label:    "Staging trial migration proof reviewed",
      status:   "manual",
      required: true,
      message:  "Complete and mark staging trial migration (MARK TRIAL COMPLETE) on Migration page.",
      linkHref: p("/migration"),
    }),
    step({
      id:       "staging-ecommerce",
      stage:    "staging_proof",
      label:    "Ecommerce test proof reviewed",
      status:   "manual",
      required: true,
      message:  "Complete and mark ecommerce proof (MARK ECOMMERCE PROOF COMPLETE) on Migration page.",
      linkHref: p("/migration"),
    }),
    step({
      id:       "staging-deployment",
      stage:    "staging_proof",
      label:    "Staging deployment proof reviewed",
      status:   stagingProject ? "pass" : "manual",
      required: true,
      message:  stagingProject
        ? `Staging project "${STAGING_SLUG}" found. Export STAGING_DEPLOYMENT_PROOF.md and mark staging ready.`
        : "Staging deployment proof not found. Generate and mark staging ready (MARK STAGING READY) on Migration page.",
      linkHref: p("/migration"),
    }),

    // ── Backup ──────────────────────────────────────────────────────────────
    step({
      id:       "backup-exists",
      stage:    "backup",
      label:    backupCount > 0 ? `${backupCount} backup(s) — latest ${Math.round(backupAgeDays * 10) / 10}d old` : "No backups",
      status:   backupCount >= 1 ? (backupAgeDays <= 3 ? "pass" : "warning") : "fail",
      required: true,
      message:  backupCount >= 1
        ? backupAgeDays <= 3
          ? `${backupCount} backup(s) — latest is recent. Create a FINAL backup immediately before cutover.`
          : `${backupCount} backup(s) — latest is ${Math.round(backupAgeDays)} days old. Create a fresh backup before cutover.`
        : "No backups. Create a backup immediately before production cutover.",
      linkHref: p("/backups"),
      warning:  "Create the final backup AFTER all checks pass and IMMEDIATELY before applying routes.",
    }),
    step({
      id:       "backup-drill",
      stage:    "backup",
      label:    "Restore drill completed",
      status:   "manual",
      required: true,
      message:  "Restore drill must be marked complete on Backups page before cutover.",
      linkHref: p("/backups"),
    }),
    step({
      id:       "backup-db-limitation",
      stage:    "backup",
      label:    "DB rollback limitation acknowledged",
      status:   "manual",
      required: true,
      message:  "App rollback does NOT rollback DB schema/data. DB rollback requires restoring from a pg_dump.",
      warning:  "Keep a pg_dump taken BEFORE any DB migration as a separate file.",
    }),

    // ── Permissions ──────────────────────────────────────────────────────────
    step({
      id:       "permissions-team",
      stage:    "permissions",
      label:    `${memberCount} team member(s) — roles reviewed`,
      status:   memberCount >= 1 ? "pass" : "warning",
      required: false,
      message:  memberCount >= 1
        ? `${memberCount} member(s). Ensure only authorized users can trigger cutover.`
        : "No team members. Assign Owner before cutover.",
      linkHref: p("/team"),
    }),
    step({
      id:       "permissions-deploy-trigger",
      stage:    "permissions",
      label:    "Deploy trigger permission required",
      status:   "manual",
      required: true,
      message:  "APPLY PRODUCTION CUTOVER requires deploy.trigger or project.edit permission.",
      warning:  "Viewer-level users cannot apply production cutover.",
    }),
    step({
      id:       "permissions-review",
      stage:    "permissions",
      label:    "Permission review on Team page",
      status:   "manual",
      required: true,
      message:  "Review team permissions on the Team page before cutover.",
      linkHref: p("/team"),
    }),

    // ── Domain ───────────────────────────────────────────────────────────────
    step({
      id:       "domain-active",
      stage:    "domain",
      label:    hasActiveDomain ? `Active domain: ${domainHostname}` : "No active domain",
      status:   hasActiveDomain ? "pass" : "warning",
      required: false,
      message:  hasActiveDomain
        ? `Domain ${domainHostname} is active.`
        : "No active domain found. Add and verify production domain.",
      linkHref: p("/domains"),
    }),
    step({
      id:       "domain-ssl",
      stage:    "domain",
      label:    hasSsl ? "SSL active" : "SSL not active",
      status:   hasSsl ? "pass" : "warning",
      required: false,
      message:  hasSsl
        ? `SSL active on ${domainHostname}.`
        : `SSL not active on ${domainHostname}. Issue SSL certificate before serving production traffic.`,
      linkHref: p("/domains"),
    }),
    step({
      id:       "domain-no-dns-change",
      stage:    "domain",
      label:    "No DNS change required by this sprint",
      status:   "pass",
      required: true,
      message:  "DNS is not changed automatically. If DNS change is required, it must be done manually before route apply.",
      warning:  "DNS propagation can take up to 48 hours. Verify DNS before applying routes.",
    }),

    // ── Routing ──────────────────────────────────────────────────────────────
    step({
      id:       "routing-preview",
      stage:    "routing",
      label:    routePreview.blockers.length === 0 ? "Route preview generated" : "Route preview has blockers",
      status:   routePreview.blockers.length === 0 ? (routePreview.warnings.length === 0 ? "pass" : "warning") : "fail",
      required: true,
      message:  routePreview.blockers.length === 0
        ? `Route preview ready: ${routePreview.routes.length} route(s) — /api/* and /*.`
        : `Route preview blockers: ${routePreview.blockers.join("; ")}`,
      linkHref: p("/publishing"),
    }),
    step({
      id:       "routing-api-split",
      stage:    "routing",
      label:    "/api/* → API service, /* → static",
      status:   "pass",
      required: true,
      message:  "Production route plan: /api/* proxied to API service, /* served as static + SPA fallback.",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "routing-nginx-test",
      stage:    "routing",
      label:    "nginx -t before apply (manual)",
      status:   "manual",
      required: true,
      message:  "Run sudo nginx -t to verify config syntax before applying any nginx changes.",
      command:  "sudo nginx -t",
      warning:  "Never reload nginx without a successful nginx -t.",
    }),
    step({
      id:       "routing-no-auto-apply",
      stage:    "routing",
      label:    "Route apply requires APPLY PRODUCTION CUTOVER confirmation",
      status:   "pass",
      required: true,
      message:  "Routes are not applied automatically. Use APPLY PRODUCTION CUTOVER confirmation.",
      confirmationRequired: "APPLY PRODUCTION CUTOVER",
    }),

    // ── Deployment ────────────────────────────────────────────────────────────
    step({
      id:       "deploy-config",
      stage:    "deployment",
      label:    "Deployment config exists",
      status:   deployConfig ? "pass" : "warning",
      required: true,
      message:  deployConfig
        ? `Deployment config: PM2 ${pm2Name}, port ${port}.`
        : "No deployment config. Set up in Publishing page.",
      linkHref: p("/publishing"),
    }),
    step({
      id:       "deploy-success",
      stage:    "deployment",
      label:    `${successfulDeployCount} successful deployment(s)`,
      status:   successfulDeployCount >= 1 ? "pass" : "fail",
      required: true,
      message:  successfulDeployCount >= 1
        ? `${successfulDeployCount} successful deployment(s) — rollback target available.`
        : "No successful deployments. Run a build first.",
      linkHref: p("/releases"),
    }),
    step({
      id:       "deploy-services",
      stage:    "deployment",
      label:    `${serviceCount} service(s) — API + static expected`,
      status:   serviceCount >= 2 ? "pass" : "warning",
      required: false,
      message:  serviceCount >= 2
        ? `${serviceCount} services configured.`
        : `Only ${serviceCount} service(s). Expected 2 (API + static frontend).`,
      linkHref: p("/publishing"),
    }),
    step({
      id:       "deploy-env",
      stage:    "deployment",
      label:    `${envSet.size} env var(s) — no placeholders`,
      status:   envSet.size >= 5 ? "pass" : "warning",
      required: true,
      message:  envSet.size >= 5
        ? `${envSet.size} env vars configured. Verify no placeholders, no localhost values.`
        : `Only ${envSet.size} env var(s) — expected more.`,
      linkHref: p("/env"),
      warning:  "Verify APP_URL points to production domain, not staging.",
    }),
    step({
      id:       "deploy-db",
      stage:    "deployment",
      label:    dbConn === "ok" || dbConn === "connected" ? "DB connection verified" : "DB connection not verified",
      status:   dbConn === "ok" || dbConn === "connected" ? "pass" : "manual",
      required: true,
      message:  dbConn === "ok" || dbConn === "connected"
        ? "Database connection verified."
        : "Verify database connection on the Database page before cutover.",
      linkHref: p("/database"),
    }),

    // ── Smoke checks ──────────────────────────────────────────────────────────
    step({
      id:       "smoke-root",
      stage:    "smoke_checks",
      label:    `Smoke: ${domainHostname}/`,
      status:   "manual",
      required: true,
      message:  "Run production smoke checks with RUN PRODUCTION SMOKE CHECKS confirmation.",
      confirmationRequired: "RUN PRODUCTION SMOKE CHECKS",
    }),
    step({
      id:       "smoke-health",
      stage:    "smoke_checks",
      label:    `Smoke: ${domainHostname}/api/healthz`,
      status:   "manual",
      required: true,
      message:  "API health endpoint must return 200 OK after deployment.",
      confirmationRequired: "RUN PRODUCTION SMOKE CHECKS",
    }),
    step({
      id:       "smoke-spa",
      stage:    "smoke_checks",
      label:    `Smoke: SPA fallback route`,
      status:   "manual",
      required: false,
      message:  "SPA fallback must return 200 (index.html), not 404.",
      confirmationRequired: "RUN PRODUCTION SMOKE CHECKS",
    }),

    // ── Rollback ──────────────────────────────────────────────────────────────
    step({
      id:       "rollback-target",
      stage:    "rollback",
      label:    successfulDeployCount >= 2 ? "Rollback target available" : "Limited rollback target",
      status:   successfulDeployCount >= 2 ? "pass" : "warning",
      required: false,
      message:  successfulDeployCount >= 2
        ? `${successfulDeployCount} successful deployments — previous release available for rollback.`
        : "Only 1 successful deployment — rollback not available until a second deploy.",
      linkHref: p("/releases"),
    }),
    step({
      id:       "rollback-plan",
      stage:    "rollback",
      label:    "Rollback plan reviewed",
      status:   "manual",
      required: true,
      message:  "Know the rollback target (previous deployment ref). Rollback requires EXECUTE PRODUCTION ROLLBACK.",
      confirmationRequired: "EXECUTE PRODUCTION ROLLBACK",
      warning:  "App rollback does NOT rollback DB schema/data.",
    }),
    step({
      id:       "rollback-nginx",
      stage:    "rollback",
      label:    "Nginx route rollback plan documented",
      status:   "manual",
      required: true,
      message:  "nginx backup (.bak) must exist before applying routes. Route rollback: cp .bak → active config → nginx -s reload.",
      command:  "sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>",
    }),

    // ── Manual ────────────────────────────────────────────────────────────────
    step({
      id:       "manual-final-backup",
      stage:    "manual",
      label:    "Final backup created immediately before cutover",
      status:   "manual",
      required: true,
      message:  "Create one last backup on the Backups page after all checks pass and just before applying routes.",
      linkHref: p("/backups"),
    }),
    step({
      id:       "manual-team-present",
      stage:    "manual",
      label:    "Team present for cutover and rollback",
      status:   "manual",
      required: true,
      message:  "Ensure Owner/Admin is available for the full duration of cutover and ready to rollback if needed.",
    }),
    step({
      id:       "manual-sign-off",
      stage:    "manual",
      label:    "Owner sign-off for production cutover",
      status:   "manual",
      required: true,
      message:  "Owner must type APPLY PRODUCTION CUTOVER to confirm production cutover execution.",
      confirmationRequired: "APPLY PRODUCTION CUTOVER",
    }),
  ];

  // ── Aggregate ──────────────────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!project)                    blockers.push("Source project not found");
  if (!deployConfig)               blockers.push("No deployment config");
  if (successfulDeployCount === 0) blockers.push("No successful deployments");
  if (backupCount === 0)           blockers.push("No backups — create before cutover");
  if (routePreview.blockers.length > 0) blockers.push(...routePreview.blockers);

  if (serviceCount < 2)            warnings.push(`Only ${serviceCount} service(s) — expected API + static`);
  if (!hasDbEnv)                   warnings.push("No DATABASE_URL env found");
  if (!hasActiveDomain)            warnings.push("No active domain configured");
  if (!hasSsl)                     warnings.push("SSL not active on primary domain");
  if (backupAgeDays > 3)           warnings.push("Latest backup is more than 3 days old — create a fresh one");
  if (!stagingProject)             warnings.push("Staging project not found — complete staging deployment proof first");

  const nextSteps = [
    "Resolve all blockers in this execution plan",
    "Generate and review Final Go-Live Gate report (Releases page)",
    "Complete staging trial, ecommerce proof, and staging deployment proof",
    "Create final backup on Backups page",
    "Preview production routes: Generate Route Preview",
    "Run production smoke checks: RUN PRODUCTION SMOKE CHECKS",
    "Run sudo nginx -t to validate nginx config",
    "With team present: enter APPLY PRODUCTION CUTOVER",
    "After cutover: run post-apply smoke checks",
    "Monitor PM2 logs and nginx error logs",
    "If anything fails: EXECUTE PRODUCTION ROLLBACK",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status:       deriveStatus(steps),
    domain:       domainHostname,
    steps,
    routePreview,
    blockers,
    warnings,
    nextSteps,
  };
}
