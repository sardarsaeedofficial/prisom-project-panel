import type {
  HelpTroubleshootingPlaybook,
  HelpTroubleshootingLibrary,
} from "./help-troubleshooting-types";

// ── Playbook definitions ──────────────────────────────────────────────────────
// Hardcoded operational playbooks. "unsafeFixes" must always be clearly labelled
// and require manual escalation. "safeFixes" can be attempted by an operator.

function buildPlaybooks(): HelpTroubleshootingPlaybook[] {
  return [
    // ── Playbook 1 ─────────────────────────────────────────────────────────────
    {
      id: "pb_login_not_loading",
      title: "Panel login page does not load",
      severity: "critical",
      symptoms: [
        "https://projects.doorstepmanchester.uk/login returns 502 or times out",
        "Browser shows 'Connection refused' or nginx error page",
        "Panel is unreachable from all devices",
      ],
      likelyCauses: [
        "PM2 process prisom-projects has crashed or stopped",
        "Node.js build output is missing or corrupt",
        "Port 3002 is not bound (another process, or the build failed)",
        "nginx upstream is misconfigured",
      ],
      checks: [
        "Check PM2 status: pm2 list | grep prisom-projects",
        "Check if port 3002 is listening: ss -tlnp | grep 3002",
        "Check recent PM2 logs: pm2 logs prisom-projects --lines 100",
        "Check nginx error log: tail -50 /var/log/nginx/error.log",
      ],
      commands: [
        "pm2 list | grep prisom-projects",
        "pm2 logs prisom-projects --lines 100",
        "ss -tlnp | grep 3002",
        "tail -50 /var/log/nginx/error.log",
      ],
      safeFixes: [
        "If PM2 shows 'stopped': pm2 restart prisom-projects --update-env (SSH only)",
        "If build output missing: cd /home/prisom/prisom-project-panel && pnpm run build && pm2 restart prisom-projects --update-env",
        "Run smoke checks after restart to confirm recovery",
      ],
      unsafeFixes: [
        "⚠ Do NOT reload nginx unless you have confirmed the config is valid: nginx -t",
        "⚠ Do NOT delete the .next/ build directory unless you are about to immediately rebuild",
        "⚠ Do NOT restart the server — escalate if a full reboot is needed",
      ],
      escalation: [
        "If PM2 keeps crashing after restart: escalate to developer (check for uncaught exception in logs)",
        "If nginx is returning 502 and prisom-projects is running: check nginx upstream config — escalate",
        "If port 3002 is occupied by another process: identify and escalate before killing",
      ],
      relatedPages: [],
      relatedExports: [],
    },

    // ── Playbook 2 ─────────────────────────────────────────────────────────────
    {
      id: "pb_dashboard_redirect",
      title: "Dashboard redirects unexpectedly",
      severity: "medium",
      symptoms: [
        "After login, dashboard redirects to login page",
        "Session appears lost immediately after authentication",
        "Multiple redirects in a loop",
      ],
      likelyCauses: [
        "NEXTAUTH_SECRET is missing or changed without restarting PM2",
        "Cookie domain mismatch (SSL/domain change without env update)",
        "NextAuth session table has expired or corrupt entries",
        "ENV variable NEXTAUTH_URL is wrong",
      ],
      checks: [
        "Check env vars are loaded: pm2 env prisom-projects | grep NEXTAUTH",
        "Verify NEXTAUTH_URL matches the current domain in .env",
        "Check browser console for cookie errors",
        "Check PM2 logs for auth errors: pm2 logs prisom-projects --lines 100 | grep -i auth",
      ],
      commands: [
        "pm2 env prisom-projects | grep NEXTAUTH",
        "pm2 logs prisom-projects --lines 100",
      ],
      safeFixes: [
        "If NEXTAUTH_URL is wrong: update .env then pm2 restart prisom-projects --update-env",
        "If session is expired/corrupt: clear the browser cookies and try again",
      ],
      unsafeFixes: [
        "⚠ Do NOT change NEXTAUTH_SECRET without planning for all existing sessions to be invalidated",
        "⚠ Do NOT delete session records from the DB without understanding the schema",
      ],
      escalation: [
        "If redirect loop persists after env fix: escalate to developer",
        "If auth errors show JWT decode failures: NEXTAUTH_SECRET may have changed — escalate",
      ],
      relatedPages: [],
      relatedExports: [],
    },

    // ── Playbook 3 ─────────────────────────────────────────────────────────────
    {
      id: "pb_sardar_frontend_down",
      title: "Sardar Security frontend is down",
      severity: "critical",
      symptoms: [
        "https://sardar-security-project.doorstepmanchester.uk/ returns 502 or 5xx",
        "Sardar frontend is unreachable from all devices",
        "Customers cannot browse the Sardar Security website",
      ],
      likelyCauses: [
        "PM2 process project-sardar-security-project has crashed",
        "Node.js build output is missing or corrupt in Sardar directory",
        "Port 4100 is not bound",
        "nginx upstream to port 4100 is broken",
      ],
      checks: [
        "Check Sardar PM2: pm2 list | grep project-sardar-security-project",
        "Check Sardar logs: pm2 logs project-sardar-security-project --lines 100",
        "Check if port 4100 is listening: ss -tlnp | grep 4100",
        "Check nginx error log: tail -50 /var/log/nginx/error.log",
      ],
      commands: [
        "pm2 list | grep project-sardar-security-project",
        "pm2 logs project-sardar-security-project --lines 100",
        "ss -tlnp | grep 4100",
        "curl -I https://sardar-security-project.doorstepmanchester.uk/",
      ],
      safeFixes: [
        "If PM2 shows stopped: pm2 restart project-sardar-security-project --update-env (SSH, manual only)",
        "Check Sardar build directory exists: ls /home/prisom/prisom-project-panel/../sardar-security-project (or its actual path)",
      ],
      unsafeFixes: [
        "⚠ Do NOT restart project-sardar-security-project from the Prisom panel UI",
        "⚠ Do NOT change Sardar's nginx config without developer approval",
        "⚠ Do NOT delete Sardar's .next/ directory without being ready to immediately rebuild",
      ],
      escalation: [
        "Notify client immediately if Sardar is down — it is a live ecommerce service",
        "If crash loop: escalate to developer, check for Stripe/DB/Cloudinary connection errors",
        "If nginx 502: check if Sardar was recently deployed — escalate to developer",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── Playbook 4 ─────────────────────────────────────────────────────────────
    {
      id: "pb_sardar_health_fail",
      title: "Sardar API health check returns non-200",
      severity: "high",
      symptoms: [
        "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz returns 500 or 503",
        "Health endpoint times out",
      ],
      likelyCauses: [
        "Prisma/database connection failure",
        "Environment variable for DATABASE_URL is wrong or DB is unreachable",
        "Node.js server is running but DB query is failing",
      ],
      checks: [
        "Check Sardar logs for DB errors: pm2 logs project-sardar-security-project --lines 50",
        "Verify DB process is running: systemctl status postgresql (or equivalent)",
        "Check if healthz route has a DB ping: the /api/healthz route may do a Prisma query",
      ],
      commands: [
        "pm2 logs project-sardar-security-project --lines 50",
        "curl -v https://sardar-security-project.doorstepmanchester.uk/api/healthz",
      ],
      safeFixes: [
        "If DB is running but connection string is wrong: update Sardar's .env, restart Sardar via SSH",
        "If DB is stopped: restart the DB service (systemctl start postgresql) — coordinate with admin",
      ],
      unsafeFixes: [
        "⚠ Do NOT restart the DB without a backup — escalate immediately",
        "⚠ Do NOT modify the DATABASE_URL in any .env file without developer approval",
      ],
      escalation: [
        "If DB is down: this is a P0 incident — notify all stakeholders immediately",
        "If Prisma migration is needed: escalate to developer — never run migrations ad-hoc",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── Playbook 5 ─────────────────────────────────────────────────────────────
    {
      id: "pb_build_fails",
      title: "pnpm run build fails",
      severity: "high",
      symptoms: [
        "pnpm run build exits with non-zero code",
        "Build output shows TypeScript or webpack errors",
        "No new .next/ output is generated",
      ],
      likelyCauses: [
        "Recent code has a TypeScript or import error",
        "A dependency was added but not installed (missing pnpm install)",
        "A server action or component references a missing type or function",
        "Environment variable is used but not defined in next.config.ts",
      ],
      checks: [
        "Run typecheck first: pnpm run typecheck",
        "Check the exact error message from the build output",
        "Run pnpm install to ensure all dependencies are installed",
      ],
      commands: [
        "pnpm run typecheck",
        "pnpm install",
        "pnpm run build",
      ],
      safeFixes: [
        "Fix the TypeScript or import error identified by typecheck",
        "Run pnpm install if a new package was added",
        "Check next.config.ts if a new env var is needed in the build",
      ],
      unsafeFixes: [
        "⚠ Do NOT use --legacy-peer-deps without developer approval",
        "⚠ Do NOT delete .next/ and retry if the error is in the source code — fix the source",
        "⚠ Do NOT restart PM2 with a broken build",
      ],
      escalation: [
        "If the error is in a library file or Prisma schema: escalate to developer",
        "If pnpm install fails with network errors: check internet access on server",
      ],
      relatedPages: [],
      relatedExports: [],
    },

    // ── Playbook 6 ─────────────────────────────────────────────────────────────
    {
      id: "pb_typecheck_fails",
      title: "pnpm run typecheck fails",
      severity: "medium",
      symptoms: [
        "pnpm run typecheck returns TypeScript errors",
        "Errors reference specific files and line numbers",
      ],
      likelyCauses: [
        "A recent code change introduced a type error",
        "A type was used that doesn't exist on the expected object",
        "An import path is wrong",
        "A required parameter is missing from a function call",
      ],
      checks: [
        "Read the exact TypeScript error output carefully",
        "Open the file at the line number shown",
        "Check if the error is in a Sprint 81–83 help-center file (known complex types)",
      ],
      commands: [
        "pnpm run typecheck 2>&1 | head -60",
      ],
      safeFixes: [
        "Fix the type error at the indicated file and line",
        "If the error is 'property does not exist on type': check if the type definition was updated",
        "If the error is 'cannot find module': verify the import path and file existence",
      ],
      unsafeFixes: [
        "⚠ Do NOT add @ts-ignore comments without developer review",
        "⚠ Do NOT set strict: false in tsconfig.json",
      ],
      escalation: [
        "If the error is in a generated Prisma type: escalate to developer (may need prisma generate)",
        "If the error is in a UI library type: escalate to developer",
      ],
      relatedPages: [],
      relatedExports: [],
    },

    // ── Playbook 7 ─────────────────────────────────────────────────────────────
    {
      id: "pb_export_button_fails",
      title: "Export button fails or produces empty output",
      severity: "medium",
      symptoms: [
        "Clicking an export button shows an error message",
        "The downloaded file is empty",
        "The export spinner never completes",
      ],
      likelyCauses: [
        "Server action threw an unexpected error",
        "The knowledge base was not generated before attempting the export",
        "A file in the scan path threw an fs.readFileSync error",
        "Node.js fs module failed to read a file (permission or encoding issue)",
      ],
      checks: [
        "Check PM2 logs for server action errors: pm2 logs prisom-projects --lines 50",
        "Ensure 'Generate All Documentation' was clicked before exporting",
        "Check if the file path in warnings was excluded due to an error",
      ],
      commands: [
        "pm2 logs prisom-projects --lines 50",
      ],
      safeFixes: [
        "Click 'Generate All Documentation' first, then retry the export",
        "If the error says 'permission denied': the file may need chmod on the server — escalate",
        "Reload the page and regenerate",
      ],
      unsafeFixes: [
        "⚠ Do NOT modify file permissions on system files without administrator approval",
      ],
      escalation: [
        "If the export consistently fails for a specific file: check the file at the path shown in the error",
        "If the fs scanner is crashing: escalate to developer to check the help-center service",
      ],
      relatedPages: ["/projects/[projectId]/help"],
      relatedExports: [],
    },

    // ── Playbook 8 ─────────────────────────────────────────────────────────────
    {
      id: "pb_help_search_weak",
      title: "Help Search gives a weak or irrelevant answer",
      severity: "low",
      symptoms: [
        "Ask Help returns 'No matching information found'",
        "Search results are unrelated to the query",
        "Confidence badge shows 'Low confidence'",
      ],
      likelyCauses: [
        "Knowledge base was not regenerated after recent code changes",
        "The query uses different terminology than the knowledge base",
        "The topic is not covered by the 15 knowledge sections",
        "The knowledge base was generated with stale content",
      ],
      checks: [
        "Check when the knowledge base was last generated (timestamp shown in Exports tab)",
        "Try different search keywords (e.g. 'deploy' instead of 'deployment procedure')",
        "Check if the knowledge base was generated at all",
      ],
      commands: [],
      safeFixes: [
        "Regenerate: click 'Generate All Documentation' to refresh the knowledge base",
        "Try the Search tab with shorter keywords",
        "Check the Sections tab to browse the knowledge base directly",
        "Look in the Deep Map tab for route/action/export relationships",
      ],
      unsafeFixes: [],
      escalation: [
        "If regeneration still gives poor results: the topic may not be well-covered — check source files directly",
      ],
      relatedPages: ["/projects/[projectId]/help"],
      relatedExports: [],
    },

    // ── Playbook 9 ─────────────────────────────────────────────────────────────
    {
      id: "pb_excluded_paths_warning",
      title: "Help scanner warns about excluded paths",
      severity: "low",
      symptoms: [
        "Warnings tab shows 'Skipped' or 'Cannot read' warnings",
        "Some expected files are missing from the knowledge base",
        "Excluded paths list is unexpectedly long",
      ],
      likelyCauses: [
        "A file exceeds the 300KB size limit",
        "A file has restricted permissions",
        "A file has an unsupported extension",
        "A directory was excluded by the hard exclusion rules",
      ],
      checks: [
        "Review the Warnings tab in the Help Center panel",
        "Review the Excluded Paths in the Warnings tab",
        "Check if the missing file is in a safe scan directory",
      ],
      commands: [],
      safeFixes: [
        "If a file is legitimately too large: this is expected — the scanner skips files over 300KB",
        "If an important file is excluded: check if it has a non-standard extension",
        "All .env, .git, node_modules exclusions are correct — these are hard safety rules",
      ],
      unsafeFixes: [
        "⚠ Do NOT modify the exclusion rules to include .env files — they contain production secrets",
      ],
      escalation: [
        "If a critical source file is being excluded incorrectly: escalate to developer",
      ],
      relatedPages: ["/projects/[projectId]/help"],
      relatedExports: [],
    },

    // ── Playbook 10 ────────────────────────────────────────────────────────────
    {
      id: "pb_smoke_check_non_200",
      title: "Smoke check returns non-200 (unexpected)",
      severity: "high",
      symptoms: [
        "curl -I https://projects.doorstepmanchester.uk/login returns 5xx",
        "Panel is not accessible after a deploy",
        "Sardar or panel smoke check fails",
      ],
      likelyCauses: [
        "PM2 process is stopped or crashed",
        "Build failed but PM2 was restarted anyway",
        "nginx upstream is wrong (wrong port or process not listening)",
        "SSL certificate has expired",
      ],
      checks: [
        "Check PM2: pm2 list",
        "Check port: ss -tlnp | grep 3002",
        "Check logs: pm2 logs prisom-projects --lines 100",
        "Check nginx: nginx -t && tail -20 /var/log/nginx/error.log",
      ],
      commands: [
        "pm2 list",
        "ss -tlnp | grep 3002",
        "pm2 logs prisom-projects --lines 100",
        "nginx -t",
      ],
      safeFixes: [
        "If PM2 stopped: pm2 restart prisom-projects --update-env (SSH only)",
        "If nginx config is valid and port is wrong: update nginx upstream port — escalate",
      ],
      unsafeFixes: [
        "⚠ Do NOT reload nginx without validating the config first: nginx -t",
        "⚠ Do NOT force-restart PM2 if logs show a crash loop — fix the root cause first",
      ],
      escalation: [
        "If SSL expired: escalate to admin for certificate renewal",
        "If crash loop persists: escalate to developer",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── Playbook 11 ────────────────────────────────────────────────────────────
    {
      id: "pb_pm2_unhealthy",
      title: "PM2 process appears unhealthy",
      severity: "high",
      symptoms: [
        "pm2 list shows status 'errored' or 'stopped'",
        "PM2 restart count is unusually high",
        "Process memory is extremely high",
      ],
      likelyCauses: [
        "Uncaught exception in the application causing crash loop",
        "Memory leak in a long-running request",
        "Missing environment variable causing startup failure",
      ],
      checks: [
        "Check PM2 details: pm2 show prisom-projects",
        "Check recent logs for crash reason: pm2 logs prisom-projects --lines 200",
        "Check env: pm2 env prisom-projects",
        "Check memory: pm2 monit",
      ],
      commands: [
        "pm2 show prisom-projects",
        "pm2 logs prisom-projects --lines 200",
        "pm2 monit",
        "pm2 env prisom-projects",
      ],
      safeFixes: [
        "If a missing env var: add it to .env and pm2 restart prisom-projects --update-env",
        "If high memory: pm2 restart prisom-projects (graceful, keeps app alive during restart)",
        "After fixing, verify with smoke checks",
      ],
      unsafeFixes: [
        "⚠ Do NOT use pm2 delete — it removes the process from the PM2 list; use restart instead",
        "⚠ Do NOT restart without checking the logs — crash loop means there is a code error",
      ],
      escalation: [
        "If crash loop continues after restart: escalate to developer immediately",
        "If ENV vars are missing that should be in .env: check if .env was accidentally deleted",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── Playbook 12 ────────────────────────────────────────────────────────────
    {
      id: "pb_domain_ssl_issue",
      title: "Domain or SSL route issue",
      severity: "high",
      symptoms: [
        "Browser shows SSL certificate error",
        "Domain resolves to wrong IP",
        "HTTPS not working on a newly configured domain",
      ],
      likelyCauses: [
        "SSL certificate has expired",
        "DNS A record is wrong or not propagated",
        "nginx SSL config is missing or incorrect",
        "Certificate was not renewed by certbot",
      ],
      checks: [
        "Check certificate: openssl s_client -connect projects.doorstepmanchester.uk:443 | grep -A2 'subject'",
        "Check DNS: nslookup projects.doorstepmanchester.uk",
        "Check nginx config: nginx -t",
      ],
      commands: [
        "openssl s_client -connect projects.doorstepmanchester.uk:443 2>/dev/null | grep -A2 'subject'",
        "nslookup projects.doorstepmanchester.uk",
        "nginx -t",
      ],
      safeFixes: [
        "If certbot renewal needed: certbot renew (escalate to admin)",
        "If DNS not propagated: wait 24–48h after DNS change, then re-check",
      ],
      unsafeFixes: [
        "⚠ Do NOT modify nginx SSL config without developer/admin review",
        "⚠ Do NOT change DNS records without written approval — downtime is immediate",
      ],
      escalation: [
        "All SSL and DNS issues should be escalated to admin — these affect live production",
      ],
      relatedPages: [],
      relatedExports: [],
    },

    // ── Playbook 13 ────────────────────────────────────────────────────────────
    {
      id: "pb_payment_issue",
      title: "Checkout or payment issue after launch",
      severity: "critical",
      symptoms: [
        "Customers cannot complete checkout on Sardar",
        "Stripe payment fails with an error",
        "Orders are not being created in the database",
      ],
      likelyCauses: [
        "Stripe API key is in test mode but live orders are being made",
        "Stripe webhook secret is wrong",
        "Cloudinary image upload failing (blocking checkout UI)",
        "Database is unreachable or full",
      ],
      checks: [
        "Check Sardar logs for Stripe errors: pm2 logs project-sardar-security-project --lines 100",
        "Check if STRIPE_SECRET_KEY in Sardar .env is the live key (sk_live_…)",
        "Check Stripe dashboard for failed webhook deliveries",
        "Check DB connectivity: run a simple health check query",
      ],
      commands: [
        "pm2 logs project-sardar-security-project --lines 100",
      ],
      safeFixes: [
        "If Stripe is in test mode on production: update STRIPE_SECRET_KEY in Sardar .env to live key, restart Sardar (SSH)",
        "If webhook secret mismatch: update STRIPE_WEBHOOK_SECRET in Sardar .env to match Stripe dashboard",
      ],
      unsafeFixes: [
        "⚠ Do NOT expose Stripe keys in any chat, log, or export",
        "⚠ Do NOT process manual refunds without confirming the order state in the database",
        "⚠ Do NOT restart Sardar during an active checkout — wait or notify customer first",
      ],
      escalation: [
        "Payment issues are P0 — notify the client immediately",
        "If data loss is suspected: stop the service and escalate before taking any action",
        "Stripe disputes require direct coordination with Stripe support",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── Playbook 14 ────────────────────────────────────────────────────────────
    {
      id: "pb_log_warning_burst",
      title: "PM2 logs show a burst of warnings or errors",
      severity: "medium",
      symptoms: [
        "pm2 logs shows many repeated WARN or ERROR lines",
        "Error rate spikes after a deploy or external event",
        "Users report intermittent failures",
      ],
      likelyCauses: [
        "An external API (Stripe, Cloudinary, Resend) is rate-limiting or down",
        "A server action is being called repeatedly with bad input",
        "A slow database query is timing out under load",
        "A middleware is throwing on every request",
      ],
      checks: [
        "Read the most recent warning/error: pm2 logs prisom-projects --lines 100 | grep -i 'warn\\|error'",
        "Check if warnings are from a single file/function",
        "Check if external service status pages are showing incidents",
      ],
      commands: [
        "pm2 logs prisom-projects --lines 200",
      ],
      safeFixes: [
        "If an external API is down: implement graceful degradation and wait for recovery",
        "If a specific action is throwing: disable the feature temporarily via UI until fixed",
        "Capture the warning burst in POST_LAUNCH_BUG_REPORT.md for the developer",
      ],
      unsafeFixes: [
        "⚠ Do NOT restart PM2 during a warning burst without first identifying the cause",
        "⚠ Do NOT modify DB connection limits without DBA approval",
      ],
      escalation: [
        "If errors contain 'FATAL' or 'Unhandled rejection': escalate to developer immediately",
        "If Prisma reports connection pool exhaustion: escalate — this needs DB-level fixing",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: ["POST_LAUNCH_BUG_REPORT.md"],
    },
  ];
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateHelpTroubleshootingLibrary(input: {
  projectId: string;
}): Promise<HelpTroubleshootingLibrary> {
  const { projectId } = input;
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    playbooks: buildPlaybooks(),
    warnings: [],
  };
}
