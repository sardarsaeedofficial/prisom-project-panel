/**
 * lib/migration/handoff-export.ts
 *
 * Sprint 41: Generate a Markdown handoff document from an enriched migration
 * report. Suitable for download, copy-paste, or sharing with a new developer.
 *
 * Safety rules:
 *  - No secret values included — only key names (DetectedSecret.name)
 *  - All content is plain Markdown (no HTML)
 */

import type { EnrichedMigrationReport } from "./replit-migration-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityIcon(severity: string): string {
  switch (severity) {
    case "blocker":     return "🔴";
    case "warning":     return "🟡";
    case "required":    return "⚠️";
    case "recommended": return "📌";
    default:            return "ℹ️";
  }
}

function table(headers: string[], rows: string[][]): string {
  const sep  = headers.map((h) => "-".repeat(Math.max(h.length, 3)));
  const head = `| ${headers.join(" | ")} |`;
  const div  = `| ${sep.join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, div, body].join("\n");
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildHeader(r: EnrichedMigrationReport): string {
  const status =
    r.readinessStatus === "ready"
      ? "✅ **Ready to migrate**"
      : r.readinessStatus === "warnings"
      ? "⚠️ **Ready with warnings**"
      : "🔴 **Blocked — resolve issues before deploying**";

  return `# Migration Handoff — \`${r.projectSlug ?? "project"}\`

> Generated: ${new Date(r.analyzedAt).toUTCString()}

**Status:** ${status}

**Summary:** ${r.filesScanned} files scanned • ${r.risks.length} issue(s) • ${r.manualSteps.length} manual step(s)
`;
}

function buildBlockers(r: EnrichedMigrationReport): string {
  const blockers = r.risks.filter((ri) => ri.severity === "blocker");
  if (blockers.length === 0) return "";

  const items = blockers
    .map(
      (b) =>
        `### 🔴 ${b.title}\n\n${b.details}\n\n**Fix:** ${b.suggestedFix}` +
        (b.filesInvolved.length > 0
          ? `\n\n**Files:** ${b.filesInvolved.map((f) => `\`${f}\``).join(", ")}`
          : ""),
    )
    .join("\n\n---\n\n");

  return `## Blockers (${blockers.length})\n\n${items}\n`;
}

function buildWarnings(r: EnrichedMigrationReport): string {
  const warnings = r.risks.filter((ri) => ri.severity === "warning");
  if (warnings.length === 0) return "";

  const items = warnings
    .map((w) => `- ${severityIcon(w.severity)} **${w.title}**: ${w.suggestedFix}`)
    .join("\n");

  return `## Warnings\n\n${items}\n`;
}

function buildEnvVars(r: EnrichedMigrationReport): string {
  if (r.requiredSecrets.length === 0) return "";

  const rows = r.requiredSecrets.map((s) => [
    `\`${s.name}\``,
    s.required ? "Required" : "Optional",
    s.category,
    s.notes ?? "",
  ]);

  return `## Environment Variables\n\n${table(["Key", "Required", "Category", "Notes"], rows)}\n`;
}

