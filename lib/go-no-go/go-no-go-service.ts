import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  GoNoGoEvidencePack,
  GoNoGoEvidenceItem,
  GoNoGoDecision,
} from "./go-no-go-types";

function item(
  overrides: Partial<GoNoGoEvidenceItem> &
    Pick<GoNoGoEvidenceItem, "id" | "category" | "label" | "evidencePrompt">,
): GoNoGoEvidenceItem {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

export async function generateGoNoGoEvidencePack(input: {
  projectId: string;
}): Promise<GoNoGoEvidencePack> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyPack(projectId, "no_go", ["Project not found."]);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [domains, deployments, members, services, envVars] = await Promise.all([
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { id: true, commitSha: true, createdAt: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { healthPath: true },
    }),
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }),
  ]);

  const primaryDomain  = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname       = primaryDomain?.hostname ?? "";
  const sslActive      = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment  = deployments.length > 0;
  const hasOwner       = members.some((m) => m.role === "owner");
  const hasHealth      = services.some((s) => s.healthPath);
  const envNames       = envVars.map((e) => e.name.toUpperCase());
  const hasDb          = envNames.some((n) => n.includes("DATABASE") || n.includes("POSTGRES") || n === "DB_URL");
  const hasAuth        = envNames.some((n) => n.includes("AUTH_SECRET") || n.includes("NEXTAUTH_SECRET"));
  const hasStripe      = isSardar ? envNames.some((n) => n.includes("STRIPE")) : true;
  const hasStripeWH    = isSardar ? envNames.some((n) => n.includes("STRIPE_WEBHOOK")) : true;

  // ── Evidence items ─────────────────────────────────────────────────────────

  const evidence: GoNoGoEvidenceItem[] = [

    // Deployment
    item({
      id: "ev-deployed-commit", category: "deployment",
      label: "Deployed commit confirmed on server",
      description: "git rev-parse --short HEAD on server must match the expected Sprint 79 commit.",
      status: hasDeployment ? "manual" : "blocked",
      evidencePrompt: hasDeployment
        ? "SSH: git -C /home/prisom/prisom-project-panel rev-parse --short HEAD"
        : "Deploy the panel first. Then SSH: git -C /home/prisom/prisom-project-panel rev-parse --short HEAD",
    }),
    item({
      id: "ev-pm2-online", category: "deployment",
      label: "prisom-projects PM2 process confirmed online",
      description: "pm2 list must show prisom-projects online.",
      status: "manual",
      evidencePrompt: "pm2 list | grep prisom-projects → confirmed online",
    }),
    item({
      id: "ev-ssl", category: "deployment",
      label: "SSL ACTIVE on production domain",
      description: `SSL must be ACTIVE on ${hostname || "the project domain"} before cutover.`,
      status: sslActive ? "collected" : (hostname ? "warning" : "manual"),
      evidencePrompt: `Check Domains page — SSL status for ${hostname || "primary domain"}`,
    }),

    // QA
    item({
      id: "ev-qa-report", category: "qa",
      label: "QA_VERIFICATION_REPORT.md exported with 0 blockers",
      description: "QA verification must have been run and exported with no blockers.",
      status: "manual",
      evidencePrompt: "Download QA_VERIFICATION_REPORT.md from Releases → QA Verification panel",
    }),
    item({
      id: "ev-final-readiness", category: "qa",
      label: "FINAL_READINESS_AUDIT.md shows READY TO EXECUTE",
      description: "Final readiness audit must show READY TO EXECUTE.",
      status: "manual",
      evidencePrompt: "Download FINAL_READINESS_AUDIT.md — status must read READY TO EXECUTE",
    }),

    // Release
    item({
      id: "ev-rc-report", category: "release",
      label: "RC_HARDENING_REPORT.md score ≥ 90%",
      description: "Release candidate report must show ≥ 90% score with no critical failures.",
      status: "manual",
      evidencePrompt: "Download RC_HARDENING_REPORT.md — score ≥ 90% visible",
    }),
    item({
      id: "ev-launch-signoff", category: "release",
      label: "FINAL_LAUNCH_SIGNOFF.md signed",
      description: "FINAL_LAUNCH_SIGNOFF.md must be signed with operator name and date.",
      status: "manual",
      evidencePrompt: "Download FINAL_LAUNCH_SIGNOFF.md — operator name and date visible",
    }),
    item({
      id: "ev-stop-build", category: "release",
      label: "STOP_BUILD_GATE.md shows STOP BUILDING — READY TO LAUNCH",
      description: "Stop-build gate must confirm the decision.",
      status: "manual",
      evidencePrompt: "Download STOP_BUILD_GATE.md — decision must read STOP BUILDING — READY TO LAUNCH",
    }),

    // Migration
    item({
      id: "ev-client-plan", category: "migration",
      label: "CLIENT_MIGRATION_PLAN.md exported",
      description: "Client migration plan must be exported and delivered.",
      status: "manual",
      evidencePrompt: "Download CLIENT_MIGRATION_PLAN.md from Migration page",
    }),
    item({
      id: "ev-staging-deployment", category: "migration",
      label: "Staging deployment proof recorded",
      description: "At least one successful deployment must be on record.",
      status: hasDeployment ? "collected" : "blocked",
      evidencePrompt: "Check Deployment History — successful deployment visible",
    }),

    // Backup
    item({
      id: "ev-backup", category: "backup",
      label: "Backup taken and path confirmed",
      description: "A database backup must be taken within 2 hours of cutover.",
      status: "manual",
      evidencePrompt: "Backup file path and timestamp confirmed on server or Backups page",
    }),
    item({
      id: "ev-restore-drill", category: "backup",
      label: "Restore drill completed on staging",
      description: "A restore drill on staging must have been completed.",
      status: "manual",
      evidencePrompt: "Restore drill confirmed on staging — timestamp noted",
    }),

    // Monitoring
    item({
      id: "ev-post-cutover-monitoring", category: "monitoring",
      label: "POST_CUTOVER_MONITORING_REPORT.md exported",
      description: "Post-cutover monitoring report must be generated and ready.",
      status: "manual",
      evidencePrompt: "Download POST_CUTOVER_MONITORING_REPORT.md from Monitoring page",
    }),
    item({
      id: "ev-health-endpoint", category: "monitoring",
      label: "Health endpoint configured on project service",
      description: "At least one project service must have a health check path.",
      status: hasHealth ? "collected" : "warning",
      evidencePrompt: "Check Services on Publishing page — health path visible",
    }),

    // Security
    item({
      id: "ev-db-env", category: "security",
      label: "DATABASE_URL env var present (name only)",
      description: "DATABASE_URL or equivalent must be set.",
      status: hasDb ? "collected" : "blocked",
      evidencePrompt: "Check Env page — DATABASE_URL visible (name only, not value)",
    }),
    item({
      id: "ev-auth-env", category: "security",
      label: "Auth secret env var present (name only)",
      description: "AUTH_SECRET or NEXTAUTH_SECRET must be set.",
      status: hasAuth ? "collected" : "warning",
      evidencePrompt: "Check Env page — AUTH_SECRET or NEXTAUTH_SECRET visible (name only)",
    }),
    item({
      id: "ev-no-secrets", category: "security",
      label: "No secret values in any export",
      description: "Review exported files — no API keys, passwords, or tokens should appear.",
      status: "manual",
      evidencePrompt: "Review at least FINAL_READINESS_AUDIT.md and LAUNCH_EXECUTION_CHECKLIST.md — no secrets visible",
    }),
    ...(isSardar
      ? [
          item({
            id: "ev-stripe", category: "security",
            label: "Stripe env vars confirmed (names only)",
            description: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set.",
            status: (hasStripe && hasStripeWH ? "collected" : "blocked") as GoNoGoEvidenceItem["status"],
            evidencePrompt: "Check Env page — STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET visible (names only)",
          }),
        ]
      : []),

    // Rollback
    item({
      id: "ev-rollback-rehearsal", category: "rollback",
      label: "FINAL_CUTOVER_REHEARSAL.md rollback section reviewed",
      description: "Operator has reviewed the rollback decision tree in the rehearsal export.",
      status: "manual",
      evidencePrompt: "Download FINAL_CUTOVER_REHEARSAL.md — rollback section confirmed reviewed",
    }),
    item({
      id: "ev-rollback-owner", category: "rollback",
      label: "Rollback owner named and available on launch day",
      description: "A named person must own the rollback decision.",
      status: "manual",
      evidencePrompt: "Record rollback owner name: ___",
    }),
    item({
      id: "ev-nginx-backup", category: "rollback",
      label: "Nginx config backup confirmed on server",
      description: "A backup nginx config must exist before cutover.",
      status: "manual",
      evidencePrompt: "SSH: ls -la /etc/nginx/sites-available/ — backup file visible",
    }),

    // Operator
    item({
      id: "ev-operator-owner", category: "operator",
      label: "Project owner assigned to project",
      description: "At least one member with owner role must be assigned.",
      status: hasOwner ? "collected" : "blocked",
      evidencePrompt: "Check Team page — owner role visible",
    }),
    item({
      id: "ev-operator-training", category: "operator",
      label: "OPERATOR_TRAINING_PACK.md delivered to operator",
      description: "Operator training pack must be delivered to the named operator.",
      status: "manual",
      evidencePrompt: "Download OPERATOR_TRAINING_PACK.md from Runbook — delivery confirmed",
    }),
    item({
      id: "ev-launch-execution", category: "operator",
      label: "LAUNCH_EXECUTION_CHECKLIST.md with operator reviewed",
      description: "Operator must have reviewed the launch execution checklist.",
      status: "manual",
      evidencePrompt: "Download LAUNCH_EXECUTION_CHECKLIST.md — operator confirms reviewed",
    }),

    // Client
    item({
      id: "ev-client-notified", category: "client",
      label: "Client notified of launch date and time",
      description: "Client must be informed of the exact planned launch time.",
      status: "manual",
      evidencePrompt: "Client notification sent — timestamp: ___",
    }),
    item({
      id: "ev-handoff-delivered", category: "client",
      label: "HANDOFF_EXPORT.md delivered to client",
      description: "Full handoff export must be delivered to the client.",
      status: "manual",
      evidencePrompt: "HANDOFF_EXPORT.md delivered — delivery method: ___",
    }),
  ];

  // ── Decision ──────────────────────────────────────────────────────────────

  const blockedItems  = evidence.filter((e) => e.required && (e.status === "blocked" || e.status === "missing"));
  const warnItems     = evidence.filter((e) => e.required && e.status === "warning");
  const collectedItems = evidence.filter((e) => e.status === "collected");
  const manualItems   = evidence.filter((e) => e.status === "manual");

  const blockers: string[] = blockedItems.map((e) => `Missing: ${e.label}`);
  const warnings: string[] = warnItems.map((e) => `Review: ${e.label}`);

  let decision: GoNoGoDecision;
  if (blockers.length > 0)              decision = "no_go";
  else if (warnings.length > 0)         decision = "go_with_warnings";
  else if (manualItems.length > 0)      decision = "needs_manual_review";
  else                                  decision = "go";

  const finalQuestions = [
    "Is FINAL_READINESS_AUDIT.md showing READY TO EXECUTE?",
    "Is STOP_BUILD_GATE.md showing STOP BUILDING — READY TO LAUNCH?",
    "Is a backup taken and confirmed within the last 2 hours?",
    "Is SSL ACTIVE on the production domain?",
    "Is the named operator available and on-call?",
    "Is the rollback owner named and available?",
    "Are all required exports downloaded and in the handoff folder?",
    "Has the cutover rehearsal been completed and reviewed?",
    "Is Sardar Security production currently returning 200 on both routes?",
    "Is Doorsteps/LocalShop confirmed running and untouched?",
    "Is the client notified of the planned launch time?",
    "Are there zero secret values in any generated export?",
    isSardar ? "Are Stripe live env vars confirmed set (name only checked)?" : null,
    isSardar ? "Has test checkout been completed on staging?" : null,
  ].filter(Boolean) as string[];

  const requiredApprovals = [
    "Named operator: must sign off on the final launch execution checklist before cutover",
    "Rollback owner: must confirm availability and decision criteria",
    "Client: must be notified and have acknowledged the launch date",
    hasOwner ? "Project owner: confirmed assigned" : "Project owner: MISSING — assign on Team page",
    isSardar ? "Stripe live mode: operator must confirm live keys are set (name only)" : null,
  ].filter(Boolean) as string[];

  const launchAllowedOnlyIf = [
    "FINAL_READINESS_AUDIT.md shows READY TO EXECUTE",
    "STOP_BUILD_GATE.md decision is STOP BUILDING — READY TO LAUNCH",
    "A backup is confirmed taken within the last 2 hours",
    "SSL is ACTIVE on the production domain",
    "Named operator is on-call and available",
    "Rollback owner is named and available",
    "All required exports are downloaded and in the handoff folder",
    "Sardar Security frontend and health endpoint are returning 200",
    "Doorsteps/LocalShop is confirmed running and untouched",
    isSardar ? "Stripe env vars are confirmed set by name" : null,
  ].filter(Boolean) as string[];

  const launchBlockedIf = [
    "FINAL_READINESS_AUDIT.md shows BLOCKED",
    "DATABASE_URL env var is not set",
    "SSL is not ACTIVE on the production domain",
    "No successful deployment is on record",
    "No project owner is assigned",
    "Sardar Security is returning non-200 responses",
    isSardar ? "Stripe env vars (STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET) are missing" : null,
    "A critical known issue is unresolved",
    "Rollback procedure has not been reviewed by the operator",
  ].filter(Boolean) as string[];

  let finalOperatorMessage: string;
  if (decision === "no_go") {
    finalOperatorMessage = `NO GO — ${blockers.length} critical item${blockers.length > 1 ? "s are" : " is"} missing. Resolve all blockers and re-generate this pack before scheduling a launch window.`;
  } else if (decision === "go_with_warnings") {
    finalOperatorMessage = `GO WITH WARNINGS — ${warnings.length} item${warnings.length > 1 ? "s require" : " requires"} review. Proceed only after reviewing all warnings and documenting acceptance in the manual signoff section.`;
  } else if (decision === "needs_manual_review") {
    finalOperatorMessage = `NEEDS MANUAL REVIEW — ${manualItems.length} item${manualItems.length > 1 ? "s require" : " requires"} manual operator confirmation. Complete the manual signoff section and re-run this report to confirm go decision.`;
  } else {
    finalOperatorMessage = "GO — All automated checks pass. Complete the manual signoff section below, then proceed to the Launch Execution Checklist.";
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    decision,
    evidence,
    blockers,
    warnings,
    finalQuestions,
    requiredApprovals,
    launchAllowedOnlyIf,
    launchBlockedIf,
    finalOperatorMessage,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function emptyPack(
  projectId: string,
  decision: GoNoGoDecision,
  blockers: string[],
): GoNoGoEvidencePack {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    decision,
    evidence: [],
    blockers,
    warnings: [],
    finalQuestions: [],
    requiredApprovals: [],
    launchAllowedOnlyIf: [],
    launchBlockedIf: [],
    finalOperatorMessage: "Could not generate go/no-go evidence pack.",
  };
}
