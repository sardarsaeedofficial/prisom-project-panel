/**
 * lib/migration/staging-import-export.ts
 *
 * Sprint 51: Exports the staging import plan/report as a Markdown document.
 *
 * Safety: never includes secret values.
 */

import type { StagingImportPlan, StagingImportReport, StagingSmokeReport } from "./staging-import-types";
import { STAGING_CATEGORY_LABEL, STAGING_CATEGORY_ORDER } from "./staging-import-types";

const STAGING_SLUG   = "sardar-security-staging";
const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

export function exportStagingImportReport(
  plan:        StagingImportPlan,
  smokeReport: StagingSmokeReport | null,
): string {
  const lines: string[] = [];
  const now = new Date(plan.generatedAt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  lines.push(`# STAGING_IMPORT_REPORT.md`);
  lines.push(`> Generated: ${now} | Status: ${plan.status.toUpperCase()}`);
  lines.push(`> Source project: ${plan.sourceProjectId}`);
  lines.push(`> ⚠️  This report contains no secret values.`);
  lines.push(``);

  // ── Overview ──────────────────────────────────────────────────────────────

  lines.push(`## Staging Import Overview`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Source project | \`${plan.sourceProjectId}\` |`);
  lines.push(`| Recommended staging slug | \`${plan.recommendedStagingSlug}\` |`);
  lines.push(`| Recommended staging domain | \`${plan.recommendedStagingDomain}\` |`);
  lines.push(`| Plan status | ${plan.status} |`);
  lines.push(``);

  // ── Service Setup ─────────────────────────────────────────────────────────

  lines.push(`## Service Setup`);
  lines.push(``);
  lines.push(`### API Service`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Root`);
  lines.push(`artifacts/api-server`);
  lines.push(``);
  lines.push(`# Build`);
  lines.push(`pnpm --filter @workspace/api-server run build`);
  lines.push(``);
  lines.push(`# Start`);
  lines.push(`node --enable-source-maps artifacts/api-server/dist/index.mjs`);
  lines.push(``);
  lines.push(`# Health`);
  lines.push(`/api/healthz`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`### Static Frontend`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Root`);
  lines.push(`artifacts/sardar-security`);
  lines.push(``);
  lines.push(`# Build`);
  lines.push(`pnpm --filter @workspace/sardar-security run build`);
  lines.push(``);
  lines.push(`# Output`);
  lines.push(`artifacts/sardar-security/dist/public`);
  lines.push(``);
  lines.push(`# SPA fallback: enabled`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── Env Setup ─────────────────────────────────────────────────────────────

  lines.push(`## Env / Secrets Setup`);
  lines.push(``);
  lines.push(`> ⚠️  Key names only — never include actual secret values.`);
  lines.push(`> Fill staging/test values manually in the staging project.`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`DATABASE_URL=<staging-neon-connection-string>   # separate from production!`);
  lines.push(`SESSION_SECRET=<random-32-char-string>`);
  lines.push(`STRIPE_SECRET_KEY=sk_test_<...>                 # test keys for staging`);
  lines.push(`STRIPE_PUBLISHABLE_KEY=pk_test_<...>            # test keys for staging`);
  lines.push(`STRIPE_WEBHOOK_SECRET=whsec_<staging-secret>`);
  lines.push(`CLOUDINARY_CLOUD_NAME=<cloud-name>`);
  lines.push(`CLOUDINARY_API_KEY=<api-key>`);
  lines.push(`CLOUDINARY_API_SECRET=<api-secret>`);
  lines.push(`APP_URL=https://${plan.recommendedStagingDomain}`);
  lines.push(`RESEND_API_KEY=re_<...>   # or SMTP_* for staging email`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── DB Setup ──────────────────────────────────────────────────────────────

  lines.push(`## Database Setup`);
  lines.push(``);
  lines.push(`> Create a separate staging database — never use the production DATABASE_URL.`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Push schema to staging database (manual, after DATABASE_URL is set)`);
  lines.push(`pnpm --filter @workspace/db exec drizzle-kit push`);
  lines.push(``);
  lines.push(`# Check diff first (recommended)`);
  lines.push(`pnpm --filter @workspace/db exec drizzle-kit diff`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── Route Setup ───────────────────────────────────────────────────────────

  lines.push(`## Route Setup`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`/api/*   → API service`);
  lines.push(`/*       → static frontend (SPA fallback)`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`> Apply routes in the staging project only. Do not apply to the live project.`);
  lines.push(``);

  // ── Checklist by Category ─────────────────────────────────────────────────

  lines.push(`## Full Staging Checklist`);
  lines.push(``);

  const stepsByCategory = new Map<string, typeof plan.steps>();
  for (const cat of STAGING_CATEGORY_ORDER) {
    stepsByCategory.set(cat, plan.steps.filter((s) => s.category === cat));
  }

  for (const cat of STAGING_CATEGORY_ORDER) {
    const catSteps = stepsByCategory.get(cat) ?? [];
    if (catSteps.length === 0) continue;
    lines.push(`### ${STAGING_CATEGORY_LABEL[cat]}`);
    lines.push(``);
    for (const s of catSteps) {
      const marker = s.status === "ready" || s.status === "passed" ? "x" : " ";
      const req    = s.required ? " *(required)*" : "";
      lines.push(`- [${marker}] ${s.title}${req}`);
      if (s.command) lines.push(`  \`\`\`bash\n  ${s.command}\n  \`\`\``);
      if (s.warning) lines.push(`  > ⚠️  ${s.warning}`);
    }
    lines.push(``);
  }

  // ── Smoke Check Results ───────────────────────────────────────────────────

  if (smokeReport) {
    lines.push(`## Smoke Check Results`);
    lines.push(``);
    lines.push(`Staging domain: \`${smokeReport.stagingDomain}\``);
    lines.push(`Run at: ${new Date(smokeReport.runAt).toLocaleString("en-GB")}`);
    lines.push(`Overall: ${smokeReport.overallPass ? "✅ PASSED" : "❌ FAILED"}`);
    lines.push(``);
    for (const c of smokeReport.checks) {
      const icon = c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      lines.push(`${icon} **${c.label}** — ${c.message}`);
    }
    lines.push(``);
  } else {
    lines.push(`## Smoke Check Results`);
    lines.push(``);
    lines.push(`Smoke checks have not been run yet.`);
    lines.push(`Configure the staging domain and run smoke checks from the staging import panel.`);
    lines.push(``);
  }

  // ── Blockers & Warnings ───────────────────────────────────────────────────

  if (plan.blockers.length > 0) {
    lines.push(`## Blockers`);
    lines.push(``);
    for (const b of plan.blockers) lines.push(`- ❌ ${b}`);
    lines.push(``);
  }

  if (plan.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push(``);
    for (const w of plan.warnings) lines.push(`- ⚠️  ${w}`);
    lines.push(``);
  }

  // ── Next Steps ────────────────────────────────────────────────────────────

  lines.push(`## Next Steps`);
  lines.push(``);
  for (const s of plan.nextSteps) {
    lines.push(`- ${s}`);
  }
  lines.push(``);

  // ── Footer ────────────────────────────────────────────────────────────────

  lines.push(`---`);
  lines.push(``);
  lines.push(`Generated by Prisom Project Panel — Sprint 51`);
  lines.push(`This document contains no secret values.`);
  lines.push(`Do not commit this file with secret values filled in.`);
  lines.push(``);

  return lines.join("\n");
}

// ── Handoff section builder ───────────────────────────────────────────────────

export function buildStagingImportHandoffSection(plan: StagingImportPlan): string {
  const lines: string[] = [`## Staging Import Plan\n`];

  lines.push(`> Staging import is a prerequisite for production cutover.`);
  lines.push(`> Complete all staging steps and validate before making any DNS or routing changes.`);
  lines.push(``);

  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Staging slug | \`${plan.recommendedStagingSlug}\` |`);
  lines.push(`| Staging domain | \`${plan.recommendedStagingDomain}\` |`);
  lines.push(`| Plan status | ${plan.status} |`);
  lines.push(``);

  lines.push(`### Staging Service Checklist`);
  lines.push(``);
  const serviceSteps = plan.steps.filter((s) => s.category === "services");
  for (const s of serviceSteps) {
    const marker = s.status === "ready" || s.status === "passed" ? "x" : " ";
    lines.push(`- [${marker}] ${s.title}`);
    if (s.command) lines.push(`  \`${s.command}\``);
  }
  lines.push(``);

  lines.push(`### Staging Env Checklist`);
  lines.push(``);
  lines.push(`> Key names only — add values manually.`);
  lines.push(``);
  const envSteps = plan.steps.filter((s) => s.category === "env");
  for (const s of envSteps) {
    const marker = s.status === "ready" || s.status === "passed" ? "x" : " ";
    lines.push(`- [${marker}] ${s.title}`);
    if (s.warning) lines.push(`  > ⚠️  ${s.warning}`);
  }
  lines.push(``);

  lines.push(`### Staging DB Checklist`);
  lines.push(``);
  const dbSteps = plan.steps.filter((s) => s.category === "database");
  for (const s of dbSteps) {
    const marker = s.status === "ready" || s.status === "passed" ? "x" : " ";
    lines.push(`- [${marker}] ${s.title}`);
    if (s.command) lines.push(`  \`\`\`bash\n  ${s.command}\n  \`\`\``);
    if (s.warning) lines.push(`  > ⚠️  ${s.warning}`);
  }
  lines.push(``);

  lines.push(`### Staging Smoke Checks`);
  lines.push(``);
  const smokeSteps = plan.steps.filter((s) => s.category === "smoke");
  for (const s of smokeSteps) {
    const marker = s.status === "ready" || s.status === "passed" ? "x" : " ";
    lines.push(`- [${marker}] ${s.title}`);
  }
  lines.push(``);

  return lines.join("\n") + "\n";
}