function buildExternalServices(r: EnrichedMigrationReport): string {
  if (r.externalServices.length === 0) return "";

  const items = r.externalServices
    .map((f) => {
      const parts = [`### ${f.critical ? "⚠️" : "📦"} ${f.label}`];
      if (f.envKeys.length > 0) {
        parts.push(`**Env keys needed:**\n${f.envKeys.map((k) => `- \`${k}\``).join("\n")}`);
      }
      if (f.webhookPath) parts.push(`**Webhook path:** \`${f.webhookPath}\``);
      if (f.callbackPath) parts.push(`**OAuth callback:** \`${f.callbackPath}\``);
      parts.push(`**Action:** ${f.action}`);
      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");

  return `## External Services\n\n${items}\n`;
}

function buildManualSteps(r: EnrichedMigrationReport): string {
  if (r.manualSteps.length === 0) return "";

  const items = r.manualSteps
    .map((step, i) => {
      const icon  = severityIcon(step.severity);
      const lines = [`### Step ${i + 1}: ${icon} ${step.title}\n\n${step.description}`];
      if (step.envKeys && step.envKeys.length > 0) {
        lines.push(`**Env vars to set:**\n${step.envKeys.map((k) => `- \`${k}\``).join("\n")}`);
      }
      if (step.command) {
        lines.push(`**Command:**\n\`\`\`sh\n${step.command}\n\`\`\``);
      }
      if (step.files && step.files.length > 0) {
        lines.push(`**Related files:** ${step.files.map((f) => `\`${f}\``).join(", ")}`);
      }
      return lines.join("\n\n");
    })
    .join("\n\n---\n\n");

  return `## Manual Steps (${r.manualSteps.length})\n\n${items}\n`;
}

function buildDatabase(r: EnrichedMigrationReport): string {
  if (!r.database || r.database.type === "none") return "";

  const lines = [
    `## Database`,
    ``,
    `- **Type:** ${r.database.type}`,
    `- **ORM:** ${r.database.orm ?? "none"}`,
  ];

  if (r.database.configFile) {
    lines.push(`- **Config file:** \`${r.database.configFile}\``);
  }
  if (r.database.migrationsDir) {
    lines.push(`- **Migrations dir:** \`${r.database.migrationsDir}\``);
  }

  if (r.dbPlan) {
    lines.push(``, `**Migration plan:**`);
    r.dbPlan.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (r.dbPlan.notes) lines.push(``, `> ${r.dbPlan.notes}`);
  }

  return lines.join("\n") + "\n";
}

function buildDatabaseReadiness(r: EnrichedMigrationReport): string {
  if (!r.database || r.database.type === "none" || r.database.type === "unknown") return "";

  const lines: string[] = [
    `## Database Migration Readiness`,
    ``,
    `- **ORM/Tool:** ${r.database.orm && r.database.orm !== "none" ? r.database.orm : "unknown"}`,
    `- **Provider:** ${r.database.type}`,
  ];

  if (r.database.configFile)    lines.push(`- **Config:** \`${r.database.configFile}\``);
  if (r.database.migrationsDir) lines.push(`- **Migrations dir:** \`${r.database.migrationsDir}\``);

  // Required env var names only — never values
  const dbEnvKeys = [
    "DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL",
    "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING",
    "MONGODB_URI", "SUPABASE_URL",
  ];
  const detectedDbSecrets = r.requiredSecrets.filter((s) => dbEnvKeys.includes(s.name));
  if (detectedDbSecrets.length > 0) {
    lines.push(``, `**Required env vars (names only — no values stored):**`);
    detectedDbSecrets.forEach((s) =>
      lines.push(`- \`${s.name}\` — ${s.required ? "required" : "optional"}`)
    );
  }

  const orm = r.database.orm;
  if (orm === "prisma") {
    lines.push(
      ``,
      `**Commands to run (in order):**`,
      `\`\`\`sh`,
      `# 1. Check which migrations are pending (safe, read-only)`,
      `pnpm prisma migrate status`,
      ``,
      `# 2. Apply pending migrations to production`,
      `# Create a database backup BEFORE running this`,
      `pnpm prisma migrate deploy`,
      `\`\`\``,
    );
  } else if (orm === "drizzle") {
    lines.push(
      ``,
      `**Commands to run (in order):**`,
      `\`\`\`sh`,
      `# 1. Check schema consistency (safe, read-only)`,
      `pnpm drizzle-kit check`,
      ``,
      `# 2. Push schema changes to database`,
      `# Create a database backup BEFORE running this`,
      `pnpm drizzle-kit push`,
      `\`\`\``,
    );
  }

  lines.push(
    ``,
    `**Manual steps:**`,
    `1. Create a database backup before any migration run.`,
    `2. Add DATABASE_URL to the Secrets Vault if not already configured.`,
    `3. Run a connection test via the Database page before first deploy.`,
    `4. Review migration output carefully — check for unexpected schema changes.`,
    ``,
    `> Always back up your database before running migrations in production.`,
    ``,
    `> Never run \`prisma migrate reset\`, \`drizzle-kit push --force\`, \`DROP TABLE\`, or \`TRUNCATE\` on production data.`,
  );

  return lines.join("\n") + "\n";
}

function buildServices(r: EnrichedMigrationReport): string {
  if (r.suggestedServices.length === 0) return "";

  const rows = r.suggestedServices.map((s) => [
    s.name,
    s.serviceType ?? "node",
    s.buildCommand ?? "",
    s.startCommand ?? "",
    s.internalPort ? String(s.internalPort) : "",
  ]);

  return `## Suggested Services\n\n${table(["Name", "Type", "Build", "Start", "Port"], rows)}\n`;
}

function buildAppliedChanges(
  appliedResults?: Array<{ id: string; ok: boolean; summary: string }>,
): string {
  if (!appliedResults || appliedResults.length === 0) return "";

  const succeeded = appliedResults.filter((r) => r.ok);
  const failed    = appliedResults.filter((r) => !r.ok);

  const lines: string[] = [`## Applied Settings (${succeeded.length} succeeded, ${failed.length} failed)\n`];

  if (succeeded.length > 0) {
    lines.push(`### Applied`);
    succeeded.forEach((r) => lines.push(`- ✅ ${r.summary}`));
    lines.push("");
  }
  if (failed.length > 0) {
    lines.push(`### Failed`);
    failed.forEach((r) => lines.push(`- ❌ ${r.summary}`));
    lines.push("");
  }

  return lines.join("\n");
}

function buildRemainingManualSteps(
  report:         EnrichedMigrationReport,
  appliedTargets: string[],
): string {
  // Manual steps that weren't handled by apply wizard
  const remaining = report.manualSteps.filter(
    (s) => !s.envKeys || !s.envKeys.every((k) => appliedTargets.includes(k)),
  );
  if (remaining.length === 0) return "";

  const items = remaining
    .map((step, i) => {
      const icon = severityIcon(step.severity);
      return `### Remaining Step ${i + 1}: ${icon} ${step.title}\n\n${step.description}`;
    })
    .join("\n\n---\n\n");

  return `## Remaining Manual Steps (${remaining.length})\n\n${items}\n`;
}

function buildFooter(): string {
  return `---

*Generated by Prisom Migration Wizard. No secret values are included in this document.*
`;
}

function buildEnvReadiness(r: EnrichedMigrationReport): string {
  const secrets = r.requiredSecrets ?? [];
  if (secrets.length === 0) return "";

  const lines: string[] = [`## Secrets / Env Readiness\n`];
  lines.push(`> All required env vars must be set in the Secrets Vault before deploying to production.`);
  lines.push(`> Never commit real values to version control.`);
  lines.push("");

  // Group by category
  const byCategory: Record<string, typeof secrets> = {};
  for (const s of secrets) {
    const cat = s.category ?? "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(s);
  }

  const categoryOrder = ["database", "payments", "email", "media", "auth", "app", "replit-specific", "other"];
  const sortedCats = [
    ...categoryOrder.filter((c) => byCategory[c]),
    ...Object.keys(byCategory).filter((c) => !categoryOrder.includes(c)),
  ];

  for (const cat of sortedCats) {
    const items = byCategory[cat];
    if (!items?.length) continue;
    lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, " ")}`);
    for (const s of items) {
      const note = s.notes ? ` — ${s.notes}` : s.replitReplacement ? ` — Replit replacement: ${s.replitReplacement}` : "";
      lines.push(`- [ ] \`${s.name}\`${note}`);
    }
    lines.push("");
  }

  lines.push(`### Pre-Deploy Checklist\n`);
  lines.push(`- [ ] All required env vars entered in Secrets Vault`);
  lines.push(`- [ ] No placeholder values remain (e.g., \`<required:...>\`, \`CHANGE_ME\`, \`your-*\`)`);
  lines.push(`- [ ] Stripe live keys used in production (not \`sk_test_*\` / \`pk_test_*\`)`);
  lines.push(`- [ ] APP_URL points to production domain (\`https://yourdomain.com\`)`);
  lines.push(`- [ ] NEXTAUTH_URL / AUTH_URL matches production domain`);
  lines.push(`- [ ] No Replit-specific vars remain (e.g., REPL_OWNER, REPLIT_DB_URL)`);
  lines.push("");

  return lines.join("\n") + "\n";
}

