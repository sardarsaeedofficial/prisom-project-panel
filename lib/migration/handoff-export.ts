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

// ── Sprint 55: Production Cutover Plan section ───────────────────────────────

function buildProductionCutover(_r: EnrichedMigrationReport): string {
  const PROD_DOMAIN    = "sardar-security-project.doorstepmanchester.uk";
  const PROD_WEBHOOK   = `https://${PROD_DOMAIN}/api/webhooks/stripe`;
  const STAGE_WEBHOOK  = "https://staging-sardar-security-project.doorstepmanchester.uk/api/webhooks/stripe";

  const lines: string[] = [`## Production Cutover Plan\n`];

  lines.push(`> Use the Production Cutover Assistant in the Releases page to generate a live cutover plan.`);
  lines.push(`> This section is a static reference checklist. The live panel has real-time readiness signals.`);
  lines.push(``);

  lines.push(`### Pre-Cutover Checklist`);
  lines.push(``);
  lines.push(`- [ ] Staging import passed — staging smoke checks are green`);
  lines.push(`- [ ] Deployment dry run passed (Publishing → Dry Run)`);
  lines.push(`- [ ] External services readiness reviewed (Env → External Services)`);
  lines.push(`- [ ] Production env values set (no localhost, correct domain)`);
  lines.push(`- [ ] Database readiness confirmed — connection test passed`);
  lines.push(`- [ ] Final backup created before cutover`);
  lines.push(`- [ ] Go-live readiness: no blockers`);
  lines.push(`- [ ] Rollback plan reviewed with team`);
  lines.push(``);

  lines.push(`### Cutover Steps (in order)`);
  lines.push(``);
  lines.push(`1. **Freeze Window** — freeze writes/orders on old system if required`);
  lines.push(`2. **Backup** — create final database + files backup`);
  lines.push(`3. **Database** — run DB migration manually if required (never auto-run)`);
  lines.push(`   \`pnpm --filter @workspace/db exec drizzle-kit push\``);
  lines.push(`   > ⚠️  Never run against production without team confirmation.`);
  lines.push(`4. **Deploy Services** — deploy using the Publishing page (type \`PROMOTE\`)`);
  lines.push(`5. **Apply Routes** — apply nginx routes using the Publishing → Routing panel (type \`APPLY ROUTES\`)`);
  lines.push(`6. **Stripe Webhook** — add production endpoint in Stripe Dashboard → Webhooks:`);
  lines.push(`   - Production: \`${PROD_WEBHOOK}\``);
  lines.push(`   - Staging: \`${STAGE_WEBHOOK}\``);
  lines.push(`7. **Smoke Checks** — run from Releases → Production Cutover Assistant (type \`RUN SMOKE CHECKS\`)`);
  lines.push(`   - \`curl -I https://${PROD_DOMAIN}/\``);
  lines.push(`   - \`curl -I https://${PROD_DOMAIN}/api/healthz\``);
  lines.push(`8. **Manual Test Order** — place a test checkout using Stripe test card`);
  lines.push(`9. **Monitor Logs** — monitor PM2 and nginx logs for 1 hour`);
  lines.push(`10. **Mark Complete** — type \`MARK CUTOVER COMPLETE\` in the panel`);
  lines.push(``);

  lines.push(`### Rollback Plan`);
  lines.push(``);
  lines.push(`> ⚠️  Application rollback does NOT rollback database schema/data.`);
  lines.push(`> If your cutover included a DB migration, restore from backup instead.`);
  lines.push(``);
  lines.push(`- App rollback: Releases → click Rollback → type \`ROLLBACK\``);
  lines.push(`- Route rollback: Publishing → Routing → Rollback Routes → type \`ROLLBACK ROUTES\``);
  lines.push(`- DB rollback: restore from pre-cutover dump manually`);
  lines.push(`- Stripe webhook rollback: update/delete endpoint in Stripe Dashboard`);
  lines.push(`- DNS rollback: update A record to previous IP (up to 48h propagation)`);
  lines.push(``);

  lines.push(`### Safety Rules`);
  lines.push(``);
  lines.push(`- Never apply routes automatically`);
  lines.push(`- Never restart services from the cutover assistant`);
  lines.push(`- Never run DB migrations automatically`);
  lines.push(`- Never create Stripe webhooks automatically`);
  lines.push(`- Never expose secret values`);
  lines.push(`- Never touch Doorsteps/LocalShop (prisom-manager, prisom-backend)`);
  lines.push(``);

  return lines.join("\n") + "\n";
}

