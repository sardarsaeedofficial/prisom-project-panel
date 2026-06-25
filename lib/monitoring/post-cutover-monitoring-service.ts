/**
 * lib/monitoring/post-cutover-monitoring-service.ts
 *
 * Sprint 66: Generates the post-cutover monitoring report.
 *
 * Safety: no secrets, no production mutation, read-only.
 */

import { db }                         from "@/lib/db";
import { runProductionHealthChecks }  from "./production-health-check-runner";
import { classifyPostCutoverIncident } from "./incident-classifier";
import { generateRollbackRecommendation } from "./rollback-decision-helper";
import type {
  MonitoringCheck,
  PostCutoverMonitoringReport,
} from "./post-cutover-monitoring-types";

const LIVE_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

// ── Helpers ───────────────────────────────────────────────────────────────────

function p(projectId: string, href: string) {
  return `/projects/${projectId}${href}`;
}

// ── Static checklist checks ───────────────────────────────────────────────────

function buildStaticChecks(projectId: string): MonitoringCheck[] {
  return [
    // ── Domain / SSL ────────────────────────────────────────────────────────
    {
      id:       "ssl-reminder",
      category: "ssl",
      label:    "SSL certificate active",
      status:   "manual",
      required: true,
      message:  "Verify SSL is active on Domains page. Check https:// loads without warning.",
      linkHref: p(projectId, "/domains"),
    },

    // ── Ecommerce ────────────────────────────────────────────────────────────
    {
      id:       "ecommerce-storefront",
      category: "ecommerce",
      label:    "Storefront loads for customers",
      status:   "manual",
      required: true,
      message:  "Open storefront in a private browser window and verify it loads correctly.",
    },
    {
      id:       "ecommerce-products",
      category: "ecommerce",
      label:    "Product pages load",
      status:   "manual",
      required: true,
      message:  "Browse to /products and open individual product pages.",
    },
    {
      id:       "ecommerce-checkout",
      category: "ecommerce",
      label:    "Checkout page accessible",
      status:   "manual",
      required: true,
      message:  "Navigate to /checkout — verify it loads without error. Do not place real orders.",
    },
    {
      id:       "ecommerce-admin",
      category: "ecommerce",
      label:    "Admin panel accessible",
      status:   "manual",
      required: true,
      message:  "Log into admin and verify orders/products pages load.",
    },
    {
      id:       "ecommerce-stripe",
      category: "ecommerce",
      label:    "Stripe dashboard checked for errors",
      status:   "manual",
      required: false,
      message:  "Check Stripe dashboard for webhook errors or failed events since cutover.",
      url:      "https://dashboard.stripe.com",
    },

    // ── External services ──────────────────────────────────────────────────
    {
      id:       "ext-email",
      category: "external_services",
      label:    "Email provider dashboard reviewed",
      status:   "manual",
      required: false,
      message:  "Check email provider for delivery failures. Verify transactional emails are being sent.",
    },
    {
      id:       "ext-cloudinary",
      category: "external_services",
      label:    "Cloudinary media loads",
      status:   "manual",
      required: false,
      message:  "Spot-check product images. Verify Cloudinary assets are accessible.",
    },

    // ── Logs ──────────────────────────────────────────────────────────────
    {
      id:       "logs-errors",
      category: "logs",
      label:    "No new critical errors in PM2 logs",
      status:   "manual",
      required: true,
      message:  "Review PM2 logs for errors since cutover: pm2 logs --lines 100",
      command:  "pm2 logs --lines 100",
      linkHref: p(projectId, "/logs"),
    },
    {
      id:       "logs-nginx",
      category: "logs",
      label:    "No errors in nginx error log",
      status:   "manual",
      required: true,
      message:  "Review nginx error log: sudo tail -f /var/log/nginx/error.log",
      command:  "sudo tail -f /var/log/nginx/error.log",
      linkHref: p(projectId, "/logs"),
    },

    // ── Rollback ──────────────────────────────────────────────────────────
    {
      id:       "rollback-target",
      category: "rollback",
      label:    "Previous release identified for rollback",
      status:   "manual",
      required: true,
      message:  "Know the previous deployment target in case rollback is needed.",
      linkHref: p(projectId, "/releases"),
    },
    {
      id:       "rollback-backup",
      category: "rollback",
      label:    "Backup confirmed available",
      status:   "manual",
      required: true,
      message:  "Confirm pre-cutover backup exists on Backups page.",
      linkHref: p(projectId, "/backups"),
    },

    // ── Performance ────────────────────────────────────────────────────────
    {
      id:       "perf-response",
      category: "performance",
      label:    "Response times acceptable",
      status:   "manual",
      required: false,
      message:  "Check page load times. Expected: < 2s for static pages, < 1s for API health.",
    },

    // ── Manual ────────────────────────────────────────────────────────────
    {
      id:       "manual-customer",
      category: "manual",
      label:    "No customer complaints reported",
      status:   "manual",
      required: false,
      message:  "Monitor support channels for the first 30 minutes after cutover.",
    },
    {
      id:       "manual-team",
      category: "manual",
      label:    "Team notified of successful cutover",
      status:   "manual",
      required: false,
      message:  "Notify relevant team members that cutover is complete and being monitored.",
    },
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generatePostCutoverMonitoringReport(input: {
  projectId:        string;
  includeLiveChecks?: boolean;
}): Promise<PostCutoverMonitoringReport> {
  const { projectId, includeLiveChecks = false } = input;

  // ── DB queries ────────────────────────────────────────────────────────────
  const [backupCount, deploymentCount, domains] = await Promise.all([
    db.projectBackup.count({ where: { projectId, status: "ready" } }).catch(() => 0),
    db.deployment.count({ where: { projectId, status: "SUCCESS" } }).catch(() => 0),
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }).catch(() => []),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const domain = primaryDomain?.hostname ?? LIVE_DOMAIN;
  const sslActive = primaryDomain?.sslStatus === "ACTIVE";

  // ── Static checks ─────────────────────────────────────────────────────────
  const staticChecks = buildStaticChecks(projectId);

  // ── Update SSL status from DB ─────────────────────────────────────────────
  const sslCheck = staticChecks.find((c) => c.id === "ssl-reminder");
  if (sslCheck) {
    sslCheck.status = sslActive ? "pass" : "warning";
    sslCheck.message = sslActive
      ? `SSL active on ${domain}.`
      : `SSL not active on ${domain}. Check Domains page.`;
  }

  // ── Update backup/rollback status from DB ─────────────────────────────────
  const backupCheck = staticChecks.find((c) => c.id === "rollback-backup");
  if (backupCheck) {
    backupCheck.status  = backupCount > 0 ? "pass" : "fail";
    backupCheck.message = backupCount > 0
      ? `${backupCount} backup(s) available.`
      : "No backups found. Create a backup before any rollback attempt.";
  }

  const rollbackCheck = staticChecks.find((c) => c.id === "rollback-target");
  if (rollbackCheck) {
    rollbackCheck.status  = deploymentCount >= 2 ? "pass" : "warning";
    rollbackCheck.message = deploymentCount >= 2
      ? `${deploymentCount} deployments — previous release available for rollback.`
      : "Only 1 deployment — no previous release target for rollback.";
  }

  // ── Live checks ───────────────────────────────────────────────────────────
  let liveChecks: MonitoringCheck[] = [];
  if (includeLiveChecks) {
    liveChecks = await runProductionHealthChecks({ projectId, domain }).catch(
      () => [],
    );
  }

  const allChecks = [...liveChecks, ...staticChecks];

  // ── Classify ──────────────────────────────────────────────────────────────
  const classification = classifyPostCutoverIncident({ checks: allChecks });

  // ── Rollback recommendation ───────────────────────────────────────────────
  const rollbackRecommendation = generateRollbackRecommendation({
    checks:   allChecks,
    severity: classification.severity,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = {
    total:    allChecks.length,
    passed:   allChecks.filter((c) => c.status === "pass").length,
    warnings: allChecks.filter((c) => c.status === "warning").length,
    failed:   allChecks.filter((c) => c.status === "fail").length,
    manual:   allChecks.filter((c) => c.status === "manual").length,
    pending:  allChecks.filter((c) => c.status === "pending").length,
  };

  return {
    projectId,
    generatedAt:          new Date().toISOString(),
    status:               classification.status,
    incidentSeverity:     classification.severity,
    checks:               allChecks,
    blockers:             classification.blockers,
    warnings:             classification.warnings,
    nextSteps:            classification.nextSteps,
    rollbackRecommendation,
    summary,
  };
}