function buildDomainReadiness(r: EnrichedMigrationReport): string {
  // Use APP_URL from requiredSecrets as the likely domain hint
  const appUrlSecret = r.requiredSecrets.find(
    (s) => s.name === "APP_URL" || s.name === "NEXT_PUBLIC_APP_URL" || s.name === "NEXTAUTH_URL",
  );

  const lines: string[] = [`## Domain / SSL / Routing Readiness\n`];

  lines.push(`> Configure your domain, DNS, and SSL before routing traffic to production.`);
  lines.push(`> Never use \`projects.doorstepmanchester.uk\` as a project domain.`);
  lines.push("");

  if (appUrlSecret) {
    lines.push(`**Expected domain source:** \`${appUrlSecret.name}\` env var (enter production URL there).`);
    lines.push("");
  }

  lines.push(`### DNS Setup`);
  lines.push(`- [ ] Choose a production domain`);
  lines.push(`- [ ] Add an A record: \`yourdomain.com\` → \`178.105.105.59\``);
  lines.push(`- [ ] Wait for DNS propagation (up to 24h)`);
  lines.push(`- [ ] Verify in Domains → Domain Readiness that A record shows "match"`);
  lines.push("");

  lines.push(`### SSL Certificate`);
  lines.push(`- [ ] Issue SSL certificate after DNS is live`);
  lines.push(`- [ ] Run: \`sudo certbot --nginx -d yourdomain.com\``);
  lines.push(`- [ ] Confirm SSL shows "valid" in Domain Readiness`);
  lines.push(`- [ ] Set a calendar reminder to renew before expiry`);
  lines.push("");

  lines.push(`### Nginx Routing`);
  lines.push(`- [ ] Apply production routes in Publishing → Production Routing`);
  lines.push(`- [ ] Confirm nginx config is managed by this project (no conflicts)`);
  lines.push(`- [ ] Verify \`/api/*\` and \`/*\` routing works after apply`);
  lines.push(`- [ ] Run smoke checks: \`curl -I https://yourdomain.com/\``);
  lines.push("");

  lines.push(`### Safety Reminders`);
  lines.push(`- Never modify \`projects.doorstepmanchester.uk\` nginx config`);
  lines.push(`- Never overwrite an existing unmanaged nginx config without reviewing it`);
  lines.push(`- Run \`sudo nginx -t\` to validate config before reloading nginx`);
  lines.push(`- Keep a nginx backup before applying routes`);
  lines.push("");

  return lines.join("\n") + "\n";
}

