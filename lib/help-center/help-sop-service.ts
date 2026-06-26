import type { HelpSop, HelpSopLibrary } from "./help-sop-types";

// ── SOP definitions ───────────────────────────────────────────────────────────
// All SOPs are hardcoded operational procedures. They are always accurate
// because they describe stable infrastructure conventions, not dynamic code.

function buildSops(): HelpSop[] {
  return [
    // ── SOP 1 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_deploy_panel",
      title: "How to deploy the Prisom Project Panel safely",
      audience: "operator",
      category: "deployment",
      summary: "Step-by-step procedure for deploying a new build of the Prisom Project Panel to the production server.",
      whenToUse: [
        "After merging new code to master",
        "After any bug fix that needs to go live",
        "After a sprint is committed and passing typecheck/build",
      ],
      steps: [
        "1. SSH into the production server: ssh prisom@<server>",
        "2. Navigate to the panel directory: cd /home/prisom/prisom-project-panel",
        "3. Fetch the latest code: git fetch origin",
        "4. Pull (fast-forward only): git pull --ff-only",
        "5. Confirm the commit: git log --oneline -5",
        "6. Install dependencies: pnpm install",
        "7. Run typecheck: pnpm run typecheck",
        "8. Run production build: pnpm run build",
        "9. If build passes, restart the PM2 process: pm2 restart prisom-projects --update-env",
        "10. Save PM2 state: pm2 save",
        "11. Run smoke checks (see SOP: How to run smoke checks)",
        "12. Check PM2 logs for errors: pm2 logs prisom-projects --lines 50",
      ],
      commands: [
        "cd /home/prisom/prisom-project-panel",
        "git fetch origin && git pull --ff-only",
        "git log --oneline -5",
        "pnpm install",
        "pnpm run typecheck",
        "pnpm run build",
        "pm2 restart prisom-projects --update-env",
        "pm2 save",
        "pm2 logs prisom-projects --lines 50",
      ],
      safetyNotes: [
        "Do NOT restart PM2 from the UI panel — SSH only",
        "If typecheck or build fails, do NOT restart PM2 with the broken build",
        "Do NOT touch prisom-manager or prisom-backend — those are Doorsteps/LocalShop",
        "Check Sardar health after every deploy: curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "If anything fails, keep the existing PM2 process running — it still serves the previous build",
      ],
      relatedPages: ["/projects/[projectId]/releases", "/projects/[projectId]/runbook"],
      relatedExports: ["DEPLOY_VERIFICATION_REPORT.md", "FINAL_LIVE_VERIFICATION_RUN.md"],
    },

    // ── SOP 2 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_smoke_checks",
      title: "How to run smoke checks after a deploy",
      audience: "operator",
      category: "deployment",
      summary: "Verify the panel is serving correctly after a restart by hitting key URLs.",
      whenToUse: [
        "Immediately after pm2 restart",
        "After every production deploy",
        "After any infrastructure change (nginx, SSL, DNS)",
      ],
      steps: [
        "1. Check panel login page: curl -I https://projects.doorstepmanchester.uk/login",
        "2. Check dashboard (expects 307 redirect if unauthenticated): curl -I https://projects.doorstepmanchester.uk/dashboard",
        "3. Check admin page (expects 307 redirect): curl -I https://projects.doorstepmanchester.uk/admin",
        "4. Check Sardar frontend: curl -I https://sardar-security-project.doorstepmanchester.uk/",
        "5. Check Sardar health endpoint: curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "6. If any check returns non-200 (other than the expected 307 redirects), investigate PM2 logs immediately",
        "7. Run PM2 status: pm2 list | grep prisom-projects",
      ],
      commands: [
        "curl -I https://projects.doorstepmanchester.uk/login",
        "curl -I https://projects.doorstepmanchester.uk/dashboard",
        "curl -I https://projects.doorstepmanchester.uk/admin",
        "curl -I https://sardar-security-project.doorstepmanchester.uk/",
        "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "pm2 list | grep prisom-projects",
        "pm2 logs prisom-projects --lines 100",
      ],
      safetyNotes: [
        "A 307 redirect on /dashboard and /admin is expected when not authenticated — this is correct",
        "If /login returns a non-200, the panel is not serving — check pm2 logs",
        "If Sardar health returns non-200, do NOT rollback the panel — investigate Sardar separately",
        "Never restart project-sardar-security-project from the Prisom panel UI",
      ],
      relatedPages: ["/projects/[projectId]/monitoring", "/projects/[projectId]/releases"],
      relatedExports: ["DEPLOY_VERIFICATION_REPORT.md"],
    },

    // ── SOP 3 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_final_live_verification",
      title: "How to use Final Live Verification",
      audience: "operator",
      category: "launch",
      summary: "Run the Final Live Verification panel to confirm post-deploy health across all systems.",
      whenToUse: [
        "After every production deploy",
        "Before signing off on a sprint launch",
        "As part of the go-live checklist",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/releases",
        "2. Find the 'Final Live Verification' panel",
        "3. Click 'Run Final Live Verification'",
        "4. Review each verification check — all items should pass",
        "5. Export FINAL_LIVE_VERIFICATION_RUN.md as a record",
        "6. If any check fails, do not proceed to launch sign-off",
        "7. Investigate the failing check and re-run after fixing",
      ],
      commands: [],
      safetyNotes: [
        "This panel is read-only — it does not change any server configuration",
        "Do not mark checks as passed if they have not been manually verified",
        "Export the report before signing off — it provides an audit trail",
      ],
      relatedPages: ["/projects/[projectId]/releases"],
      relatedExports: ["FINAL_LIVE_VERIFICATION_RUN.md"],
    },

    // ── SOP 4 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_go_no_go",
      title: "How to use the Go/No-Go Evidence Pack",
      audience: "operator",
      category: "launch",
      summary: "Collect and review all go/no-go evidence before a production launch decision.",
      whenToUse: [
        "Before any production launch",
        "Before confirming a migration cutover",
        "As part of the sprint launch checklist",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/releases",
        "2. Find the 'Go/No-Go Evidence Pack' panel",
        "3. Review all evidence items — required items must be in 'passed' or 'collected' status",
        "4. Address any 'blocked' or 'missing' required items before proceeding",
        "5. Export GO_NO_GO_EVIDENCE_PACK.md as a signed record",
        "6. Only proceed to launch if all required evidence items are resolved",
      ],
      commands: [],
      safetyNotes: [
        "A 'blocked' required item is a hard stop — do not override without written approval",
        "Export the evidence pack before every launch for audit purposes",
        "Warning items may proceed with documented acceptance — blocked items may not",
      ],
      relatedPages: ["/projects/[projectId]/releases", "/projects/[projectId]/runbook"],
      relatedExports: ["GO_NO_GO_EVIDENCE_PACK.md"],
    },

    // ── SOP 5 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_launch_checklist",
      title: "How to use the Launch Execution Checklist",
      audience: "operator",
      category: "launch",
      summary: "Step-by-step launch execution checklist to follow on launch day.",
      whenToUse: [
        "On the day of a production launch",
        "During a cutover from staging to production",
        "Alongside the Go/No-Go evidence review",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/releases",
        "2. Find the 'Launch Execution Checklist' panel",
        "3. Work through each checklist item in order",
        "4. Complete DNS, SSL, and smoke check items before marking the launch complete",
        "5. Export LAUNCH_EXECUTION_CHECKLIST.md as evidence",
        "6. Coordinate with team before each irreversible step",
      ],
      commands: [],
      safetyNotes: [
        "Do not skip steps — every item has a reason",
        "DNS changes are irreversible in the short term — confirm before applying",
        "After completing the checklist, run smoke checks immediately",
      ],
      relatedPages: ["/projects/[projectId]/releases"],
      relatedExports: ["LAUNCH_EXECUTION_CHECKLIST.md"],
    },

    // ── SOP 6 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_monitor_after_launch",
      title: "How to monitor the project after launch",
      audience: "operator",
      category: "monitoring",
      summary: "Post-launch monitoring procedure to catch issues early.",
      whenToUse: [
        "Immediately after a production launch",
        "For the first 48 hours after any significant deploy",
        "During scheduled on-call monitoring",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/monitoring",
        "2. Run a monitoring snapshot",
        "3. Check PM2 status: pm2 list",
        "4. Check panel logs: pm2 logs prisom-projects --lines 100",
        "5. Check Sardar health: curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "6. If using 'Launch Day Support' panel — capture any incidents immediately",
        "7. Check for 5xx errors in nginx logs if accessible",
        "8. After 24h with no incidents, document that monitoring period is complete",
      ],
      commands: [
        "pm2 list",
        "pm2 logs prisom-projects --lines 100",
        "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "curl -I https://projects.doorstepmanchester.uk/login",
      ],
      safetyNotes: [
        "Do not restart PM2 from the panel UI — SSH only",
        "Any 5xx errors on the panel should be investigated before they accumulate",
        "Sardar incidents must be handled separately — Sardar has its own PM2 process",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: ["LAUNCH_DAY_SUPPORT_REPORT.md"],
    },

    // ── SOP 7 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_read_logs",
      title: "How to read logs and capture issues",
      audience: "operator",
      category: "logs",
      summary: "Procedure for reading PM2 and application logs to diagnose and capture issues.",
      whenToUse: [
        "When any panel functionality fails",
        "When a user reports an issue",
        "After a deploy to verify no errors",
        "During on-call monitoring",
      ],
      steps: [
        "1. SSH into the server",
        "2. View recent panel logs: pm2 logs prisom-projects --lines 100",
        "3. View Sardar logs if needed: pm2 logs project-sardar-security-project --lines 50",
        "4. Look for ERROR, WARN, or exception stack traces",
        "5. If the panel is running but responding slowly: pm2 monit",
        "6. Copy the relevant log lines and use 'Post-Launch Bug Capture' panel to record the issue",
        "7. Never share raw logs that may contain session tokens or user data",
      ],
      commands: [
        "pm2 logs prisom-projects --lines 100",
        "pm2 logs prisom-projects --lines 200 | grep -i error",
        "pm2 logs project-sardar-security-project --lines 50",
        "pm2 monit",
        "pm2 list",
      ],
      safetyNotes: [
        "Raw logs may contain session tokens — do not paste them into public channels",
        "Do not delete or truncate log files while diagnosing",
        "pm2 logs streams live — use Ctrl+C to exit the stream",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: ["POST_LAUNCH_BUG_REPORT.md"],
    },

    // ── SOP 8 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_export_documentation",
      title: "How to export project documentation",
      audience: "operator",
      category: "help_center",
      summary: "Download all project documentation exports from the Help Center for offline use or handover.",
      whenToUse: [
        "Before a client handover",
        "At the end of a sprint",
        "As part of the operator runbook update",
        "When preparing a go-live pack",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/help",
        "2. Click 'Generate All Documentation'",
        "3. Wait for generation to complete (up to 30 seconds)",
        "4. Go to the Exports tab",
        "5. Download each file using the download buttons",
        "6. Available exports: PROJECT_KNOWLEDGE_BASE.md, PROJECT_FILE_INVENTORY.md, PROJECT_METHODS_AND_RESOURCES.md, PROJECT_DEEP_MAP.md, OPERATOR_SOP_LIBRARY.md, TROUBLESHOOTING_PLAYBOOK.md",
        "7. Also download from the Releases page: FINAL_LIVE_VERIFICATION_RUN.md, GO_NO_GO_EVIDENCE_PACK.md",
        "8. From Runbook page: OPERATOR_TRAINING_PACK.md, LAUNCH_SIGNOFF_REPORT.md",
      ],
      commands: [],
      safetyNotes: [
        "All exports are read-only documentation — no secrets are included",
        "Do not share exports containing internal route paths with untrusted parties",
        "Exports are point-in-time snapshots — regenerate before a handover to get the latest",
      ],
      relatedPages: ["/projects/[projectId]/help", "/projects/[projectId]/releases", "/projects/[projectId]/runbook"],
      relatedExports: ["PROJECT_KNOWLEDGE_BASE.md", "PROJECT_DEEP_MAP.md", "OPERATOR_SOP_LIBRARY.md", "TROUBLESHOOTING_PLAYBOOK.md"],
    },

    // ── SOP 9 ──────────────────────────────────────────────────────────────────
    {
      id: "sop_use_help_center",
      title: "How to use the Help Center",
      audience: "operator",
      category: "help_center",
      summary: "Guide for using the Project Help Center to find documentation and get answers.",
      whenToUse: [
        "When you need to find how something works in the codebase",
        "When onboarding a new operator",
        "When troubleshooting an unfamiliar issue",
        "Before manually reading source files",
      ],
      steps: [
        "1. Navigate to: /projects/[projectId]/help",
        "2. Click 'Generate All Documentation' to build the knowledge base",
        "3. To search: use the Search & Ask panel → Search tab → type keywords (e.g. 'deploy', 'Sardar', 'server actions')",
        "4. To ask a question: use the Ask tab → type a natural language question",
        "5. The system answers from the generated knowledge only — it does not invent answers",
        "6. If the answer says 'not enough information', try regenerating or use different keywords",
        "7. To browse structured docs: use the Help Center panel tabs (Sections, Deep Map, SOPs, Troubleshooting, Exports)",
        "8. Download exports for offline reading or handover",
      ],
      commands: [],
      safetyNotes: [
        "The Help Center is read-only — it does not modify any files or server state",
        "Secret values are never exposed in any output",
        "Answers come from the generated knowledge base — regenerate if the codebase has changed",
      ],
      relatedPages: ["/projects/[projectId]/help"],
      relatedExports: ["PROJECT_KNOWLEDGE_BASE.md"],
    },

    // ── SOP 10 ─────────────────────────────────────────────────────────────────
    {
      id: "sop_what_not_to_touch",
      title: "What not to touch — forbidden operations",
      audience: "operator",
      category: "security",
      summary: "Critical list of operations that must NEVER be performed from the panel UI or without explicit approval.",
      whenToUse: [
        "Always — read this before performing any operation",
        "During onboarding of new operators",
        "When in doubt about whether an action is safe",
      ],
      steps: [
        "NEVER: Restart PM2 from the panel UI — SSH only",
        "NEVER: Touch prisom-manager or prisom-backend — those are the live Doorsteps/LocalShop services",
        "NEVER: Change DNS records from the panel",
        "NEVER: Reload or reconfigure nginx from the panel",
        "NEVER: Run DB migrations from the panel UI",
        "NEVER: Expose .env values, tokens, or secret keys in any export or message",
        "NEVER: Push code that hasn't passed typecheck and build",
        "NEVER: Restart project-sardar-security-project without verifying it recovers",
        "NEVER: Delete or overwrite production backup files",
        "NEVER: Perform destructive UI actions without typing the required confirmation phrase",
        "ALWAYS: Verify smoke checks after every PM2 restart",
        "ALWAYS: Export audit evidence before any launch decision",
      ],
      commands: [],
      safetyNotes: [
        "These rules exist because live ecommerce is running on Sardar and Doorsteps at all times",
        "Any of these actions could cause customer-facing downtime or data loss",
        "When in doubt: do nothing and escalate",
      ],
      relatedPages: ["/projects/[projectId]/settings", "/projects/[projectId]/runbook"],
      relatedExports: [],
    },

    // ── SOP 11 ─────────────────────────────────────────────────────────────────
    {
      id: "sop_sardar_health",
      title: "How to verify Sardar Security frontend and API health",
      audience: "operator",
      category: "sardar",
      summary: "Procedure to verify the Sardar Security project is live and healthy.",
      whenToUse: [
        "After every panel deploy",
        "During any incident investigation",
        "Before and after Sardar-specific operations",
        "During scheduled monitoring",
      ],
      steps: [
        "1. Check the Sardar frontend: curl -I https://sardar-security-project.doorstepmanchester.uk/",
        "2. Expected: HTTP/2 200 or HTTP/1.1 200 OK",
        "3. Check the Sardar health API: curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "4. Expected: 200 OK",
        "5. Check PM2 process is running: pm2 list | grep project-sardar-security-project",
        "6. If frontend returns 5xx: check pm2 logs project-sardar-security-project --lines 100",
        "7. If health returns 5xx: check if Prisma/DB connection is up",
        "8. PM2 restart of Sardar (if needed and safe): pm2 restart project-sardar-security-project — MANUAL ONLY",
      ],
      commands: [
        "curl -I https://sardar-security-project.doorstepmanchester.uk/",
        "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
        "pm2 list | grep project-sardar-security-project",
        "pm2 logs project-sardar-security-project --lines 100",
      ],
      safetyNotes: [
        "Sardar Security is a live production ecommerce service",
        "Do NOT restart project-sardar-security-project from the Prisom panel UI",
        "PM2 restarts of Sardar must be performed via SSH only, after verifying no active checkout",
        "If Sardar is down, notify the client immediately before attempting any fix",
      ],
      relatedPages: ["/projects/[projectId]/monitoring"],
      relatedExports: [],
    },

    // ── SOP 12 ─────────────────────────────────────────────────────────────────
    {
      id: "sop_rollback_evidence",
      title: "How to prepare rollback evidence",
      audience: "operator",
      category: "rollback",
      summary: "Procedure to collect evidence needed to execute a safe rollback.",
      whenToUse: [
        "Before every production deploy (pre-collect)",
        "When a post-launch issue requires rollback",
        "Before applying DNS or nginx changes",
      ],
      steps: [
        "1. Before deploy: record current git commit hash: git rev-parse --short HEAD",
        "2. Before deploy: export PROJECT_KNOWLEDGE_BASE.md and DEPLOY_VERIFICATION_REPORT.md as baseline",
        "3. Before DNS change: screenshot current DNS config",
        "4. After failed deploy: identify the last working commit from git log",
        "5. Rollback code: git checkout <last-good-commit> (or git revert + redeploy)",
        "6. Rebuild and restart: pnpm install && pnpm run build && pm2 restart prisom-projects --update-env",
        "7. Run smoke checks to verify rollback succeeded",
        "8. Document the incident and rollback in POST_LAUNCH_BUG_REPORT.md",
      ],
      commands: [
        "git rev-parse --short HEAD",
        "git log --oneline -10",
        "git checkout <last-good-commit>",
        "pnpm install && pnpm run build",
        "pm2 restart prisom-projects --update-env",
        "pm2 save",
      ],
      safetyNotes: [
        "Do not perform code rollbacks without checking that the DB schema is compatible",
        "If a migration was applied, rollback requires a matching down-migration — escalate",
        "DNS rollbacks can take up to 24h to propagate — plan accordingly",
      ],
      relatedPages: ["/projects/[projectId]/releases", "/projects/[projectId]/monitoring"],
      relatedExports: ["DEPLOY_VERIFICATION_REPORT.md", "POST_LAUNCH_BUG_REPORT.md"],
    },

    // ── SOP 13 ─────────────────────────────────────────────────────────────────
    {
      id: "sop_handover",
      title: "How to hand over the project to a client or operator",
      audience: "admin",
      category: "daily_ops",
      summary: "Handover procedure for transferring project responsibility to a new operator or client.",
      whenToUse: [
        "At the end of a development sprint",
        "When a new operator takes over the project",
        "After client training is complete",
        "At project go-live",
      ],
      steps: [
        "1. Ensure the latest build is deployed and passing smoke checks",
        "2. Generate all documentation: /projects/[projectId]/help → Generate All Documentation",
        "3. Download and share: PROJECT_KNOWLEDGE_BASE.md, OPERATOR_SOP_LIBRARY.md, TROUBLESHOOTING_PLAYBOOK.md",
        "4. From Runbook page: export OPERATOR_TRAINING_PACK.md and LAUNCH_SIGNOFF_REPORT.md",
        "5. From Releases page: export FINAL_LIVE_VERIFICATION_RUN.md and GO_NO_GO_EVIDENCE_PACK.md",
        "6. Review the 'What Not to Touch' SOP with the new operator",
        "7. Walk through the Help Center and demonstrate Search + Ask",
        "8. Confirm new operator can SSH, view PM2 logs, and run smoke checks",
        "9. Export HANDOFF_PACK.md from the Migration page for the complete handover pack",
      ],
      commands: [],
      safetyNotes: [
        "Never share .env files or secret values during handover",
        "Provide only the documentation exports — not raw server access unless intentional",
        "Run a final smoke check in front of the new operator before completing handover",
      ],
      relatedPages: ["/projects/[projectId]/help", "/projects/[projectId]/runbook", "/projects/[projectId]/migration"],
      relatedExports: ["OPERATOR_TRAINING_PACK.md", "OPERATOR_SOP_LIBRARY.md", "HANDOFF_PACK.md"],
    },

    // ── SOP 14 ─────────────────────────────────────────────────────────────────
    {
      id: "sop_update_docs_after_fix",
      title: "How to update project documentation after fixing a bug",
      audience: "developer",
      category: "daily_ops",
      summary: "Keep the Help Center knowledge base and handoff exports up to date after any bug fix or code change.",
      whenToUse: [
        "After merging a bug fix",
        "After adding a new feature",
        "After updating a configuration",
        "Before a handover or sprint review",
      ],
      steps: [
        "1. After deploying the fix, navigate to: /projects/[projectId]/help",
        "2. Click 'Generate All Documentation' to regenerate the knowledge base",
        "3. Verify the relevant section now reflects the fix (check Sections tab)",
        "4. Download the updated exports",
        "5. If the fix touched a server action: check the actionMap in the Deep Map tab",
        "6. If the fix touched a page or panel: verify the routeMap is still accurate",
        "7. Update the HANDOFF_PACK.md export from the Migration page if the fix affects the handover",
        "8. Record the fix in the POST_LAUNCH_BUG_REPORT if it was a post-launch issue",
      ],
      commands: [],
      safetyNotes: [
        "The knowledge base is regenerated from the current codebase — it is always up to date after regeneration",
        "Old exports are stale after a code change — always regenerate before sharing",
      ],
      relatedPages: ["/projects/[projectId]/help", "/projects/[projectId]/monitoring"],
      relatedExports: ["PROJECT_KNOWLEDGE_BASE.md", "POST_LAUNCH_BUG_REPORT.md"],
    },
  ];
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateHelpSopLibrary(input: {
  projectId: string;
}): Promise<HelpSopLibrary> {
  const { projectId } = input;
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    sops: buildSops(),
    warnings: [],
  };
}
