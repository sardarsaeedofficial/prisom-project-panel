import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  LaunchExecutionChecklist,
  LaunchExecutionStep,
  LaunchExecutionStatus,
} from "./launch-execution-types";

const SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";
const PANEL_DOMAIN  = "projects.doorstepmanchester.uk";

function step(
  overrides: Partial<LaunchExecutionStep> &
    Pick<LaunchExecutionStep, "id" | "phase" | "label">,
): LaunchExecutionStep {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

export async function generateLaunchExecutionChecklist(input: {
  projectId: string;
}): Promise<LaunchExecutionChecklist> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyChecklist(projectId, "blocked", ["Project not found."]);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [domains, deployments, members] = await Promise.all([
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { id: true, commitSha: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname      = primaryDomain?.hostname ?? "";
  const sslActive     = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment = deployments.length > 0;
  const hasOwner      = members.some((m) => m.role === "owner");

  // ── Steps ─────────────────────────────────────────────────────────────────

  const steps: LaunchExecutionStep[] = [

    // Freeze
    step({
      id: "freeze-confirm", phase: "freeze",
      label: "Confirm launch freeze is active",
      description: "LAUNCH_FREEZE_CHECKLIST.md must have been exported and all freeze checks confirmed.",
      status: "manual",
      evidence: "LAUNCH_FREEZE_CHECKLIST.md present in handoff folder",
      safetyNote: "No new features, schema changes, or config changes after freeze is declared.",
    }),
    step({
      id: "freeze-signoff", phase: "freeze",
      label: "Final Launch Signoff signed",
      description: "FINAL_LAUNCH_SIGNOFF.md must be signed by a named operator with date and time.",
      status: "manual",
      evidence: "FINAL_LAUNCH_SIGNOFF.md operator name and timestamp visible",
    }),

    // Backup
    step({
      id: "backup-confirm", phase: "backup",
      label: "Backup taken within 2 hours of cutover",
      description: "A database backup must be taken immediately before cutover and the path confirmed.",
      status: "manual",
      safetyNote: "Do not proceed to cutover without a confirmed backup.",
      evidence: "Backup file path and timestamp confirmed",
    }),
    step({
      id: "backup-restore-drill", phase: "backup",
      label: "Restore drill completed on staging",
      description: "A restore drill must have been completed on staging before production cutover.",
      status: "manual",
      evidence: "BACKUP_RESTORE_REPORT.md or drill confirmed on staging",
    }),

    // Preflight
    step({
      id: "preflight-readiness", phase: "preflight",
      label: "FINAL_READINESS_AUDIT.md shows READY TO EXECUTE",
      description: "Final readiness audit must show READY TO EXECUTE with 0 blockers.",
      status: hasDeployment ? "manual" : "warning",
      evidence: "FINAL_READINESS_AUDIT.md exported with READY TO EXECUTE status",
      nextStep: hasDeployment ? undefined : "Ensure a successful deployment exists before cutover",
    }),
    step({
      id: "preflight-stop-build", phase: "preflight",
      label: "STOP_BUILD_GATE.md decision is STOP BUILDING — READY TO LAUNCH",
      description: "Stop-build gate must show STOP BUILDING — READY TO LAUNCH.",
      status: "manual",
      evidence: "STOP_BUILD_GATE.md with STOP BUILDING — READY TO LAUNCH decision",
    }),
    step({
      id: "preflight-rehearsal", phase: "preflight",
      label: "Cutover rehearsal completed",
      description: "FINAL_CUTOVER_REHEARSAL.md exported and go/no-go questions answered.",
      status: "manual",
      evidence: "FINAL_CUTOVER_REHEARSAL.md exported",
    }),
    step({
      id: "preflight-team", phase: "preflight",
      label: "Operator and rollback owner available",
      description: "Named operator must be present. Rollback owner must be named and reachable.",
      status: hasOwner ? "manual" : "warning",
      nextStep: hasOwner ? undefined : "Assign an owner on the Team page",
    }),
    step({
      id: "preflight-ssl", phase: "preflight",
      label: "SSL confirmed active on production domain",
      description: `SSL must be ACTIVE on ${hostname || "the production domain"} before cutover.`,
      status: sslActive ? "manual" : (hostname ? "warning" : "manual"),
      nextStep: !sslActive && hostname ? "Check SSL status on the Domains page" : undefined,
    }),

    // Cutover
    step({
      id: "cutover-owner", phase: "cutover",
      label: "Named operator owns the cutover",
      description: "A specific named operator must be on-call and actively monitoring during cutover.",
      status: "manual",
      operator: "Assign operator name before cutover",
      safetyNote: "Do not begin cutover without a named operator present.",
    }),
    step({
      id: "cutover-execute", phase: "cutover",
      label: "DNS / nginx cutover executed manually on server",
      description: "All cutover commands (nginx config apply, PM2 restart if needed) must be executed manually via SSH.",
      status: "manual",
      command: "sudo nginx -t && sudo systemctl reload nginx",
      safetyNote: "This panel does NOT execute this command. Operator must SSH to the server and run manually.",
      evidence: "Operator confirms: nginx -t passed, reload completed, no errors",
    }),
    step({
      id: "cutover-timestamp", phase: "cutover",
      label: "Cutover timestamp and operator name recorded",
      description: "Note the exact time cutover was completed and the name of the operator who executed it.",
      status: "manual",
      evidence: "Format: YYYY-MM-DD HH:MM UTC — operator: <name>",
    }),

    // Smoke tests
    step({
      id: "smoke-health", phase: "smoke",
      label: "Health endpoint returns 200",
      description: `curl -I https://${hostname || "<domain>"}/api/healthz must return 200`,
      status: "manual",
      command: hostname ? `curl -I https://${hostname}/api/healthz` : `curl -I https://<domain>/api/healthz`,
      evidence: "HTTP/2 200 confirmed",
    }),
    step({
      id: "smoke-homepage", phase: "smoke",
      label: "Homepage returns 200",
      description: `curl -I https://${hostname || "<domain>"}/ must return 200`,
      status: "manual",
      command: hostname ? `curl -I https://${hostname}/` : `curl -I https://<domain>/`,
      evidence: "HTTP/2 200 confirmed",
    }),
    step({
      id: "smoke-login", phase: "smoke",
      label: "Login page returns 200",
      description: `curl -I https://${hostname || "<domain>"}/login must return 200`,
      status: "manual",
      command: hostname ? `curl -I https://${hostname}/login` : `curl -I https://<domain>/login`,
      evidence: "HTTP/2 200 confirmed",
    }),
    step({
      id: "smoke-pm2", phase: "smoke",
      label: "PM2 process showing online",
      description: "pm2 list must show the project process as 'online' with no excessive restarts.",
      status: "manual",
      command: "pm2 list",
      evidence: "Process status: online",
    }),
    step({
      id: "smoke-logs", phase: "smoke",
      label: "Application logs show no critical errors",
      description: "pm2 logs must show no repeated error patterns in the first 60 seconds.",
      status: "manual",
      command: "pm2 logs --lines 50",
      evidence: "No ERROR or FATAL lines in recent logs",
    }),
    step({
      id: "smoke-sardar", phase: "smoke",
      label: `Sardar Security production remains 200`,
      description: `${SARDAR_DOMAIN}/ and /api/healthz must still return 200 after panel deploy.`,
      status: "manual",
      command: `curl -I https://${SARDAR_DOMAIN}/\ncurl -I https://${SARDAR_DOMAIN}/api/healthz`,
      evidence: "Both return HTTP/2 200",
      safetyNote: "Do not restart Sardar PM2 process. Verify only.",
    }),

    // Ecommerce (Sardar-only)
    ...(isSardar
      ? ([
          step({
            id: "ecommerce-stripe-live", phase: "ecommerce",
            label: "Stripe live mode confirmed (not test mode)",
            description: "Confirm STRIPE_SECRET_KEY is the live key (sk_live_...) in production env vars.",
            status: "manual",
            safetyNote: "Check env var NAME only — do not expose the key value.",
            evidence: "Env var name STRIPE_SECRET_KEY confirmed set (value not checked)",
          }),
          step({
            id: "ecommerce-checkout", phase: "ecommerce",
            label: "Test checkout flow in production (if safe)",
            description: "Complete a minimal checkout in production with a real card to confirm end-to-end flow.",
            status: "manual",
            safetyNote: "Do not refund or cancel test orders without confirming with the client.",
            evidence: "Order ID and confirmation email received",
          }),
          step({
            id: "ecommerce-webhook", phase: "ecommerce",
            label: "Stripe webhook delivery confirmed",
            description: "Confirm at least one webhook event was delivered successfully in the Stripe dashboard.",
            status: "manual",
            evidence: "Stripe dashboard shows successful webhook delivery",
          }),
        ] satisfies LaunchExecutionStep[])
      : []),

    // Monitoring
    step({
      id: "monitoring-window", phase: "monitoring",
      label: "Post-cutover monitoring window opened (minimum 30 min)",
      description: "Operator must actively monitor logs, health endpoint, and PM2 status for at least 30 minutes after cutover.",
      status: "manual",
      command: "pm2 logs --lines 100",
      evidence: "Monitoring window start time noted: ___",
    }),
    step({
      id: "monitoring-post-cutover", phase: "monitoring",
      label: "POST_CUTOVER_MONITORING_REPORT.md generated",
      description: "Generate the post-cutover monitoring report from the Monitoring page.",
      status: "manual",
      evidence: "POST_CUTOVER_MONITORING_REPORT.md exported",
    }),
    step({
      id: "monitoring-bug-capture", phase: "monitoring",
      label: "POST_LAUNCH_BUG_CAPTURE.md available for triage",
      description: "Post-launch bug capture report must be available for the first 24 hours post-launch.",
      status: "manual",
      evidence: "POST_LAUNCH_BUG_CAPTURE.md exported and with the operator",
    }),

    // Handover
    step({
      id: "handover-client", phase: "handover",
      label: "Client notified of successful launch",
      description: "Client must be notified of the exact time production went live.",
      status: "manual",
      evidence: "Notification sent — timestamp: ___",
    }),
    step({
      id: "handover-exports", phase: "handover",
      label: "All handoff exports delivered to client",
      description: "All HANDOFF_EXPORT.md and sprint exports must be delivered to the client contact.",
      status: "manual",
      evidence: "Exports delivered — delivery method: ___",
    }),
    step({
      id: "handover-operator", phase: "handover",
      label: "Operator training pack delivered",
      description: "OPERATOR_TRAINING_PACK.md must be delivered to the named operator.",
      status: "manual",
      evidence: "OPERATOR_TRAINING_PACK.md delivered to: ___",
    }),

    // Rollback (contingency)
    step({
      id: "rollback-owner", phase: "rollback",
      label: "Rollback owner named and decision criteria agreed",
      description: "A named person must own the rollback decision. Criteria: health endpoint non-200 for >5 min after cutover.",
      required: true,
      status: "manual",
      safetyNote: "Rollback decision must be made within 5 minutes of confirmed production failure.",
    }),
    step({
      id: "rollback-nginx", phase: "rollback",
      label: "Nginx rollback config available",
      description: "Previous nginx config backup must exist at the backup path on the server.",
      status: "manual",
      command: "ls -la /etc/nginx/sites-available/*.bak 2>/dev/null || echo 'No backup found'",
      evidence: "Backup nginx config path: ___",
    }),
    step({
      id: "rollback-verified", phase: "rollback",
      label: "Rollback procedure reviewed and operator ready",
      description: "Operator has reviewed FINAL_CUTOVER_REHEARSAL.md rollback decision tree.",
      status: "manual",
      evidence: "FINAL_CUTOVER_REHEARSAL.md reviewed — rollback section confirmed",
    }),
  ];

  // ── Commands ──────────────────────────────────────────────────────────────

  const operatorCommands = [
    `# Verify deployed commit`,
    `git -C /home/prisom/prisom-project-panel rev-parse --short HEAD`,
    `git -C /home/prisom/prisom-project-panel log --oneline -8`,
    ``,
    `# Check PM2 status`,
    `pm2 list`,
    `pm2 logs prisom-projects --lines 50`,
    ``,
    `# Deploy update (no schema change)`,
    `cd /home/prisom/prisom-project-panel`,
    `git fetch origin && git pull --ff-only`,
    `pnpm install`,
    `pnpm run typecheck`,
    `pnpm run build`,
    `pm2 restart prisom-projects --update-env`,
    `pm2 save`,
    ``,
    `# Verify Doorsteps/LocalShop untouched`,
    `pm2 list | grep -E 'prisom-manager|prisom-backend'`,
  ];

  const smokeCommands = [
    `curl -I https://${PANEL_DOMAIN}/login`,
    `curl -I https://${PANEL_DOMAIN}/dashboard`,
    `curl -I https://${PANEL_DOMAIN}/admin`,
    hostname ? `curl -I https://${hostname}/api/healthz` : `curl -I https://<project-domain>/api/healthz`,
    hostname ? `curl -I https://${hostname}/` : `curl -I https://<project-domain>/`,
    `curl -I https://${SARDAR_DOMAIN}/`,
    `curl -I https://${SARDAR_DOMAIN}/api/healthz`,
  ];

  const rollbackCommands = [
    `# Rollback nginx to previous config (manual operator action — run on server)`,
    `# 1. Locate backup nginx config`,
    `ls -la /etc/nginx/sites-available/`,
    ``,
    `# 2. Restore backup config`,
    `sudo cp /etc/nginx/sites-available/<backup>.bak /etc/nginx/sites-available/<site>`,
    ``,
    `# 3. Test nginx config`,
    `sudo nginx -t`,
    ``,
    `# 4. If test passes, reload nginx`,
    `sudo systemctl reload nginx`,
    ``,
    `# 5. Verify health endpoint`,
    hostname ? `curl -I https://${hostname}/api/healthz` : `curl -I https://<domain>/api/healthz`,
    ``,
    `# 6. Confirm Sardar still live`,
    `curl -I https://${SARDAR_DOMAIN}/`,
    ``,
    `# 7. Notify client and operator immediately after rollback`,
    `# Rollback complete at: <timestamp> — operator: <name>`,
  ];

  const goNoGoQuestions = [
    "Is FINAL_READINESS_AUDIT.md showing READY TO EXECUTE?",
    "Is STOP_BUILD_GATE.md showing STOP BUILDING — READY TO LAUNCH?",
    "Is a backup taken and confirmed within the last 2 hours?",
    "Is SSL ACTIVE on the production domain?",
    "Is the named operator available and on-call for the next 2 hours?",
    "Is the rollback owner named and available?",
    "Are all required exports generated and in the handoff folder?",
    "Has the cutover rehearsal been completed and reviewed?",
    "Are the Sardar production frontend and health endpoint currently returning 200?",
    "Is the Doorsteps/LocalShop panel untouched and confirmed running?",
    isSardar ? "Are Stripe live env vars confirmed set by name?" : null,
    isSardar ? "Has a test checkout been completed on staging with Stripe test keys?" : null,
  ].filter(Boolean) as string[];

  const evidenceChecklist = [
    "[ ] FINAL_READINESS_AUDIT.md — exported and in handoff folder",
    "[ ] STOP_BUILD_GATE.md — exported and in handoff folder",
    "[ ] FINAL_LAUNCH_SIGNOFF.md — signed with operator name and date",
    "[ ] FINAL_CUTOVER_REHEARSAL.md — exported and reviewed",
    "[ ] LAUNCH_FREEZE_CHECKLIST.md — exported and acknowledged",
    "[ ] LAUNCH_DAY_SUPPORT_REPORT.md — exported and operator checklist reviewed",
    "[ ] OPERATOR_TRAINING_PACK.md — exported and delivered",
    "[ ] DEPLOY_VERIFICATION_REPORT.md — exported",
    "[ ] LAUNCH_EXECUTION_CHECKLIST.md — exported",
    "[ ] POST_CUTOVER_MONITORING_REPORT.md — exported and operator ready",
    "[ ] POST_LAUNCH_BUG_CAPTURE.md — exported and with operator",
    "[ ] Backup path + timestamp confirmed",
    "[ ] Cutover timestamp + operator name recorded",
    "[ ] Client notified of launch time",
    isSardar ? "[ ] Stripe live keys confirmed set by name" : null,
    isSardar ? "[ ] Test checkout on staging confirmed" : null,
  ].filter(Boolean) as string[];

  // ── Status ─────────────────────────────────────────────────────────────────

  const blockedSteps  = steps.filter((s) => s.required && s.status === "blocked");
  const warnSteps     = steps.filter((s) => s.required && s.status === "warning");

  const blockers: string[] = [
    ...blockedSteps.map((s) => `${s.label}${s.nextStep ? ` — ${s.nextStep}` : ""}`),
    ...(!hasDeployment ? ["No successful deployment on record — complete a deployment before cutover"] : []),
    ...(!sslActive && hostname ? [`SSL not ACTIVE on ${hostname} — must be ACTIVE before cutover`] : []),
    ...(!hasOwner ? ["No project owner assigned — assign an owner before cutover"] : []),
  ];

  const warnings: string[] = [
    ...warnSteps.map((s) => `Review: ${s.label}`),
  ];

  const status: LaunchExecutionStatus = blockers.length > 0 ? "blocked" : "ready";

  const recommendedNextSteps = blockers.length > 0
    ? [
        "Resolve all blockers listed above before proceeding to cutover.",
        "Re-generate this checklist after fixing blockers to confirm readiness.",
      ]
    : [
        "Work through each phase in order: freeze → backup → preflight → cutover → smoke → monitoring → handover.",
        "Do not skip any required step.",
        "If any smoke check fails after cutover, initiate rollback immediately.",
        "Monitor for at least 30 minutes post-cutover before declaring success.",
        "Export LAUNCH_EXECUTION_CHECKLIST.md for the handover documentation set.",
      ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    steps,
    operatorCommands,
    smokeCommands,
    rollbackCommands,
    goNoGoQuestions,
    evidenceChecklist,
    blockers,
    warnings,
    recommendedNextSteps,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function emptyChecklist(
  projectId: string,
  status: LaunchExecutionStatus,
  blockers: string[],
): LaunchExecutionChecklist {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    steps: [],
    operatorCommands: [],
    smokeCommands: [],
    rollbackCommands: [],
    goNoGoQuestions: [],
    evidenceChecklist: [],
    blockers,
    warnings: [],
    recommendedNextSteps: [],
  };
}