function buildGitHubReadiness(_r: EnrichedMigrationReport): string {
  const lines: string[] = [`## GitHub Auto-Sync Readiness\n`];

  lines.push(`> Configure GitHub webhooks and auto-sync before enabling auto-deploy in production.`);
  lines.push(`> Never expose or log the webhook secret value.`);
  lines.push("");

  lines.push(`### Repository Setup`);
  lines.push(`- [ ] GitHub repository connected to this project (GitHub section)`);
  lines.push(`- [ ] Default branch confirmed (should match your production branch)`);
  lines.push("");

  lines.push(`### Webhook Configuration`);
  lines.push(`- [ ] Copy the webhook URL from GitHub → Auto-Sync Readiness panel`);
  lines.push(`- [ ] In GitHub repository → Settings → Webhooks → Add webhook:`);
  lines.push(`  - Payload URL: \`https://your-domain/api/webhooks/github\``);
  lines.push(`  - Content type: \`application/json\``);
  lines.push(`  - Secret: value from \`GITHUB_WEBHOOK_SECRET\` on your server`);
  lines.push(`  - Events: Just the push event`);
  lines.push(`  - Active: enabled`);
  lines.push(`- [ ] Add \`GITHUB_WEBHOOK_SECRET\` to your server \`.env\` file`);
  lines.push(`- [ ] Restart the panel service to pick up the new env var`);
  lines.push("");

  lines.push(`### Verification`);
  lines.push(`- [ ] Push a commit and confirm a delivery appears in GitHub → Readiness`);
  lines.push(`- [ ] Run Webhook Setup Test — all checks should pass`);
  lines.push("");

  lines.push(`### Auto-Deploy Safety`);
  lines.push(`- [ ] Review env var, domain, and database readiness BEFORE enabling auto-deploy`);
  lines.push(`- [ ] Auto-pull is safe once env is clean and the worktree is not dirty`);
  lines.push(`- [ ] Auto-deploy triggers a full deploy on every push — confirm this is intended`);
  lines.push(`- [ ] Keep a recent backup / snapshot before first auto-deploy`);
  lines.push("");

  return lines.join("\n") + "\n";
}

