/**
 * lib/cutover/production-execution-export.ts
 *
 * Sprint 65: Export PRODUCTION_CUTOVER_EXECUTION_PLAN.md.
 *
 * Safety: no secrets, no env values.
 */

import type {
  ProductionExecutionPlan,
  ProductionExecutionSmokeReport,
} from "./production-execution-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: string): string {
  if (status === "pass" || status === "passed") return "✅";
  if (status === "warning")                     return "⚠️";
  if (status === "fail" || status === "failed")  return "❌";
  if (status === "manual")                       return "🔲";
  return "⏳";
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toUTCString(); } catch { return iso; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function exportProductionExecutionPlan(
  plan:        ProductionExecutionPlan,
  projectName: string,
  smokeReport?: ProductionExecutionSmokeReport,
): string {
  const lines: string[] = [];

  lines.push(`# PRODUCTION_CUTOVER_EXECUTION_PLAN.md`);
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Generated:** ${fmtDate(plan.generatedAt)}`);
  lines.push(`**Domain:** ${plan.domain}`);
  lines.push(`**Execution Status:** ${plan.status.toUpperCase()}`);
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(`> ⚠️ SAFETY NOTICE`);
  lines.push(`> - This document does NOT change DNS.`);
  lines.push(`> - This document does NOT run DB migrations.`);
  lines.push(`> - This document does NOT restart PM2 automatically.`);
  lines.push(`> - Production routes are NOT applied automatically.`);
  lines.push(`> - Doorsteps/LocalShop (/home/prisom/prisom-panel) is untouched.`);
  lines.push(`> - APPLY PRODUCTION CUTOVER confirmation is required before any route apply.`);
  lines.push(`> - EXECUTE PRODUCTION ROLLBACK confirmation is required for rollback.`);
  lines.push("");

  // ── Blockers ────────────────────────────────────────────────────────────────
  if (plan.blockers.length > 0) {
    lines.push(`## ❌ Blockers — Must Resolve Before Cutover`);
    lines.push("");
    plan.blockers.forEach((b) => lines.push(`- ❌ ${b}`));
    lines.push("");
  }

  // ── Warnings ────────────────────────────────────────────────────────────────
  if (plan.warnings.length > 0) {
    lines.push(`## ⚠️ Warnings`);
    lines.push("");
    plan.warnings.forEach((w) => lines.push(`- ⚠️ ${w}`));
    lines.push("");
  }

  // ── Route preview ────────────────────────────────────────────────────────────
  lines.push(`## Production Route Preview`);
  lines.push(`**Domain:** ${plan.routePreview.domain}`);
  lines.push(`**Status:** ${plan.routePreview.status}`);
  lines.push("");
  lines.push(`| Path | Target | Type | Notes |`);
  lines.push(`|------|--------|------|-------|`);
  plan.routePreview.routes.forEach((r) => {
    lines.push(`| \`${r.path}\` | \`${r.target}\` | ${r.type} | ${r.message} |`);
  });
  lines.push("");
  if (plan.routePreview.nginxPreview && plan.routePreview.nginxPreview.length > 0) {
    lines.push(`### Nginx Config Preview (display only — never written to disk)`);
    lines.push("```nginx");
    plan.routePreview.nginxPreview.forEach((l) => lines.push(l));
    lines.push("```");
    lines.push("");
  }

  // ── Pre-apply checklist ──────────────────────────────────────────────────────
  const stages = [
    "final_gate", "staging_proof", "backup", "permissions",
    "domain", "routing", "deployment", "smoke_checks", "rollback", "manual",
  ] as const;

  const stageLabels: Record<string, string> = {
    final_gate:    "Final Gate Review",
    staging_proof: "Staging Proof",
    backup:        "Backup",
    permissions:   "Permissions",
    domain:        "Domain",
    routing:       "Routing",
    deployment:    "Deployment",
    smoke_checks:  "Smoke Checks",
    rollback:      "Rollback Plan",
    manual:        "Manual Sign-offs",
  };

  lines.push(`## Pre-Apply Checklist`);
  lines.push("");
  for (const stageId of stages) {
    const stageSteps = plan.steps.filter((s) => s.stage === stageId);
    if (stageSteps.length === 0) continue;
    lines.push(`### ${stageLabels[stageId] ?? stageId}`);
    lines.push("");
    stageSteps.forEach((s) => {
      const icon = statusIcon(s.status);
      const req  = s.required ? " *(required)*" : "";
      lines.push(`- ${icon} **${s.label}**${req}`);
      lines.push(`  ${s.message}`);
      if (s.command)  lines.push(`  \`${s.command}\``);
      if (s.warning)  lines.push(`  ⚠️ ${s.warning}`);
      if (s.linkHref) lines.push(`  🔗 ${s.linkHref}`);
      if (s.confirmationRequired) {
        lines.push(`  🔐 Requires confirmation: \`${s.confirmationRequired}\``);
      }
    });
    lines.push("");
  }

  // ── Smoke check results ──────────────────────────────────────────────────────
  if (smokeReport) {
    lines.push(`## Smoke Check Results`);
    lines.push(`**Run at:** ${fmtDate(smokeReport.generatedAt)}`);
    lines.push(`**Overall:** ${smokeReport.status.toUpperCase()}`);
    lines.push("");
    lines.push(`| Check | URL | Status | HTTP | Notes |`);
    lines.push(`|-------|-----|--------|------|-------|`);
    smokeReport.results.forEach((r) => {
      lines.push(`| ${r.label} | \`${r.url}\` | ${statusIcon(r.status)} ${r.status} | ${r.httpStatus ?? "—"} | ${r.message} |`);
    });
    lines.push("");
  } else {
    lines.push(`## Smoke Check Results`);
    lines.push(`_Not run yet. Use RUN PRODUCTION SMOKE CHECKS confirmation._`);
    lines.push("");
    lines.push(`| Check | URL |`);
    lines.push(`|-------|-----|`);
    lines.push(`| Production root       | \`https://${plan.domain}/\` |`);
    lines.push(`| API health endpoint   | \`https://${plan.domain}/api/healthz\` |`);
    lines.push(`| SPA fallback route    | \`https://${plan.domain}/non-existent-spa-route\` |`);
    lines.push("");
  }

  // ── Rollback checklist ──────────────────────────────────────────────────────
  lines.push(`## Rollback Checklist`);
  lines.push("");
  lines.push(`> ⚠️ App rollback does NOT rollback DB schema/data.`);
  lines.push(`> Requires \`EXECUTE PRODUCTION ROLLBACK\` confirmation.`);
  lines.push("");
  lines.push(`- [ ] Identify previous successful deployment ref`);
  lines.push(`- [ ] Nginx backup (.bak) was created before applying routes`);
  lines.push(`- [ ] Rollback nginx: \`sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>\``);
  lines.push(`- [ ] Validate nginx: \`sudo nginx -t\``);
  lines.push(`- [ ] Reload nginx: \`sudo nginx -s reload\``);
  lines.push(`- [ ] Restart previous PM2 release if needed`);
  lines.push(`- [ ] Verify: \`curl -I https://${plan.domain}/\``);
  lines.push(`- [ ] Verify: \`curl -I https://${plan.domain}/api/healthz\``);
  lines.push(`- [ ] DB rollback requires pg_dump restore (manual — coordinate DBA)`);
  lines.push(`- [ ] Notify team of rollback status`);
  lines.push("");

  // ── Manual operator commands ─────────────────────────────────────────────────
  lines.push(`## Manual Operator Commands`);
  lines.push("");
  lines.push(`> These commands are for documentation only. Do NOT execute them automatically.`);
  lines.push("");
  lines.push(`### Pre-Cutover Checks`);
  lines.push("```bash");
  lines.push(`# Verify live Sardar production is healthy before cutover`);
  lines.push(`curl -I https://${plan.domain}/`);
  lines.push(`curl -I https://${plan.domain}/api/healthz`);
  lines.push(`pm2 status`);
  lines.push("```");
  lines.push("");
  lines.push(`### nginx Validation and Reload (only after full sign-off)`);
  lines.push("```bash");
  lines.push(`# Backup existing config first`);
  lines.push(`sudo cp /etc/nginx/sites-available/<project> /etc/nginx/sites-available/<project>.bak`);
  lines.push(`# Test config syntax (always before reload)`);
  lines.push(`sudo nginx -t`);
  lines.push(`# Reload only after nginx -t passes and with operator approval`);
  lines.push(`sudo nginx -s reload`);
  lines.push("```");
  lines.push("");
  lines.push(`### Post-Cutover Verification`);
  lines.push("```bash");
  lines.push(`curl -I https://${plan.domain}/`);
  lines.push(`curl -I https://${plan.domain}/api/healthz`);
  lines.push(`curl -I https://${plan.domain}/non-existent-spa-route`);
  lines.push(`pm2 logs --lines 50`);
  lines.push(`sudo tail -f /var/log/nginx/error.log`);
  lines.push("```");
  lines.push("");

  // ── Audit expectations ─────────────────────────────────────────────────────
  lines.push(`## Audit Expectations`);
  lines.push("");
  lines.push(`All production execution actions are audit-logged under category \`publishing\``);
  lines.push(`with events:`);
  lines.push("");
  lines.push(`- \`production_execution.plan_generated\``);
  lines.push(`- \`production_execution.route_preview_generated\``);
  lines.push(`- \`production_execution.smoke_checks_started\``);
  lines.push(`- \`production_execution.smoke_checks_passed\` / \`.smoke_checks_failed\``);
  lines.push(`- \`production_execution.cutover_apply_requested\``);
  lines.push(`- \`production_execution.rollback_requested\``);
  lines.push(`- \`production_execution.plan_exported\``);
  lines.push("");

  // ── Next steps ─────────────────────────────────────────────────────────────
  if (plan.nextSteps.length > 0) {
    lines.push(`## Next Steps`);
    lines.push("");
    plan.nextSteps.forEach((ns, i) => lines.push(`${i + 1}. ${ns}`));
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`*Exported from Prisom Project Panel — Sprint 65 Production Cutover Execution Guard*`);
  lines.push(`*This document does not authorize or automate any production mutation.*`);

  return lines.join("\n");
}
