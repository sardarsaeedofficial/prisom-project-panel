/**
 * lib/cutover/production-cutover-export.ts
 *
 * Sprint 55: Export production cutover plan as PRODUCTION_CUTOVER_PLAN.md.
 *
 * Safety rules:
 *  - no secret values included
 *  - plain Markdown only
 */

import type {
  ProductionCutoverPlan,
  ProductionCutoverSmokeReport,
  RollbackReadiness,
} from "./production-cutover-types";

const SARDAR_PROD_DOMAIN  = "sardar-security-project.doorstepmanchester.uk";
const SARDAR_WEBHOOK      = `https://${SARDAR_PROD_DOMAIN}/api/webhooks/stripe`;
const SARDAR_STAGING_HOOK = "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";

// ── Status icons ──────────────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "🔴";
    case "manual":  return "☐";
    case "pending": return "⏳";
    default:        return "ℹ️";
  }
}

function overallIcon(status: string): string {
  switch (status) {
    case "ready":       return "✅";
    case "warning":     return "⚠️";
    case "blocked":     return "🔴";
    case "complete":    return "✅";
    case "failed":      return "🔴";
    case "in_progress": return "⏳";
    default:            return "⏳";
  }
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildSummary(plan: ProductionCutoverPlan, projectName: string): string {
  const lines: string[] = [];
  lines.push(`# PRODUCTION_CUTOVER_PLAN — ${projectName}`);
  lines.push(``);
  lines.push(`> Generated: ${new Date(plan.generatedAt).toUTCString()}`);
  lines.push(``);
  lines.push(`**Overall Status:** ${overallIcon(plan.status)} ${plan.status.toUpperCase()}`);
  lines.push(``);

  const totalSteps = plan.stages.reduce((n, s) => n + s.steps.length, 0);
  const passedSteps = plan.stages.reduce(
    (n, s) => n + s.steps.filter((step) => step.status === "pass").length, 0,
  );
  const blockerSteps = plan.stages.reduce(
    (n, s) => n + s.steps.filter((step) => step.status === "fail" && step.required).length, 0,
  );
  const manualSteps = plan.stages.reduce(
    (n, s) => n + s.steps.filter((step) => step.status === "manual").length, 0,
  );

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total checks | ${totalSteps} |`);
  lines.push(`| Passed | ${passedSteps} |`);
  lines.push(`| Blockers | ${blockerSteps} |`);
  lines.push(`| Manual steps | ${manualSteps} |`);
  lines.push(``);

  return lines.join("\n");
}

function buildBlockerSection(plan: ProductionCutoverPlan): string {
  if (plan.blockers.length === 0) return "";
  const lines = [`## 🔴 Blockers\n`];
  lines.push(`> Resolve all blockers before starting production cutover.\n`);
  plan.blockers.slice(0, 10).forEach((b) => lines.push(`- ${b}`));
  lines.push(``);
  return lines.join("\n");
}

function buildWarningSection(plan: ProductionCutoverPlan): string {
  if (plan.warnings.length === 0) return "";
  const lines = [`## ⚠️ Warnings\n`];
  plan.warnings.slice(0, 10).forEach((w) => lines.push(`- ${w}`));
  lines.push(``);
  return lines.join("\n");
}

function buildNextStepsSection(plan: ProductionCutoverPlan): string {
  if (plan.nextSteps.length === 0) return "";
  const lines = [`## Next Steps\n`];
  plan.nextSteps.forEach((ns) => lines.push(`1. ${ns}`));
  lines.push(``);
  return lines.join("\n");
}

function buildStagesSection(plan: ProductionCutoverPlan): string {
  const lines: string[] = [`## Stage Checklist\n`];

  for (const stage of plan.stages) {
    lines.push(`### ${overallIcon(stage.status)} ${stage.title}`);
    lines.push(``);
    for (const step of stage.steps) {
      const icon = statusIcon(step.status);
      const req  = step.required ? "" : " *(optional)*";
      lines.push(`- [${step.status === "pass" ? "x" : " "}] ${icon} **${step.title}**${req}`);
      lines.push(`  ${step.description}`);
      if (step.command) {
        lines.push(`  \`\`\`bash`);
        lines.push(`  ${step.command}`);
        lines.push(`  \`\`\``);
      }
      if (step.evidence?.length) {
        step.evidence.forEach((e) => lines.push(`  - ${e}`));
      }
      if (step.warning) {
        lines.push(`  > ⚠️  ${step.warning}`);
      }
      if (step.confirmationRequired) {
        lines.push(`  > Requires confirmation: \`${step.confirmationRequired}\``);
      }
      if (step.linkHref) {
        lines.push(`  > See: Panel → ${step.linkHref}`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function buildSmokeCheckSection(): string {
  const lines: string[] = [`## Smoke Check URLs\n`];
  lines.push(`> Run HTTP GET/HEAD checks only. No Stripe payloads. No real orders.\n`);
  lines.push(`| URL | Expected |`);
  lines.push(`|-----|----------|`);
  lines.push(`| https://${SARDAR_PROD_DOMAIN}/ | 200 OK |`);
  lines.push(`| https://${SARDAR_PROD_DOMAIN}/api/healthz | 200 OK |`);
  lines.push(`| ${SARDAR_WEBHOOK} | HEAD → 200/405 (reachable) |`);
  lines.push(``);
  lines.push(`**Manual smoke check commands:**`);
  lines.push(`\`\`\`bash`);
  lines.push(`curl -I https://${SARDAR_PROD_DOMAIN}/`);
  lines.push(`curl -I https://${SARDAR_PROD_DOMAIN}/api/healthz`);
  lines.push(`curl -I ${SARDAR_WEBHOOK}`);
  lines.push(`\`\`\``);
  lines.push(``);
  return lines.join("\n");
}

function buildStripeWebhookSection(): string {
  const lines: string[] = [`## Stripe Webhook Configuration\n`];
  lines.push(`> Configure Stripe webhooks manually in the Stripe Dashboard.\n`);
  lines.push(`> Never create Stripe webhooks automatically.\n`);
  lines.push(``);
  lines.push(`| Environment | Endpoint URL |`);
  lines.push(`|-------------|-------------|`);
  lines.push(`| Production | \`${SARDAR_WEBHOOK}\` |`);
  lines.push(`| Staging | \`${SARDAR_STAGING_HOOK}\` |`);
  lines.push(``);
  lines.push(`**Steps:**`);
  lines.push(`1. Go to Stripe Dashboard → Developers → Webhooks`);
  lines.push(`2. Add endpoint: \`${SARDAR_WEBHOOK}\``);
  lines.push(`3. Select events: \`payment_intent.succeeded\`, \`checkout.session.completed\`, etc.`);
  lines.push(`4. Copy the webhook signing secret`);
  lines.push(`5. Add \`STRIPE_WEBHOOK_SECRET\` to production env (key name only — never log the value)`);
  lines.push(``);
  return lines.join("\n");
}

function buildRollbackSection(): string {
  const lines: string[] = [`## Rollback Plan\n`];
  lines.push(`> ⚠️  Application rollback does NOT automatically rollback database schema/data.\n`);
  lines.push(`> If your cutover included a DB migration, restore from a pre-cutover backup instead.\n`);
  lines.push(``);
  lines.push(`### Application Rollback`);
  lines.push(`- [ ] Go to Releases page → Release Promotions`);
  lines.push(`- [ ] Find the previous promoted release`);
  lines.push(`- [ ] Click **Rollback** and type \`ROLLBACK\` to confirm`);
  lines.push(``);
  lines.push(`### Nginx Route Rollback`);
  lines.push(`- [ ] Go to Publishing → Production Routing`);
  lines.push(`- [ ] Click **Rollback Routes** and type \`ROLLBACK ROUTES\` to confirm`);
  lines.push(`- [ ] Verify the previous routing config is restored`);
  lines.push(``);
  lines.push(`### Database Rollback`);
  lines.push(`- [ ] Restore from pre-cutover database backup (application rollback will NOT undo migrations)`);
  lines.push(`- [ ] Verify database is consistent after restore`);
  lines.push(``);
  lines.push(`### Stripe Webhook Rollback`);
  lines.push(`- [ ] Manually update or delete the production webhook in Stripe Dashboard → Webhooks`);
  lines.push(`- [ ] Update \`STRIPE_WEBHOOK_SECRET\` if webhook secret changes`);
  lines.push(``);
  lines.push(`### DNS Rollback`);
  lines.push(`- [ ] Update DNS A record to point back to the previous server/IP`);
  lines.push(`- [ ] DNS propagation may take up to 48 hours`);
  lines.push(``);
  return lines.join("\n");
}

function buildPostGoLiveSection(): string {
  const lines: string[] = [`## Post Go-Live Monitoring Checklist\n`];
  lines.push(`- [ ] Run smoke checks 15 minutes after cutover`);
  lines.push(`- [ ] Monitor PM2 logs: \`pm2 logs project-sardar-security-project --lines 100\``);
  lines.push(`- [ ] Monitor nginx access/error logs: \`tail -f /var/log/nginx/access.log\``);
  lines.push(`- [ ] Check Stripe Dashboard for webhook events (first real payment/event)`);
  lines.push(`- [ ] Verify email delivery (order confirmation, password reset)`);
  lines.push(`- [ ] Verify Cloudinary image uploads`);
  lines.push(`- [ ] Monitor error rates for at least 24 hours`);
  lines.push(`- [ ] Confirm uptime monitoring is in place`);
  lines.push(`- [ ] Announce go-live to stakeholders`);
  lines.push(``);
  return lines.join("\n");
}

function buildSafetyReminders(): string {
  const lines: string[] = [`## Safety Reminders\n`];
  lines.push(`- Never apply production routes automatically`);
  lines.push(`- Never reload nginx automatically`);
  lines.push(`- Never restart project services from the cutover assistant`);
  lines.push(`- Never run DB migrations automatically`);
  lines.push(`- Never change DNS automatically`);
  lines.push(`- Never create Stripe webhooks automatically`);
  lines.push(`- Never expose secret values — only key names`);
  lines.push(`- Never auto-promote releases`);
  lines.push(`- Never auto-rollback without explicit \`ROLLBACK\` confirmation`);
  lines.push(`- Never touch Doorsteps/LocalShop (prisom-manager, prisom-backend)`);
  lines.push(``);
  return lines.join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportProductionCutoverPlan(
  plan:        ProductionCutoverPlan,
  projectName: string,
): string {
  return [
    buildSummary(plan, projectName),
    buildBlockerSection(plan),
    buildWarningSection(plan),
    buildNextStepsSection(plan),
    buildStagesSection(plan),
    buildSmokeCheckSection(),
    buildStripeWebhookSection(),
    buildRollbackSection(),
    buildPostGoLiveSection(),
    buildSafetyReminders(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function exportProductionCutoverWithSmoke(
  plan:        ProductionCutoverPlan,
  projectName: string,
  smoke?:      ProductionCutoverSmokeReport,
): string {
  const base = exportProductionCutoverPlan(plan, projectName);
  if (!smoke) return base;

  const smokeLines: string[] = [`\n## Smoke Check Results (last run: ${new Date(smoke.runAt).toUTCString()})\n`];
  smokeLines.push(`**Overall: ${smoke.overallPass ? "✅ PASSED" : "❌ FAILED"}**\n`);
  for (const r of smoke.results) {
    smokeLines.push(`- ${statusIcon(r.status)} **${r.label}**: ${r.message}`);
    if (r.url) smokeLines.push(`  URL: ${r.url}`);
  }
  smokeLines.push(``);

  return base + smokeLines.join("\n");
}