// ── Sprint 49: Go-live readiness ──────────────────────────────────────────────

function buildGoLiveReadiness(_r: EnrichedMigrationReport): string {
  const lines: string[] = [`## Go-Live Readiness\n`];

  lines.push(`> Complete all required checks before promoting to production.`);
  lines.push(`> Promotion requires typing \`PROMOTE\`. Rollback requires typing \`ROLLBACK\`.`);
  lines.push(`> Rollback reverts the release but does not undo database migrations.`);
  lines.push("");

  lines.push(`### Required Checks Before Promoting`);
  lines.push(`- [ ] Env readiness passed — all required env vars configured`);
  lines.push(`- [ ] Database readiness reviewed — connection test passed`);
  lines.push(`- [ ] Domain readiness passed — DNS, SSL, nginx config safe`);
  lines.push(`- [ ] Backup created before promotion`);
  lines.push(`- [ ] Release preflight passed (Releases → Go-Live Readiness panel)`);
  lines.push(`- [ ] Go-Live Readiness panel shows no blockers`);
  lines.push("");

  lines.push(`### Recommended Before Go-Live`);
  lines.push(`- [ ] Routing configuration applied in Publishing`);
  lines.push(`- [ ] GitHub auto-sync setup reviewed`);
  lines.push(`- [ ] Rollback plan reviewed — know which release to roll back to`);
  lines.push(`- [ ] Monitoring/alerting confirmed (PM2, nginx logs)`);
  lines.push("");

  lines.push(`### After Promotion`);
  lines.push(`- [ ] Run smoke checks: Releases → Run Smoke Checks`);
  lines.push(`  - Domain root (HTTPS, should return 2xx/3xx)`);
  lines.push(`  - Internal health endpoint (\`/api/healthz\`)`);
  lines.push(`  - Public health endpoint`);
  lines.push(`  - SSL (confirm cert active from DB)`);
  lines.push(`- [ ] Verify login / auth flow works`);
  lines.push(`- [ ] Verify key user journeys`);
  lines.push("");

  lines.push(`### Promotion Instructions`);
  lines.push(`1. Open **Releases** in the panel`);
  lines.push(`2. Run Go-Live Readiness check — fix all blockers`);
  lines.push(`3. Review the Release Comparison card (Current Live vs Candidate)`);
  lines.push(`4. Click **Approve & Promote** and type \`PROMOTE\` to confirm`);
  lines.push(`5. Wait for promotion to complete before running smoke checks`);
  lines.push("");

  lines.push(`### Rollback Warning`);
  lines.push(`⚠️  Rollback reverts the deployment to the rollback target.`);
  lines.push(`   It does **not** roll back database migrations.`);
  lines.push(`   If your promotion included a DB migration, restore from backup instead.`);
  lines.push(`   Rollback confirmation requires typing \`ROLLBACK\`.`);
  lines.push("");

  return lines.join("\n") + "\n";
}

// ── Sprint 54: External services readiness section ───────────────────────────

