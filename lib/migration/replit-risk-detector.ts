/**
 * lib/migration/replit-risk-detector.ts
 *
 * Sprint 24: Generates migration risks (blockers/warnings/info) from
 * the detected project structure.
 *
 * Each risk has a severity, title, details, suggested fix, and the
 * source files where the issue was detected.
 */

import type {
  MigrationRisk,
  ReplitMigrationReport,
} from "./replit-detection-types";

// ── Risk generator ────────────────────────────────────────────────────────────

/**
 * Given a partial report (everything except risks + suggestedServices),
 * produce the list of migration risks.
 */
export function detectMigrationRisks(
  report: Omit<ReplitMigrationReport, "risks" | "suggestedServices" | "analyzedAt" | "filesScanned">,
  allContent: string,
  fileList:   string[],
): MigrationRisk[] {
  const risks: MigrationRisk[] = [];

  // ── Blocker: Replit email connector ──────────────────────────────────────
  if (report.email?.isReplitConnector) {
    const files = fileList.filter((f) =>
      /connectors|mail|email|nodemailer/i.test(f) && !f.includes("node_modules"),
    ).slice(0, 5);
    risks.push({
      severity:     "blocker",
      title:        "Email uses Replit connector (google-mail)",
      details:      "The @replit/connectors-sdk or Replit Google Mail connector does not work outside Replit. Emails will fail silently on VPS.",
      suggestedFix: "Replace with an SMTP provider (Resend, SendGrid, Mailgun, or SMTP relay). Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in the Secrets Vault.",
      filesInvolved: files,
    });
  }

  // ── Blocker: REPLIT_DOMAINS used for absolute URLs ─────────────────────
  if (allContent.includes("REPLIT_DOMAINS")) {
    const files = fileList.filter((f) =>
      !f.includes("node_modules"),
    ).filter((f) => {
      // We don't have per-file content at this point; return likely suspects
      return /server|api|config|env|url|host|cors/i.test(f);
    }).slice(0, 5);
    risks.push({
      severity:     "blocker",
      title:        "REPLIT_DOMAINS used for absolute URL generation",
      details:      "REPLIT_DOMAINS is set automatically by Replit and will be undefined on VPS. Any code using it to build URLs will produce broken links or CORS failures.",
      suggestedFix: "Replace REPLIT_DOMAINS with APP_URL. Create a helper: getPublicBaseUrl() → process.env.APP_URL || req.headers['x-forwarded-proto'] + '://' + req.headers['x-forwarded-host']. Set APP_URL in the Secrets Vault.",
      filesInvolved: files,
    });
  }

  // ── Blocker: REPLIT_DB_URL (Replit KV) ───────────────────────────────────
  if (report.database?.type === "replit-db") {
    risks.push({
      severity:     "blocker",
      title:        "Replit KV database (REPLIT_DB_URL) detected",
      details:      "Replit DB is a proprietary key-value store that only works inside Replit. It will be inaccessible on VPS.",
      suggestedFix: "Export all key-value data from Replit DB using their SDK. Migrate to Redis, PostgreSQL (JSONB), or another KV store. Update all REPLIT_DB_URL references.",
      filesInvolved: [],
    });
  }

  // ── Blocker: PORT must be injected, not hardcoded ─────────────────────────
  if (report.backend) {
    const hardcodedPort = /listen\(\s*(?:3000|8080|8000|5000|4000|3001)\s*[,)]/g.test(allContent);
    if (hardcodedPort) {
      risks.push({
        severity:     "blocker",
        title:        "Hardcoded port number in server code",
        details:      "A specific port number is hardcoded in server.listen(). On Prisom VPS, the port is assigned dynamically and injected as the PORT environment variable.",
        suggestedFix: "Change server.listen(3000) to server.listen(process.env.PORT || 3000). Prisom will inject the correct PORT via environment.",
        filesInvolved: fileList.filter((f) =>
          /server|index|app|main/i.test(f) && /\.(ts|js|mjs|cjs)$/.test(f) && !f.includes("node_modules"),
        ).slice(0, 3),
      });
    }
  }

  // ── Blocker: DATABASE_URL not detected but DB dependency exists ────────────
  if (report.database && report.database.type !== "none" && report.database.type !== "unknown") {
    const hasDatabaseUrl = allContent.includes("DATABASE_URL") || allContent.includes("POSTGRES_URL");
    if (!hasDatabaseUrl && report.database.type !== "replit-db") {
      risks.push({
        severity:     "warning",
        title:        "Database detected but DATABASE_URL not found in code",
        details:      "A database dependency was detected but no DATABASE_URL reference was found in source code. The connection string may be hardcoded or configured differently.",
        suggestedFix: "Ensure database connection uses process.env.DATABASE_URL and add this secret to the Secrets Vault.",
        filesInvolved: [],
      });
    }
  }

  // ── Blocker: No API health route ──────────────────────────────────────────
  if (report.backend) {
    const hasHealthz = allContent.includes("/healthz") || allContent.includes("/health");
    if (!hasHealthz) {
      risks.push({
        severity:     "warning",
        title:        "No health check endpoint detected",
        details:      "Prisom's deployment monitor checks /api/healthz to confirm the Node service is alive. Without it, deployment health checks will fail.",
        suggestedFix: 'Add a GET /api/healthz route that returns HTTP 200 with { ok: true, ts: Date.now() }.',
        filesInvolved: [],
      });
    }
  }

  // ── Warning: Stripe webhook must be repointed ─────────────────────────────
  if (report.payments.some((p) => p.provider === "stripe" && p.hasWebhook)) {
    risks.push({
      severity:     "warning",
      title:        "Stripe webhook URL must be updated",
      details:      "Your Stripe webhook is currently pointing to your Replit domain. After deployment, you must update it in the Stripe Dashboard to your new domain.",
      suggestedFix: "After first deploy: Stripe Dashboard → Developers → Webhooks → Update endpoint URL to https://yourdomain.com/api/webhooks/stripe. Update STRIPE_WEBHOOK_SECRET if it changes.",
      filesInvolved: fileList.filter((f) => /webhook|stripe/i.test(f) && !f.includes("node_modules")).slice(0, 3),
    });
  }

  // ── Warning: CORS origin is wide open ─────────────────────────────────────
  const hasWideCors = allContent.includes('origin: "*"') || allContent.includes("origin: '*'") ||
    allContent.includes('cors()') && !allContent.includes("origin:");
  if (hasWideCors && report.backend) {
    risks.push({
      severity:     "warning",
      title:        "CORS is configured to allow all origins (*)",
      details:      "Wide-open CORS (origin: '*') is insecure for authenticated APIs. All origins can make cross-origin requests.",
      suggestedFix: "Restrict CORS to your frontend domain: cors({ origin: process.env.APP_URL }). Set APP_URL to your production domain.",
      filesInvolved: fileList.filter((f) => /cors|server|index|app/i.test(f) && !f.includes("node_modules")).slice(0, 3),
    });
  }

  // ── Warning: No SQL migrations folder ────────────────────────────────────
  if (report.database?.type === "postgres" && report.database?.orm === "drizzle") {
    const hasMigrations = fileList.some((f) => f.includes("/migrations/") || f.includes("drizzle/migrations"));
    if (!hasMigrations) {
      risks.push({
        severity:     "warning",
        title:        "No Drizzle migration files found",
        details:      "Drizzle ORM is detected but no /migrations/ directory was found. You may be using drizzle-kit push (schema-push) instead of migrations.",
        suggestedFix: "Run `pnpm drizzle-kit push` after deployment to sync the database schema. For production, consider generating migration files for audit trail.",
        filesInvolved: ["drizzle.config.ts"],
      });
    }
  }

  // ── Warning: node-cron in multi-process ──────────────────────────────────
  const hasNodeCron = allContent.includes("node-cron") || allContent.includes("cron.schedule");
  if (hasNodeCron && report.backend) {
    risks.push({
      severity:     "warning",
      title:        "In-process cron job detected (node-cron)",
      details:      "node-cron runs inside the Node.js process. If PM2 starts multiple instances, cron jobs will run once per instance. This can cause duplicate job execution.",
      suggestedFix: "Set PM2 instances to 1 for the API service (startCommand should not use cluster mode). Or migrate to a proper queue (Bull, BullMQ) with a single worker.",
      filesInvolved: fileList.filter((f) => /cron|scheduler|job/i.test(f) && !f.includes("node_modules")).slice(0, 3),
    });
  }

  // ── Warning: @replit/connectors-sdk package ───────────────────────────────
  if (allContent.includes("@replit/connectors-sdk") || allContent.includes("REPLIT_CONNECTORS_")) {
    risks.push({
      severity:     "warning",
      title:        "Replit connectors SDK detected",
      details:      "The @replit/connectors-sdk package or REPLIT_CONNECTORS_* environment variables are used. This SDK only works in Replit's cloud environment.",
      suggestedFix: "Remove @replit/connectors-sdk. Replace its email functionality with Nodemailer + SMTP or a provider like Resend. Remove all REPLIT_CONNECTORS_* env vars.",
      filesInvolved: fileList.filter((f) =>
        !f.includes("node_modules") && /connector|mail|email/i.test(f),
      ).slice(0, 3),
    });
  }

  // ── Info: Node version requirement ────────────────────────────────────────
  if (report.nodeVersion) {
    risks.push({
      severity:     "info",
      title:        `Node.js version requirement: ${report.nodeVersion}`,
      details:      `The project specifies Node.js ${report.nodeVersion} in package.json engines or .nvmrc.`,
      suggestedFix: `Ensure the VPS Node.js version meets the requirement. Check with: node --version. Use nvm to install the required version if needed.`,
      filesInvolved: fileList.filter((f) => f === ".nvmrc" || f === "package.json").slice(0, 2),
    });
  }

  // ── Info: SQLite not recommended for VPS ─────────────────────────────────
  if (report.database?.type === "sqlite") {
    risks.push({
      severity:     "info",
      title:        "SQLite detected — consider migrating to PostgreSQL",
      details:      "SQLite works for single-process apps but has limitations in PM2-managed environments (concurrent writes, no network access).",
      suggestedFix: "Consider migrating the SQLite database to PostgreSQL for production stability. Drizzle and Prisma both support this migration path.",
      filesInvolved: [],
    });
  }

  // ── Info: Local file uploads ──────────────────────────────────────────────
  if (report.media?.hasLocalUploads && report.media.provider === "local") {
    risks.push({
      severity:     "info",
      title:        "Local file uploads detected",
      details:      "Files uploaded by users are stored on the local filesystem. These will not survive redeploys unless stored in a persistent location.",
      suggestedFix: "Mount a persistent storage directory for uploads, or migrate to Cloudinary/S3 for zero-maintenance media storage.",
      filesInvolved: report.media.localUploadPaths,
    });
  }

  // ── Info: Monorepo install recommendation ─────────────────────────────────
  if (report.isMonorepo && report.packageManager === "pnpm") {
    risks.push({
      severity:     "info",
      title:        "pnpm workspace monorepo — install must run from root",
      details:      "In a pnpm workspace, `pnpm install` must be run from the repo root to hoist shared packages. Running install inside a sub-package will not work correctly.",
      suggestedFix: "Set installCommand to `pnpm install --frozen-lockfile` with workingDir `.` (repo root). Build individual packages with `pnpm --filter @workspace/pkg run build`.",
      filesInvolved: ["pnpm-workspace.yaml"],
    });
  }

  return risks;
}
