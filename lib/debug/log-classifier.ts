/**
 * lib/debug/log-classifier.ts
 *
 * Sprint 58: Pattern-based log classifier.
 *
 * Scans sanitized log text and returns DebugFindings.
 * Each pattern maps to a category, severity, title, suggested fix, and
 * optional fix page href (resolved against /projects/[projectId]/ by callers).
 */

import type { DebugCategory, DebugFinding, DebugSeverity } from "./debug-types";

// ── Pattern definition ────────────────────────────────────────────────────────

type PatternDef = {
  id:          string;
  pattern:     RegExp;
  category:    DebugCategory;
  severity:    DebugSeverity;
  title:       string;
  message:     string;
  fix:         string;
  fixPage?:    string;  // relative path segment, e.g. "env" → /projects/[id]/env
};

const PATTERNS: PatternDef[] = [
  // ── Install / package ────────────────────────────────────────────────────────
  {
    id: "pnpm-outdated-lockfile",
    pattern: /ERR_PNPM_OUTDATED_LOCKFILE/i,
    category: "install", severity: "error",
    title: "pnpm lockfile out of date",
    message: "The lockfile does not match package.json. Run `pnpm install` to regenerate it.",
    fix: "Run `pnpm install` in the project root.",
    fixPage: "publishing",
  },
  {
    id: "module-not-found",
    pattern: /Cannot find module|Module not found/i,
    category: "install", severity: "error",
    title: "Missing module",
    message: "A required module could not be resolved. Dependencies may not be installed.",
    fix: "Run `pnpm install` and ensure all dependencies are listed in package.json.",
    fixPage: "publishing",
  },
  {
    id: "unsupported-engine",
    pattern: /Unsupported engine|requires Node\.js/i,
    category: "install", severity: "warning",
    title: "Unsupported Node.js version",
    message: "The project requires a different Node.js version than the one installed.",
    fix: "Use nvm or .nvmrc to set the correct Node.js version.",
    fixPage: "publishing",
  },
  {
    id: "node-gyp-failed",
    pattern: /node-gyp failed|gyp ERR!/i,
    category: "install", severity: "error",
    title: "Native build failure (node-gyp)",
    message: "A native addon failed to compile. System build tools may be missing.",
    fix: "Install build-essential and python3, then run `pnpm install` again.",
    fixPage: "publishing",
  },
  {
    id: "eacces-permission",
    pattern: /EACCES permission denied/i,
    category: "permissions", severity: "error",
    title: "Permission denied",
    message: "The process lacks read/write permission on a file or directory.",
    fix: "Check file ownership and permissions. Ensure the process user owns the project directory.",
    fixPage: "publishing",
  },
  // ── Build ────────────────────────────────────────────────────────────────────
  {
    id: "ts-type-error",
    pattern: /Type error:|TS\d+:|typescript.*error/i,
    category: "build", severity: "error",
    title: "TypeScript type error",
    message: "The build failed due to a TypeScript type error.",
    fix: "Run `pnpm run typecheck` locally to see the full error. Fix the type mismatch.",
    fixPage: "publishing",
  },
  {
    id: "ts-property-not-exist",
    pattern: /Property .* does not exist on type/i,
    category: "build", severity: "error",
    title: "TypeScript property missing",
    message: "A property was accessed that does not exist on its type.",
    fix: "Check the type definition and ensure the property name is correct.",
    fixPage: "publishing",
  },
  {
    id: "ts-cannot-find-name",
    pattern: /Cannot find name '|is not defined/i,
    category: "build", severity: "error",
    title: "Undefined name",
    message: "An identifier is used before it is declared or imported.",
    fix: "Check imports and ensure the variable/function is declared.",
    fixPage: "publishing",
  },
  {
    id: "next-build-failed",
    pattern: /Next\.js build failed|next build.*error/i,
    category: "build", severity: "critical",
    title: "Next.js build failed",
    message: "The Next.js production build failed.",
    fix: "Run `pnpm run build` locally and resolve all errors shown.",
    fixPage: "publishing",
  },
  {
    id: "vite-build-failed",
    pattern: /vite build.*error|Vite.*failed/i,
    category: "build", severity: "critical",
    title: "Vite build failed",
    message: "The Vite production build failed.",
    fix: "Run the build locally and resolve errors before deploying.",
    fixPage: "publishing",
  },
  // ── Runtime ─────────────────────────────────────────────────────────────────
  {
    id: "eaddrinuse",
    pattern: /EADDRINUSE|address already in use|port.*already in use/i,
    category: "runtime", severity: "critical",
    title: "Port already in use",
    message: "The server process cannot bind to its port because another process is using it.",
    fix: "Run `pm2 list` to find the conflicting process. Stop or restart it before deploying.",
    fixPage: "publishing",
  },
  {
    id: "econnrefused",
    pattern: /ECONNREFUSED|Cannot connect to/i,
    category: "runtime", severity: "error",
    title: "Connection refused",
    message: "The app failed to connect to a downstream service (database, cache, API).",
    fix: "Verify the service is running and the connection URL/port is correct.",
    fixPage: "env",
  },
  {
    id: "health-check-failed",
    pattern: /health check failed|healthz.*failed|unhealthy/i,
    category: "runtime", severity: "critical",
    title: "Health check failed",
    message: "The application's health endpoint returned an error or did not respond.",
    fix: "Check app logs for startup errors. Verify DATABASE_URL and other env vars are set.",
    fixPage: "publishing",
  },
  {
    id: "start-command-exited",
    pattern: /start command exited|process.*exited|pm2.*stopped/i,
    category: "runtime", severity: "critical",
    title: "Process exited unexpectedly",
    message: "The application process stopped immediately after starting.",
    fix: "Check PM2 logs (`pm2 logs <name>`) for the error. Usually an env var or port issue.",
    fixPage: "publishing",
  },
  // ── Database ─────────────────────────────────────────────────────────────────
  {
    id: "database-url-missing",
    pattern: /DATABASE_URL.*missing|DATABASE_URL.*not.*set|missing.*DATABASE_URL/i,
    category: "database", severity: "critical",
    title: "DATABASE_URL not set",
    message: "The DATABASE_URL environment variable is missing or empty.",
    fix: "Add DATABASE_URL to the project's environment variables.",
    fixPage: "env",
  },
  {
    id: "prisma-init-error",
    pattern: /PrismaClientInitializationError|prisma.*initialization/i,
    category: "database", severity: "critical",
    title: "Prisma initialization failed",
    message: "Prisma failed to connect to the database on startup.",
    fix: "Verify DATABASE_URL is correct and the database server is reachable. Run `pnpm prisma generate`.",
    fixPage: "database",
  },
  {
    id: "db-password-auth-failed",
    pattern: /password authentication failed|authentication failed for user/i,
    category: "database", severity: "critical",
    title: "Database authentication failed",
    message: "The database rejected the credentials in DATABASE_URL.",
    fix: "Update DATABASE_URL with the correct username and password.",
    fixPage: "env",
  },
  {
    id: "db-connection-timeout",
    pattern: /connection timeout|connect.*timed out|Can't reach database server/i,
    category: "database", severity: "error",
    title: "Database connection timeout",
    message: "The database server did not respond in time.",
    fix: "Check that the database host is reachable from the server. Verify firewall rules.",
    fixPage: "database",
  },
  {
    id: "db-ssl-required",
    pattern: /SSL required|SSL connection/i,
    category: "database", severity: "error",
    title: "Database requires SSL",
    message: "The database requires an SSL connection, but the connection string does not include SSL settings.",
    fix: "Append `?sslmode=require` to DATABASE_URL or add `ssl: true` to Drizzle/Prisma config.",
    fixPage: "database",
  },
  {
    id: "relation-not-exist",
    pattern: /relation .* does not exist|table .* doesn't exist/i,
    category: "database", severity: "critical",
    title: "Database table missing",
    message: "A query referenced a table that does not exist. Migrations may not have run.",
    fix: "Run database migrations: `pnpm prisma db push` or `pnpm drizzle-kit migrate`.",
    fixPage: "database",
  },
  {
    id: "migration-failed",
    pattern: /migration failed|migrate.*error/i,
    category: "database", severity: "critical",
    title: "Database migration failed",
    message: "A database migration step failed.",
    fix: "Check migration files for errors. Verify DATABASE_URL is pointing to the correct database.",
    fixPage: "database",
  },
  // ── Routing / nginx ──────────────────────────────────────────────────────────
  {
    id: "nginx-config-failed",
    pattern: /nginx.*configuration file test failed|nginx.*\[emerg\]/i,
    category: "routing", severity: "critical",
    title: "nginx config syntax error",
    message: "The nginx configuration has a syntax error and failed the config test.",
    fix: "Run `nginx -t` to see the exact error. Check the generated config for typos.",
    fixPage: "publishing",
  },
  {
    id: "nginx-upstream-not-found",
    pattern: /host not found in upstream|no resolver defined/i,
    category: "routing", severity: "error",
    title: "nginx upstream not found",
    message: "nginx cannot resolve the upstream server address.",
    fix: "Verify the upstream host/port is correct in the routing config.",
    fixPage: "publishing",
  },
  {
    id: "502-bad-gateway",
    pattern: /502 Bad Gateway|bad gateway/i,
    category: "routing", severity: "critical",
    title: "502 Bad Gateway",
    message: "nginx received an invalid response from the upstream app server. The app may be down.",
    fix: "Restart the app process and check its logs for startup errors.",
    fixPage: "publishing",
  },
  {
    id: "ssl-cert-problem",
    pattern: /SSL certificate problem|certificate verify failed|SSL handshake/i,
    category: "routing", severity: "error",
    title: "SSL certificate error",
    message: "An SSL/TLS certificate error occurred. The cert may be expired or misconfigured.",
    fix: "Renew the certificate with certbot or check the certificate path in nginx config.",
    fixPage: "domains",
  },
  // ── External services ─────────────────────────────────────────────────────────
  {
    id: "stripe-sig-failed",
    pattern: /Stripe signature verification failed|stripe.*webhook.*secret/i,
    category: "external_service", severity: "error",
    title: "Stripe webhook signature mismatch",
    message: "The Stripe webhook signature could not be verified. The webhook secret may be wrong.",
    fix: "Update STRIPE_WEBHOOK_SECRET in environment variables to match the Stripe dashboard.",
    fixPage: "env",
  },
  {
    id: "stripe-no-payment-intent",
    pattern: /No such payment_intent|No such customer|stripe.*not found/i,
    category: "external_service", severity: "warning",
    title: "Stripe resource not found",
    message: "A Stripe API request referenced a resource that does not exist.",
    fix: "Verify that you are using the correct Stripe mode (test vs. live) and the correct API key.",
    fixPage: "env",
  },
  {
    id: "cloudinary-unauthorized",
    pattern: /Cloudinary Unauthorized|cloudinary.*401|cloudinary.*invalid credentials/i,
    category: "external_service", severity: "error",
    title: "Cloudinary authentication failed",
    message: "Cloudinary rejected the API credentials.",
    fix: "Update CLOUDINARY_URL or CLOUDINARY_API_SECRET/KEY in environment variables.",
    fixPage: "env",
  },
  {
    id: "smtp-auth-failed",
    pattern: /SMTP authentication failed|smtp.*535|smtp.*login.*failed/i,
    category: "external_service", severity: "error",
    title: "SMTP authentication failed",
    message: "The SMTP server rejected the credentials.",
    fix: "Update SMTP_USER/SMTP_PASS in environment variables. Check if 2FA is blocking SMTP.",
    fixPage: "env",
  },
  {
    id: "resend-forbidden",
    pattern: /Resend 403|resend.*forbidden/i,
    category: "external_service", severity: "error",
    title: "Resend API forbidden",
    message: "The Resend API returned a 403. The API key may be invalid or the domain unverified.",
    fix: "Check RESEND_API_KEY and ensure your sending domain is verified in Resend.",
    fixPage: "env",
  },
  {
    id: "sendgrid-unauthorized",
    pattern: /SendGrid unauthorized|sendgrid.*401/i,
    category: "external_service", severity: "error",
    title: "SendGrid API unauthorized",
    message: "The SendGrid API key is invalid or has insufficient permissions.",
    fix: "Update SENDGRID_API_KEY in environment variables.",
    fixPage: "env",
  },
  // ── GitHub ───────────────────────────────────────────────────────────────────
  {
    id: "github-auth-failed",
    pattern: /fatal: Authentication failed|remote: Repository not found.*credentials/i,
    category: "github", severity: "critical",
    title: "GitHub authentication failed",
    message: "Git could not authenticate with GitHub. The token or SSH key may be invalid.",
    fix: "Re-authorise the GitHub integration or update the deploy key.",
    fixPage: "github",
  },
  {
    id: "github-ssh-denied",
    pattern: /Permission denied \(publickey\)|git.*permission denied/i,
    category: "github", severity: "critical",
    title: "GitHub SSH permission denied",
    message: "The SSH public key was rejected by GitHub.",
    fix: "Add the deploy key to the GitHub repository settings.",
    fixPage: "github",
  },
  {
    id: "github-repo-not-found",
    pattern: /repository not found|ERROR: Repository not found/i,
    category: "github", severity: "error",
    title: "GitHub repository not found",
    message: "The repository does not exist or the account lacks access.",
    fix: "Verify the repository URL and check that the GitHub token has access.",
    fixPage: "github",
  },
  {
    id: "github-non-fast-forward",
    pattern: /non-fast-forward|push rejected.*non-fast-forward/i,
    category: "github", severity: "warning",
    title: "GitHub push rejected (non-fast-forward)",
    message: "The remote branch has diverged and the push was rejected.",
    fix: "Pull the latest changes and rebase before pushing.",
    fixPage: "github",
  },
  {
    id: "github-dirty-worktree",
    pattern: /dirty worktree|uncommitted changes/i,
    category: "github", severity: "warning",
    title: "Dirty working tree",
    message: "There are uncommitted changes in the repository.",
    fix: "Commit or stash changes before running the operation.",
    fixPage: "github",
  },
];

