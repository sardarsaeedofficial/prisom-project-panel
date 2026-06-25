/**
 * lib/monitoring/post-cutover-monitoring-export.ts
 *
 * Sprint 66: Export POST_CUTOVER_MONITORING_REPORT.md.
 *
 * Safety: no secrets, no env values.
 */

import type { PostCutoverMonitoringReport } from "./post-cutover-monitoring-types";

const LIVE_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: string): string {
  if (status === "pass" || status === "healthy" || status === "passed") return "✅";
  if (status === "warning")                                             return "⚠️";
  if (status === "fail" || status === "failed" || status === "critical") return "❌";
  if (status === "incident")                                            return "🚨";
  if (status === "manual")                                              return "🔲";
  return "⏳";
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toUTCString(); } catch { return iso; }
}

function severityBadge(s: string): string {
  if (s === "critical") return "🔴 CRITICAL";
  if (s === "high")     return "🟠 HIGH";
  if (s === "medium")   return "🟡 MEDIUM";
  if (s === "low")      return "🔵 LOW";
  return "🟢 NONE";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function exportPostCutoverMonitoringReport(
  report:      PostCutoverMonitoringReport,
  projectName: string,
): string {
  const lines: string[] = [];
  const domain = LIVE_DOMAIN;

  lines.push(`# POST_CUTOVER_MONITORING_REPORT.md`);
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Generated:** ${fmtDate(report.generatedAt)}`);
  lines.push(`**Status:** ${statusIcon(report.status)} ${report.status.toUpperCase()}`);
  lines.push(`**Incident Severity:** ${severityBadge(report.incidentSeverity)}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("> ⚠️ SAFETY NOTICE");
  lines.push("> - This report does NOT execute rollback.");
  lines.push("> - This report does NOT restart PM2 or reload nginx.");
  lines.push("> - This report does NOT change DNS or run DB migrations.");
  lines.push("> - All rollback actions require manual operator execution.");
  lines.push("> - Doorsteps/LocalShop (/home/prisom/prisom-panel) is untouched.");
  lines.push("");

  // ── Summary ────────────────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total checks | ${report.summary.total} |`);
  lines.push(`| Passed       | ${report.summary.passed} |`);
  lines.push(`| Warnings     | ${report.summary.warnings} |`);
  lines.push(`| Failed       | ${report.summary.failed} |`);
  lines.push(`| Manual       | ${report.summary.manual} |`);
  lines.push("");

  // ── Blockers ──────────────────────────────────────────────────────────────
  if (report.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push("");
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (report.warnings.length > 0) {
    lines.push("## ⚠️ Warnings");
    lines.push("");
    report.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // ── Health checks ─────────────────────────────────────────────────────────
  const liveChecks = report.checks.filter((c) =>
    ["frontend", "api", "routing"].includes(c.category) && c.url,
  );
  if (liveChecks.length > 0) {
    lines.push("## Production Health Checks");
    lines.push("");
    lines.push("| Check | URL | Status | HTTP | Notes |");
    lines.push("|-------|-----|--------|------|-------|");
    liveChecks.forEach((c) => {
      lines.push(
        `| ${c.label} | \`${c.url ?? "—"}\` | ${statusIcon(c.status)} ${c.status} | ${c.httpStatus ?? "—"} | ${c.message} |`,
      );
    });
    lines.push("");
  } else {
    lines.push("## Production Health Checks");
    lines.push("");
    lines.push("_Not run yet — use RUN PRODUCTION HEALTH CHECKS confirmation._");
    lines.push("");
    lines.push("| Check | URL |");
    lines.push("|-------|-----|");
    lines.push(`| Production root     | \`https://${domain}/\` |`);
    lines.push(`| API health endpoint | \`https://${domain}/api/healthz\` |`);
    lines.push(`| SPA fallback route  | \`https://${domain}/non-existent-spa-route\` |`);
    lines.push("");
  }

  // ── Ecommerce checklist ───────────────────────────────────────────────────
  lines.push("## Ecommerce Manual Health Checklist");
  lines.push("");
  const ecomChecks = report.checks.filter((c) => c.category === "ecommerce");
  if (ecomChecks.length > 0) {
    ecomChecks.forEach((c) => {
      lines.push(`- ${statusIcon(c.status)} ${c.label}`);
      if (c.message) lines.push(`  ${c.message}`);
    });
  } else {
    [
      "Storefront loads for customers",
      "Product list loads",
      "Product detail loads",
      "Cart page loads",
      "Checkout page accessible",
      "Admin login works",
      "Orders page works",
      "Stripe dashboard checked for errors",
      "Webhook delivery reviewed",
      "Email provider dashboard checked",
      "Cloudinary media loads",
      "No customer complaints reported",
    ].forEach((item) => lines.push(`- [ ] ${item}`));
  }
  lines.push("");

  // ── Rollback recommendation ───────────────────────────────────────────────
  lines.push("## Rollback Recommendation");
  lines.push("");
  lines.push(`**Consider rollback:** ${report.rollbackRecommendation.shouldConsiderRollback ? "YES" : "NO"}`);
  lines.push(`**Severity:** ${severityBadge(report.rollbackRecommendation.severity)}`);
  lines.push("");
  lines.push(report.rollbackRecommendation.reason);
  lines.push("");
  lines.push("### Rollback Checklist");
  lines.push("");
  lines.push("> ⚠️ App rollback does NOT rollback DB schema/data. Requires EXECUTE PRODUCTION ROLLBACK confirmation.");
  lines.push("");
  report.rollbackRecommendation.checklist.forEach((item) => {
    lines.push(`- [ ] ${item}`);
  });
  lines.push("");

  // ── Incident response checklist ───────────────────────────────────────────
  lines.push("## Incident Response Checklist");
  lines.push("");
  [
    "Incident severity confirmed",
    "Logs reviewed (PM2 + nginx)",
    "Failed checks identified",
    "Customer impact assessed",
    "Owner assigned",
    "Rollback criteria reviewed",
    "Backup location confirmed",
    "Communication drafted",
    "Post-fix smoke checks planned",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // ── Operator commands ─────────────────────────────────────────────────────
  lines.push("## Operator Commands");
  lines.push("");
  lines.push("> Documentation only — do NOT execute automatically.");
  lines.push("");
  lines.push("```bash");
  lines.push(`# Live health checks`);
  lines.push(`curl -I https://${domain}/`);
  lines.push(`curl -I https://${domain}/api/healthz`);
  lines.push(`curl -I https://${domain}/non-existent-spa-route`);
  lines.push(`pm2 status`);
  lines.push("");
  lines.push(`# Log review`);
  lines.push(`pm2 logs --lines 100`);
  lines.push(`sudo tail -f /var/log/nginx/error.log`);
  lines.push("```");
  lines.push("");

  // ── Key URLs ─────────────────────────────────────────────────────────────
  lines.push("## Key URLs");
  lines.push("");
  lines.push("| Resource | URL |");
  lines.push("|----------|-----|");
  lines.push(`| Production storefront | \`https://${domain}/\` |`);
  lines.push(`| API health | \`https://${domain}/api/healthz\` |`);
  lines.push(`| Stripe dashboard | \`https://dashboard.stripe.com\` |`);
  lines.push("");

  // ── Debug links ───────────────────────────────────────────────────────────
  lines.push("## Debug Links (Prisom Panel)");
  lines.push("");
  lines.push("| Section | Path |`");
  lines.push("|---------|------|");
  lines.push(`| Monitoring Control Room | /projects/{id}/monitoring |`);
  lines.push(`| Logs                    | /projects/{id}/logs |`);
  lines.push(`| Releases                | /projects/{id}/releases |`);
  lines.push(`| Backups                 | /projects/{id}/backups |`);
  lines.push(`| Domains                 | /projects/{id}/domains |`);
  lines.push(`| Operations              | /projects/{id}/operations |`);
  lines.push("");

  // ── Next steps ────────────────────────────────────────────────────────────
  if (report.nextSteps.length > 0) {
    lines.push("## Next Steps");
    lines.push("");
    report.nextSteps.forEach((ns, i) => lines.push(`${i + 1}. ${ns}`));
    lines.push("");
  }

  lines.push("---");
  lines.push("*Exported from Prisom Project Panel — Sprint 66 Post-Cutover Monitoring*");
  lines.push("*This document does not authorize or automate any production mutation.*");

  return lines.join("\n");
}
