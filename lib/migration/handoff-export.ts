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

function buildPostCutoverMonitoringSection(): string {
  const LIVE_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Post-Cutover Monitoring & Incident Response (Sprint 66)",
    "",
    `> **Live domain:** \`https://${LIVE_DOMAIN}\``,
    "> **Panel location:** Monitoring page → Post-Cutover Monitoring Control Room",
    "> **No secrets are included in this section.**",
    "> This section is a reference guide only. No production mutation happens automatically.",
    "",
    "### Production Health Checks",
    "",
    "| Check | URL | Required |",
    "|-------|-----|----------|",
    `| Production root     | \`https://${LIVE_DOMAIN}/\`                       | Yes |`,
    `| API health endpoint | \`https://${LIVE_DOMAIN}/api/healthz\`            | Yes |`,
    `| SPA fallback route  | \`https://${LIVE_DOMAIN}/non-existent-spa-route\` | No  |`,
    `| Product listing     | \`https://${LIVE_DOMAIN}/products\`               | No  |`,
    `| Shop page           | \`https://${LIVE_DOMAIN}/shop\`                   | No  |`,
    `| API products        | \`https://${LIVE_DOMAIN}/api/products\`           | No  |`,
    "",
    "All health checks are GET-only. No checkout, no orders, no Stripe calls, no provider mutation.",
    "",
    "### Ecommerce Manual Health Checklist",
    "",
    "- [ ] Storefront loads for customers",
    "- [ ] Product list loads",
    "- [ ] Product detail loads",
    "- [ ] Cart page loads",
    "- [ ] Checkout page accessible",
    "- [ ] Admin login works",
    "- [ ] Orders page works",
    "- [ ] Stripe dashboard checked for errors",
    "- [ ] Webhook delivery reviewed",
    "- [ ] Email provider dashboard checked",
    "- [ ] Cloudinary media loads",
    "- [ ] No customer complaints reported",
    "",
    "### Incident Severity Guide",
    "",
    "| Severity | Criteria |",
    "|----------|----------|",
    "| Critical | Production root down, API health down, SSL failure, routing broken, database unreachable |",
    "| High     | Checkout unavailable, admin unavailable, repeated 5xx, product pages unavailable |",
    "| Medium   | Ecommerce manual checks incomplete, email/Cloudinary warnings |",
    "| Low      | Optional pages missing, manual reviews pending |",
    "| None     | All required checks pass |",
    "",
    "### Incident Response Checklist",
    "",
    "- [ ] Incident severity confirmed",
    "- [ ] Logs reviewed (PM2 + nginx)",
    "- [ ] Failed checks identified",
    "- [ ] Customer impact assessed",
    "- [ ] Owner assigned",
    "- [ ] Rollback criteria reviewed",
    "- [ ] Backup location confirmed",
    "- [ ] Communication drafted",
    "- [ ] Post-fix smoke checks planned",
    "",
    "### Rollback Conditions",
    "",
    "> App rollback does NOT rollback DB schema/data. Requires EXECUTE PRODUCTION ROLLBACK confirmation.",
    "",
    "Consider rollback when:",
    "- Production root (/) is unreachable and cannot be fixed quickly",
    "- API health endpoint is down and API service cannot restart cleanly",
    "- SSL failure that cannot be resolved without nginx config restore",
    "- 3+ simultaneous check failures indicating systemic problem",
    "",
    "### Operator Commands",
    "",
    "```bash",
    `curl -I https://${LIVE_DOMAIN}/`,
    `curl -I https://${LIVE_DOMAIN}/api/healthz`,
    `curl -I https://${LIVE_DOMAIN}/non-existent-spa-route`,
    "pm2 status",
    "pm2 logs --lines 100",
    "sudo tail -f /var/log/nginx/error.log",
    "```",
    "",
    "### Confirmation Phrases",
    "",
    "| Action | Phrase |",
    "|--------|--------|",
    "| Production health checks | `RUN PRODUCTION HEALTH CHECKS` |",
    "| Mark incident reviewed   | `MARK INCIDENT REVIEWED` |",
    "| Export monitoring report | `EXPORT MONITORING REPORT` |",
    "",
    "### Audit Events",
    "",
    "| Event | Category |",
    "|-------|----------|",
    "| `post_cutover.report_generated`      | publishing |",
    "| `post_cutover.health_checks_started` | publishing |",
    "| `post_cutover.health_checks_passed`  | publishing |",
    "| `post_cutover.health_checks_failed`  | publishing |",
    "| `post_cutover.incident_reviewed`     | publishing |",
    "| `post_cutover.report_exported`       | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildProductionCutoverExecutionSection(): string {
  const LIVE_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

  const lines: string[] = [
    "## Production Cutover Execution Guard (Sprint 65)",
    "",
    `> **Live domain:** \`https://${LIVE_DOMAIN}\``,
    "> **Panel location:** Releases page → Production Cutover Execution Guard",
    "> **No secrets are included in this section.**",
    "> This section is a reference guide only. No production mutation happens automatically.",
    "",
    "### Route Apply Preview",
    "",
    "| Path | Target | Type |",
    "|------|--------|------|",
    "| `/api/*`        | API service (Node.js, port from deploy config) | api |",
    "| `/*`            | Static frontend (artifacts/sardar-security/dist/public) | static |",
    "| `/* (fallback)` | index.html (SPA fallback for client-side routing) | spa_fallback |",
    "",
    "### Pre-Apply Checklist",
    "",
    "- [ ] Final go-live gate report generated and reviewed",
    "- [ ] All 14 gate evidence items reviewed",
    "- [ ] No blockers in gate report",
    "- [ ] Staging trial migration proof reviewed",
    "- [ ] Ecommerce test proof reviewed",
    "- [ ] Staging deployment proof reviewed and marked ready",
    "- [ ] Final backup created immediately before cutover",
    "- [ ] Restore drill completed",
    "- [ ] DB rollback limitation acknowledged",
    "- [ ] Production domain verified and SSL active",
    "- [ ] Route preview reviewed — /api/* and /* confirmed",
    "- [ ] sudo nginx -t passes on server",
    "- [ ] Team present for cutover and rollback",
    "- [ ] Owner sign-off — APPLY PRODUCTION CUTOVER",
    "",
    "### Smoke Check Checklist",
    "",
    `| Check | URL |`,
    `|-------|-----|`,
    `| Production root     | \`https://${LIVE_DOMAIN}/\` |`,
    `| API health endpoint | \`https://${LIVE_DOMAIN}/api/healthz\` |`,
    `| SPA fallback route  | \`https://${LIVE_DOMAIN}/non-existent-spa-route\` |`,
    "",
    "All smoke checks are GET-only. No checkout, orders, Stripe calls, or provider mutation.",
    "",
    "### Rollback Checklist",
    "",
    "> App rollback does NOT rollback DB schema/data. Requires EXECUTE PRODUCTION ROLLBACK confirmation.",
    "",
    "- [ ] Previous deployment ref identified",
    "- [ ] nginx backup (.bak) created before applying routes",
    "- [ ] Rollback nginx: `sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>`",
    "- [ ] Validate: `sudo nginx -t`",
    "- [ ] Reload: `sudo nginx -s reload`",
    "- [ ] Restart previous PM2 release if needed",
    "- [ ] Verify: `curl -I https://sardar-security-project.doorstepmanchester.uk/`",
    "- [ ] DB rollback from pg_dump if required (manual — coordinate DBA)",
    "",
    "### Manual Operator Commands",
    "",
    "```bash",
    "# Pre-cutover",
    `curl -I https://${LIVE_DOMAIN}/`,
    `curl -I https://${LIVE_DOMAIN}/api/healthz`,
    "pm2 status",
    "",
    "# nginx validation (always before reload)",
    "sudo cp /etc/nginx/sites-available/<project> /etc/nginx/sites-available/<project>.bak",
    "sudo nginx -t",
    "# sudo nginx -s reload  ← only after nginx -t passes",
    "",
    "# Post-cutover",
    `curl -I https://${LIVE_DOMAIN}/`,
    `curl -I https://${LIVE_DOMAIN}/api/healthz`,
    "pm2 logs --lines 50",
    "sudo tail -f /var/log/nginx/error.log",
    "```",
    "",
    "### Confirmation Phrases",
    "",
    "| Action | Phrase |",
    "|--------|--------|",
    "| Smoke checks | `RUN PRODUCTION SMOKE CHECKS` |",
    "| Production cutover apply | `APPLY PRODUCTION CUTOVER` |",
    "| Production rollback | `EXECUTE PRODUCTION ROLLBACK` |",
    "",
    "### Safety Rules",
    "",
    "- Do not apply production routes automatically",
    "- Do not change DNS automatically",
    "- Do not run DB migrations",
    "- Do not restart PM2 without review",
    "- Do not touch Doorsteps/LocalShop (/home/prisom/prisom-panel)",
    "- Do not expose secrets",
    "- Apply/rollback are guarded execution-records — operator must apply nginx manually",
    "",
    "### Audit Events",
    "",
    "| Event | Category |",
    "|-------|----------|",
    "| `production_execution.plan_generated` | publishing |",
    "| `production_execution.route_preview_generated` | publishing |",
    "| `production_execution.smoke_checks_started` | publishing |",
    "| `production_execution.smoke_checks_passed` | publishing |",
    "| `production_execution.smoke_checks_failed` | publishing |",
    "| `production_execution.cutover_apply_requested` | publishing |",
    "| `production_execution.rollback_requested` | publishing |",
    "| `production_execution.plan_exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 67: Operator Runbook & Admin Onboarding ────────────────────────────

function buildOperatorRunbookSection(): string {
  const lines = [
    "---",
    "",
    "## Operator Runbook & Admin Onboarding",
    "",
    "**Sprint 67 — Documentation & Guided UX**",
    "",
    "### Daily Operator Checklist",
    "",
    "| Step | Page | Action |",
    "| --- | --- | --- |",
    "| Check Monitoring | /monitoring | Generate report. Run RUN PRODUCTION HEALTH CHECKS. |",
    "| Check Logs | /logs | Review PM2 log stream. Look for new error patterns. |",
    "| Check Operations | /operations | Confirm no unexpected actions were performed. |",
    "| Check Backups | /backups | Verify latest backup is < 3 days old. |",
    "| Check Sardar frontend | sardar-security-project.doorstepmanchester.uk | Storefront must return 200. |",
    "| Check Sardar health | /api/healthz | Health endpoint must return 200. |",
    "",
    "### Admin Onboarding Checklist",
    "",
    "| # | Item | Notes |",
    "| --- | --- | --- |",
    "| 1 | Login tested | Confirm admin login works. |",
    "| 2 | Admin users reviewed | /admin/users — verify OWNER/ADMIN roles only for trusted users. |",
    "| 3 | Project team reviewed | Visit Team page. Confirm roles are correct. |",
    "| 4 | Owner/admin confirmed | At least one person has OWNER and knows their responsibilities. |",
    "| 5 | Deploy permissions reviewed | Only intended users have deploy.trigger. |",
    "| 6 | Env/secret access reviewed | Settings page — secret names only, no values shown. |",
    "| 7 | Backup page reviewed | Confirm recent backup exists. |",
    "| 8 | Monitoring page reviewed | Run health checks. Read the report. |",
    "| 9 | Logs/debug page reviewed | PM2 log streaming confirmed. Debug Summary panel checked. |",
    "| 10 | Final Go-Live Control Room reviewed | Understand confirmation phrases. |",
    "| 11 | Incident response process reviewed | Read Incident Response section of Operator Runbook. |",
    "| 12 | Handoff exports reviewed | Know what OPERATOR_RUNBOOK.md, FINAL_GO_LIVE_PACK.md, POST_CUTOVER_MONITORING_REPORT.md contain. |",
    "",
    "### Incident Response Summary",
    "",
    "| Severity | Condition | Immediate Action |",
    "| --- | --- | --- |",
    "| Critical | Root or API unreachable | Check PM2/nginx logs. Consider rollback. |",
    "| High | Products API down | Check app logs. Verify DB connection. Assess checkout. |",
    "| Medium | External service warning | Check Stripe/email/Cloudinary dashboards. |",
    "| Low | Manual checks pending | Complete ecommerce checklist. Monitor 30 min. |",
    "| None | All checks pass | Re-run health checks in 10-15 min. |",
    "",
    "### Rollback Warning",
    "",
    "> **IMPORTANT:** Rollback does NOT rollback the database automatically.",
    "> Coordinate with DBA for a separate pg_dump restore if a DB migration ran before cutover.",
    "> Never restore from backup without confirming DB state first.",
    "",
    "### Key Documentation Exports",
    "",
    "| File | Location | Description |",
    "| --- | --- | --- |",
    "| SARDAR_MIGRATION_HANDOFF.md | Migration page | Complete migration handoff |",
    "| FINAL_GO_LIVE_PACK.md | Releases → Final Go-Live Control Room | Go-live gate export |",
    "| PRODUCTION_CUTOVER_EXECUTION_PLAN.md | Releases → Production Cutover Guard | Cutover execution plan |",
    "| POST_CUTOVER_MONITORING_REPORT.md | Monitoring → Post-Cutover Control Room | Monitoring report |",
    "| OPERATOR_RUNBOOK.md | Settings/Runbook page | Operator runbook |",
    "",
    "### Audit Events (Sprint 67)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `operator_runbook.generated` | publishing |",
    "| `operator_runbook.exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 68: Release Candidate Hardening Summary ────────────────────────────

function buildReleaseCandidateSection(): string {
  const lines = [
    "---",
    "",
    "## Release Candidate Hardening Summary",
    "",
    "**Sprint 68 — Final Hardening + Bug Bash**",
    "",
    "### Final RC Checklist",
    "",
    "| # | Item |",
    "| --- | --- |",
    "| 1 | All nav links opened at least once |",
    "| 2 | All Sardar panels generated at least once |",
    "| 3 | All exports downloaded at least once |",
    "| 4 | All dangerous actions show confirmation gates |",
    "| 5 | All production mutation warnings reviewed |",
    "| 6 | Logs/debug page reviewed |",
    "| 7 | Monitoring report generated and reviewed |",
    "| 8 | Operator runbook exported (OPERATOR_RUNBOOK.md) |",
    "| 9 | Final Go-Live pack exported (FINAL_GO_LIVE_PACK.md) |",
    "| 10 | Sardar live root (/) returns 200 OK |",
    "| 11 | Sardar /api/healthz returns 200 OK |",
    "| 12 | Doorsteps/LocalShop confirmed untouched |",
    "",
    "### Export Coverage",
    "",
    "| File | Location |",
    "| --- | --- |",
    "| OPERATOR_RUNBOOK.md | Settings/Runbook page |",
    "| FINAL_GO_LIVE_PACK.md | Releases → Final Go-Live Control Room |",
    "| PRODUCTION_CUTOVER_EXECUTION_PLAN.md | Releases → Production Cutover Guard |",
    "| POST_CUTOVER_MONITORING_REPORT.md | Monitoring → Post-Cutover Control Room |",
    "| STAGING_DEPLOYMENT_PROOF.md | Migration → Staging Deployment Panel |",
    "| ECOMMERCE_TEST_REPORT.md | Migration → Ecommerce Test Panel |",
    "| DISASTER_RECOVERY_REPORT.md | Backups → Disaster Recovery Drill |",
    "| TRIAL_MIGRATION_REPORT.md | Migration → Trial Migration Panel |",
    "| SOURCE_INTAKE_REPORT.md | Migration → Source Intake Panel |",
    "| DEBUG_BUNDLE.md | Logs → Debug Summary Panel |",
    "| SARDAR_MIGRATION_HANDOFF.md | Migration → Handoff Export section |",
    "| RELEASE_CANDIDATE_REPORT.md | Releases → Release Candidate Panel |",
    "",
    "### Confirmation Phrase Index",
    "",
    "> **Reference only.** Do not enter these phrases unless intentionally executing that workflow.",
    "",
    "| Phrase | Location |",
    "| --- | --- |",
    "| `APPLY PRODUCTION CUTOVER` | Production Execution Guard — /releases |",
    "| `EXECUTE PRODUCTION ROLLBACK` | Production Execution Guard — /releases |",
    "| `RUN PRODUCTION SMOKE CHECKS` | Production Execution Guard — /releases |",
    "| `RUN PRODUCTION HEALTH CHECKS` | Post-Cutover Monitoring — /monitoring |",
    "| `MARK INCIDENT REVIEWED` | Post-Cutover Monitoring — /monitoring |",
    "| `RUN SAFE ECOMMERCE CHECKS` | Ecommerce Test Panel — /migration |",
    "| `MARK ECOMMERCE PROOF COMPLETE` | Ecommerce Test Panel — /migration |",
    "| `RUN STAGING CHECKS` | Staging Trial Panel — /migration |",
    "| `MARK TRIAL COMPLETE` | Staging Trial Panel — /migration |",
    "| `MARK STAGING READY` | Staging Deployment Panel — /migration |",
    "| `RUN STAGING DRY RUN` | Staging Deployment Panel — /migration |",
    "| `PREPARE STAGING SOURCE` | Staging Deployment Panel — /migration |",
    "| `VERIFY BACKUP` | Backups panel — /backups |",
    "| `MARK DRILL COMPLETE` | Disaster Recovery Drill — /backups |",
    "| `GENERATE FINAL GO LIVE GATE` | Final Go-Live Control Room — /releases |",
    "| `MARK EVIDENCE REVIEWED` | Final Go-Live Control Room — /releases |",
    "",
    "### Final Smoke Commands",
    "",
    "```bash",
    "curl -I https://projects.doorstepmanchester.uk/login",
    "curl -I https://projects.doorstepmanchester.uk/dashboard",
    "curl -I https://projects.doorstepmanchester.uk/admin",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    "```",
    "",
    "Expected:",
    "- /login       → 200 OK",
    "- /dashboard   → 307 redirect (login if unauthenticated)",
    "- /admin       → 307 redirect (login if unauthenticated)",
    "- Sardar frontend → 200 OK",
    "- Sardar health   → 200 OK",
    "",
    "### Remaining Manual Checks",
    "",
    "| Check | Page | Action |",
    "| --- | --- | --- |",
    "| Live Sardar frontend returns 200 | External | curl -I https://sardar-security-project.doorstepmanchester.uk/ |",
    "| Live Sardar health returns 200 | External | curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz |",
    "| Ecommerce checklist completed | /migration | Complete 12-item checklist |",
    "| Monitoring report generated | /monitoring | Generate + review report |",
    "| Team permission review completed | /team | Complete TeamPermissionReviewChecklist |",
    "| Backup restore drill completed | /backups | MARK DRILL COMPLETE |",
    "",
    "### Audit Events (Sprint 68)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `release_candidate.report_generated` | publishing |",
    "| `release_candidate.report_exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

// ── Sprint 69: Live QA Verification Summary ───────────────────────────────────

function buildLiveQaVerificationSection(): string {
  const lines = [
    "---",
    "",
    "## Live QA Verification Summary",
    "",
    "**Sprint 69 — Live QA Pass + Production Deployment Verification**",
    "",
    "### Manual QA Checklist",
    "",
    "| # | Item | Status |",
    "| --- | --- | --- |",
    "| 1 | Opened Releases page | ☐ |",
    "| 2 | Opened Migration page | ☐ |",
    "| 3 | Opened Publishing page | ☐ |",
    "| 4 | Opened Monitoring page | ☐ |",
    "| 5 | Opened Runbook page | ☐ |",
    "| 6 | Opened Backups page | ☐ |",
    "| 7 | Opened Logs page | ☐ |",
    "| 8 | Opened Operations page | ☐ |",
    "| 9 | Opened Team page | ☐ |",
    "| 10 | Opened Settings page | ☐ |",
    "| 11 | Generated Release Candidate report | ☐ |",
    "| 12 | Generated Final Go-Live gate | ☐ |",
    "| 13 | Generated Production Execution plan | ☐ |",
    "| 14 | Generated Monitoring report | ☐ |",
    "| 15 | Exported Operator Runbook | ☐ |",
    "| 16 | Exported Handoff document | ☐ |",
    "| 17 | Verified Sardar live root | ☐ |",
    "| 18 | Verified Sardar health endpoint | ☐ |",
    "",
    "### Live Smoke Commands",
    "",
    "```bash",
    "curl -I https://projects.doorstepmanchester.uk/login",
    "curl -I https://projects.doorstepmanchester.uk/dashboard",
    "curl -I https://projects.doorstepmanchester.uk/admin",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    "```",
    "",
    "Expected results:",
    "- /login       → 200 OK",
    "- /dashboard   → 307 redirect (unauthenticated)",
    "- /admin       → 307 redirect (unauthenticated)",
    "- Sardar root  → 200 OK",
    "- Sardar health → 200 OK",
    "",
    "### Export Coverage (Sprint 69 additions)",
    "",
    "| File | Location |",
    "| --- | --- |",
    "| QA_VERIFICATION_REPORT.md | Releases → QA Verification Panel |",
    "| OPERATOR_RUNBOOK.md | Settings/Runbook page |",
    "| RELEASE_CANDIDATE_REPORT.md | Releases → Release Candidate Panel |",
    "| FINAL_GO_LIVE_PACK.md | Releases → Final Go-Live Control Room |",
    "| PRODUCTION_CUTOVER_EXECUTION_PLAN.md | Releases → Production Cutover Guard |",
    "| POST_CUTOVER_MONITORING_REPORT.md | Monitoring → Post-Cutover Control Room |",
    "| STAGING_DEPLOYMENT_PROOF.md | Migration → Staging Deployment Panel |",
    "| ECOMMERCE_TEST_REPORT.md | Migration → Ecommerce Test Panel |",
    "| DISASTER_RECOVERY_REPORT.md | Backups → Disaster Recovery Drill |",
    "| TRIAL_MIGRATION_REPORT.md | Migration → Trial Migration Panel |",
    "| SOURCE_INTAKE_REPORT.md | Migration → Source Intake Panel |",
    "| DEBUG_BUNDLE.md | Logs → Debug Summary Panel |",
    "| SARDAR_MIGRATION_HANDOFF.md | Migration → Handoff Export section |",
    "",
    "### Remaining Manual Checks",
    "",
    "| Check | URL/Location | Command |",
    "| --- | --- | --- |",
    "| Panel login returns 200 | /login | `curl -I https://projects.doorstepmanchester.uk/login` |",
    "| Panel dashboard redirects (unauthenticated) | /dashboard | `curl -I https://projects.doorstepmanchester.uk/dashboard` |",
    "| Sardar live root returns 200 | External | `curl -I https://sardar-security-project.doorstepmanchester.uk/` |",
    "| Sardar health returns 200 | External | `curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz` |",
    "| Admin onboarding checklist visible | /admin | Log in and open /admin |",
    "| RC panel visible on Releases | /releases | Open Releases and verify RC panel loads |",
    "| QA panel visible on Releases | /releases | Open Releases and verify QA panel loads |",
    "",
    "### Release-Candidate Status Note",
    "",
    "> After completing all 18 manual QA items and running RUN LIVE QA SMOKE CHECKS, export",
    "> QA_VERIFICATION_REPORT.md and keep it alongside RELEASE_CANDIDATE_REPORT.md as the final",
    "> evidence pack before marking the system production-ready.",
    "",
    "### Audit Events (Sprint 69)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `qa_verification.report_generated` | publishing |",
    "| `qa_verification.live_smoke_checks_started` | publishing |",
    "| `qa_verification.live_smoke_checks_passed` | publishing |",
    "| `qa_verification.live_smoke_checks_failed` | publishing |",
    "| `qa_verification.report_exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildClientMigrationTemplateSection(): string {
  const lines = [
    "---",
    "",
    "## Client Migration Template Plan",
    "",
    "**Sprint 72 — Client Project Templates + New Migration Wizard**",
    "",
    "Use the Template Selector on the Migration page to choose a template and export `CLIENT_MIGRATION_PLAN.md`.",
    "",
    "### Available Templates",
    "",
    "| Template | Kind | Best For |",
    "| --- | --- | --- |",
    "| Ecommerce Migration | ecommerce | Online stores, Stripe checkout, API + frontend, DB + auth + media |",
    "| Generic Web App | web_app | Next.js / Remix / SvelteKit, internal tools, dashboards |",
    "| API Service | api_service | REST or GraphQL backends, microservices, webhook receivers |",
    "| Static Site | static_site | Marketing pages, docs, Astro / Hugo, React SPA without backend |",
    "| Custom Project | custom | Non-standard architectures, monorepos, unspecified projects |",
    "",
    "### Recommended Template for Sardar Ecommerce",
    "",
    "Use the **Ecommerce Migration** template. It includes:",
    "",
    "- API Server + Static Frontend services",
    "- DATABASE_URL, SESSION_SECRET, APP_URL",
    "- STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET",
    "- Cloudinary media (optional)",
    "- Email provider (optional)",
    "- 18-item onboarding checklist",
    "- Stripe webhook verification step post-cutover",
    "",
    "### Onboarding Checklist (Ecommerce)",
    "",
    "| # | Task | Required |",
    "| --- | --- | --- |",
    "| 1 | Clone or import source artifacts | Yes |",
    "| 2 | Review expected services | Yes |",
    "| 3 | Add DATABASE_URL env var | Yes |",
    "| 4 | Add SESSION_SECRET env var | Yes |",
    "| 5 | Add APP_URL env var | Yes |",
    "| 6 | Add Stripe keys | Yes |",
    "| 7 | Configure Cloudinary (optional) | No |",
    "| 8 | Configure email provider (optional) | No |",
    "| 9 | Run Deployment Dry Run | Yes |",
    "| 10 | Run Ecommerce Test Plan | Yes |",
    "| 11 | Run Staging Trial Migration | Yes |",
    "| 12 | Verify /api/healthz returns 200 | Yes |",
    "| 13 | Create DB backup before cutover | Yes |",
    "| 14 | Approve Release Candidate | Yes |",
    "| 15 | Run Live QA Smoke Checks | Yes |",
    "| 16 | Execute Production Cutover | Yes |",
    "| 17 | Verify Stripe webhooks are live | Yes |",
    "| 18 | Complete post-cutover monitoring review | Yes |",
    "",
    "### First-Run Migration Sequence",
    "",
    "```",
    "1. Detect project profile (Migration page)",
    "2. Import source artifacts (Source Intake → Publishing)",
    "3. Configure environment variables (Settings)",
    "4. Review expected services (Migration page)",
    "5. Run Deployment Dry Run (Migration page)",
    "6. Run Ecommerce Test Plan (Migration page)",
    "7. Run Staging Trial Migration (Migration page)",
    "8. Create database backup (Backups page)",
    "9. Approve Release Candidate (Releases page)",
    "10. Execute Production Cutover (Releases page)",
    "11. Post-cutover monitoring (Monitoring page)",
    "12. Complete operator runbook (Runbook page)",
    "```",
    "",
    "### Safety Notes",
    "",
    "- Do not restart PM2 or reload nginx from the panel UI.",
    "- Stripe webhook secret must match the configured Stripe endpoint exactly.",
    "- Always create a DB backup before production cutover.",
    "",
    "### Template Audit Events (Sprint 72)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `project_template.plan_generated` | publishing |",
    "| `project_template.plan_exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildProjectMigrationProfileSection(): string {
  const lines = [
    "---",
    "",
    "## Project Migration Profile",
    "",
    "**Sprint 71 — Multi-Project Generalization + Reusable Migration Framework**",
    "",
    "The Project Migration Profile classifies this project's architecture and provides",
    "canonical expectations for services, routes, and environment variables.",
    "Export `PROJECT_PROFILE_REPORT.md` from the Profile card on the Migration, Releases, or Settings pages.",
    "",
    "### Profile Kinds",
    "",
    "| Kind | Description |",
    "| --- | --- |",
    "| `sardar_ecommerce` | Full-stack ecommerce — Node.js API + React/Vite static frontend, Stripe, Cloudinary |",
    "| `generic_ecommerce` | Ecommerce app with Stripe integration (non-Sardar) |",
    "| `generic_web_app` | Database-backed web application |",
    "| `api_service` | Node.js API only — no detected frontend service |",
    "| `static_site` | Static build output only |",
    "| `unknown` | Insufficient signals for classification |",
    "",
    "### Expected Services (Sardar Preset)",
    "",
    "| Service | Kind | Build Command | Health | Route |",
    "| --- | --- | --- | --- | --- |",
    "| API Server | api | `pnpm --filter @workspace/api-server run build` | `/api/healthz` | `/api/*` |",
    "| Static Frontend | static | `pnpm --filter @workspace/sardar-security run build` | — | `/*` |",
    "",
    "### Expected Routes (Sardar Preset)",
    "",
    "| Path | Target | Type |",
    "| --- | --- | --- |",
    "| `/api/*` | `http://localhost:4100` | api |",
    "| `/*` | `artifacts/sardar-security/dist/public` | spa_fallback |",
    "",
    "### Expected Env Categories (Sardar Preset)",
    "",
    "| Category | Key Names |",
    "| --- | --- |",
    "| app | `APP_URL` |",
    "| database | `DATABASE_URL` |",
    "| auth | `SESSION_SECRET` |",
    "| stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |",
    "| cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |",
    "| email | `SMTP_HOST` / `RESEND_API_KEY` / `SENDGRID_API_KEY` |",
    "",
    "> Values are never included — only key names.",
    "",
    "### Safety Notes",
    "",
    "- Do not restart the PM2 process (`project-sardar-security-project`) from the panel UI.",
    "- Do not reload nginx from the panel UI.",
    "- Do not run DB migrations from the panel.",
    "- Stripe webhook secret must match the configured Stripe endpoint exactly.",
    "- Production health endpoint `/api/healthz` must return 200 before cutover.",
    "",
    "### Profile Audit Events (Sprint 71)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `project_profile.detected` | publishing |",
    "| `project_profile.exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildLaunchSignoffAndTrainingSection(): string {
  const lines = [
    "---",
    "",
    "## Final Launch Signoff and Operator Training",
    "",
    "**Sprint 74 — Final Launch Signoff + Operator Training Pack**",
    "",
    "Before handing over to a client or operator, complete the following signoff and training steps.",
    "",
    "### Signoff Checklist Summary",
    "",
    "| Category | Check | Required | Evidence |",
    "| --- | --- | --- | --- |",
    "| QA | Live QA Verification | Yes | `QA_VERIFICATION_REPORT.md` |",
    "| Release Candidate | RC Hardening score ≥ 90 | Yes | `RELEASE_CANDIDATE_REPORT.md` |",
    "| Staging | Staging Deployment Proof | Yes | `STAGING_DEPLOYMENT_PROOF.md` |",
    "| Staging | Trial Migration Proof | Sardar only | `TRIAL_MIGRATION_PROOF.md` |",
    "| Ecommerce | Ecommerce Test Harness | Stripe only | `ECOMMERCE_TEST_PROOF.md` |",
    "| Backups | Backup < 24h old | If database | Backups page |",
    "| Backups | Disaster Recovery Drill | If database | Backups page |",
    "| Release Candidate | Production Execution Guard | Yes | `PRODUCTION_EXECUTION_PLAN.md` |",
    "| Monitoring | Post-Cutover Monitoring | If healthPath | Monitoring page |",
    "| Team | Owner role assigned | Yes | Team page |",
    "| Security | All required env vars set | Yes | Settings > Env Vars |",
    "| Security | Domain + SSL active | Yes | Settings > Domains |",
    "| Client Handover | Project Profile exported | No | `PROJECT_PROFILE_REPORT.md` |",
    "| Client Handover | Client Migration Plan | No | `CLIENT_MIGRATION_PLAN.md` |",
    "",
    "Export `FINAL_LAUNCH_SIGNOFF.md` from the Launch Signoff panel on the Releases page.",
    "",
    "### Daily Operations Checklist",
    "",
    "Complete every morning before starting work:",
    "",
    "- [ ] Check Monitoring page — all health checks green",
    "- [ ] Review Logs for ERROR-level entries in last 24 hours",
    "- [ ] Confirm latest backup is within 24 hours",
    "- [ ] Check Releases for stuck deployments",
    "- [ ] Review Activity log for unexpected actions",
    "",
    "### Emergency Rollback Checklist",
    "",
    "Follow this sequence if production breaks after cutover:",
    "",
    "- [ ] Confirm the problem — check health endpoint and logs first",
    "- [ ] Open Releases > Production Execution Guard",
    "- [ ] Type confirmation: EXECUTE PRODUCTION ROLLBACK",
    "- [ ] On server: sudo nginx -t && sudo systemctl reload nginx (revert config)",
    "- [ ] Verify rollback with health endpoint check",
    "- [ ] Notify client immediately",
    "- [ ] Document incident in project Activity log",
    "- [ ] Do not redeploy until root cause confirmed",
    "",
    "### Launch-Day Evidence Checklist",
    "",
    "All of the following must exist before production cutover:",
    "",
    "- [ ] `QA_VERIFICATION_REPORT.md`",
    "- [ ] `RELEASE_CANDIDATE_REPORT.md`",
    "- [ ] `STAGING_DEPLOYMENT_PROOF.md`",
    "- [ ] `PRODUCTION_EXECUTION_PLAN.md`",
    "- [ ] Backup taken within last 2 hours",
    "- [ ] `FINAL_LAUNCH_SIGNOFF.md` (manual signoff section completed)",
    "- [ ] `OPERATOR_TRAINING_PACK.md` (distributed to operators)",
    "",
    "### Training Pack Summary",
    "",
    "Export `OPERATOR_TRAINING_PACK.md` from the Runbook page.",
    "The pack includes the following training sections:",
    "",
    "1. Daily Operations",
    "2. Checking Application Health",
    "3. Reading Logs",
    "4. Running QA Checks",
    "5. Exporting Reports",
    "6. Reviewing Backups",
    "7. Understanding Cutover Controls",
    "8. Emergency Rollback Procedure",
    "9. What Not to Touch",
    "10. When to Escalate",
    "",
    "### Safety Notes",
    "",
    "- Do not apply nginx routes from the panel UI — must be done via server SSH.",
    "- Do not restart PM2 from the panel UI.",
    "- Do not run DB migrations from the panel.",
    "- Do not restore backups to production without staging verification.",
    "- Do not touch the Doorsteps/LocalShop app (prisom-manager / prisom-backend).",
    "- Confirm live Sardar health endpoint (/api/healthz) returns 200 after every cutover.",
    "",
    "### Audit Events (Sprint 74)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `launch_signoff.generated` | publishing |",
    "| `launch_signoff.exported` | publishing |",
    "| `operator_training.generated` | publishing |",
    "| `operator_training.exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildFinalRehearsalAndFreezeSection(): string {
  const lines = [
    "---",
    "",
    "## Final Cutover Rehearsal and Launch Freeze",
    "",
    "**Sprint 75 — Production Cutover Rehearsal + Final Readiness Freeze**",
    "",
    "### Rehearsal Checklist Summary",
    "",
    "The cutover rehearsal covers 8 phases. All phases must be reviewed before launch day.",
    "",
    "| Phase | Description |",
    "| --- | --- |",
    "| Pre-Launch | QA report, RC report, signoff signed, training distributed, domain + SSL, team, env, deployment |",
    "| Backup | Backup taken < 2h before cutover, DR drill confirmed |",
    "| Routing | Route apply plan previewed, confirmation phrase verified, nginx -t passes |",
    "| Smoke Test | Health endpoint, frontend homepage, API route |",
    "| Ecommerce | Ecommerce test proof, Stripe live mode confirmed |",
    "| Monitoring | Live health check active, alert rules configured |",
    "| Rollback | Backup confirmed, previous nginx config saved, rollback phrase memorized |",
    "| Handover | All handover exports ready, client notified |",
    "",
    "Export `FINAL_CUTOVER_REHEARSAL.md` from the Cutover Rehearsal panel on the Releases page.",
    "",
    "### Rollback Decision Tree",
    "",
    "1. Is the health endpoint returning non-200? → Run smoke checks to confirm",
    "2. Are there 502/503 errors in logs? → Check PM2 process status and nginx config",
    "3. Did DB changes break data access? → Consider DB restore from pre-cutover backup",
    "4. Can the previous nginx config be restored quickly? → cp sardar.bak → sardar, reload nginx",
    "5. Is this a code bug vs. config bug? → Code bug: rollback deploy; Config bug: fix nginx config",
    "6. Has it been > 5 minutes with no progress? → Execute rollback immediately, notify client",
    "7. After rollback: confirm health endpoint returns 200 before declaring safe",
    "",
    "### Final Go / No-Go Questions",
    "",
    "Answer YES to all before proceeding with production cutover:",
    "",
    "- [ ] Is QA_VERIFICATION_REPORT.md exported and showing 0 blockers?",
    "- [ ] Is RELEASE_CANDIDATE_REPORT.md score ≥ 90?",
    "- [ ] Is FINAL_LAUNCH_SIGNOFF.md signed off by an authorized operator?",
    "- [ ] Has a backup been taken within the last 2 hours?",
    "- [ ] Has the disaster recovery drill been completed on staging?",
    "- [ ] Is the production execution plan generated and reviewed?",
    "- [ ] Does nginx -t pass on the server?",
    "- [ ] Are all operators available and briefed on the rollback procedure?",
    "- [ ] Is the client available to verify after cutover?",
    "",
    "### Launch Freeze Rules",
    "",
    "The following changes are **blocked** during the launch freeze window:",
    "",
    "- Database schema changes or new Prisma migrations",
    "- New major features or new pages",
    "- Route, DNS, or nginx configuration changes (from panel)",
    "- Payment provider or Stripe configuration changes",
    "- Secret value rotations without explicit approval",
    "- PM2 process behavior changes from the panel UI",
    "- Any change that requires a full QA cycle to validate",
    "",
    "The following changes are **allowed** during the launch freeze window:",
    "",
    "- Critical bug fixes (confirmed broken behavior, not enhancements)",
    "- Copy fixes that reduce operator confusion",
    "- Broken link fixes in the panel UI",
    "- Export/report content fixes",
    "- Confirmation gate fixes",
    "",
    "Export `LAUNCH_FREEZE_CHECKLIST.md` from the Launch Freeze panel on the Releases page.",
    "",
    "### Audit Events (Sprint 75)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `cutover_rehearsal.generated` | publishing |",
    "| `cutover_rehearsal.exported` | publishing |",
    "| `launch_freeze.generated` | publishing |",
    "| `launch_freeze.exported` | publishing |",
    "",
  ];
  return lines.join("\n");
}

function buildLaunchDayAndBugCaptureSection(): string {
  const lines = [
    "---",
    "",
    "## Launch-Day Support and Post-Launch Bug Capture",
    "",
    "**Sprint 76 — Launch-Day Execution Support + Post-Launch Bug Capture**",
    "",
    "### Launch-Day Timeline Summary",
    "",
    "All phases must be worked through on launch day in order. Each step is a manual operator action.",
    "",
    "| Phase | Key Step | Evidence Required |",
    "| --- | --- | --- |",
    "| Pre-Launch | Confirm freeze, signoff, backup, team | LAUNCH_FREEZE_CHECKLIST.md, FINAL_LAUNCH_SIGNOFF.md |",
    "| Cutover | Execute manual server command | Operator name + timestamp |",
    "| Smoke Tests | Health endpoint, homepage, API | curl 200 screenshot |",
    "| Ecommerce | Test checkout, confirm Stripe live mode | Checkout proof |",
    "| Monitoring | Activate health check, monitor logs | Post-Cutover Monitoring report |",
    "| Client Handover | Notify client, deliver all exports | Email/message timestamp |",
    "| Post-Launch | Log any issues, monitor 24h | Post-Launch Bug Capture export |",
    "",
    "Export `LAUNCH_DAY_SUPPORT_REPORT.md` from the Launch-Day Support panel on the Releases or Monitoring page.",
    "",
    "### Smoke Check Commands",
    "",
    "```bash",
    "curl -I https://<domain>/api/healthz",
    "curl -I https://<domain>/",
    "pm2 logs --lines 50",
    "sudo nginx -t",
    "pm2 status",
    "```",
    "",
    "### Rollback Reminder",
    "",
    "1. Is the health endpoint returning non-200? → Run smoke checks to confirm scope.",
    "2. Are there 502/503 errors? → Check PM2 process status and nginx config.",
    "3. Can the previous nginx config be restored? → Restore backup config, reload nginx manually.",
    "4. Has it been > 5 minutes with no recovery? → Execute rollback immediately.",
    "5. After rollback: confirm health endpoint returns 200 before declaring safe.",
    "6. Notify client and rollback owner as soon as rollback is confirmed.",
    "",
    "### Post-Launch Bug Triage Rules",
    "",
    "| Severity | Example | Response Time | Action |",
    "| --- | --- | --- | --- |",
    "| Critical | Site down, checkout broken, health failing | Immediate | Escalate, consider rollback |",
    "| High | Payment webhooks failing, admin login broken | < 30 min | Fix or rollback |",
    "| Medium | Images missing, 404 routes, slow load | Same day | Log and fix |",
    "| Low | Log noise, cosmetic issues | Next deploy | Log only |",
    "",
    "### Allowed Immediate Fixes",
    "",
    "- Copy fixes that don't affect business logic",
    "- Broken internal link fixes",
    "- Missing static asset path corrections",
    "- Log verbosity adjustments",
    "- Environment variable corrections (with approval)",
    "",
    "### Changes Requiring Operator Approval",
    "",
    "- [ ] Any DB schema or data change",
    "- [ ] Stripe or payment provider configuration",
    "- [ ] Secret / env var rotations",
    "- [ ] nginx or PM2 configuration changes",
    "- [ ] New feature deployments",
    "- [ ] DNS changes",
    "- [ ] Auth/session configuration changes",
    "",
    "### Audit Events (Sprint 76)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `launch_day.generated` | publishing |",
    "| `launch_day.exported` | publishing |",
    "| `post_launch_bug_capture.generated` | publishing |",
    "| `post_launch_bug_capture.exported` | publishing |",
    "",
    "### Safety Notes",
    "",
    "- No production mutation from any panel in this sprint.",
    "- Cutover is always a manual server-side command — never triggered from the panel.",
    "- Rollback is always a manual operator decision.",
    "- Collect evidence before attempting any fix.",
    "- Escalate before making changes requiring approval.",
    "",
  ];
  return lines.join("\n");
}

function buildFinalReadinessAndStopBuildSection(): string {
  const lines = [
    "---",
    "",
    "## Final Production Readiness Audit and Stop-Build Gate",
    "",
    "**Sprint 77 — Final Production Readiness Audit + Stop-Build Gate**",
    "",
    "### Final Readiness Audit",
    "",
    "The Final Readiness Audit is a cross-sprint gate covering all sprints 69–76. It produces a score (0–100%), a blocker list, and a final recommendation (BLOCKED / NEEDS FIXES / READY TO EXECUTE).",
    "",
    "| Category | Key Checks |",
    "| --- | --- |",
    "| QA Verification | QA_VERIFICATION_REPORT.md with 0 blockers |",
    "| Release & Signoff | RC score ≥ 90%, FINAL_LAUNCH_SIGNOFF.md signed |",
    "| Migration | Project profile, client plan, source intake |",
    "| Staging & Trial | Successful deployment, trial migration |",
    "| Ecommerce | Stripe test checkout confirmed (Sardar only) |",
    "| Routing & DNS | Domain configured, SSL ACTIVE |",
    "| Monitoring | Health endpoint, post-cutover monitoring ready |",
    "| Security | DATABASE_URL, AUTH_SECRET, STRIPE keys present (names only) |",
    "| Team | Owner and admin assigned |",
    "| Documentation | Operator training, runbook, handoff export |",
    "| Launch Day | Cutover rehearsal, launch freeze, launch-day report |",
    "| Post-Launch | Post-launch bug capture report generated |",
    "",
    "Export `FINAL_READINESS_AUDIT.md` from the Final Readiness Audit panel on the Releases page.",
    "",
    "### Stop-Build Gate",
    "",
    "The Stop-Build Gate gives the operator a final decision: **STOP BUILDING — READY TO LAUNCH**, **FIX BLOCKERS ONLY**, or **CONTINUE BUILDING**.",
    "",
    "| Decision | Meaning |",
    "| --- | --- |",
    "| STOP BUILDING — READY TO LAUNCH | All gate checks pass. Move to launch-day execution. |",
    "| FIX BLOCKERS ONLY | Critical blockers remain. Fix them, re-run, then launch. |",
    "| CONTINUE BUILDING | Core platform or launch workflow checks incomplete. |",
    "",
    "**Allowed next work after stop-build:**",
    "",
    "- Confirmed blocker fixes required by this gate report",
    "- Launch-day execution once all gate checks pass",
    "- Post-launch bug triage",
    "- Documentation and handoff export updates",
    "",
    "**Blocked next work:**",
    "",
    "- New major features before production launch",
    "- Schema changes without a confirmed blocker requiring them",
    "- Route, DNS, or nginx configuration changes from the panel",
    "- Broad UI rewrites or speculative infrastructure changes",
    "",
    "Export `STOP_BUILD_GATE.md` from the Stop-Build Gate panel on the Releases page.",
    "",
    "### Audit Events (Sprint 77)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `final_readiness.generated` | publishing |",
    "| `final_readiness.exported` | publishing |",
    "| `stop_build.generated` | publishing |",
    "| `stop_build.exported` | publishing |",
    "",
    "### Safety Notes",
    "",
    "- No production mutation from any panel in Sprint 77.",
    "- This audit and gate are read-only documentation tools.",
    "- Do not proceed to production cutover while FINAL_READINESS_AUDIT.md shows BLOCKED.",
    "- Re-generate both reports after fixing any blockers to confirm readiness.",
    "",
  ];
  return lines.join("\n");
}

function buildDeployVerificationAndLaunchExecutionSection(): string {
  const lines = [
    "---",
    "",
    "## Final Deploy Verification and Launch Execution Checklist",
    "",
    "**Sprint 78 — Final Deploy Verification + Launch Execution Checklist**",
    "",
    "### Deployed Commit Verification",
    "",
    "After deploying, verify the running commit on the production server:",
    "",
    "```bash",
    "git -C /home/prisom/prisom-project-panel rev-parse --short HEAD",
    "git -C /home/prisom/prisom-project-panel log --oneline -8",
    "```",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Expected commit | _(record here after deploying)_ |",
    "| Observed commit | _(record from git rev-parse on server)_ |",
    "| Panel domain | projects.doorstepmanchester.uk |",
    "| PM2 process | prisom-projects |",
    "",
    "### Route Verification Checklist",
    "",
    "```bash",
    "curl -I https://projects.doorstepmanchester.uk/login",
    "curl -I https://projects.doorstepmanchester.uk/dashboard",
    "curl -I https://projects.doorstepmanchester.uk/admin",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    "```",
    "",
    "| Route | Expected |",
    "| --- | --- |",
    "| /login | 200 OK |",
    "| /dashboard | 307 → /login (unauthenticated) |",
    "| /admin | 307 → /login (unauthenticated) |",
    "| Sardar frontend | 200 OK |",
    "| Sardar health | 200 OK |",
    "",
    "### Export Verification Checklist",
    "",
    "Generate each export from the panel and confirm it downloads without error:",
    "",
    "- [ ] FINAL_READINESS_AUDIT.md",
    "- [ ] STOP_BUILD_GATE.md",
    "- [ ] LAUNCH_DAY_SUPPORT_REPORT.md",
    "- [ ] FINAL_CUTOVER_REHEARSAL.md",
    "- [ ] LAUNCH_FREEZE_CHECKLIST.md",
    "- [ ] FINAL_LAUNCH_SIGNOFF.md",
    "- [ ] OPERATOR_TRAINING_PACK.md",
    "- [ ] POST_CUTOVER_MONITORING_REPORT.md",
    "- [ ] DEPLOY_VERIFICATION_REPORT.md",
    "- [ ] LAUNCH_EXECUTION_CHECKLIST.md",
    "",
    "### Launch Execution Phases",
    "",
    "| Phase | Key Requirement |",
    "| --- | --- |",
    "| Freeze | LAUNCH_FREEZE_CHECKLIST.md confirmed, FINAL_LAUNCH_SIGNOFF.md signed |",
    "| Backup | Backup taken within 2 hours of cutover, path confirmed |",
    "| Preflight | FINAL_READINESS_AUDIT.md READY, STOP_BUILD_GATE.md READY, team on-call |",
    "| Cutover | Manual nginx reload by named operator via SSH |",
    "| Smoke | Health endpoint, homepage, login all return 200 |",
    "| Monitoring | 30-minute post-cutover monitoring window opened |",
    "| Handover | Client notified, all exports delivered |",
    "| Rollback | Owner named, rollback procedure reviewed |",
    "",
    "### Smoke Commands",
    "",
    "```bash",
    "curl -I https://projects.doorstepmanchester.uk/login",
    "curl -I https://<project-domain>/api/healthz",
    "curl -I https://<project-domain>/",
    "pm2 list",
    "pm2 logs --lines 50",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/",
    "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
    "```",
    "",
    "### Rollback Commands",
    "",
    "```bash",
    "# Rollback nginx to previous config (manual — run on server if cutover fails)",
    "sudo cp /etc/nginx/sites-available/<backup>.bak /etc/nginx/sites-available/<site>",
    "sudo nginx -t",
    "sudo systemctl reload nginx",
    "curl -I https://<project-domain>/api/healthz",
    "```",
    "",
    "### Go / No-Go Questions",
    "",
    "Answer YES to all before proceeding to cutover:",
    "",
    "- [ ] FINAL_READINESS_AUDIT.md shows READY TO EXECUTE?",
    "- [ ] STOP_BUILD_GATE.md shows STOP BUILDING — READY TO LAUNCH?",
    "- [ ] Backup taken and confirmed within the last 2 hours?",
    "- [ ] SSL ACTIVE on the production domain?",
    "- [ ] Named operator available and on-call for the next 2 hours?",
    "- [ ] Rollback owner named and available?",
    "- [ ] All required exports generated and in handoff folder?",
    "- [ ] Cutover rehearsal completed and reviewed?",
    "- [ ] Sardar production frontend and health endpoint returning 200?",
    "- [ ] Doorsteps/LocalShop panel untouched and confirmed running?",
    "",
    "### Evidence Checklist",
    "",
    "- [ ] FINAL_READINESS_AUDIT.md — exported",
    "- [ ] STOP_BUILD_GATE.md — exported",
    "- [ ] FINAL_LAUNCH_SIGNOFF.md — signed with operator name and date",
    "- [ ] FINAL_CUTOVER_REHEARSAL.md — exported and reviewed",
    "- [ ] LAUNCH_FREEZE_CHECKLIST.md — exported and acknowledged",
    "- [ ] LAUNCH_DAY_SUPPORT_REPORT.md — exported and reviewed",
    "- [ ] OPERATOR_TRAINING_PACK.md — delivered to operator",
    "- [ ] DEPLOY_VERIFICATION_REPORT.md — exported",
    "- [ ] LAUNCH_EXECUTION_CHECKLIST.md — exported",
    "- [ ] POST_CUTOVER_MONITORING_REPORT.md — exported",
    "- [ ] Backup path + timestamp confirmed",
    "- [ ] Cutover timestamp + operator name recorded",
    "- [ ] Client notified of launch time",
    "",
    "### Audit Events (Sprint 78)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `deploy_verification.generated` | publishing |",
    "| `deploy_verification.exported` | publishing |",
    "| `launch_execution.generated` | publishing |",
    "| `launch_execution.exported` | publishing |",
    "",
    "### Safety Notes",
    "",
    "- No production mutation from any panel in Sprint 78.",
    "- All server commands must be executed manually by a named operator via SSH.",
    "- Do not restart any PM2 process from the panel.",
    "- Do not touch Doorsteps/LocalShop (prisom-manager, prisom-backend).",
    "- Sardar Security production must remain live throughout.",
    "- No secrets are included in this section.",
    "",
  ];
  return lines.join("\n");
}

function buildFinalLiveVerificationAndGoNoGoSection(): string {
  const lines = [
    "---",
    "",
    "## Final Live Verification and Go/No-Go Evidence",
    "",
    "**Sprint 79 — Final Live Verification Run + Go/No-Go Evidence Pack**",
    "",
    "### Final Live Verification Checklist",
    "",
    "Run the Final Live Verification panel on `/projects/[id]/releases` after deploying Sprint 79.",
    "",
    "| Check | Command / Method | Expected |",
    "| --- | --- | --- |",
    "| Deployed commit | `git -C /home/prisom/prisom-project-panel rev-parse --short HEAD` | Matches expected SHA |",
    "| PM2 online | `pm2 list \\| grep prisom-projects` | online \\| port 3002 |",
    "| Panel login | `curl -I https://projects.doorstepmanchester.uk/login` | HTTP 200 |",
    "| Panel dashboard | `curl -I https://projects.doorstepmanchester.uk/dashboard` | HTTP 307 → /login |",
    "| Panel admin | `curl -I https://projects.doorstepmanchester.uk/admin` | HTTP 307 → /login |",
    "| Sardar frontend | `curl -I https://sardar-security-project.doorstepmanchester.uk/` | HTTP 200 |",
    "| Sardar health | `curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz` | HTTP 200 |",
    "| Doorsteps untouched | `pm2 list \\| grep -E 'prisom-manager\\|prisom-backend'` | Both online, no restart increase |",
    "",
    "### Go/No-Go Evidence Categories",
    "",
    "| Category | Evidence Required |",
    "| --- | --- |",
    "| Deployment | Deployed commit SHA confirmed, PM2 online, SSL ACTIVE |",
    "| QA | QA_VERIFICATION_REPORT.md with 0 blockers, FINAL_READINESS_AUDIT.md READY TO EXECUTE |",
    "| Release | RC score ≥ 90%, FINAL_LAUNCH_SIGNOFF.md signed, STOP_BUILD_GATE.md READY |",
    "| Migration | CLIENT_MIGRATION_PLAN.md exported, successful deployment on record |",
    "| Backup | Backup file path + timestamp confirmed, restore drill on staging |",
    "| Monitoring | POST_CUTOVER_MONITORING_REPORT.md ready, health endpoint configured |",
    "| Security | DATABASE_URL set, AUTH_SECRET set, no secrets in any export |",
    "| Rollback | Rehearsal reviewed, rollback owner named and available, nginx backup confirmed |",
    "| Operator | Project owner assigned, OPERATOR_TRAINING_PACK.md delivered, checklist reviewed |",
    "| Client | Client notified of launch time, HANDOFF_EXPORT.md delivered |",
    "",
    "### Blockers (launch blocked if any are present)",
    "",
    "- [ ] FINAL_READINESS_AUDIT.md shows BLOCKED",
    "- [ ] DATABASE_URL env var not set",
    "- [ ] SSL not ACTIVE on production domain",
    "- [ ] No successful deployment on record",
    "- [ ] No project owner assigned",
    "- [ ] Sardar Security returning non-200",
    "- [ ] Critical known issue unresolved",
    "- [ ] Rollback procedure not reviewed by operator",
    "",
    "### Warnings (launch with documented acceptance only)",
    "",
    "- [ ] AUTH_SECRET env var not set",
    "- [ ] Health endpoint not configured on any service",
    "",
    "### Required Approvals",
    "",
    "- [ ] Named operator signs off on Launch Execution Checklist before cutover",
    "- [ ] Rollback owner confirms availability",
    "- [ ] Client acknowledges planned launch date and time",
    "- [ ] Project owner confirmed assigned",
    "",
    "### Launch Allowed Only If",
    "",
    "- [ ] FINAL_READINESS_AUDIT.md shows READY TO EXECUTE",
    "- [ ] STOP_BUILD_GATE.md decision is STOP BUILDING — READY TO LAUNCH",
    "- [ ] Backup confirmed taken within the last 2 hours",
    "- [ ] SSL ACTIVE on production domain",
    "- [ ] Named operator on-call and available",
    "- [ ] Rollback owner named and available",
    "- [ ] All required exports downloaded and in handoff folder",
    "- [ ] Sardar Security frontend and health returning 200",
    "- [ ] Doorsteps/LocalShop confirmed running and untouched",
    "",
    "### Launch Blocked If",
    "",
    "- FINAL_READINESS_AUDIT.md shows BLOCKED",
    "- DATABASE_URL not set",
    "- SSL not ACTIVE",
    "- No successful deployment on record",
    "- No project owner assigned",
    "- Sardar Security returning non-200 responses",
    "- Critical known issue unresolved",
    "- Rollback procedure not reviewed",
    "",
    "### Final Operator Message Template",
    "",
    "```",
    "Complete the Manual Go/No-Go Signoff section in GO_NO_GO_EVIDENCE_PACK.md before proceeding:",
    "",
    "Operator:",
    "Approver:",
    "Decision:   [ GO / NO GO / GO WITH WARNINGS ]",
    "Date/time:",
    "Notes:",
    "```",
    "",
    "### Verified Exports Checklist",
    "",
    "- [ ] FINAL_LIVE_VERIFICATION_RUN.md — exported from Final Live Verification panel",
    "- [ ] GO_NO_GO_EVIDENCE_PACK.md — exported from Go/No-Go Evidence panel",
    "- [ ] FINAL_READINESS_AUDIT.md",
    "- [ ] STOP_BUILD_GATE.md",
    "- [ ] DEPLOY_VERIFICATION_REPORT.md",
    "- [ ] LAUNCH_EXECUTION_CHECKLIST.md",
    "- [ ] LAUNCH_DAY_SUPPORT_REPORT.md",
    "- [ ] FINAL_CUTOVER_REHEARSAL.md",
    "- [ ] LAUNCH_FREEZE_CHECKLIST.md",
    "- [ ] FINAL_LAUNCH_SIGNOFF.md",
    "- [ ] OPERATOR_TRAINING_PACK.md",
    "- [ ] POST_CUTOVER_MONITORING_REPORT.md",
    "- [ ] POST_LAUNCH_BUG_CAPTURE.md",
    "",
    "### Audit Events (Sprint 79)",
    "",
    "| Event | Category |",
    "| --- | --- |",
    "| `final_live_verification.generated` | publishing |",
    "| `final_live_verification.exported` | publishing |",
    "| `go_no_go.generated` | publishing |",
    "| `go_no_go.exported` | publishing |",
    "",
    "### Safety Notes",
    "",
    "- No production mutation from any panel in Sprint 79.",
    "- All server commands must be executed manually by a named operator via SSH.",
    "- Do not restart PM2 from the panel.",
    "- Do not touch Doorsteps/LocalShop (prisom-manager, prisom-backend).",
    "- Sardar Security production must remain live throughout the verification window.",
    "- No secrets are included in this section or any export.",
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
    buildProductionCutoverExecutionSection(),
    buildPostCutoverMonitoringSection(),
    buildOperatorRunbookSection(),
    buildReleaseCandidateSection(),
    buildLiveQaVerificationSection(),
    buildClientMigrationTemplateSection(),
    buildProjectMigrationProfileSection(),
    buildLaunchSignoffAndTrainingSection(),
    buildFinalRehearsalAndFreezeSection(),
    buildLaunchDayAndBugCaptureSection(),
    buildFinalReadinessAndStopBuildSection(),
    buildDeployVerificationAndLaunchExecutionSection(),
    buildFinalLiveVerificationAndGoNoGoSection(),
    buildServices(report),
    buildFooter(),
  ]
    .filter(Boolean)
    .join("\n");
}