function buildExternalServicesReadiness(_r: EnrichedMigrationReport): string {
  const PROD_WEBHOOK    = "https://sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";
  const STAGING_WEBHOOK = "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";

  const lines: string[] = [`## External Services Readiness\n`];

  lines.push(`> Configure Stripe, Cloudinary, and email before going live.`);
  lines.push(`> Check External Services Readiness in the Env page for live status.`);
  lines.push(`> No secret values are shown here — only key names.`);
  lines.push(``);

  lines.push(`### Stripe`);
  lines.push(``);
  lines.push(`- [ ] \`STRIPE_SECRET_KEY\` — use \`sk_test_*\` in staging, \`sk_live_*\` in production`);
  lines.push(`- [ ] \`STRIPE_PUBLISHABLE_KEY\` — use \`pk_test_*\` in staging, \`pk_live_*\` in production`);
  lines.push(`- [ ] \`STRIPE_WEBHOOK_SECRET\` — from Stripe Dashboard → Webhooks`);
  lines.push(`- [ ] Register production webhook: \`${PROD_WEBHOOK}\``);
  lines.push(`- [ ] Register staging webhook: \`${STAGING_WEBHOOK}\``);
  lines.push(`- [ ] Test a checkout using card \`4242 4242 4242 4242\` in staging`);
  lines.push(`- [ ] Verify webhook fires and order is created after test payment`);
  lines.push(`- [ ] Verify payment appears in Stripe test dashboard`);
  lines.push(``);

  lines.push(`### Cloudinary`);
  lines.push(``);
  lines.push(`- [ ] \`CLOUDINARY_CLOUD_NAME\` — from Cloudinary Dashboard → Settings`);
  lines.push(`- [ ] \`CLOUDINARY_API_KEY\` — from Cloudinary Dashboard → API Keys`);
  lines.push(`- [ ] \`CLOUDINARY_API_SECRET\` — from Cloudinary Dashboard → API Keys`);
  lines.push(`- [ ] Upload a test product image via the admin panel`);
  lines.push(`- [ ] Confirm image appears in Cloudinary dashboard`);
  lines.push(`- [ ] Confirm image appears correctly on the storefront`);
  lines.push(`- [ ] Replace or copy old Replit-hosted images to Cloudinary`);
  lines.push(``);

  lines.push(`### Email`);
  lines.push(``);
  lines.push(`- [ ] Email provider configured: one of \`RESEND_API_KEY\`, \`SENDGRID_API_KEY\`, or \`SMTP_*\` vars`);
  lines.push(`- [ ] Sender address configured (\`SMTP_FROM\`, \`MAIL_FROM\`, or \`EMAIL_FROM\`)`);
  lines.push(`- [ ] Sender domain SPF/DKIM/DMARC records verified`);
  lines.push(`- [ ] Password reset email tested in staging`);
  lines.push(`- [ ] Order confirmation email tested in staging`);
  lines.push(``);

  lines.push(`### APP_URL`);
  lines.push(``);
  lines.push(`- [ ] \`APP_URL\` set to production domain (\`https://yourdomain.com\`)`);
  lines.push(`- [ ] No \`localhost\` value in \`APP_URL\` in production`);
  lines.push(`- [ ] \`APP_URL\` matches the configured domain in the panel`);
  lines.push(``);

  return lines.join("\n") + "\n";
}

// ── Sprint 51: Staging import section ────────────────────────────────────────