// ── Classifier ────────────────────────────────────────────────────────────────

export type ClassifiedFinding = {
  id:          string;
  category:    DebugCategory;
  severity:    DebugSeverity;
  title:       string;
  message:     string;
  evidence:    string[];
  suggestedFix: string;
  fixPage?:    string;
};

/**
 * Classify sanitized log text into findings.
 * The `projectId` is used to build fix hrefs; pass "" if none available.
 */
export function classifyLogText(logText: string, projectId: string): DebugFinding[] {
  const lines    = logText.split("\n");
  const findings: DebugFinding[] = [];
  const seen     = new Set<string>();

  for (const def of PATTERNS) {
    // Check if any line matches
    const matchedLines = lines.filter((l) => def.pattern.test(l));
    if (matchedLines.length === 0) continue;
    if (seen.has(def.id)) continue;
    seen.add(def.id);

    const evidence = matchedLines.slice(0, 3).map((l) => l.trim());
    const fixHref  = def.fixPage && projectId
      ? `/projects/${projectId}/${def.fixPage}`
      : undefined;

    findings.push({
      id:           def.id,
      category:     def.category,
      severity:     def.severity,
      title:        def.title,
      message:      def.message,
      evidence,
      suggestedFix: def.fix,
      fixHref,
    });
  }

  return findings;
}

