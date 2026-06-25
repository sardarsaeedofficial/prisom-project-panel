/**
 * lib/cutover-rehearsal/cutover-rehearsal-service.ts
 *
 * Sprint 75: Generates a production cutover rehearsal report by querying DB state.
 * Read-only — no secrets exposed, no production mutation.
 */

import { db }              from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  CutoverRehearsalReport,
  CutoverRehearsalStep,
  CutoverRehearsalStatus,
} from "./cutover-rehearsal-types";

function step(
  overrides: Partial<CutoverRehearsalStep> & Pick<CutoverRehearsalStep, "id" | "phase" | "label">,
): CutoverRehearsalStep {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

export async function generateCutoverRehearsalReport(input: {
  projectId: string;
}): Promise<CutoverRehearsalReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });

  const isSardar = project
    ? isSardarProject(project.name) || isSardarProject(project.slug ?? "")
    : false;

  const [domains, envVars, deployments, services, members] = await Promise.all([
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    3,
      select:  { id: true, createdAt: true, commitSha: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { name: true, serviceType: true, healthPath: true, startCommand: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
  ]);

  const primaryDomain  = domains.find((d) => d.isPrimary) ?? domains[0];
  const domain         = primaryDomain?.hostname ?? `project-${projectId.slice(0, 8)}`;
  const hasDomain      = !!primaryDomain;
  const hasSsl         = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment  = deployments.length > 0;
  const hasEnvVars     = envVars.length > 0;
  const hasStripe      = envVars.some((e) => e.name.toUpperCase().includes("STRIPE"));
  const hasDatabase    = envVars.some((e) =>
    ["DATABASE_URL", "DB_URL", "POSTGRES", "MYSQL", "MONGO"].some((p) => e.name.toUpperCase().includes(p)),
  );
  const hasHealthPath  = services.some((s) => s.healthPath);
  const hasOwner       = members.some((m) => m.role === "owner");
  const healthPath     = services.find((s) => s.healthPath)?.healthPath ?? "/api/healthz";

  const steps: CutoverRehearsalStep[] = [

    // ── Pre-launch ────────────────────────────────────────────────────────────

    step({
      id:          "pre-qa-report",
      phase:       "pre_launch",
      label:       "QA Verification Report",
      description: "Confirm QA_VERIFICATION_REPORT.md is exported and all 18 checks pass.",
      required:    true,
      status:      "manual",
      evidence:    "QA_VERIFICATION_REPORT.md",
      safetyNote:  "Do not proceed with zero QA runs.",
    }),

    step({
      id:          "pre-rc-report",
      phase:       "pre_launch",
      label:       "Release Candidate Report",
      description: "Confirm RELEASE_CANDIDATE_REPORT.md is exported and RC score ≥ 90.",
      required:    true,
      status:      "manual",
      evidence:    "RELEASE_CANDIDATE_REPORT.md",
      safetyNote:  "Score < 90 means blockers remain.",
    }),

    step({
      id:          "pre-signoff",
      phase:       "pre_launch",
      label:       "Final Launch Signoff",
      description: "Confirm FINAL_LAUNCH_SIGNOFF.md manual signoff section is completed.",
      required:    true,
      status:      "manual",
      evidence:    "FINAL_LAUNCH_SIGNOFF.md",
      safetyNote:  "The manual signoff section must be signed by an authorized operator.",
    }),

    step({
      id:          "pre-training",
      phase:       "pre_launch",
      label:       "Operator Training Pack Distributed",
      description: "Confirm OPERATOR_TRAINING_PACK.md is distributed to all operators.",
      required:    true,
      status:      "manual",
      evidence:    "OPERATOR_TRAINING_PACK.md",
    }),

    step({
      id:          "pre-domain",
      phase:       "pre_launch",
      label:       "Domain + SSL Ready",
      description: "Primary domain configured with active SSL certificate.",
      required:    true,
      status:      !hasDomain ? "blocked" : !hasSsl ? "warning" : "pass",
      evidence:    "Settings > Domains",
      safetyNote:  hasSsl ? undefined : "SSL must be ACTIVE before cutover — requests will be rejected otherwise.",
    }),

    step({
      id:          "pre-team",
      phase:       "pre_launch",
      label:       "Owner Role Assigned",
      description: "At least one project member has the owner role.",
      required:    true,
      status:      hasOwner ? "pass" : "blocked",
      evidence:    "Team page",
      safetyNote:  hasOwner ? undefined : "Assign an owner before proceeding.",
    }),

    step({
      id:          "pre-env",
      phase:       "pre_launch",
      label:       "All Required Env Vars Set",
      description: "All required environment variables are registered (keys only, no values shown).",
      required:    true,
      status:      hasEnvVars ? "pass" : "warning",
      evidence:    "Settings > Environment Variables",
    }),

    step({
      id:          "pre-deployment",
      phase:       "pre_launch",
      label:       "Successful Build Exists",
      description: "At least one successful production build in the deployment history.",
      required:    true,
      status:      hasDeployment ? "pass" : "blocked",
      evidence:    "Releases page — deployment history",
    }),

    // ── Backup ────────────────────────────────────────────────────────────────

    step({
      id:          "backup-recent",
      phase:       "backup",
      label:       "Backup Taken Within 2 Hours",
      description: "A fresh backup must exist immediately before cutover.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      command:     "Check Backups page — confirm timestamp < 2h ago",
      evidence:    "Backups page — latest backup timestamp",
      safetyNote:  "Do not cut over without a fresh backup — rollback requires it.",
    }),

    step({
      id:          "backup-dr-drill",
      phase:       "backup",
      label:       "Disaster Recovery Drill Completed",
      description: "A full restore drill has been completed on staging and proven recoverable.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      evidence:    "Backups page — restore drill record",
      safetyNote:  "A drill that has not been run means rollback is untested.",
    }),

    // ── Routing ───────────────────────────────────────────────────────────────

    step({
      id:          "routing-plan-preview",
      phase:       "routing",
      label:       "Production Route Apply Plan Previewed",
      description: "The nginx route map preview has been reviewed — services, ports, routes are correct.",
      required:    true,
      status:      "manual",
      evidence:    "PRODUCTION_EXECUTION_PLAN.md",
      safetyNote:  "The panel records the plan — nginx must be applied manually via SSH.",
      command:     "Generate execution plan from Releases > Production Execution Guard",
    }),

    step({
      id:          "routing-confirmation-phrase",
      phase:       "routing",
      label:       "Confirmation Phrase Verified",
      description: "Operator has read and confirmed: APPLY PRODUCTION CUTOVER",
      required:    true,
      status:      "manual",
      safetyNote:  "Do not type the phrase in production until all other steps are ✅",
    }),

    step({
      id:          "routing-nginx-syntax",
      phase:       "routing",
      label:       "Nginx Config Syntax Check",
      description: "nginx -t passes before and after route application.",
      required:    true,
      status:      "manual",
      command:     "sudo nginx -t",
      safetyNote:  "Never reload nginx without a passing syntax check.",
    }),

    // ── Smoke Test ────────────────────────────────────────────────────────────

    step({
      id:          "smoke-health",
      phase:       "smoke_test",
      label:       "Health Endpoint Smoke Check",
      description: `Health endpoint returns 200 OK after route application.`,
      required:    hasHealthPath,
      status:      hasHealthPath ? "manual" : "warning",
      command:     `curl -I https://${domain}${healthPath}`,
      safetyNote:  "A non-200 response immediately after cutover requires rollback.",
    }),

    step({
      id:          "smoke-frontend",
      phase:       "smoke_test",
      label:       "Frontend Homepage Smoke Check",
      description: "Production domain serves the frontend homepage with status 200.",
      required:    true,
      status:      "manual",
      command:     `curl -I https://${domain}/`,
    }),

    step({
      id:          "smoke-api",
      phase:       "smoke_test",
      label:       "API Route Smoke Check",
      description: "A key API route responds correctly (no 502/503).",
      required:    services.some((s) => s.serviceType === "node"),
      status:      services.some((s) => s.serviceType === "node") ? "manual" : "pass",
      command:     `curl -I https://${domain}/api/`,
    }),

    // ── Ecommerce ─────────────────────────────────────────────────────────────

    step({
      id:          "ecommerce-test-proof",
      phase:       "ecommerce",
      label:       "Ecommerce Test Proof",
      description: "ECOMMERCE_TEST_PROOF.md generated — checkout, orders, Stripe test-mode verified on staging.",
      required:    isSardar || hasStripe,
      status:      (isSardar || hasStripe) ? "manual" : "pass",
      evidence:    "ECOMMERCE_TEST_PROOF.md",
      safetyNote:  "Do not go live without a confirmed staging ecommerce test.",
    }),

    step({
      id:          "ecommerce-stripe-live-mode",
      phase:       "ecommerce",
      label:       "Stripe Live Mode Confirmed",
      description: "Production Stripe webhook endpoint is live mode (not test mode). Webhook secret matches dashboard.",
      required:    isSardar || hasStripe,
      status:      (isSardar || hasStripe) ? "manual" : "pass",
      safetyNote:  "Live-mode Stripe processes real card charges — confirm this deliberately.",
    }),

    // ── Monitoring ────────────────────────────────────────────────────────────

    step({
      id:          "monitoring-health-check-live",
      phase:       "monitoring",
      label:       "Live Health Check Active",
      description: "Monitoring page shows a green uptime badge after cutover.",
      required:    hasHealthPath,
      status:      "manual",
      safetyNote:  "Set up monitoring before cutover — not after.",
    }),

    step({
      id:          "monitoring-alert-rules",
      phase:       "monitoring",
      label:       "Alert Rules Configured",
      description: "Uptime alert and error-rate alert are configured for the production domain.",
      required:    false,
      status:      "manual",
    }),

    // ── Rollback ──────────────────────────────────────────────────────────────

    step({
      id:          "rollback-backup-confirmed",
      phase:       "rollback",
      label:       "Rollback Backup Confirmed",
      description: "The backup taken immediately before cutover is verified on the Backups page.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      safetyNote:  "This is the backup that will be used if a DB rollback is required.",
    }),

    step({
      id:          "rollback-nginx-config-saved",
      phase:       "rollback",
      label:       "Previous Nginx Config Saved",
      description: "The previous nginx configuration file is saved and accessible on the server.",
      required:    true,
      status:      "manual",
      command:     "cp /etc/nginx/sites-available/sardar /etc/nginx/sites-available/sardar.bak",
      safetyNote:  "Always save the previous config before applying the new one.",
    }),

    step({
      id:          "rollback-phrase-known",
      phase:       "rollback",
      label:       "Rollback Phrase Memorized",
      description: "The operator knows the rollback confirmation phrase: EXECUTE PRODUCTION ROLLBACK",
      required:    true,
      status:      "manual",
      safetyNote:  "This phrase is typed in the Production Execution Guard panel on Releases.",
    }),

    // ── Handover ──────────────────────────────────────────────────────────────

    step({
      id:          "handover-exports-ready",
      phase:       "handover",
      label:       "All Handover Exports Ready",
      description: "OPERATOR_RUNBOOK.md, FINAL_GO_LIVE_PACK.md, FINAL_LAUNCH_SIGNOFF.md, OPERATOR_TRAINING_PACK.md are all exported.",
      required:    false,
      status:      "manual",
      evidence:    "Runbook and Releases pages",
    }),

    step({
      id:          "handover-client-notified",
      phase:       "handover",
      label:       "Client Notified",
      description: "Client has been informed of the launch date, time, and contact procedure.",
      required:    false,
      status:      "manual",
    }),
  ];

  // ── Score / status ─────────────────────────────────────────────────────────

  const required      = steps.filter((s) => s.required);
  const passed        = required.filter((s) => s.status === "pass");
  const blockedSteps  = required.filter((s) => s.status === "blocked");
  const manualSteps   = required.filter((s) => s.status === "manual" || s.status === "warning");
  const score         = required.length > 0
    ? Math.round((passed.length / required.length) * 100)
    : 0;

  let status: CutoverRehearsalStatus;
  if (blockedSteps.length > 0)                         status = "blocked";
  else if (score === 100 && manualSteps.length === 0)  status = "ready_for_launch";
  else if (score > 0)                                  status = "needs_review";
  else                                                 status = "not_started";

  const blockers = blockedSteps.map((s) => `${s.label}: ${s.safetyNote ?? s.description}`);

  const warnings = steps
    .filter((s) => s.status === "warning")
    .map((s) => `${s.label}: ${s.description}`);

  const operatorCommands = steps
    .filter((s) => s.command)
    .map((s) => `[${s.phase}] ${s.label}: ${s.command}`);

  const rollbackDecisionTree = [
    "1. Is the health endpoint returning non-200? → Run smoke checks to confirm",
    "2. Are there 502/503 errors in logs? → Check PM2 process status and nginx config",
    "3. Did DB changes break data access? → Consider DB restore from pre-cutover backup",
    "4. Can the previous nginx config be restored quickly? → cp sardar.bak → sardar, reload nginx",
    "5. Is this a code bug vs. config bug? → Code bug: rollback deploy; Config bug: fix nginx config",
    "6. Has it been > 5 minutes with no progress? → Execute rollback immediately, notify client",
    "7. After rollback: confirm health endpoint returns 200 before declaring safe",
  ];

  const finalGoNoGoQuestions = [
    "Is QA_VERIFICATION_REPORT.md exported and showing 0 blockers?",
    "Is RELEASE_CANDIDATE_REPORT.md score ≥ 90?",
    "Is FINAL_LAUNCH_SIGNOFF.md signed off by an authorized operator?",
    "Has a backup been taken within the last 2 hours?",
    "Has the disaster recovery drill been completed on staging?",
    "Is the production execution plan generated and reviewed?",
    "Does nginx -t pass on the server?",
    ...(hasStripe || isSardar ? ["Is Stripe running in live mode (not test mode)?"] : []),
    "Are all operators available and briefed on the rollback procedure?",
    "Is the client available to verify after cutover?",
  ];

  const recommendedNextSteps = steps
    .filter((s) => s.status === "blocked" || (s.status === "manual" && s.required))
    .slice(0, 6)
    .map((s) => `${s.label} — ${s.evidence ?? s.command ?? s.description}`);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score,
    steps,
    blockers,
    warnings,
    operatorCommands,
    rollbackDecisionTree,
    finalGoNoGoQuestions,
    recommendedNextSteps,
  };
}
