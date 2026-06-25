/**
 * lib/runbook/operator-runbook-service.ts
 *
 * Sprint 67: Generates the operator runbook.
 *
 * Safety: no secrets, no production mutation, read-only.
 */

import type {
  OperatorRunbook,
  RunbookSection,
} from "./operator-runbook-types";

const LIVE_DOMAIN  = "sardar-security-project.doorstepmanchester.uk";
const PANEL_DOMAIN = "projects.doorstepmanchester.uk";

function p(projectId: string | undefined, href: string): string | undefined {
  return projectId ? `/projects/${projectId}${href}` : undefined;
}

// ── Sections ──────────────────────────────────────────────────────────────────

function buildSections(projectId?: string): RunbookSection[] {
  return [

    // ── Overview ─────────────────────────────────────────────────────────────
    {
      id:       "overview",
      title:    "System Overview",
      summary:  "What Prisom Project Panel is and what Sardar Security Supplies migration involves.",
      priority: "critical",
      audience: ["owner", "admin", "developer", "operator", "support"],
      steps: [
        {
          id:          "ov-1",
          label:       "What is Prisom Project Panel?",
          description: "A Next.js admin panel that manages project deployments, backups, staging, go-live, and monitoring for hosted client projects. Lives at projects.doorstepmanchester.uk.",
        },
        {
          id:          "ov-2",
          label:       "What is the Sardar Security Supplies project?",
          description: "An ecommerce project being migrated to a new stack. Currently live at sardar-security-project.doorstepmanchester.uk (port 4100). The migration follows Sprints 50–66.",
        },
        {
          id:          "ov-3",
          label:       "What is safe to do in this panel?",
          description: "Generating reports, running GET-only smoke checks, reviewing checklists, exporting documentation, managing team members, reviewing audit logs. All safe — no production mutation.",
        },
        {
          id:          "ov-4",
          label:       "What requires explicit confirmation?",
          description: "APPLY PRODUCTION CUTOVER, EXECUTE PRODUCTION ROLLBACK, RUN PRODUCTION SMOKE CHECKS, MARK STAGING READY — all require typing the exact phrase. Never type these unless you are ready.",
          warning:     "Confirmation phrases must be typed exactly. There is no undo for production apply or rollback.",
        },
        {
          id:          "ov-5",
          label:       "What must NEVER be touched?",
          description: "Doorsteps/LocalShop (/home/prisom/prisom-panel, PM2: prisom-manager, prisom-backend). Do not touch these processes or files under any circumstances.",
          warning:     "Touching Doorsteps/LocalShop will break production for other clients.",
        },
      ],
    },

    // ── Access ───────────────────────────────────────────────────────────────
    {
      id:       "access",
      title:    "Access & Authentication",
      summary:  "Admin login, project team roles, and permission management.",
      priority: "critical",
      audience: ["owner", "admin"],
      steps: [
        {
          id:          "ac-1",
          label:       "Admin login",
          description: "Navigate to projects.doorstepmanchester.uk/login. Use your admin email and password. If locked out, reset via the CLI on the server.",
          linkHref:    `https://${PANEL_DOMAIN}/login`,
        },
        {
          id:          "ac-2",
          label:       "Review admin users",
          description: "Go to /admin/users to see all global users. Ensure only trusted users have admin or owner role.",
          linkHref:    `https://${PANEL_DOMAIN}/admin/users`,
        },
        {
          id:          "ac-3",
          label:       "Review project team permissions",
          description: "Each project has a Team page. Roles: owner, admin, developer, operator, viewer. Only owner/admin/developer can trigger deploys. Only deploy.trigger can apply production cutover.",
          linkHref:    p(projectId, "/team"),
        },
        {
          id:          "ac-4",
          label:       "Do not share credentials",
          description: "Never share admin passwords, session tokens, or secret API keys. Add team members as project members with the appropriate role instead.",
          warning:     "Shared credentials make audit trails unreliable and increase security risk.",
        },
      ],
    },

    // ── Project map ───────────────────────────────────────────────────────────
    {
      id:       "project_map",
      title:    "Project Page Map",
      summary:  "What each page does and when to use it.",
      priority: "high",
      audience: ["owner", "admin", "developer", "operator"],
      steps: [
        { id: "pm-1", label: "Monitoring",  description: "Real-time production health checks, incident severity, rollback recommendation. Start here after cutover.", linkHref: p(projectId, "/monitoring") },
        { id: "pm-2", label: "Releases",    description: "Production Execution Guard, Final Go-Live Control Room, deployment history, staging cards.", linkHref: p(projectId, "/releases") },
        { id: "pm-3", label: "Publishing",  description: "Deployment config, PM2 settings, route setup, compact sprint cards.", linkHref: p(projectId, "/publishing") },
        { id: "pm-4", label: "Migration",   description: "Sardar trial migration, ecommerce test, staging deployment proof.", linkHref: p(projectId, "/migration") },
        { id: "pm-5", label: "Backups",     description: "Create/restore backups, restore drill, integrity checks.", linkHref: p(projectId, "/backups") },
        { id: "pm-6", label: "Logs",        description: "PM2 log streaming, nginx error log access, debug summary panel.", linkHref: p(projectId, "/logs") },
        { id: "pm-7", label: "Operations",  description: "Full audit trail of deploys, backups, and admin actions.", linkHref: p(projectId, "/operations") },
        { id: "pm-8", label: "Domains",     description: "Domain management, SSL status.", linkHref: p(projectId, "/domains") },
        { id: "pm-9", label: "Team",        description: "Project team members and role management.", linkHref: p(projectId, "/team") },
        { id: "pm-10", label: "Settings",   description: "Project name, slug, env secrets overview (no values shown).", linkHref: p(projectId, "/settings") },
      ],
    },

    // ── Daily operations ──────────────────────────────────────────────────────
    {
      id:       "daily_operations",
      title:    "Daily Operations Checklist",
      summary:  "Routine operator checks for a healthy production system.",
      priority: "high",
      audience: ["owner", "admin", "operator"],
      steps: [
        { id: "do-1", label: "Check Monitoring page",    description: "Open Monitoring → Post-Cutover Control Room. Generate report. Verify status = Healthy, severity = None.", linkHref: p(projectId, "/monitoring") },
        { id: "do-2", label: "Run production health checks", description: "Use RUN PRODUCTION HEALTH CHECKS — root, /api/healthz, SPA fallback should all return 200.", linkHref: p(projectId, "/monitoring") },
        { id: "do-3", label: "Review Logs",              description: "Open Logs page. Look for new error patterns. Check nginx error log if anything is unusual.", linkHref: p(projectId, "/logs") },
        { id: "do-4", label: "Check Operations",         description: "Open Operations page. Confirm no unexpected actions were performed overnight.", linkHref: p(projectId, "/operations") },
        { id: "do-5", label: "Check Backups",            description: "Verify latest backup is recent (< 3 days). Create a new backup before any deployment.", linkHref: p(projectId, "/backups") },
        { id: "do-6", label: "Check Sardar frontend",    description: "Open https://sardar-security-project.doorstepmanchester.uk/ in a browser. Confirm storefront loads.", linkHref: `https://${LIVE_DOMAIN}/` },
        { id: "do-7", label: "Check Sardar API health",  description: "Open https://sardar-security-project.doorstepmanchester.uk/api/healthz — expect 200 OK.", linkHref: `https://${LIVE_DOMAIN}/api/healthz` },
      ],
    },

    // ── Staging ───────────────────────────────────────────────────────────────
    {
      id:       "staging",
      title:    "Staging Deployment Workflow",
      summary:  "How to create and validate a staging deployment before production cutover.",
      priority: "high",
      audience: ["owner", "admin", "developer"],
      steps: [
        { id: "st-1", label: "Open Migration page",       description: "Navigate to Migration → Sardar Staging Deployment panel.", linkHref: p(projectId, "/migration") },
        { id: "st-2", label: "Generate staging plan",     description: "Click Generate Staging Plan. Review 34 steps across 9 stages.", linkHref: p(projectId, "/migration") },
        { id: "st-3", label: "Review staging target",     description: "Staging slug must contain 'staging'. Never target live Sardar domain.", warning: "Do not use live Sardar slug or domain as staging target." },
        { id: "st-4", label: "Prepare source plan",       description: "Click PREPARE STAGING SOURCE. Reviews rsync plan — no files are actually copied.", linkHref: p(projectId, "/migration") },
        { id: "st-5", label: "Run staging dry run",       description: "Click RUN STAGING DRY RUN. GET-only smoke checks on staging domain.", linkHref: p(projectId, "/migration") },
        { id: "st-6", label: "Mark staging ready",        description: "Click MARK STAGING READY only when all 15 evidence items are reviewed.", linkHref: p(projectId, "/migration") },
        { id: "st-7", label: "Export staging proof",      description: "Export STAGING_DEPLOYMENT_PROOF.md for documentation before cutover.", linkHref: p(projectId, "/migration") },
      ],
    },

    // ── Go-live ───────────────────────────────────────────────────────────────
    {
      id:       "go_live",
      title:    "Go-Live & Cutover Workflow",
      summary:  "The exact sequence for safely moving from staging to production.",
      priority: "critical",
      audience: ["owner", "admin"],
      steps: [
        { id: "gl-1", label: "Generate Final Go-Live Gate",       description: "Releases page → Final Go-Live Control Room → Generate gate report. Score must be acceptable.", linkHref: p(projectId, "/releases") },
        { id: "gl-2", label: "Review all 14 evidence items",      description: "Check all 14 items in the Final Go-Live Control Room evidence checklist.", linkHref: p(projectId, "/releases") },
        { id: "gl-3", label: "Generate Production Execution Plan", description: "Releases page → Production Cutover Execution Guard → Generate Execution Plan.", linkHref: p(projectId, "/releases") },
        { id: "gl-4", label: "Preview production routes",         description: "Click Preview Production Routes. Confirm /api/* and /* routes are correct.", linkHref: p(projectId, "/releases") },
        { id: "gl-5", label: "Create final backup",               description: "Backups page → create a new backup IMMEDIATELY before applying routes.", linkHref: p(projectId, "/backups") },
        { id: "gl-6", label: "Run sudo nginx -t on server",       description: "SSH to server. Run: sudo nginx -t. Must pass before any nginx reload.", command: "sudo nginx -t", warning: "Never reload nginx without a passing nginx -t." },
        { id: "gl-7", label: "Run production smoke checks",       description: "Type RUN PRODUCTION SMOKE CHECKS confirmation in Production Execution Guard.", linkHref: p(projectId, "/releases") },
        { id: "gl-8", label: "Apply production cutover",          description: "Type APPLY PRODUCTION CUTOVER — records the request. Operator must then apply nginx config manually.", linkHref: p(projectId, "/releases"), warning: "This does NOT apply nginx automatically. Operator must apply nginx manually." },
        { id: "gl-9", label: "Verify post-cutover health",        description: "Open Monitoring page. Run RUN PRODUCTION HEALTH CHECKS. All required checks must pass.", linkHref: p(projectId, "/monitoring") },
      ],
    },

    // ── Monitoring ────────────────────────────────────────────────────────────
    {
      id:       "monitoring",
      title:    "Production Monitoring",
      summary:  "How to monitor the live Sardar production system after cutover.",
      priority: "critical",
      audience: ["owner", "admin", "operator"],
      steps: [
        { id: "mo-1", label: "Generate monitoring report", description: "Monitoring page → Post-Cutover Control Room → Generate Monitoring Report.", linkHref: p(projectId, "/monitoring") },
        { id: "mo-2", label: "Run production health checks", description: "Type RUN PRODUCTION HEALTH CHECKS to trigger GET-only checks on root, API, SPA fallback, products.", linkHref: p(projectId, "/monitoring") },
        { id: "mo-3", label: "Complete ecommerce checklist", description: "Manually verify storefront, products, checkout, admin, Stripe dashboard, email, Cloudinary.", linkHref: p(projectId, "/monitoring") },
        { id: "mo-4", label: "Review incident severity",    description: "Critical = site down. High = checkout down. Medium = external service warning. Low = minor.", linkHref: p(projectId, "/monitoring") },
        { id: "mo-5", label: "Export monitoring report",    description: "Export POST_CUTOVER_MONITORING_REPORT.md for the post-cutover record.", linkHref: p(projectId, "/monitoring") },
      ],
    },

    // ── Incident response ─────────────────────────────────────────────────────
    {
      id:       "incident_response",
      title:    "Incident Response Guide",
      summary:  "What to do when something goes wrong in production.",
      priority: "critical",
      audience: ["owner", "admin", "operator"],
      steps: [
        { id: "ir-1", label: "Check monitoring report",    description: "Go to Monitoring page. Run health checks. Note which checks failed and the severity.", linkHref: p(projectId, "/monitoring") },
        { id: "ir-2", label: "Check PM2 logs",             description: "Logs page → filter by PM2 source. Or on server: pm2 logs --lines 100", command: "pm2 logs --lines 100", linkHref: p(projectId, "/logs") },
        { id: "ir-3", label: "Check nginx error log",      description: "On server: sudo tail -f /var/log/nginx/error.log", command: "sudo tail -f /var/log/nginx/error.log" },
        { id: "ir-4", label: "Assess customer impact",     description: "Is the storefront loading? Can customers browse? Is checkout broken? Is admin accessible?" },
        { id: "ir-5", label: "Assign incident owner",      description: "One person must own the incident. Notify the team of degraded status." },
        { id: "ir-6", label: "Decide: fix or rollback?",   description: "If root or API is down and cannot be fixed in < 5 minutes, consider rollback. Review rollback checklist first.", linkHref: p(projectId, "/monitoring"), warning: "Do not attempt to fix production by running untested commands." },
        { id: "ir-7", label: "Mark incident reviewed",     description: "After resolution, type MARK INCIDENT REVIEWED in Monitoring Control Room.", linkHref: p(projectId, "/monitoring") },
        { id: "ir-8", label: "Export monitoring report",   description: "Export POST_CUTOVER_MONITORING_REPORT.md as a post-incident record.", linkHref: p(projectId, "/monitoring") },
      ],
    },

    // ── Rollback ──────────────────────────────────────────────────────────────
    {
      id:       "rollback",
      title:    "Rollback Guide",
      summary:  "How to safely roll back production to a previous working state.",
      priority: "critical",
      audience: ["owner", "admin"],
      steps: [
        { id: "rb-1", label: "Confirm rollback is needed",     description: "Rollback is needed when root or API is unreachable and cannot be restored quickly by fixing config.", warning: "Rollback does NOT rollback the database. Coordinate with DBA if schema migration occurred." },
        { id: "rb-2", label: "Identify previous release",      description: "Releases page → deployment history. Note the previous successful deployment ref.", linkHref: p(projectId, "/releases") },
        { id: "rb-3", label: "Confirm backup is available",    description: "Backups page → confirm a pre-cutover backup exists.", linkHref: p(projectId, "/backups") },
        { id: "rb-4", label: "Request rollback via panel",     description: "Releases page → Production Execution Guard → type EXECUTE PRODUCTION ROLLBACK. Records the request — does NOT restart PM2 or restore nginx automatically.", linkHref: p(projectId, "/releases"), warning: "The panel records the request only. Operator must execute manual steps." },
        { id: "rb-5", label: "Restore nginx config (manual)",  description: "On server: sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>", command: "sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>" },
        { id: "rb-6", label: "Validate nginx",                 description: "sudo nginx -t — must pass before reload.", command: "sudo nginx -t" },
        { id: "rb-7", label: "Reload nginx",                   description: "sudo nginx -s reload — only after nginx -t passes.", command: "sudo nginx -s reload" },
        { id: "rb-8", label: "Verify rollback health",         description: "Run health checks on Monitoring page. Confirm root and /api/healthz return 200.", linkHref: p(projectId, "/monitoring") },
        { id: "rb-9", label: "DB rollback warning",            description: "If a DB migration was run before cutover, app rollback does NOT undo DB changes. Restore from pg_dump backup separately.", warning: "Never run DB rollback without coordinator approval and a pg_dump backup." },
      ],
    },

    // ── Backups ───────────────────────────────────────────────────────────────
    {
      id:       "backups",
      title:    "Backup & Restore Guide",
      summary:  "How to create, verify, and restore project backups safely.",
      priority: "high",
      audience: ["owner", "admin", "developer"],
      steps: [
        { id: "bk-1", label: "Create a backup",       description: "Backups page → Create Backup. Always create a backup before any deployment or cutover.", linkHref: p(projectId, "/backups") },
        { id: "bk-2", label: "Verify backup integrity", description: "Backups page → check integrity status on latest backup.", linkHref: p(projectId, "/backups") },
        { id: "bk-3", label: "Run restore drill",      description: "Backups page → Restore Drill → mark drill complete. Proves restore is possible before you need it.", linkHref: p(projectId, "/backups") },
        { id: "bk-4", label: "Restore a backup",       description: "Backups page → select backup → restore. Requires confirmation phrase. Only restores app files — does NOT restore DB automatically.", linkHref: p(projectId, "/backups"), warning: "Backup restore does not restore database data. DB must be restored separately from a pg_dump." },
        { id: "bk-5", label: "Keep backups recent",    description: "Backups older than 3 days should be supplemented with a fresh one before cutover.", linkHref: p(projectId, "/backups") },
      ],
    },

    // ── Ecommerce ─────────────────────────────────────────────────────────────
    {
      id:       "ecommerce",
      title:    "Ecommerce Operations",
      summary:  "How to verify and maintain the Sardar ecommerce integrations.",
      priority: "medium",
      audience: ["owner", "admin", "operator"],
      steps: [
        { id: "ec-1", label: "Stripe: use test mode for checks", description: "All checkout tests must use Stripe test keys (pk_test_…). Never use real cards for testing.", warning: "Using live Stripe keys with test card numbers will create failed charges." },
        { id: "ec-2", label: "Verify Stripe webhook delivery",   description: "Check Stripe dashboard → Webhooks for any failed delivery events after cutover." },
        { id: "ec-3", label: "Verify email provider",            description: "Check email provider dashboard for transactional email delivery. Confirm order confirmation emails are sending." },
        { id: "ec-4", label: "Verify Cloudinary media",          description: "Open product pages and confirm images load. Check Cloudinary dashboard for upload errors." },
        { id: "ec-5", label: "Test admin panel",                  description: "Login to Sardar admin. Verify orders, products, and settings pages load without errors." },
        { id: "ec-6", label: "Ecommerce test harness",           description: "Use Migration page → Ecommerce Test Harness for systematic GET-only smoke checks.", linkHref: p(projectId, "/migration") },
      ],
    },

    // ── Permissions ───────────────────────────────────────────────────────────
    {
      id:       "permissions",
      title:    "Permissions & Role Guide",
      summary:  "Who can do what and how to review access safely.",
      priority: "high",
      audience: ["owner", "admin"],
      steps: [
        { id: "pe-1", label: "Roles overview",            description: "owner: all permissions. admin: all except owner-only. developer: deploy, edit. operator: view + run checks. viewer: read-only." },
        { id: "pe-2", label: "Dangerous actions require deploy.trigger", description: "APPLY PRODUCTION CUTOVER, EXECUTE PRODUCTION ROLLBACK, and smoke check triggers all require deploy.trigger or higher." },
        { id: "pe-3", label: "Never give viewer rollback access", description: "Viewers must not be able to trigger production cutover or rollback. Verify on Team page.", linkHref: p(projectId, "/team"), warning: "Granting viewer deploy access is a security risk." },
        { id: "pe-4", label: "Review team permissions",   description: "Team page → review each member's role before go-live. Remove anyone who should not have deploy access.", linkHref: p(projectId, "/team") },
        { id: "pe-5", label: "Audit trail",               description: "All dangerous actions are logged. Review Operations page for audit history.", linkHref: p(projectId, "/operations") },
      ],
    },

    // ── Debugging ─────────────────────────────────────────────────────────────
    {
      id:       "debugging",
      title:    "Debugging Guide",
      summary:  "How to diagnose and resolve common production issues.",
      priority: "high",
      audience: ["owner", "admin", "developer", "operator"],
      steps: [
        { id: "db-1", label: "Start at Logs page",        description: "Logs page streams PM2 process logs and supports log source selection.", linkHref: p(projectId, "/logs") },
        { id: "db-2", label: "Use Debug Summary panel",   description: "Logs page → expand Debug Summary. Provides AI-assisted root cause analysis from recent log lines.", linkHref: p(projectId, "/logs") },
        { id: "db-3", label: "Common: port conflict",     description: "If API service won't start, check if port 4100 is in use: sudo lsof -i :4100", command: "sudo lsof -i :4100" },
        { id: "db-4", label: "Common: nginx 502",         description: "502 Bad Gateway means the upstream Node.js service is not running. Check: pm2 status, pm2 logs", command: "pm2 status && pm2 logs --lines 20" },
        { id: "db-5", label: "Common: 404 on SPA routes", description: "If SPA routes return 404, nginx try_files is missing or wrong. Review route preview in Production Execution Guard.", linkHref: p(projectId, "/releases") },
        { id: "db-6", label: "Common: SSL error",         description: "If SSL fails, check certbot renewal: sudo certbot renew --dry-run. Check Domains page for SSL status.", linkHref: p(projectId, "/domains"), command: "sudo certbot renew --dry-run" },
        { id: "db-7", label: "Common: env var missing",   description: "If app crashes on startup with env error, check env vars on Settings page. Values not shown — verify on server.", linkHref: p(projectId, "/settings") },
      ],
    },

    // ── Handoff ───────────────────────────────────────────────────────────────
    {
      id:       "handoff",
      title:    "Handoff & Documentation Exports",
      summary:  "How to export complete documentation packages for handoff or archiving.",
      priority: "medium",
      audience: ["owner", "admin"],
      steps: [
        { id: "hf-1", label: "Export Full Migration Handoff",         description: "Migration page → Export Handoff. Generates a complete SARDAR_MIGRATION_HANDOFF.md with all sprint sections.", linkHref: p(projectId, "/migration") },
        { id: "hf-2", label: "Export Final Go-Live Pack",             description: "Releases → Final Go-Live Control Room → Export FINAL_GO_LIVE_PACK.md.", linkHref: p(projectId, "/releases") },
        { id: "hf-3", label: "Export Production Execution Plan",      description: "Releases → Production Cutover Execution Guard → Export PRODUCTION_CUTOVER_EXECUTION_PLAN.md.", linkHref: p(projectId, "/releases") },
        { id: "hf-4", label: "Export Post-Cutover Monitoring Report", description: "Monitoring → Post-Cutover Control Room → Export POST_CUTOVER_MONITORING_REPORT.md.", linkHref: p(projectId, "/monitoring") },
        { id: "hf-5", label: "Export This Operator Runbook",          description: "Settings/Runbook → Export OPERATOR_RUNBOOK.md.", linkHref: p(projectId, "/settings") },
        { id: "hf-6", label: "Store all exports",                     description: "Keep all exported Markdown files in a secure location. Share with new operators as onboarding documentation.", warning: "Exported documents do not contain secrets but do contain system architecture details." },
      ],
    },

  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateOperatorRunbook(input: {
  projectId?: string;
}): Promise<OperatorRunbook> {
  const { projectId } = input;

  const sections = buildSections(projectId);

  const warnings: string[] = [
    "This runbook is documentation only. No production actions are performed automatically.",
    "All confirmation phrases must be typed exactly — there is no undo for production apply or rollback.",
    "Doorsteps/LocalShop (/home/prisom/prisom-panel) must NEVER be touched.",
  ];

  const nextSteps = [
    "Review the System Overview section with all operators",
    "Complete the Admin Onboarding Checklist",
    "Run daily operations checklist at least once to verify it works",
    "Export this runbook and store it in a shared location",
    "Ensure at least one backup owner is identified",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    title:       "Operator Runbook — Sardar Security Supplies Migration",
    status:      "ready",
    sections,
    blockers:    [],
    warnings,
    nextSteps,
  };
}