function buildStagingImportHandoffSection(_r: EnrichedMigrationReport): string {
  const STAGING_SLUG   = "sardar-security-staging";
  const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [`## Staging Import Plan\n`];

  lines.push(`> Staging import is a prerequisite for production cutover.`);
  lines.push(`> Complete all staging steps and validate before making any DNS or routing changes.`);
  lines.push(``);

  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Staging slug | \`${STAGING_SLUG}\` |`);
  lines.push(`| Staging domain | \`${STAGING_DOMAIN}\` |`);
  lines.push(``);

  lines.push(`### Staging Service Checklist`);
  lines.push(``);
  lines.push(`- [ ] Configure API service — root: artifacts/api-server`);
  lines.push(`  \`pnpm --filter @workspace/api-server run build\``);
  lines.push(`  \`node --enable-source-maps artifacts/api-server/dist/index.mjs\``);
  lines.push(`- [ ] Configure static frontend — root: artifacts/sardar-security`);
  lines.push(`  \`pnpm --filter @workspace/sardar-security run build\``);
  lines.push(`  Output: artifacts/sardar-security/dist/public`);
  lines.push(`- [ ] SPA fallback enabled on frontend service`);
  lines.push(``);

  lines.push(`### Staging Env Checklist`);
  lines.push(``);
  lines.push(`> Key names only. Add staging/test values manually — never copy production secrets.`);
  lines.push(``);
  lines.push(`- [ ] DATABASE_URL — staging/test Neon database (separate from production)`);
  lines.push(`- [ ] SESSION_SECRET — new random value for staging`);
  lines.push(`- [ ] STRIPE_SECRET_KEY — sk_test_... (test key only)`);
  lines.push(`- [ ] STRIPE_PUBLISHABLE_KEY — pk_test_... (test key only)`);
  lines.push(`- [ ] STRIPE_WEBHOOK_SECRET — staging webhook secret`);
  lines.push(`- [ ] CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET`);
  lines.push(`- [ ] APP_URL — https://${STAGING_DOMAIN}`);
  lines.push(`- [ ] Email provider env (RESEND_API_KEY, SMTP_* etc.)`);
  lines.push(``);

  lines.push(`### Staging DB Checklist`);
  lines.push(``);
  lines.push(`- [ ] Staging DATABASE_URL points to separate database`);
  lines.push(`- [ ] Run: \`pnpm --filter @workspace/db exec drizzle-kit push\``);
  lines.push(`  > ⚠️  Never run schema push against production database.`);
  lines.push(`- [ ] Verify schema pushed correctly`);
  lines.push(``);

  lines.push(`### Staging Smoke Checks`);
  lines.push(``);
  lines.push(`- [ ] https://${STAGING_DOMAIN}/ returns 200`);
  lines.push(`- [ ] https://${STAGING_DOMAIN}/api/healthz returns { ok: true }`);
  lines.push(`- [ ] SPA fallback: deep link returns 200`);
  lines.push(`- [ ] SSL valid at https://${STAGING_DOMAIN}`);
  lines.push(``);

  lines.push(`> Only proceed to production cutover after staging smoke checks pass.`);
  lines.push(``);

  return lines.join("\n") + "\n";
}

// ── Main export ───────────────────────────────────────────────────────────────

export type HandoffOptions = {
  /** Results from applyMigrationPlanAction — optional */
  appliedResults?: Array<{ id: string; ok: boolean; summary: string }>;
  /** Targets already handled (env var names, field names) — for filtering manual steps */
  appliedTargets?: string[];
};

/**
 * Generates a Markdown handoff document from an enriched migration report.
 * Safe to share — no secret values are included.
 */
export function generateHandoffMarkdown(
  report:  EnrichedMigrationReport,
  options: HandoffOptions = {},
): string {
  const { appliedResults, appliedTargets = [] } = options;

  return [
    buildHeader(report),
    buildBlockers(report),
    buildWarnings(report),
    buildEnvVars(report),
    buildExternalServices(report),
    appliedResults ? buildAppliedChanges(appliedResults) : "",
    appliedTargets.length > 0
      ? buildRemainingManualSteps(report, appliedTargets)
      : buildManualSteps(report),
    buildDatabase(report),
    buildDatabaseReadiness(report),
    buildEnvReadiness(report),
    buildDomainReadiness(report),
    buildGitHubReadiness(report),
    buildGoLiveReadiness(report),
    buildExternalServicesReadiness(report),
    buildStagingImportHandoffSection(report),
    buildServices(report),
    buildFooter(),
  ]
    .filter(Boolean)
    .join("\n");
}
