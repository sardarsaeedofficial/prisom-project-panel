/**
 * lib/monitoring/incident-classifier.ts
 *
 * Sprint 66: Classify post-cutover incident severity from monitoring checks.
 */

import type {
  MonitoringCheck,
  PostCutoverStatus,
  IncidentSeverity,
} from "./post-cutover-monitoring-types";

// ── Critical-fail categories ───────────────────────────────────────────────────

const CRITICAL_IDS = new Set([
  "health-frontend-root",
  "health-api-healthz",
]);

const CRITICAL_CATEGORIES = new Set<MonitoringCheck["category"]>([
  "ssl", "routing",
]);

const HIGH_IDS = new Set([
  "health-api-products",
]);

// ── Main ──────────────────────────────────────────────────────────────────────

export function classifyPostCutoverIncident(input: {
  checks:   MonitoringCheck[];
  logText?: string;
}): {
  status:     PostCutoverStatus;
  severity:   IncidentSeverity;
  blockers:   string[];
  warnings:   string[];
  nextSteps:  string[];
} {
  const { checks } = input;

  const fails    = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warning");

  const blockers: string[] = [];
  const warnMsgs: string[] = [];

  let severity: IncidentSeverity = "none" as IncidentSeverity;

  // ── Critical checks ───────────────────────────────────────────────────────
  for (const c of fails) {
    if (CRITICAL_IDS.has(c.id) || CRITICAL_CATEGORIES.has(c.category)) {
      blockers.push(`CRITICAL: ${c.label} — ${c.message}`);
      severity = "critical";
    } else if (HIGH_IDS.has(c.id)) {
      blockers.push(`HIGH: ${c.label} — ${c.message}`);
      if (severity !== "critical") severity = "high";
    } else if (c.required) {
      blockers.push(`${c.label} — ${c.message}`);
      if (severity === "none" || severity === "low") severity = "medium";
    }
  }

  // ── Database/ecommerce ────────────────────────────────────────────────────
  const dbFail = fails.find((c) => c.category === "database");
  if (dbFail) {
    blockers.push(`Database unreachable — ${dbFail.message}`);
    severity = "critical";
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  for (const c of warnings) {
    warnMsgs.push(`${c.label} — ${c.message}`);
    if (severity === "none") severity = "low";
  }

  const ecommercePending = checks.filter((c) =>
    c.category === "ecommerce" && c.status === "pending",
  );
  if (ecommercePending.length > 0) {
    warnMsgs.push(`${ecommercePending.length} ecommerce manual check(s) pending`);
    if (severity === "none") severity = "low";
  }

  const externalWarnings = warnings.filter((c) => c.category === "external_services");
  if (externalWarnings.length > 0) {
    warnMsgs.push("External service warnings — review Stripe/email/Cloudinary dashboards");
    if (severity === "none") severity = "medium";
  }

  // ── Status ────────────────────────────────────────────────────────────────
  const status: PostCutoverStatus =
    severity === "critical" ? "critical" :
    severity === "high"     ? "incident" :
    severity === "medium"   ? "warning"  :
    severity === "low"      ? "warning"  :
    blockers.length > 0     ? "incident" :
    "healthy";

  // ── Next steps ────────────────────────────────────────────────────────────
  const nextSteps: string[] = [];

  if (severity === "critical") {
    nextSteps.push("Immediately review nginx and PM2 logs for root cause");
    nextSteps.push("Check if PM2 process is running: pm2 status");
    nextSteps.push("Review nginx error log: sudo tail -f /var/log/nginx/error.log");
    nextSteps.push("Consider rollback if root or API is down after 5 minutes");
  } else if (severity === "high") {
    nextSteps.push("Check application logs for 5xx errors");
    nextSteps.push("Verify API endpoints and DB connection");
    nextSteps.push("Assess customer impact");
  } else if (severity === "medium") {
    nextSteps.push("Review ecommerce manual checks");
    nextSteps.push("Verify external service dashboards (Stripe, email, Cloudinary)");
  } else if (severity === "low") {
    nextSteps.push("Complete manual ecommerce health checklist");
    nextSteps.push("Monitor for any new error patterns over the next 30 minutes");
  } else {
    nextSteps.push("Continue monitoring — run health checks again in 10–15 minutes");
    nextSteps.push("Complete ecommerce manual checklist if not done");
  }

  nextSteps.push("Export POST_CUTOVER_MONITORING_REPORT.md for the record");

  return { status, severity, blockers, warnings: warnMsgs, nextSteps };
}
