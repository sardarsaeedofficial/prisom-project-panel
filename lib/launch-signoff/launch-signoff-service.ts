/**
 * lib/launch-signoff/launch-signoff-service.ts
 *
 * Sprint 74: Generates a final launch signoff report by querying DB state.
 * Read-only — no secrets exposed, no production mutation.
 */

import { db } from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  LaunchSignoffCheck,
  LaunchSignoffReport,
  LaunchSignoffStatus,
} from "./launch-signoff-types";

// ── Check builders ────────────────────────────────────────────────────────────

function check(
  overrides: Partial<LaunchSignoffCheck> & Pick<LaunchSignoffCheck, "id" | "category" | "label">,
): LaunchSignoffCheck {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateLaunchSignoffReport(input: {
  projectId: string;
}): Promise<LaunchSignoffReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });

  const isSardar = project
    ? isSardarProject(project.name) || isSardarProject(project.slug ?? "")
    : false;

  const [domains, envVars, deployments, members, services] = await Promise.all([
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
      take:    5,
      select:  { id: true, createdAt: true, commitSha: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { name: true, serviceType: true, healthPath: true },
    }),
  ]);

  const primaryDomain    = domains.find((d) => d.isPrimary) ?? domains[0];
  const hasDomain        = !!primaryDomain;
  const hasSsl           = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment    = deployments.length > 0;
  const hasEnvVars       = envVars.length > 0;
  const hasStripe        = envVars.some((e) => e.name.toUpperCase().includes("STRIPE"));
  const hasDatabase      = envVars.some((e) =>
    ["DATABASE_URL", "DB_URL", "POSTGRES", "MYSQL", "MONGO"].some((p) =>
      e.name.toUpperCase().includes(p),
    ),
  );
  const hasOwner         = members.some((m) => m.role === "owner");
  const hasServices      = services.length > 0;
  const hasHealthPath    = services.some((s) => s.healthPath);

  const checks: LaunchSignoffCheck[] = [
    // QA
    check({
      id:          "qa-verification",
      category:    "qa",
      label:       "Live QA Verification",
      description: "All 18 QA checks completed — routes, exports, confirmations, safety gates.",
      required:    true,
      status:      "manual",
      evidence:    "QA_VERIFICATION_REPORT.md",
      nextStep:    "Run QA Verification panel on Releases page.",
    }),

    // Release Candidate
    check({
      id:          "rc-hardening",
      category:    "release_candidate",
      label:       "Release Candidate Hardening",
      description: "RC hardening score ≥ 90, zero blockers, all confirmation phrases verified.",
      required:    true,
      status:      "manual",
      evidence:    "RELEASE_CANDIDATE_REPORT.md",
      nextStep:    "Run Release Candidate panel on Releases page.",
    }),

    // Project Profile
    check({
      id:          "project-profile",
      category:    "client_handover",
      label:       "Project Migration Profile",
      description: "Project profile detected and exported.",
      required:    false,
      status:      hasServices ? "pass" : "warning",
      evidence:    "PROJECT_PROFILE_REPORT.md",
      nextStep:    hasServices ? undefined : "Register at least one service in Settings.",
    }),

    // Client Migration Plan
    check({
      id:          "client-migration-plan",
      category:    "client_handover",
      label:       "Client Migration Plan",
      description: "CLIENT_MIGRATION_PLAN.md generated and shared with client.",
      required:    false,
      status:      "manual",
      evidence:    "CLIENT_MIGRATION_PLAN.md",
      nextStep:    "Export from Migration > Migration Templates.",
    }),

    // Staging
    check({
      id:          "staging-deployment",
      category:    "staging",
      label:       "Staging Deployment Proof",
      description: "Isolated staging deployment succeeded with all services healthy.",
      required:    true,
      status:      "manual",
      evidence:    "STAGING_DEPLOYMENT_PROOF.md",
      nextStep:    "Complete Staging Deployment panel on Migration page.",
    }),

    // Trial Migration
    check({
      id:          "trial-migration",
      category:    "staging",
      label:       "Trial Migration Proof",
      description: "Staging trial migration passed — smoke checks, env, DB, routing, backup drill.",
      required:    isSardar,
      status:      "manual",
      evidence:    "TRIAL_MIGRATION_PROOF.md",
      nextStep:    "Complete Trial Migration panel on Migration page.",
    }),

    // Ecommerce
    check({
      id:          "ecommerce-test",
      category:    "ecommerce",
      label:       "Ecommerce Test Harness",
      description: "Checkout, orders, and Stripe test-mode smoke checks passed on staging.",
      required:    isSardar || hasStripe,
      status:      hasStripe ? "manual" : "pass",
      evidence:    "ECOMMERCE_TEST_PROOF.md",
      nextStep:    hasStripe ? "Complete Ecommerce Test panel on Migration page." : undefined,
    }),

    // Backup Readiness
    check({
      id:          "backup-readiness",
      category:    "backups",
      label:       "Backup Readiness",
      description: "Latest backup is recent (< 24h) and verified recoverable.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      evidence:    "Backups page — latest backup timestamp",
      nextStep:    hasDatabase ? "Run Backup / Restore Drill before cutover." : undefined,
    }),

    // Disaster Recovery Drill
    check({
      id:          "dr-drill",
      category:    "backups",
      label:       "Disaster Recovery Drill",
      description: "Full restore drill completed — backup unpacked, app started, data verified.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      evidence:    "Backups page — restore drill record",
      nextStep:    hasDatabase ? "Complete restore drill on Backups page." : undefined,
    }),

    // Production Execution Guard
    check({
      id:          "production-execution-guard",
      category:    "release_candidate",
      label:       "Production Execution Guard",
      description: "Execution plan previewed, confirmation phrase verified, smoke checks defined.",
      required:    true,
      status:      "manual",
      evidence:    "PRODUCTION_EXECUTION_PLAN.md",
      nextStep:    "Generate execution plan on Releases page.",
    }),

    // Post-Cutover Monitoring
    check({
      id:          "monitoring-setup",
      category:    "monitoring",
      label:       "Post-Cutover Monitoring Setup",
      description: "Health check, uptime monitor, and alert rules confirmed for production.",
      required:    hasHealthPath,
      status:      hasHealthPath ? "manual" : "warning",
      evidence:    "Monitoring page — uptime and alert config",
      nextStep:    hasHealthPath
        ? "Verify monitoring page shows active health checks."
        : "Add a healthPath to at least one service in Settings.",
    }),

    // Operator Runbook
    check({
      id:          "operator-runbook",
      category:    "runbook",
      label:       "Operator Runbook",
      description: "Runbook reviewed and exported. Emergency contacts and escalation rules confirmed.",
      required:    false,
      status:      "manual",
      evidence:    "OPERATOR_RUNBOOK.md",
      nextStep:    "Export from Runbook page.",
    }),

    // Team Permissions
    check({
      id:          "team-permissions",
      category:    "team",
      label:       "Team Permissions",
      description: "At least one owner assigned. Developer and operator roles confirmed.",
      required:    true,
      status:      hasOwner ? "pass" : "blocked",
      evidence:    "Team page — member list",
      nextStep:    hasOwner ? undefined : "Assign an owner role in Team settings.",
    }),

    // Secrets Readiness
    check({
      id:          "secrets-readiness",
      category:    "security",
      label:       "Secrets / Env Vars",
      description: "All required env vars registered. No secrets in source code.",
      required:    true,
      status:      hasEnvVars ? "pass" : "warning",
      evidence:    "Settings > Environment Variables",
      nextStep:    hasEnvVars ? undefined : "Add required env vars in Settings.",
    }),

    // Domain / SSL
    check({
      id:          "domain-ssl",
      category:    "security",
      label:       "Domain / SSL Readiness",
      description: "Primary domain configured. SSL certificate active.",
      required:    true,
      status:      !hasDomain ? "blocked" : !hasSsl ? "warning" : "pass",
      evidence:    "Settings > Domains",
      nextStep:    !hasDomain
        ? "Add a production domain in Settings."
        : !hasSsl
        ? "Provision SSL certificate for the primary domain."
        : undefined,
    }),

    // Live Deployment
    check({
      id:          "live-deployment",
      category:    "staging",
      label:       "Successful Deployment",
      description: "At least one successful production build exists.",
      required:    true,
      status:      hasDeployment ? "pass" : "blocked",
      evidence:    "Releases page — deployment history",
      nextStep:    hasDeployment ? undefined : "Trigger a successful deployment from Publishing.",
    }),
  ];

  // ── Score / status ────────────────────────────────────────────────────────

  const required       = checks.filter((c) => c.required);
  const passed         = required.filter((c) => c.status === "pass");
  const blockedChecks  = required.filter((c) => c.status === "blocked");
  const manualRequired = required.filter((c) => c.status === "manual" || c.status === "warning");
  const score          = required.length > 0
    ? Math.round((passed.length / required.length) * 100)
    : 0;

  let status: LaunchSignoffStatus;
  if (blockedChecks.length > 0)                          status = "blocked";
  else if (score === 100 && manualRequired.length === 0) status = "ready";
  else if (score > 0)                                    status = "in_progress";
  else                                                   status = "not_started";

  const blockers = blockedChecks.map((c) => `${c.label}: ${c.nextStep ?? c.description}`);

  const warnings = checks
    .filter((c) => c.status === "warning")
    .map((c) => `${c.label}: ${c.description}`);

  const requiredEvidence = checks
    .filter((c) => c.required && c.evidence)
    .map((c) => c.evidence!);

  const recommendedNextSteps = checks
    .filter((c) => c.nextStep && (c.status === "blocked" || c.status === "manual" || c.status === "warning"))
    .slice(0, 8)
    .map((c) => c.nextStep!);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score,
    checks,
    blockers,
    warnings,
    requiredEvidence,
    recommendedNextSteps,
  };
}
