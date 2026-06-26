import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  LaunchDayStatus,
  LaunchDayTimelineItem,
  LaunchDaySupportReport,
} from "./launch-day-types";

export async function generateLaunchDaySupportReport(input: {
  projectId: string;
}): Promise<LaunchDaySupportReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyReport(projectId, "blocked", ["Project not found."]);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [domains, deployments, envVars, services] = await Promise.all([
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { id: true },
    }),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { id: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { healthPath: true },
    }),
  ]);

  const primaryDomain  = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname       = primaryDomain?.hostname ?? "";
  const sslActive      = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment  = deployments.length > 0;
  const hasEnvVars     = envVars.length > 0;
  const healthPath     = services.find((s) => s.healthPath)?.healthPath ?? "/api/healthz";

  // ── Build timeline ──────────────────────────────────────────────────────────

  const timeline: LaunchDayTimelineItem[] = [
    // ── Pre-launch ─────────────────────────────────────────────────────────
    {
      id:          "pre-freeze-confirm",
      phase:       "pre_launch",
      label:       "Confirm launch freeze is active",
      description: "Verify LAUNCH_FREEZE_CHECKLIST.md has been exported and the freeze is acknowledged.",
      required:    true,
      status:      "manual",
      evidence:    "LAUNCH_FREEZE_CHECKLIST.md exported",
      operatorNote: "Check the Launch Freeze panel on Releases before proceeding.",
    },
    {
      id:          "pre-signoff-confirm",
      phase:       "pre_launch",
      label:       "Confirm final launch signoff is approved",
      description: "FINAL_LAUNCH_SIGNOFF.md must be signed with operator name and date.",
      required:    true,
      status:      "manual",
      evidence:    "FINAL_LAUNCH_SIGNOFF.md signed",
      operatorNote: "Check the Launch Signoff panel on Releases.",
    },
    {
      id:          "pre-backup-confirm",
      phase:       "pre_launch",
      label:       "Confirm backup evidence exists",
      description: "A backup must have been taken within the last 2 hours before cutover.",
      required:    true,
      status:      "manual",
      evidence:    "Backup timestamp confirmed < 2h before cutover",
      safetyNote:  "Do not proceed without a confirmed recent backup.",
    },
    {
      id:          "pre-staging-confirm",
      phase:       "pre_launch",
      label:       "Confirm staging deployment proof",
      description: "Staging deployment must have passed QA before production cutover.",
      required:    true,
      status:      hasDeployment ? "manual" : "warning",
      evidence:    "Staging deployment proof in STAGING_DEPLOYMENT_REPORT.md",
    },
    {
      id:          "pre-team-confirm",
      phase:       "pre_launch",
      label:       "Confirm operators and rollback owner are available",
      description: "The executing operator and rollback owner must both be online and reachable.",
      required:    true,
      status:      "manual",
      safetyNote:  "Do not start cutover if rollback owner is unavailable.",
    },
    {
      id:          "pre-env-confirm",
      phase:       "pre_launch",
      label:       "Confirm production env vars are set",
      description: "All required production secrets must be loaded before cutover.",
      required:    true,
      status:      hasEnvVars ? "manual" : "warning",
      evidence:    "Production env vars confirmed in Settings",
    },
    {
      id:          "pre-ssl-confirm",
      phase:       "pre_launch",
      label:       "Confirm domain and SSL are ready",
      description: hostname
        ? `Domain ${hostname} must resolve and SSL must be ACTIVE.`
        : "No domain configured — confirm DNS before cutover.",
      required:    true,
      status:      sslActive ? "pass" : (hostname ? "warning" : "blocked"),
      evidence:    hostname ? `SSL on ${hostname}` : undefined,
    },

    // ── Cutover ─────────────────────────────────────────────────────────────
    {
      id:          "cutover-command-owner",
      phase:       "cutover",
      label:       "Confirm manual cutover command owner",
      description: "Only one named operator runs the production route-apply command. Confirm who.",
      required:    true,
      status:      "manual",
      safetyNote:  "Never run the cutover command from this panel. Execute it manually on the server.",
    },
    {
      id:          "cutover-execute",
      phase:       "cutover",
      label:       "Execute production cutover (manual server step)",
      description: "Run the previously reviewed nginx/route-apply command manually on the server.",
      required:    true,
      status:      "manual",
      operatorNote: "Manual step. This panel does not execute any server commands.",
      safetyNote:  "No production mutation from this panel.",
    },

    // ── Smoke tests ─────────────────────────────────────────────────────────
    {
      id:          "smoke-health",
      phase:       "smoke_test",
      label:       "Run health endpoint smoke check",
      description: hostname
        ? `curl -I https://${hostname}${healthPath} must return 200.`
        : "Run health check on production domain.",
      required:    true,
      status:      "manual",
      command:     hostname ? `curl -I https://${hostname}${healthPath}` : "curl -I https://<domain>/api/healthz",
      evidence:    "Health endpoint returns 200",
    },
    {
      id:          "smoke-frontend",
      phase:       "smoke_test",
      label:       "Confirm frontend homepage loads",
      description: hostname
        ? `Open https://${hostname}/ in browser and confirm it renders correctly.`
        : "Open production domain homepage in browser.",
      required:    true,
      status:      "manual",
      command:     hostname ? `curl -I https://${hostname}/` : undefined,
      evidence:    "Homepage renders correctly",
    },
    {
      id:          "smoke-api",
      phase:       "smoke_test",
      label:       "Confirm API route responds",
      description: "An authenticated API route must return the expected response.",
      required:    true,
      status:      "manual",
      evidence:    "API route confirmed via browser dev tools or curl",
    },

    // ── Ecommerce (Sardar only) ─────────────────────────────────────────────
    ...(isSardar
      ? ([
          {
            id:          "ecom-checkout",
            phase:       "ecommerce" as const,
            label:       "Confirm checkout flow works",
            description: "Run a test checkout on the live Sardar Stripe integration.",
            required:    true,
            status:      "manual" as const,
            evidence:    "Checkout proof screenshot or test order ID",
            safetyNote:  "Use a test card only. Do not charge a real card.",
          },
          {
            id:          "ecom-stripe",
            phase:       "ecommerce" as const,
            label:       "Confirm Stripe is in live mode",
            description: "Stripe dashboard must show live mode keys are active and webhooks are registered.",
            required:    true,
            status:      "manual" as const,
            evidence:    "Stripe live mode confirmed in dashboard",
          },
        ] satisfies LaunchDayTimelineItem[])
      : []),

    // ── Monitoring ──────────────────────────────────────────────────────────
    {
      id:          "monitoring-health-active",
      phase:       "monitoring",
      label:       "Confirm live health check is active",
      description: "Post-cutover monitoring must be active on the Monitoring page.",
      required:    true,
      status:      "manual",
      operatorNote: "Navigate to Monitoring and generate the Post-Cutover Monitoring report.",
    },
    {
      id:          "monitoring-logs",
      phase:       "monitoring",
      label:       "Monitor logs for errors",
      description: "Check PM2 and nginx logs for any unexpected errors in the first 15 minutes.",
      required:    true,
      status:      "manual",
      command:     "pm2 logs --lines 50",
      operatorNote: "Navigate to Logs page for streaming view.",
    },

    // ── Client handover ─────────────────────────────────────────────────────
    {
      id:          "handover-notify",
      phase:       "client_handover",
      label:       "Notify client",
      description: "Inform the client that launch is complete and provide access credentials.",
      required:    true,
      status:      "manual",
      evidence:    "Client notification sent (email/message timestamp)",
    },
    {
      id:          "handover-exports",
      phase:       "client_handover",
      label:       "Confirm all handover exports are ready",
      description: "HANDOFF_EXPORT.md, OPERATOR_TRAINING_PACK.md, FINAL_LAUNCH_SIGNOFF.md must all be exportable.",
      required:    true,
      status:      "manual",
      evidence:    "All handover exports generated and delivered",
    },

    // ── Post-launch ─────────────────────────────────────────────────────────
    {
      id:          "post-issue-log",
      phase:       "post_launch",
      label:       "Log any post-launch issues",
      description: "Use the Post-Launch Bug Capture panel to record and triage any issues found.",
      required:    false,
      status:      "manual",
      operatorNote: "Navigate to Logs or Operations for the Post-Launch Bug Capture panel.",
    },
    {
      id:          "post-stabilization",
      phase:       "post_launch",
      label:       "Monitor for 24 hours post-launch",
      description: "Check health, logs, and error rates for at least 24 hours after launch.",
      required:    false,
      status:      "manual",
    },
  ];

  // ── Score ────────────────────────────────────────────────────────────────────

  const required        = timeline.filter((t) => t.required);
  const passedOrManual  = required.filter((t) => t.status === "pass" || t.status === "manual");
  const blocked         = required.filter((t) => t.status === "blocked");
  const warnings        = required.filter((t) => t.status === "warning");

  const score = required.length > 0
    ? Math.round((passedOrManual.length / required.length) * 100)
    : 100;

  const blockerMessages = [
    ...blocked.map((t) => `${t.label} — ${t.description}`),
    ...(!hostname ? ["No production domain configured."] : []),
    ...(!sslActive && hostname ? ["SSL is not ACTIVE on the primary domain."] : []),
  ];

  const warningMessages = [
    ...warnings.map((t) => `Review required: ${t.label}`),
    ...(!hasDeployment ? ["No successful deployment found. Ensure staging deployment is complete."] : []),
    ...(!hasEnvVars ? ["No env vars detected. Ensure production secrets are loaded."] : []),
  ];

  let status: LaunchDayStatus = "pre_launch";
  if (blockerMessages.length > 0) status = "blocked";

  const operatorChecklist = [
    "Confirm launch freeze is active and acknowledged",
    "Confirm FINAL_LAUNCH_SIGNOFF.md is signed",
    "Confirm backup taken within last 2 hours",
    "Confirm staging + ecommerce proof exists",
    "Confirm rollback owner is online and briefed",
    "Confirm production env vars are loaded",
    "Confirm domain and SSL are active",
    "Name the single operator who will run the cutover command",
    "Execute cutover command manually on server (not from this panel)",
    "Run health endpoint smoke check immediately after cutover",
    "Confirm homepage and API route load correctly",
    ...(isSardar ? ["Confirm Stripe checkout works with a test card"] : []),
    "Activate post-cutover monitoring on Monitoring page",
    "Monitor logs for 15+ minutes for unexpected errors",
    "Notify client that launch is complete",
    "Deliver all handover exports to client",
  ];

  const smokeCommands = [
    hostname ? `curl -I https://${hostname}${healthPath}` : "curl -I https://<domain>/api/healthz",
    ...(hostname ? [`curl -I https://${hostname}/`] : []),
    "pm2 logs --lines 50",
    "sudo nginx -t",
    "pm2 status",
  ];

  const rollbackReminder = [
    "1. Is the health endpoint returning non-200? → Run smoke checks to confirm scope.",
    "2. Are there 502/503 errors? → Check PM2 process status and nginx config.",
    "3. Can the previous nginx config be restored? → Restore sardar.bak → sardar, reload nginx.",
    "4. Has it been > 5 minutes with no recovery? → Execute rollback immediately.",
    "5. After rollback: confirm health endpoint returns 200 before declaring safe.",
    "6. Notify the client and rollback owner as soon as rollback is confirmed.",
  ];

  const requiredEvidence = [
    "LAUNCH_FREEZE_CHECKLIST.md exported",
    "FINAL_LAUNCH_SIGNOFF.md signed with operator name and date",
    "Backup confirmed < 2h before cutover",
    "Staging deployment proof",
    ...(isSardar ? ["Stripe checkout proof (test card)"] : []),
    "Health endpoint 200 — curl output or screenshot",
    "Client notification timestamp",
    "All handover exports delivered",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    timeline,
    blockers:   blockerMessages,
    warnings:   warningMessages,
    requiredEvidence,
    operatorChecklist,
    smokeCommands,
    rollbackReminder,
    recommendedNextSteps: [
      "Run smoke checks immediately after cutover.",
      "Monitor logs on the Logs page for 15 minutes.",
      "Capture any issues in the Post-Launch Bug Capture panel.",
      "Deliver handover exports to client.",
      "Monitor health for 24 hours post-launch.",
    ],
  };
}

function emptyReport(
  projectId: string,
  status: LaunchDayStatus,
  blockers: string[],
): LaunchDaySupportReport {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    timeline:             [],
    blockers,
    warnings:             [],
    requiredEvidence:     [],
    operatorChecklist:    [],
    smokeCommands:        [],
    rollbackReminder:     [],
    recommendedNextSteps: [],
  };
}
