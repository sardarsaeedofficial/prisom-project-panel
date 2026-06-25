/**
 * lib/launch-freeze/launch-freeze-service.ts
 *
 * Sprint 75: Generates a launch freeze report by querying DB state.
 * Read-only — no secrets, no production mutation.
 */

import { db }              from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  LaunchFreezeCheck,
  LaunchFreezeReport,
  LaunchFreezeStatus,
} from "./launch-freeze-types";

function check(
  overrides: Partial<LaunchFreezeCheck> & Pick<LaunchFreezeCheck, "id" | "category" | "label">,
): LaunchFreezeCheck {
  return {
    description: "",
    status: "manual",
    required: true,
    ...overrides,
  };
}

export async function generateLaunchFreezeReport(input: {
  projectId: string;
}): Promise<LaunchFreezeReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { name: true, slug: true },
  });

  const isSardar = project
    ? isSardarProject(project.name) || isSardarProject(project.slug ?? "")
    : false;

  const [envVars, deployments, domains, services] = await Promise.all([
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { id: true, createdAt: true },
    }),
    db.domain.findMany({
      where:  { projectId },
      select: { hostname: true, isPrimary: true, sslStatus: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { name: true, serviceType: true },
    }),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const hasSsl        = primaryDomain?.sslStatus === "ACTIVE";
  const hasDomain     = !!primaryDomain;
  const hasDeployment = deployments.length > 0;
  const hasServices   = services.length > 0;
  const hasEnvVars    = envVars.length > 0;
  const hasStripe     = envVars.some((e) => e.name.toUpperCase().includes("STRIPE"));
  const hasDatabase   = envVars.some((e) =>
    ["DATABASE_URL", "DB_URL", "POSTGRES", "MYSQL", "MONGO"].some((p) => e.name.toUpperCase().includes(p)),
  );

  const checks: LaunchFreezeCheck[] = [
    // Code
    check({
      id:          "code-no-new-features",
      category:    "code",
      label:       "No New Features in Freeze",
      description: "No new major features have been merged after the freeze began.",
      required:    true,
      status:      "manual",
      freezeRule:  "New features require a full QA cycle — blocked during freeze.",
    }),
    check({
      id:          "code-only-critical-fixes",
      category:    "code",
      label:       "Only Critical Bug Fixes Allowed",
      description: "Any code changes during freeze are critical bug fixes only, not enhancements.",
      required:    true,
      status:      "manual",
      freezeRule:  "Enhancements are deferred to post-launch sprint.",
    }),

    // Deployment
    check({
      id:          "deploy-last-build-passing",
      category:    "deployment",
      label:       "Last Build Passing",
      description: "The most recent deployment build succeeded.",
      required:    true,
      status:      hasDeployment ? "pass" : "blocked",
      freezeRule:  "No release can proceed from a failed build.",
    }),
    check({
      id:          "deploy-no-schema-change",
      category:    "deployment",
      label:       "No Schema Changes",
      description: "No Prisma schema or database migration is included in the freeze window.",
      required:    true,
      status:      "manual",
      freezeRule:  "Schema changes during freeze require a full DB migration review.",
    }),

    // Database
    check({
      id:          "db-backup-recent",
      category:    "database",
      label:       "Backup Current",
      description: "Latest backup taken within the last 24 hours.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      freezeRule:  "Do not enter freeze without a verified backup.",
    }),
    check({
      id:          "db-no-migration-pending",
      category:    "database",
      label:       "No Pending DB Migrations",
      description: "No database migrations are queued or partially applied.",
      required:    hasDatabase,
      status:      hasDatabase ? "manual" : "pass",
      freezeRule:  "Partial migrations can corrupt data — must be resolved before freeze.",
    }),

    // Secrets
    check({
      id:          "secrets-all-set",
      category:    "secrets",
      label:       "All Required Secrets Set",
      description: "All required environment variables are registered (keys only).",
      required:    true,
      status:      hasEnvVars ? "pass" : "warning",
      freezeRule:  "Missing secrets cause runtime failures — must be resolved.",
    }),
    check({
      id:          "secrets-no-changes",
      category:    "secrets",
      label:       "No Secret Rotations During Freeze",
      description: "No secret values are being rotated during the launch freeze window.",
      required:    hasStripe,
      status:      "manual",
      freezeRule:  "Rotating a Stripe key mid-freeze invalidates existing webhook signatures.",
    }),

    // Routing
    check({
      id:          "routing-ssl-active",
      category:    "routing",
      label:       "SSL Certificate Active",
      description: "Primary domain has an active SSL certificate.",
      required:    true,
      status:      !hasDomain ? "blocked" : !hasSsl ? "warning" : "pass",
      freezeRule:  "Do not cut over without a valid SSL certificate.",
    }),
    check({
      id:          "routing-no-dns-changes",
      category:    "routing",
      label:       "No DNS Changes During Freeze",
      description: "DNS records are not being changed during the freeze window.",
      required:    true,
      status:      "manual",
      freezeRule:  "DNS changes have TTL propagation delays — must not overlap with cutover.",
    }),
    check({
      id:          "routing-nginx-backed-up",
      category:    "routing",
      label:       "Previous Nginx Config Backed Up",
      description: "The current nginx config is saved before applying the production route.",
      required:    true,
      status:      "manual",
      freezeRule:  "Required for rollback — must save cp before applying new config.",
    }),

    // QA
    check({
      id:          "qa-complete",
      category:    "qa",
      label:       "QA Verification Complete",
      description: "QA_VERIFICATION_REPORT.md exported with 0 blockers.",
      required:    true,
      status:      "manual",
      freezeRule:  "QA must complete in the same build as the freeze — no code changes after QA.",
    }),
    check({
      id:          "qa-rc-score",
      category:    "qa",
      label:       "RC Hardening Score ≥ 90",
      description: "RELEASE_CANDIDATE_REPORT.md shows score ≥ 90.",
      required:    true,
      status:      "manual",
      freezeRule:  "A sub-90 score indicates outstanding risks — resolve before freeze.",
    }),

    // Team
    check({
      id:          "team-contacts-ready",
      category:    "team",
      label:       "All Team Contacts Confirmed",
      description: "Signoff owner, emergency contact, cutover approver, and rollback approver are all confirmed.",
      required:    true,
      status:      "manual",
    }),

    // Documentation
    check({
      id:          "docs-signoff-signed",
      category:    "documentation",
      label:       "Launch Signoff Signed",
      description: "FINAL_LAUNCH_SIGNOFF.md manual signoff section is completed.",
      required:    true,
      status:      "manual",
      freezeRule:  "Launch is blocked without a signed signoff document.",
    }),
    check({
      id:          "docs-training-distributed",
      category:    "documentation",
      label:       "Training Pack Distributed",
      description: "OPERATOR_TRAINING_PACK.md is distributed to all operators and acknowledged.",
      required:    false,
      status:      "manual",
    }),

    // Monitoring
    check({
      id:          "monitoring-active",
      category:    "monitoring",
      label:       "Post-Cutover Monitoring Ready",
      description: "Health check, uptime monitor, and alert rules are configured for the production domain.",
      required:    services.some((s) => s.serviceType === "node"),
      status:      "manual",
      freezeRule:  "Monitoring must be ready before cutover — not set up after.",
    }),
  ];

  // ── Score / status ─────────────────────────────────────────────────────────

  const required      = checks.filter((c) => c.required);
  const passed        = required.filter((c) => c.status === "pass");
  const blockedChecks = required.filter((c) => c.status === "blocked");
  const score         = required.length > 0
    ? Math.round((passed.length / required.length) * 100)
    : 0;

  let status: LaunchFreezeStatus;
  if (blockedChecks.length > 0) status = "blocked";
  else if (score >= 80)         status = "frozen_pending_launch";
  else if (score >= 40)         status = "freeze_recommended";
  else                          status = "not_frozen";

  const blockers = blockedChecks.map((c) => c.label);
  const warnings = checks.filter((c) => c.status === "warning").map((c) => `${c.label}: ${c.description}`);

  const freezeRules = checks
    .filter((c) => c.freezeRule)
    .map((c) => c.freezeRule!);

  const allowedChanges = [
    "Critical bug fixes (confirmed broken behavior, not enhancements)",
    "Copy fixes that reduce operator confusion or remove misleading text",
    "Broken link fixes in the panel UI",
    "Export/report content fixes (no secrets, no behavioral change)",
    "Confirmation gate fixes (wrong phrase, wrong label)",
    "Dependency security patches (pinned version changes only)",
  ];

  const blockedChanges = [
    "Database schema changes or new Prisma migrations",
    "New major features or new pages",
    "Route, DNS, or nginx configuration changes (from panel)",
    "Payment provider or Stripe configuration changes",
    "Secret value rotations without explicit approval",
    "PM2 process behavior changes from the panel UI",
    "Nginx or web server changes from the panel UI",
    "Any change that requires a full QA cycle to validate",
  ];

  const recommendedNextSteps = checks
    .filter((c) => c.status === "blocked" || c.status === "manual")
    .filter((c) => c.required)
    .slice(0, 5)
    .map((c) => c.label);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    checks,
    blockers,
    warnings,
    freezeRules,
    allowedChanges,
    blockedChanges,
    recommendedNextSteps,
  };
}