/** Return the overall status based on finding severities. */
export function findingsToStatus(
  findings: DebugFinding[],
): "healthy" | "warning" | "failed" | "unknown" {
  if (findings.length === 0) return "unknown";
  if (findings.some((f) => f.severity === "critical" || f.severity === "error")) return "failed";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "healthy";
}

/** Derive a human-readable likely cause from the highest-severity finding. */
export function derivelikelyCause(findings: DebugFinding[]): string | undefined {
  if (findings.length === 0) return undefined;
  const ordered = [...findings].sort((a, b) => {
    const rank = { critical: 0, error: 1, warning: 2, info: 3 };
    return rank[a.severity] - rank[b.severity];
  });
  return ordered[0].title;
}

/** Generate next steps based on findings categories. */
export function deriveNextSteps(findings: DebugFinding[]): string[] {
  if (findings.length === 0) {
    return [
      "No known error patterns detected in the log text.",
      "Check the full logs for any output after the last successful step.",
      "Verify environment variables are set correctly.",
    ];
  }

  const steps: string[] = [];
  const categories = new Set(findings.map((f) => f.category));

  if (categories.has("database")) {
    steps.push("Verify DATABASE_URL is set and the database server is reachable.");
  }
  if (categories.has("env")) {
    steps.push("Check all required environment variables are populated in the env page.");
  }
  if (categories.has("install") || categories.has("build")) {
    steps.push("Run `pnpm install && pnpm run build` locally to reproduce and fix build errors.");
  }
  if (categories.has("runtime")) {
    steps.push("Review PM2 logs after restart: `pm2 logs <process-name> --lines 100`.");
  }
  if (categories.has("routing")) {
    steps.push("Run `nginx -t` on the server to validate the nginx configuration.");
  }
  if (categories.has("github")) {
    steps.push("Check GitHub integration and re-authorise the deploy key if needed.");
  }
  if (categories.has("external_service")) {
    steps.push("Update the affected service API keys in the environment variables page.");
  }
  if (categories.has("permissions")) {
    steps.push("Check file and directory ownership on the server with `ls -la`.");
  }

  // Always add: review full logs
  steps.push("Review the full logs on the Logs page for additional context.");

  // De-duplicate
  return [...new Set(steps)];
}