// ── Sprint 61: Staging Trial Migration section ────────────────────────────────

function buildStagingTrialSection(): string {
  const STAGING_SLUG   = "sardar-security-staging";
  const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Sardar Staging Trial Migration",
    "",
    "> Complete the staging trial migration using the **Migration → Staging Trial** panel.",
    "> All stages must pass and manual evidence items must be confirmed before production cutover.",
    "> This trial does NOT modify live Sardar routing, apply nginx changes, run DB migrations, or restart PM2.",
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| Staging slug | \`${STAGING_SLUG}\` |`,
    `| Staging domain | \`${STAGING_DOMAIN}\` |`,
    `| Staging trial action | Migration → Staging Trial Migration |`,
    "",
    "### Trial Stage Checklist",
    "",
    "| Stage | Description |",
    "|-------|-------------|",
    "| Source Intake | Source imported, structure detected, Replit markers patched |",
    "| Staging Import | Staging project exists, source deployed to staging environment |",
    "| Services | API service and static frontend service configured |",
    "| Env / Secrets | Staging env vars configured (test/sandbox values only) |",
    "| Database | Staging DB URL separate from production, schema reviewed |",
    "| Routing | Route preview correct — /api/* → API, /* → frontend SPA |",
    "| Dry Run | Deployment dry run executed and passed |",
    "| External Services | Stripe test mode, Cloudinary, email all verified in staging |",
    "| Backup Drill | Backup integrity verified, restore drill reviewed |",
    "| Smoke Checks | Root URL 200, /api/healthz 200, SPA fallback 200 (RUN STAGING CHECKS) |",
    "| Manual Review | All evidence items manually confirmed |",
    "",
    "### Smoke Check Confirmation",
    "",
    "Type `RUN STAGING CHECKS` in the Staging Trial panel to run HTTP checks against the staging domain.",
    "",
    "- Checks: `/`, `/api/healthz`, `/non-existent-spa-route`",
    "- Expected: all return HTTP 200 (or 3xx redirect for /)",
    "- DNS/connection failures return a warning, not a blocker — staging may not be deployed yet",
    "",
    "### Mark Trial Complete",
    "",
    "Once all stages pass and the manual evidence checklist is confirmed:",
    "",
    "Type `MARK TRIAL COMPLETE` in the Staging Trial Migration panel.",
    "",
    "> Only then proceed to production cutover.",
    "",
    "### Safety Rules",
    "",
    "- Staging trial does NOT route production traffic",
    "- Staging trial does NOT apply production nginx config",
    "- Staging trial does NOT run production DB migrations",
    "- Staging trial does NOT restart live PM2 services",
    "- Staging env must use separate DB from production",
    "- No production secrets copied to staging — use test/sandbox values only",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 62: Ecommerce Test Proof section ───────────────────────────────────

function buildEcommerceTestProofSection(): string {
  const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Ecommerce Test Proof (Sardar Security Supplies)",
    "",
    "> Complete the **Ecommerce Test Harness** on the Migration page before production go-live.",
    "> No real charges, no production orders, no secrets exposed.",
    "> All Stripe tests must use test-mode keys and test cards only.",
    "",
    `**Staging target:** \`https://${STAGING_DOMAIN}\``,
    "",
    "### Provider Readiness Checklist",
    "",
    "| Provider | Required Env Names | Notes |",
    "|----------|--------------------|-------|",
    "| Stripe   | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Use `sk_test_` / `pk_test_` in staging |",
    "| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Staging can share Cloudinary account |",
    "| Email | `RESEND_API_KEY` or `SMTP_HOST` | Use test mailbox in staging |",
    "",
    "### Safe Ecommerce Smoke Checks",
    "",
    "> Confirm with `RUN SAFE ECOMMERCE CHECKS` in the Ecommerce Test Harness panel.",
    "",
    "- [ ] `GET /` returns HTTP 200",
    "- [ ] `GET /api/healthz` returns HTTP 200",
    "- [ ] `GET /non-existent-route` returns HTTP 200 (SPA fallback)",
    "- [ ] `GET /products` or `/shop` returns HTTP 200",
    "- [ ] `GET /api/products` returns HTTP 200 (if applicable)",
    "",
    "### Manual Order Flow Checklist",
    "",
    "- [ ] Storefront loads on staging",
    "- [ ] Product list visible",
    "- [ ] Product detail page visible",
    "- [ ] Product images load (Cloudinary)",
    "- [ ] Add-to-cart works",
    "- [ ] Cart quantity update works",
    "- [ ] Cart item remove works",
    "- [ ] Checkout form loads",
    "- [ ] Checkout validation errors display",
    "- [ ] Stripe test card checkout reviewed (`4242 4242 4242 4242`)",
    "- [ ] Stripe webhook endpoint documented and registered in Stripe Dashboard (test)",
    "- [ ] Test order created in staging/test mode ONLY",
    "- [ ] Order confirmation page reviewed",
    "- [ ] Admin orders page reviewed",
    "- [ ] Test email reviewed (no real customer address)",
    "- [ ] Cloudinary test upload reviewed safely",
    "- [ ] Refund/cancel path reviewed manually",
    "- [ ] Database backup exists before order-flow test",
    "",
    "### Stripe Test Mode Instructions",
    "",
    "> **Use test mode only.** Stripe live keys must not be used in staging.",
    "",
    "| Scenario | Card | Expiry | CVC |",
    "|----------|------|--------|-----|",
    "| Success | `4242 4242 4242 4242` | Any future | Any |",
    "| Insufficient funds | `4000 0000 0000 9995` | Any future | Any |",
    "| Requires auth | `4000 0025 0000 3155` | Any future | Any |",
    "| Declined | `4000 0000 0000 0002` | Any future | Any |",
    "",
    `Staging webhook: \`https://${STAGING_DOMAIN}/api/webhooks/stripe\``,
    "",
    "### Safety Rules",
    "",
    "- Never use Stripe live keys (sk_live_ / pk_live_) in staging",
    "- Never use real customer email addresses for test email delivery",
    "- Never upload destructive assets to Cloudinary during testing",
    "- Never create production orders during staging tests",
    "- Never charge real cards",
    "- Ecommerce harness HTTP checks are GET-only — no POST to checkout or order endpoints",
    "",
  ];
  return lines.join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export type HandoffOptions = {
  /** Results from applyMigrationPlanAction — optional */
  appliedResults?: Array<{ id: string; ok: boolean; summary: string }>;
  /** Targets already handled (env var names, field names) — for filtering manual steps */
  appliedTargets?: string[];
};

// ── Sprint 57: Source Intake Summary ──────────────────────────────────────────

function buildSourceIntakeSummary(_r: EnrichedMigrationReport): string {
  const SLUG        = "sardar-security-supplies";
  const SOURCE_ROOT = `storage/projects/${SLUG}`;

  const lines: string[] = [
    `## Source Intake Summary`,
    ``,
    `> Run the **Source Intake** panel on the Import page to generate the full SOURCE_INTAKE_REPORT.md.`,
    ``,
    `**Expected detections for Sardar Security Supplies:**`,
    ``,
    `| Item | Expected Detection |`,
    `| --- | --- |`,
    `| Package manager | \`pnpm\` (pnpm-lock.yaml) |`,
    `| Workspace | \`pnpm-workspace.yaml\` |`,
    `| API service | \`artifacts/api-server\` (Express/Fastify/Hono) |`,
    `| Static frontend | \`artifacts/sardar-security\` (Vite/React) |`,
    `| Database | Drizzle + PostgreSQL (\`lib/db\`) |`,
    `| Env example | \`.env.example\` at workspace root |`,
    `| Replit markers | \`.replit\`, \`replit.nix\` if present |`,
    ``,
    `**Source path:** \`${SOURCE_ROOT}\``,
    ``,
    `**Safety reminders:**`,
    `- Never deploy source automatically after import.`,
    `- Run portability patches before deployment if Replit markers are detected.`,
    `- Never run \`drizzle-kit push\` or \`prisma migrate deploy\` automatically.`,
    `- Add all env variables to the Secrets Vault — never commit .env files.`,
    ``,
  ];

  return lines.join("\n");
}

// ── Sprint 59: Permissions & Access Control section ───────────────────────────

function buildPermissionsSection(): string {
  const lines: string[] = [
    "## Permissions & Access Control",
    "",
    "### Permission Model Summary",
    "",
    "This project uses a 5-tier RBAC model:",
    "",
    "| Role      | Key permissions |",
    "|-----------|-----------------|",
    "| Owner     | Full control — team management, delete project, all secrets |",
    "| Admin     | Same as Owner, except cannot transfer ownership |",
    "| Developer | Code write, terminal, deploy.trigger, env names (read only) |",
    "| Operator  | deploy.trigger, deploy.rollback, monitoring — read-only code |",
    "| Viewer    | Read-only across all resources, no deployment or command access |",
    "",
    "### Dangerous Actions — Required Access",
    "",
    "The following actions require elevated permissions and must only be granted to trusted users:",
    "",
    "| Action                          | Required Permission           |",
    "|---------------------------------|-------------------------------|",
    "| Apply Production Routes         | deploy.trigger or project.edit |",
    "| Mark Cutover Complete           | deploy.trigger or project.edit |",
    "| Run Smoke Checks                | deploy.trigger or project.edit |",
    "| Trigger Deployment              | deploy.trigger or project.edit |",
    "| Rollback Deployment             | deploy.rollback or project.edit |",
    "| Write Environment Variables     | env.manage or project.edit   |",
    "| Write Secrets                   | secrets.manage or project.edit |",
    "| Replace Project Source          | project.edit                  |",
    "| Restore from Backup             | backup.restore                |",
    "| Manage Team Members             | project.manageTeam            |",
    "",
    "### Pre-Cutover Team Review Checklist",
    "",
    "Before staging execution or production cutover, confirm:",
    "",
    "- [ ] Owner or Admin confirmed for this project",
    "- [ ] Deploy permission limited to Operator / Developer / Admin / Owner",
    "- [ ] Env and secret editing limited to Developer / Admin / Owner",
    "- [ ] Route apply limited to trusted users",
    "- [ ] Cutover completion limited to trusted users",
    "- [ ] Backup restore limited to trusted users",
    "- [ ] Former team members removed from the project",
    "- [ ] Pending invite links reviewed or cancelled",
    "- [ ] Audit log reviewed for unexpected permission denials",
    "",
    "> **Note:** No secrets are included in this document. Secret names and required",
    "> env vars are listed in the Env & Secrets section. Values must be set via the",
    "> project Env page before go-live.",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 60: Disaster Recovery & Restore Drill section ─────────────────────

function buildDisasterRecoverySection(): string {
  const DRILL_SLUG   = "sardar-security-restore-drill";
  const DRILL_DOMAIN = "restore-sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Disaster Recovery & Restore Drill",
    "",
    "> Complete a staging restore drill before production cutover to confirm your backup is recoverable.",
    "> No live restore is triggered automatically — all actions require explicit confirmation.",
    "",
    "### Backup Status Checklist",
    "",
    "- [ ] At least one ready backup exists (Backups page)",
    "- [ ] Latest backup is within 7 days of go-live",
    "- [ ] Backup archive file is present on disk (non-zero size)",
    "- [ ] SHA-256 checksum recorded",
    "- [ ] Scheduled backup configured and enabled",
    "- [ ] Backup retention set to at least 3",
    "",
    "### Restore Drill Plan",
    "",
    `**Staging restore target:** \`${DRILL_SLUG}\` — \`${DRILL_DOMAIN}\``,
    "",
    "Complete the following steps before production cutover:",
    "",
    "1. **Select latest backup** — from the Backups page",
    "2. **Verify backup integrity** — type `VERIFY BACKUP` to confirm archive is intact",
    `3. **Create drill project** — use slug \`${DRILL_SLUG}\` (not the live project)`,
    "4. **Restore source files** — restore into drill project (confirm: `RESTORE TO STAGING`)",
    "5. **Add test env values** — use safe staging/sandbox values only (never copy production secrets)",
    "6. **Run deployment dry run** — confirm source builds in drill project",
    "7. **Run build dry run** — confirm build command succeeds",
    "8. **Configure staging route** — preview route for drill domain only, no production nginx changes",
    `9. **Run smoke checks** — \`curl -I https://${DRILL_DOMAIN}/\``,
    "10. **Compare output** — check key pages against the live project",
    "11. **Mark drill complete** — type `MARK DRILL COMPLETE` in the Backups → DR Drill panel",
    "",
    "### Release Rollback Plan",
    "",
    "- [ ] At least 2 successful deployments exist (rollback requires a prior release)",
    "- [ ] Rollback confirmation: type `ROLLBACK` in Releases page",
    "- [ ] Previous deployment ref recorded before cutover",
    "",
    "> **Note:** Application rollback does NOT rollback database schema or data.",
    "",
    "### Route Rollback Plan",
    "",
    "1. `sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>`",
    "2. `sudo nginx -t`",
    "3. If test passes: `sudo nginx -s reload`",
    "4. Verify domain resolves correctly",
    "",
    "> Always take an nginx config backup before applying new routes.",
    "",
    "### ⚠️  Database Rollback Warning",
    "",
    "> **CRITICAL: Application rollback does NOT automatically rollback database schema or data.**",
    "> Database changes may be irreversible without a separate DB-level backup.",
    "",
    "- Take a DB dump before any migration: `pg_dump <db> > backup_before_migration.sql`",
    "- Keep the dump outside the project directory",
    "- To restore DB: `psql <db> < backup_before_migration.sql`",
    "- Test DB restore on staging before applying to production",
    "",
    "### Monitoring After Restore",
    "",
    "```bash",
    "curl -I https://projects.doorstepmanchester.uk/login",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    "```",
    "",
    "Expected: all return HTTP 200.",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 63: Final Go-Live Gate summary section ─────────────────────────────

function buildFinalGoLiveGateSection(): string {
  const lines: string[] = [
    "## Final Go-Live Gate (Sprint 63)",
    "",
    "> Aggregate production readiness gate — Sprints 50–62.",
    "> **Generate the gate report on the Releases page** before production cutover.",
    "> No secrets are included in this section.",
    "",
    "### Key Requirements (all must pass before cutover)",
    "",
    "| Category | Requirement | Page |",
    "|----------|-------------|------|",
    "| Source | Deployment config exists, services configured | Publishing |",
    "| Staging | Trial migration complete (MARK TRIAL COMPLETE) | Migration |",
    "| Ecommerce | Ecommerce proof complete (MARK ECOMMERCE PROOF COMPLETE) | Migration |",
    "| Env | Env vars configured, no placeholders, no localhost | Env |",
    "| Database | Connection test passed, migration plan reviewed | Database |",
    "| External | Stripe/Cloudinary/email on staging | Env |",
    "| Routing | Nginx routing plan reviewed and approved | Publishing |",
    "| Domains | Active domain, SSL cert issued | Domains |",
    "| Deployment | At least 1 successful deployment | Releases |",
    "| Backup | Recent backup exists, restore drill complete (MARK DRILL COMPLETE) | Backups |",
    "| Permissions | Team roles reviewed, no unauthorized access | Team |",
    "| Rollback | Rollback target exists, rollback plan reviewed | Releases |",
    "| Manual | Owner sign-off obtained | Releases |",
    "",
    "### Final Evidence Checklist",
    "",
    "- [ ] Source intake reviewed",
    "- [ ] Staging trial migration reviewed (MARK TRIAL COMPLETE)",
    "- [ ] Ecommerce proof reviewed (MARK ECOMMERCE PROOF COMPLETE)",
    "- [ ] Backup/restore drill reviewed (MARK DRILL COMPLETE)",
    "- [ ] Team permissions reviewed",
    "- [ ] Env/secrets reviewed (no placeholders, no localhost)",
    "- [ ] Database readiness reviewed (connection test passed)",
    "- [ ] External services reviewed (Stripe/Cloudinary/email on staging)",
    "- [ ] Routing plan reviewed (nginx preview approved)",
    "- [ ] Domain/SSL health reviewed",
    "- [ ] Build dry run reviewed",
    "- [ ] Rollback plan reviewed",
    "- [ ] Debug/logs page checked",
    "- [ ] Owner sign-off obtained",
    "",
    "### Safety Rules",
    "",
    "- Do not apply production nginx routes before all gate checks pass",
    "- Do not restart PM2 automatically — use Releases → MARK CUTOVER COMPLETE",
    "- Do not run DB migrations automatically",
    "- Do not expose secrets in the gate report",
    "- Do not touch Doorsteps/LocalShop",
    "- Application rollback does NOT rollback DB schema/data",
    "- Generate `FINAL_GO_LIVE_PACK.md` on the Releases page — download for your records",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 64: Staging Deployment Proof summary section ──────────────────────

function buildStagingDeploymentProofSection(): string {
  const STAGING_SLUG   = "sardar-security-staging";
  const STAGING_DOMAIN = "staging-sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Staging Deployment Proof (Sprint 64)",
    "",
    `> **Staging slug:** \`${STAGING_SLUG}\``,
    `> **Staging domain:** \`https://${STAGING_DOMAIN}\``,
    "> **Generate the full proof on the Migration page** — Staging Deployment panel.",
    "> No secrets are included in this section.",
    "",
    "### Sardar Service Plan",
    "",
    "| Service | Kind | Root | Build Command | Route |",
    "|---------|------|------|---------------|-------|",
    "| `api`   | API     | `artifacts/api-server`      | `pnpm --filter @workspace/api-server run build`      | `/api/*` |",
    "| `web`   | Static  | `artifacts/sardar-security` | `pnpm --filter @workspace/sardar-security run build` | `/*`     |",
    "",
    "### Source Preparation (plan-only)",
    "",
    "```bash",
    "# Install",
    "pnpm install --frozen-lockfile",
    "",
    "# Build",
    "pnpm --filter @workspace/api-server run build",
    "pnpm --filter @workspace/sardar-security run build",
    "```",
    "",
    "### Staging Smoke Checks",
    "",
    "| Check | URL |",
    "|-------|-----|",
    `| Root | \`https://${STAGING_DOMAIN}/\` |`,
    `| API health | \`https://${STAGING_DOMAIN}/api/healthz\` |`,
    `| SPA fallback | \`https://${STAGING_DOMAIN}/non-existent-spa-route\` |`,
    "",
    "### Staging Evidence Checklist",
    "",
    "- [ ] Staging project target reviewed",
    "- [ ] Staging source path reviewed",
    "- [ ] Production source untouched",
    "- [ ] Staging env placeholders reviewed",
    "- [ ] Staging DATABASE_URL uses staging DB",
    "- [ ] API service command reviewed",
    "- [ ] Static frontend command reviewed",
    "- [ ] /api/* route preview reviewed",
    "- [ ] /* static route preview reviewed",
    "- [ ] Build dry run reviewed",
    "- [ ] Staging root smoke check reviewed",
    "- [ ] Staging API health reviewed",
    "- [ ] Staging SPA fallback reviewed",
    "- [ ] Logs reviewed after dry run",
    "- [ ] Staging marked ready by owner",
    "",
    "### Safety Rules",
    "",
    "- Do not overwrite live Sardar source (port 4100)",
    "- Do not mutate production nginx routes",
    "- Do not change DNS without team approval",
    "- Do not restart live Sardar PM2 processes",
    "- Do not run production DB migrations",
    "- Do not copy production secrets into staging automatically",
    "- Confirm with MARK STAGING READY when all items pass",
    "",
  ];
  return lines.join("\n");
}

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
    buildProductionCutover(report),
    buildSourceIntakeSummary(report),
    buildPermissionsSection(),
    buildDisasterRecoverySection(),
    buildStagingTrialSection(),
    buildEcommerceTestProofSection(),
    buildStagingDeploymentProofSection(),
    buildFinalGoLiveGateSection(),
    buildServices(report),
    buildFooter(),
  ]
    .filter(Boolean)
    .join("\n");
}
