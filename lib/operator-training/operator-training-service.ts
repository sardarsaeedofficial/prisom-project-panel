/**
 * lib/operator-training/operator-training-service.ts
 *
 * Sprint 74: Generates an operator training pack for a project.
 * Read-only — no DB writes, no secrets returned, no production mutation.
 */

import { db }              from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type { OperatorTrainingPack, TrainingSection } from "./operator-training-types";

export async function generateOperatorTrainingPack(input: {
  projectId: string;
}): Promise<OperatorTrainingPack> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });

  const isSardar = project
    ? isSardarProject(project.name) || isSardarProject(project.slug ?? "")
    : false;

  const domain = await db.domain
    .findFirst({ where: { projectId, isPrimary: true }, select: { hostname: true } })
    .then((d) => d?.hostname ?? `project-${projectId.slice(0, 8)}`);

  const healthUrl = `https://${domain}/api/healthz`;

  // ── Training sections ─────────────────────────────────────────────────────

  const sections: TrainingSection[] = [
    {
      id:       "daily-operations",
      title:    "Daily Operations",
      audience: "operator",
      summary:  "Steps an operator should complete each morning before starting work.",
      steps: [
        "Navigate to Monitoring and verify the health check is green.",
        "Check the Logs page for any ERROR-level entries from the last 24 hours.",
        "Open Releases and confirm no deployment is stuck in 'Promoting' status.",
        "Check Backups — confirm the latest backup is within the last 24 hours.",
        "Review any open audit events on the Activity page.",
      ],
      safetyNotes: [
        "Do not restart PM2 from the panel UI — use server SSH only.",
        "Do not reload nginx from the panel UI.",
        "Do not apply route changes without a confirmed backup.",
      ],
    },

    {
      id:       "checking-health",
      title:    "Checking Application Health",
      audience: "operator",
      summary:  "How to verify the live application is responding correctly.",
      steps: [
        `Open the Monitoring page and look for a green uptime badge.`,
        `If the panel shows a failed health check, manually verify: curl -I ${healthUrl}`,
        "Check the PM2 process status on the server: pm2 list",
        "Check recent logs for crashes: pm2 logs <process-name> --lines 100",
        "If the app is down, check the Logs page for root cause before taking action.",
      ],
      safetyNotes: [
        "A single failed health check may be a transient timeout — wait 60 seconds and re-check.",
        "Do not restart the app without checking logs first.",
      ],
    },

    {
      id:       "reading-logs",
      title:    "Reading Logs",
      audience: "developer",
      summary:  "How to find and interpret application logs.",
      steps: [
        "Go to Logs page in the project.",
        "Filter by level=ERROR to find critical issues.",
        "Cross-reference error timestamps with Monitoring alerts.",
        "For PM2-level logs: ssh into server, run pm2 logs <process> --lines 200.",
        "For nginx access logs: /var/log/nginx/access.log",
      ],
      safetyNotes: [
        "Never share raw log output externally — logs may contain IP addresses or partial request data.",
        "Do not grep for secret key values — logs should never contain them.",
      ],
    },

    {
      id:       "running-qa",
      title:    "Running QA Checks",
      audience: "developer",
      summary:  "How to run the QA verification workflow before a release.",
      steps: [
        "Open Releases page.",
        "Scroll to the QA Verification panel.",
        "Click 'Run QA Check' and wait for the report.",
        "Resolve any blockers — do not promote to production with QA blockers.",
        "Export QA_VERIFICATION_REPORT.md and attach to the release record.",
      ],
      safetyNotes: [
        "QA checks are read-only — they do not change any production state.",
        "A QA pass is required before running the Release Candidate Hardening check.",
      ],
    },

    {
      id:       "exporting-reports",
      title:    "Exporting Reports",
      audience: "operator",
      summary:  "How to export key reports for client handover or audit records.",
      steps: [
        "QA Report → Releases > QA Verification panel > Export button.",
        "Release Candidate Report → Releases > Release Candidate panel > Export button.",
        "Final Go-Live Pack → Releases > Final Go-Live Control Room > Export button.",
        "Operator Runbook → Runbook page > Export button.",
        "Handoff Document → Migration page > Source Intake panel > Export Handoff.",
        "Launch Signoff → Releases > Final Launch Signoff panel > Export button.",
        "Operator Training Pack → Runbook page > Operator Training panel > Export button.",
      ],
      safetyNotes: [
        "No export contains secret values — only key names.",
        "Store all exported .md files in the project's documentation folder, not in the repo.",
      ],
    },

    {
      id:       "reviewing-backups",
      title:    "Reviewing Backups",
      audience: "operator",
      summary:  "How to confirm backups are current and recoverable.",
      steps: [
        "Open the Backups page.",
        "Verify the latest backup was taken within the last 24 hours.",
        "Check the backup size — a sudden drop may indicate an empty backup.",
        "Run a restore drill on staging before any production cutover.",
        "Export the backup record for audit purposes.",
      ],
      safetyNotes: [
        "Never restore a backup directly to production without a staging test first.",
        "Do not delete backups without approval from the project owner.",
      ],
    },

    {
      id:       "cutover-controls",
      title:    "Understanding Cutover Controls",
      audience: "admin",
      summary:  "Overview of the production cutover workflow and what each step does.",
      steps: [
        "The Production Execution Guard (Releases page) requires typing a specific confirmation phrase.",
        "The phrase is: APPLY PRODUCTION CUTOVER — do not type this unless you are ready.",
        "The panel records the request but does NOT apply nginx routes automatically.",
        "After confirmation, an operator must manually apply nginx routes on the server.",
        "Smoke checks must be run after route application — run them from the Execution Guard panel.",
      ],
      safetyNotes: [
        "The panel records all cutover attempts in the audit log.",
        "Never apply production routes if there are open QA blockers.",
        "Confirm a valid backup exists before any cutover.",
        "Have the rollback phrase ready: EXECUTE PRODUCTION ROLLBACK",
      ],
    },

    {
      id:       "emergency-rollback",
      title:    "Emergency Rollback Procedure",
      audience: "admin",
      summary:  "Step-by-step instructions for emergency rollback if production breaks.",
      steps: [
        "1. Confirm the issue — check health endpoint and logs before rolling back.",
        "2. Open Releases > Production Execution Guard.",
        "3. Type the confirmation phrase: EXECUTE PRODUCTION ROLLBACK",
        "4. Record the decision and timestamp in the audit log.",
        "5. On the server, switch nginx to the previous deployment: sudo nginx -t && sudo systemctl reload nginx",
        "6. Run smoke checks immediately after rollback.",
        "7. Notify the client and document the incident.",
        "8. Do not redeploy until root cause is confirmed.",
      ],
      safetyNotes: [
        "Rollback restores the previous nginx configuration — it does NOT undo database changes.",
        "If a DB migration was part of the deployment, a rollback may require a DB restore too.",
        "Always confirm the backup is recent before rolling back.",
      ],
    },

    ...(isSardar
      ? [
          {
            id:       "sardar-ecommerce",
            title:    "Sardar Ecommerce Operations",
            audience: "operator" as const,
            summary:  "Specific operational notes for the Sardar Security Supplies ecommerce project.",
            steps: [
              "Health endpoint: GET /api/healthz — must return 200 with JSON { ok: true }.",
              "API server runs on port 4100 under PM2 process: project-sardar-security-project.",
              "Stripe is in test mode on staging and live mode on production — do not confuse them.",
              "Cloudinary handles all product images — confirm CDN is reachable before launch.",
              "Confirm SMTP or Resend is configured for order confirmation emails.",
            ],
            safetyNotes: [
              "Do not run Stripe test transactions against the production Stripe account.",
              "Do not change the Stripe webhook secret without updating the Stripe dashboard.",
              "Never expose STRIPE_SECRET_KEY or CLOUDINARY_API_SECRET in logs or exports.",
            ],
          },
        ]
      : []),

    {
      id:       "what-not-to-touch",
      title:    "What Not to Touch",
      audience: "operator",
      summary:  "List of actions that are off-limits from the panel UI.",
      steps: [
        "Do NOT apply production nginx routes from the panel — must be done via server SSH.",
        "Do NOT restart PM2 processes from the panel UI.",
        "Do NOT reload nginx from the panel UI.",
        "Do NOT run database migrations from the panel.",
        "Do NOT restore backups to production without staging verification.",
        "Do NOT change DNS records from the panel.",
        "Do NOT charge real Stripe customers during testing.",
        "Do NOT touch the Doorsteps/LocalShop app (prisom-manager / prisom-backend).",
      ],
      safetyNotes: [
        "The panel records all actions in the audit log.",
        "Unauthorized destructive actions will be visible to the project owner.",
      ],
    },

    {
      id:       "when-to-escalate",
      title:    "When to Escalate",
      audience: "operator",
      summary:  "Situations that require escalation to a senior engineer or project owner.",
      steps: [
        "Health endpoint returns non-200 for more than 5 minutes → escalate immediately.",
        "Backup is older than 48 hours → escalate to project owner.",
        "A deployment has been stuck in 'Promoting' for more than 10 minutes → escalate.",
        "Stripe webhook failures detected in logs → escalate to developer.",
        "Any data loss or suspected data corruption → escalate immediately, do not rollback alone.",
        "SSL certificate expiry within 7 days → escalate to admin.",
        "Any security alert or unexpected admin login → escalate and audit immediately.",
      ],
      safetyNotes: [
        "When in doubt, escalate — it is always better to pause and check than to guess.",
        "Document all escalations in the project's incident log.",
      ],
    },
  ];

  // ── Checklists ─────────────────────────────────────────────────────────────

  const dailyChecklist = [
    "Check Monitoring page — all health checks green",
    "Review Logs for ERROR-level entries in last 24 hours",
    "Confirm latest backup is within 24 hours",
    "Check Releases for stuck deployments",
    "Review Activity log for unexpected actions",
    ...(isSardar ? ["Verify Sardar health endpoint returns 200: curl -I " + healthUrl] : []),
  ];

  const weeklyChecklist = [
    "Run QA Verification from Releases page",
    "Export Operator Runbook and store in documentation folder",
    "Review team permissions on Team page",
    "Confirm SSL certificates are not expiring within 30 days",
    "Run a backup restore drill on staging",
    "Review error rate trends on Monitoring page",
  ];

  const launchDayChecklist = [
    "Confirm all QA checks pass (zero blockers)",
    "Confirm Release Candidate score ≥ 90",
    "Confirm backup taken within last 2 hours",
    "Confirm staging deployment proof exported",
    ...(isSardar ? ["Confirm ecommerce test proof exported"] : []),
    "Confirm production execution plan generated",
    "Confirm all team members are notified",
    "Confirm rollback plan is documented and understood",
    "Confirm client is available to verify after cutover",
    "Run final smoke checks on staging before cutover",
    "Apply production routes via server SSH (NOT from panel UI)",
    "Run smoke checks on production immediately after route application",
    "Confirm health endpoint returns 200 after cutover",
    "Notify client — launch complete",
  ];

  const emergencyChecklist = [
    "1. Confirm the problem — check health endpoint and logs first",
    "2. Open Releases > Production Execution Guard",
    "3. Type confirmation: EXECUTE PRODUCTION ROLLBACK",
    "4. On server: sudo nginx -t && sudo systemctl reload nginx (revert config)",
    "5. Verify rollback: curl -I " + healthUrl,
    "6. Check logs for errors after rollback",
    "7. Notify client immediately",
    "8. Document incident in project Activity log",
    "9. Do not redeploy until root cause confirmed",
  ];

  const escalationRules = [
    "Health endpoint down > 5 minutes → escalate to admin immediately",
    "Backup older than 48 hours → escalate to project owner",
    "Deployment stuck in Promoting > 10 minutes → escalate to developer",
    "Stripe webhook failures in logs → escalate to developer",
    "Data loss or corruption suspected → escalate immediately, do not act alone",
    "SSL expiry within 7 days → escalate to admin",
    "Any security alert or unexpected admin login → escalate and audit",
  ];

  const pagesToUse = [
    { label: "Monitoring",   path: `/projects/${projectId}/monitoring`,  note: "Daily health checks and uptime" },
    { label: "Releases",     path: `/projects/${projectId}/releases`,    note: "QA, RC, cutover, signoff" },
    { label: "Logs",         path: `/projects/${projectId}/logs`,        note: "Error triage" },
    { label: "Backups",      path: `/projects/${projectId}/backups`,     note: "Backup status and restore drills" },
    { label: "Runbook",      path: `/projects/${projectId}/runbook`,     note: "Operations documentation" },
    { label: "Team",         path: `/projects/${projectId}/team`,        note: "Permission management" },
    { label: "Migration",    path: `/projects/${projectId}/migration`,   note: "Source intake and staging" },
    { label: "Settings",     path: `/projects/${projectId}/settings`,    note: "Domain, env vars, services" },
  ];

  const pagesToAvoid = [
    { label: "Apply nginx routes", note: "Must be done via server SSH, not from panel" },
    { label: "Restart PM2",        note: "Must be done via server SSH: pm2 restart <process>" },
    { label: "Run DB migrations",  note: "Must be run in a controlled migration script" },
    { label: "Restore to production", note: "Always restore to staging first, verify, then switch" },
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    sections,
    dailyChecklist,
    weeklyChecklist,
    launchDayChecklist,
    emergencyChecklist,
    escalationRules,
    pagesToUse,
    pagesToAvoid,
  };
}
