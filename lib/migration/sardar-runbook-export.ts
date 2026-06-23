/**
 * lib/migration/sardar-runbook-export.ts
 *
 * Sprint 50: Exports the Sardar migration runbook as a Markdown document.
 *
 * Safety:
 *  - never includes secret values
 *  - includes only env key names
 *  - includes commands as reference only (never executed)
 */

import type { SardarMigrationRunbook } from "./sardar-migration-types";
import { SARDAR_STAGE_TITLES }         from "./sardar-migration-types";

const SARDAR_LIVE_DOMAIN  = "sardar-security-project.doorstepmanchester.uk";
const SARDAR_STAGING_SLUG = "sardar-security-staging";
const SARDAR_STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";
const STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe";

export function exportSardarRunbookAsMarkdown(runbook: SardarMigrationRunbook): string {
  const lines: string[] = [];
  const now = new Date(runbook.generatedAt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  lines.push(`# SARDAR_MIGRATION_RUNBOOK.md`);
  lines.push(`> Generated: ${now} | Status: ${runbook.overallStatus.toUpperCase()}`);
  lines.push(`> Project ID: ${runbook.projectId}`);
  lines.push(`> ⚠️  This runbook contains no secret values. All secret values must be added manually.`);
  lines.push(``);

  // ── Overview ────────────────────────────────────────────────────────────────

  lines.push(`## Project Overview`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| App | Sardar Security Supplies (ecommerce) |`);
  lines.push(`| Source | Replit import (monorepo) |`);
  lines.push(`| Production domain | \`${SARDAR_LIVE_DOMAIN}\` |`);
  lines.push(`| Staging domain | \`${SARDAR_STAGING_DOMAIN}\` |`);
  lines.push(`| Staging project slug | \`${SARDAR_STAGING_SLUG}\` |`);
  lines.push(`| PM2 process (live) | \`project-sardar-security-project\` |`);
  lines.push(`| Port | 4100 |`);
  lines.push(``);

  // ── Source Structure ─────────────────────────────────────────────────────────

  lines.push(`## Source Structure`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`artifacts/`);
  lines.push(`  api-server/          ← Node.js/Express API`);
  lines.push(`    src/`);
  lines.push(`    dist/`);
  lines.push(`      index.mjs        ← production entry point`);
  lines.push(`  sardar-security/     ← React SPA frontend`);
  lines.push(`    src/`);
  lines.push(`    dist/`);
  lines.push(`      public/          ← static output`);
  lines.push(`lib/`);
  lines.push(`  db/                  ← Drizzle schema + client`);
  lines.push(`package.json           ← monorepo root`);
  lines.push(`pnpm-workspace.yaml`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── Service Commands ─────────────────────────────────────────────────────────

  lines.push(`## Service Commands`);
  lines.push(``);
  lines.push(`### API Service`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Build`);
  lines.push(`pnpm --filter @workspace/api-server run build`);
  lines.push(``);
  lines.push(`# Start`);
  lines.push(`node --enable-source-maps artifacts/api-server/dist/index.mjs`);
  lines.push(``);
  lines.push(`# Health check`);
  lines.push(`curl -I https://${SARDAR_LIVE_DOMAIN}/api/healthz`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`### Static Frontend`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Build`);
  lines.push(`pnpm --filter @workspace/sardar-security run build`);
  lines.push(``);
  lines.push(`# Static output path`);
  lines.push(`artifacts/sardar-security/dist/public`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── Expected Routing ─────────────────────────────────────────────────────────

  lines.push(`## Expected nginx Routing`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`/api/*   → API service (localhost:4100 or configured port)`);
  lines.push(`/*       → static frontend (dist/public) with SPA fallback`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`> ⚠️  Do not apply routing automatically. Confirm manually in Publishing → Production Routing.`);
  lines.push(``);

  // ── Env Keys ─────────────────────────────────────────────────────────────────

  lines.push(`## Required Environment Variables`);
  lines.push(``);
  lines.push(`> ⚠️  Key names only. Never include actual secret values in this document.`);
  lines.push(``);
  lines.push(`\`\`\``);
  lines.push(`# Database`);
  lines.push(`DATABASE_URL=<neon-postgres-connection-string>`);
  lines.push(``);
  lines.push(`# Auth`);
  lines.push(`SESSION_SECRET=<random-32-char-string>`);
  lines.push(``);
  lines.push(`# Stripe`);
  lines.push(`STRIPE_SECRET_KEY=sk_live_<...>       # sk_test_<...> for staging`);
  lines.push(`STRIPE_PUBLISHABLE_KEY=pk_live_<...>  # pk_test_<...> for staging`);
  lines.push(`STRIPE_WEBHOOK_SECRET=whsec_<...>`);
  lines.push(``);
  lines.push(`# Cloudinary`);
  lines.push(`CLOUDINARY_CLOUD_NAME=<cloud-name>`);
  lines.push(`CLOUDINARY_API_KEY=<api-key>`);
  lines.push(`CLOUDINARY_API_SECRET=<api-secret>`);
  lines.push(``);
  lines.push(`# App`);
  lines.push(`APP_URL=https://${SARDAR_LIVE_DOMAIN}`);
  lines.push(``);
  lines.push(`# Email (choose one)`);
  lines.push(`RESEND_API_KEY=re_<...>`);
  lines.push(`# OR`);
  lines.push(`SMTP_HOST=smtp.example.com`);
  lines.push(`SMTP_PORT=587`);
  lines.push(`SMTP_USER=noreply@example.com`);
  lines.push(`SMTP_PASS=<password>`);
  lines.push(`\`\`\``);
  lines.push(``);

  // ── Database Commands ────────────────────────────────────────────────────────

  lines.push(`## Database Migration Commands`);
  lines.push(``);
  lines.push(`> ⚠️  These commands are for reference. Do not run automatically.`);
  lines.push(`> Always backup before running any migration.`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Push schema to production database (manual)`);
  lines.push(`pnpm --filter @workspace/db exec drizzle-kit push`);
  lines.push(``);
  lines.push(`# Check diff first (safer)`);
  lines.push(`pnpm --filter @workspace/db exec drizzle-kit diff`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`> ⚠️  Rollback does not automatically revert database schema or data changes.`);
  lines.push(`> Plan database rollback separately by restoring from a backup.`);
  lines.push(``);

  // ── External Services ────────────────────────────────────────────────────────

  lines.push(`## External Services`);
  lines.push(``);
  lines.push(`### Stripe`);
  lines.push(``);
  lines.push(`- Production webhook URL: \`https://${SARDAR_LIVE_DOMAIN}${STRIPE_WEBHOOK_PATH}\``);
  lines.push(`- Stripe events: \`payment_intent.succeeded\`, \`checkout.session.completed\``);
  lines.push(`- Test card: 4242 4242 4242 4242 (any future date, any CVC)`);
  lines.push(`- ⚠️  Do not auto-enable Stripe live webhooks. Configure manually in Stripe Dashboard.`);
  lines.push(``);
  lines.push(`### Cloudinary`);
  lines.push(``);
  lines.push(`- Use separate Cloudinary folders for staging vs production`);
  lines.push(`- Test upload flow in staging before enabling in production`);
  lines.push(``);
  lines.push(`### Email`);
  lines.push(``);
  lines.push(`- Verify sender domain with email provider`);
  lines.push(`- Test password reset and order confirmation emails in staging`);
  lines.push(``);

  // ── Staging Checklist ────────────────────────────────────────────────────────

  lines.push(`## Staging Checklist`);
  lines.push(``);
  lines.push(`Recommended staging project: \`${SARDAR_STAGING_SLUG}\``);
  lines.push(`Staging domain: \`${SARDAR_STAGING_DOMAIN}\``);
  lines.push(``);
  for (const it of runbook.stages.find((s) => s.stage === "staging_import")?.items ?? []) {
    lines.push(`- [${it.status === "ready" ? "x" : " "}] ${it.title}`);
  }
  lines.push(``);

  // ── Staging Validation Checklist ─────────────────────────────────────────────

  lines.push(`## Staging Validation Checklist`);
  lines.push(``);
  for (const it of runbook.stages.find((s) => s.stage === "staging_validation")?.items ?? []) {
    const marker = it.status === "ready" ? "x" : " ";
    lines.push(`- [${marker}] ${it.title}`);
    if (it.description) lines.push(`  - ${it.description}`);
  }
  lines.push(``);

  // ── Production Cutover Checklist ──────────────────────────────────────────────

  lines.push(`## Production Cutover Checklist`);
  lines.push(``);
  lines.push(`> ⚠️  These steps must be performed manually in order. Do not automate cutover.`);
  lines.push(``);
  for (const it of runbook.stages.find((s) => s.stage === "production_cutover")?.items ?? []) {
    const marker = it.status === "ready" ? "x" : " ";
    lines.push(`- [${marker}] ${it.title}`);
    if (it.command)  lines.push(`  \`\`\`bash\n  ${it.command}\n  \`\`\``);
    if (it.warning)  lines.push(`  > ⚠️  ${it.warning}`);
  }
  lines.push(``);

  // ── Rollback Plan ─────────────────────────────────────────────────────────────

  lines.push(`## Rollback Plan`);
  lines.push(``);
  lines.push(`### Application Rollback`);
  lines.push(``);
  lines.push(`1. Go to Prisom → Releases → find the previous release`);
  lines.push(`2. Click **Rollback** and type \`ROLLBACK\` to confirm`);
  lines.push(`3. Wait for rollback to complete`);
  lines.push(`4. Verify the health endpoint: curl -I https://${SARDAR_LIVE_DOMAIN}/api/healthz`);
  lines.push(``);
  lines.push(`### nginx Route Rollback`);
  lines.push(``);
  lines.push(`1. Go to Publishing → Production Routing`);
  lines.push(`2. Remove or revert the routing rules`);
  lines.push(`3. Reload nginx (done by Prisom)`);
  lines.push(``);
  lines.push(`### Stripe Webhook Rollback`);
  lines.push(``);
  lines.push(`1. Go to Stripe Dashboard → Webhooks`);
  lines.push(`2. Disable or remove the production webhook endpoint`);
  lines.push(`3. Re-enable staging/test webhook if needed`);
  lines.push(``);
  lines.push(`### DNS Rollback`);
  lines.push(``);
  lines.push(`1. Update A record to point back to the old server/IP`);
  lines.push(`2. DNS propagation may take 1–48 hours`);
  lines.push(`3. Lower TTL in advance of cutover to speed up rollback`);
  lines.push(``);
  lines.push(`### ⚠️  Database Rollback`);
  lines.push(``);
  lines.push(`**Application rollback does NOT automatically rollback database schema or data.**`);
  lines.push(``);
  lines.push(`To roll back a database migration:`);
  lines.push(`1. Restore from the backup taken before the migration`);
  lines.push(`2. Verify row counts after restore`);
  lines.push(`3. Test the app against the restored database before re-enabling traffic`);
  lines.push(``);

  // ── Post Go-Live Checks ────────────────────────────────────────────────────────

  lines.push(`## Post Go-Live Checks`);
  lines.push(``);
  for (const it of runbook.stages.find((s) => s.stage === "post_go_live")?.items ?? []) {
    const marker = it.status === "ready" ? "x" : " ";
    lines.push(`- [${marker}] ${it.title}`);
  }
  lines.push(``);

  // ── All Stage Checklists ──────────────────────────────────────────────────────

  lines.push(`## Full Stage Checklist`);
  lines.push(``);
  for (const stage of runbook.stages) {
    lines.push(`### ${stage.title}`);
    lines.push(``);
    for (const it of stage.items) {
      const marker = it.status === "ready" ? "x" : " ";
      const req    = it.required ? " *(required)*" : "";
      lines.push(`- [${marker}] ${it.title}${req}`);
      if (it.description && it.description !== it.title) {
        lines.push(`  - ${it.description}`);
      }
      if (it.command) {
        lines.push(`  \`\`\`bash\n  ${it.command}\n  \`\`\``);
      }
      if (it.warning) {
        lines.push(`  > ⚠️  ${it.warning}`);
      }
    }
    lines.push(``);
  }

  // ── Footer ────────────────────────────────────────────────────────────────────

  lines.push(`---`);
  lines.push(``);
  lines.push(`Generated by Prisom Project Panel — Sprint 50`);
  lines.push(`This document contains no secret values.`);
  lines.push(`All env var values must be added manually and never committed to source control.`);
  lines.push(``);

  return lines.join("\n");
}
