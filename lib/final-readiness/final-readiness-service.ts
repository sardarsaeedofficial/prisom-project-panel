import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  FinalReadinessAudit,
  FinalReadinessCheck,
  FinalReadinessStatus,
  FinalKnownIssue,
} from "./final-readiness-types";

// ── Helper ────────────────────────────────────────────────────────────────────

function chk(
  overrides: Partial<FinalReadinessCheck> &
    Pick<FinalReadinessCheck, "id" | "category" | "label">,
): FinalReadinessCheck {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateFinalReadinessAudit(input: {
  projectId: string;
}): Promise<FinalReadinessAudit> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyAudit(projectId, "blocked", ["Project not found."]);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

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
      select:  { id: true, createdAt: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { name: true, healthPath: true },
    }),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname      = primaryDomain?.hostname ?? "";
  const sslActive     = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment = deployments.length > 0;
  const hasEnvVars    = envVars.length > 0;
  const hasOwner      = members.some((m) => m.role === "owner");
  const hasAdmin      = members.some((m) => m.role === "admin" || m.role === "owner");
  const hasHealth     = services.some((s) => s.healthPath);

  // Env var name checks (no values exposed)
  const envNames      = envVars.map((e) => e.name.toUpperCase());
  const hasDb         = envNames.some((n) => n.includes("DATABASE") || n.includes("POSTGRES") || n === "DB_URL");
  const hasAuth       = envNames.some((n) => n.includes("AUTH_SECRET") || n.includes("NEXTAUTH_SECRET") || n.includes("SESSION_SECRET"));
  const hasStripe     = isSardar ? envNames.some((n) => n.includes("STRIPE")) : true;
  const hasStripeWH   = isSardar ? envNames.some((n) => n.includes("STRIPE_WEBHOOK")) : true;

  // ── Readiness checks ────────────────────────────────────────────────────────

  const checks: FinalReadinessCheck[] = [
    // QA / Release
    chk({
      id: "qa-verification", category: "qa",
      label: "QA Verification Report generated and exported",
      description: "QA_VERIFICATION_REPORT.md must have been generated with 0 blockers.",
      status: "manual",
      evidence: "QA_VERIFICATION_REPORT.md exported from Releases page",
      nextStep: "Generate and export from Releases → QA Verification panel",
    }),
    chk({
      id: "rc-hardening", category: "release",
      label: "Release Candidate report score ≥ 90%",
      description: "RC_HARDENING_REPORT.md must show ≥ 90% score with no critical failures.",
      status: "manual",
      evidence: "RC_HARDENING_REPORT.md exported from Releases page",
    }),
    chk({
      id: "launch-signoff", category: "release",
      label: "Final Launch Signoff signed",
      description: "FINAL_LAUNCH_SIGNOFF.md must be signed with operator name and date.",
      status: "manual",
      evidence: "FINAL_LAUNCH_SIGNOFF.md signed — operator name + date visible",
    }),

    // Migration
    chk({
      id: "project-profile", category: "migration",
      label: "Project Migration Profile generated",
      description: "Project profile must identify framework, env requirements, and deploy target.",
      status: "manual",
      evidence: "Project Profile visible on Migration or Settings page",
    }),
    chk({
      id: "client-migration-plan", category: "migration",
      label: "Client Migration Plan exported",
      description: "CLIENT_MIGRATION_PLAN.md exported from Migration page.",
      status: "manual",
      evidence: "CLIENT_MIGRATION_PLAN.md in handoff exports",
    }),
    chk({
      id: "source-intake", category: "migration",
      label: "Source Intake complete",
      description: "Source intake panel must have been completed and exported.",
      status: "manual",
      evidence: "Source intake panel completed on Migration page",
    }),

    // Staging
    chk({
      id: "staging-deployment", category: "staging",
      label: "Staging deployment proof exists",
      description: "At least one successful deployment must be recorded.",
      status: hasDeployment ? "pass" : "warning",
      evidence: hasDeployment ? "Successful deployment in deployment history" : undefined,
      nextStep: hasDeployment ? undefined : "Complete a staging deployment before cutover",
    }),
    chk({
      id: "trial-migration", category: "staging",
      label: isSardar ? "Trial migration completed on staging" : "Staging import verified",
      description: isSardar
        ? "Full trial migration must have run on the staging environment."
        : "Staging import verified before production cutover.",
      required: isSardar,
      status: "manual",
      evidence: isSardar ? "TRIAL_MIGRATION_REPORT.md exported" : undefined,
    }),

    // Ecommerce (Sardar only)
    chk({
      id: "ecommerce-test", category: "ecommerce",
      label: "Ecommerce test harness completed",
      description: isSardar
        ? "Stripe test checkout and webhook delivery must be confirmed."
        : "Not applicable — no ecommerce integration.",
      required: isSardar,
      status: isSardar ? (hasStripe && hasStripeWH ? "manual" : "warning") : "not_applicable",
      evidence: isSardar ? "ECOMMERCE_TEST_REPORT.md with Stripe test order ID" : undefined,
      nextStep: isSardar && !hasStripe
        ? "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars"
        : undefined,
    }),
    chk({
      id: "stripe-keys", category: "security",
      label: "Stripe env vars configured (names only)",
      description: isSardar
        ? "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set."
        : "Not applicable.",
      required: isSardar,
      status: isSardar
        ? (hasStripe && hasStripeWH ? "pass" : "blocked")
        : "not_applicable",
      nextStep: isSardar && !(hasStripe && hasStripeWH)
        ? "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in production env vars"
        : undefined,
    }),

    // Routing
    chk({
      id: "domain-configured", category: "routing",
      label: "Production domain configured",
      description: "A primary domain must be configured for the project.",
      status: hostname ? "pass" : "blocked",
      evidence: hostname ? `Domain: ${hostname}` : undefined,
      nextStep: hostname ? undefined : "Add a domain on the Domains page",
    }),
    chk({
      id: "ssl-active", category: "routing",
      label: "SSL certificate active on primary domain",
      description: "SSL must be ACTIVE before production cutover.",
      status: sslActive ? "pass" : (hostname ? "warning" : "blocked"),
      evidence: sslActive ? `SSL ACTIVE on ${hostname}` : undefined,
      nextStep: !sslActive ? "Check SSL status on the Domains page" : undefined,
    }),
    chk({
      id: "production-execution-guard", category: "routing",
      label: "Production Execution Guard configured",
      description: "Production route apply must be gated with a confirmation phrase.",
      status: "manual",
      evidence: "Production Execution Guard panel visible on Releases page",
    }),

    // Monitoring
    chk({
      id: "health-endpoint", category: "monitoring",
      label: "Health endpoint configured",
      description: "At least one service must have a health check path configured.",
      status: hasHealth ? "pass" : "warning",
      evidence: hasHealth ? "Health path configured on a project service" : undefined,
      nextStep: hasHealth ? undefined : "Configure health check path on a project service",
    }),
    chk({
      id: "post-cutover-monitoring", category: "monitoring",
      label: "Post-Cutover Monitoring panel ready",
      description: "Post-cutover monitoring must be set up and exportable.",
      status: "manual",
      evidence: "POST_CUTOVER_MONITORING_REPORT.md exported from Monitoring page",
    }),

    // Logs
    chk({
      id: "log-visibility", category: "logs",
      label: "Log sources visible on Logs page",
      description: "PM2 and nginx logs must be discoverable from the Logs page.",
      status: "manual",
      evidence: "Logs page shows process log sources",
    }),

    // Backups
    chk({
      id: "backup-readiness", category: "backups",
      label: "Backup taken and restore drill completed",
      description: "A backup must be available and a restore drill must have been completed on staging.",
      status: "manual",
      evidence: "Backup and restore drill confirmed on Backups page",
    }),

    // Security
    chk({
      id: "db-env-var", category: "security",
      label: "Database connection env var present (name only)",
      description: "DATABASE_URL or equivalent must be set in production env vars.",
      status: hasDb ? "pass" : "blocked",
      nextStep: hasDb ? undefined : "Set DATABASE_URL in production env vars",
    }),
    chk({
      id: "auth-secret", category: "security",
      label: "Auth secret env var present (name only)",
      description: "AUTH_SECRET or NEXTAUTH_SECRET must be set in production.",
      status: hasAuth ? "pass" : (hasEnvVars ? "warning" : "blocked"),
      nextStep: hasAuth ? undefined : "Set AUTH_SECRET or NEXTAUTH_SECRET in production env vars",
    }),

    // Team
    chk({
      id: "owner-assigned", category: "team",
      label: "Project owner assigned",
      description: "At least one project member with owner role must be assigned.",
      status: hasOwner ? "pass" : "blocked",
      nextStep: hasOwner ? undefined : "Assign an owner on the Team page",
    }),
    chk({
      id: "admin-assigned", category: "team",
      label: "Admin or owner assigned",
      description: "At least one admin or owner must be available for launch day.",
      status: hasAdmin ? "pass" : "warning",
      nextStep: hasAdmin ? undefined : "Assign an admin on the Team page",
    }),

    // Documentation
    chk({
      id: "operator-training", category: "training",
      label: "Operator Training Pack generated and distributed",
      description: "OPERATOR_TRAINING_PACK.md must be generated and delivered to the operator.",
      status: "manual",
      evidence: "OPERATOR_TRAINING_PACK.md exported from Runbook or Releases page",
    }),
    chk({
      id: "operator-runbook", category: "documentation",
      label: "Operator Runbook generated and exported",
      description: "The operator runbook must be complete and exportable from the Runbook page.",
      status: "manual",
      evidence: "Operator Runbook exported from Runbook page",
    }),
    chk({
      id: "handoff-export", category: "documentation",
      label: "Full handoff export complete",
      description: "HANDOFF_EXPORT.md must include all sprint sections through Sprint 76.",
      status: "manual",
      evidence: "HANDOFF_EXPORT.md exported from Migration page",
    }),

    // Launch day
    chk({
      id: "cutover-rehearsal", category: "launch_day",
      label: "Cutover Rehearsal completed",
      description: "FINAL_CUTOVER_REHEARSAL.md must be generated and reviewed.",
      status: "manual",
      evidence: "FINAL_CUTOVER_REHEARSAL.md exported from Releases page",
    }),
    chk({
      id: "launch-freeze", category: "launch_day",
      label: "Launch Freeze active",
      description: "LAUNCH_FREEZE_CHECKLIST.md must be generated and freeze acknowledged.",
      status: "manual",
      evidence: "LAUNCH_FREEZE_CHECKLIST.md exported from Releases page",
    }),
    chk({
      id: "launch-day-support", category: "launch_day",
      label: "Launch-Day Support Report generated",
      description: "LAUNCH_DAY_SUPPORT_REPORT.md must be generated and operator checklist reviewed.",
      status: "manual",
      evidence: "LAUNCH_DAY_SUPPORT_REPORT.md exported from Releases or Monitoring page",
    }),

    // Post-launch
    chk({
      id: "post-launch-bug-capture", category: "post_launch",
      label: "Post-Launch Bug Capture report generated",
      description: "POST_LAUNCH_BUG_CAPTURE.md must be generated for post-launch triage readiness.",
      status: "manual",
      evidence: "POST_LAUNCH_BUG_CAPTURE.md exported from Logs or Operations page",
    }),
  ];

  // ── Known issues register ───────────────────────────────────────────────────

  const knownIssues: FinalKnownIssue[] = [
    {
      id: "ki-ssl",
      severity: sslActive ? "low" : "high",
      category: "routing",
      title: sslActive ? "SSL confirmed active" : "SSL not yet ACTIVE on primary domain",
      description: sslActive
        ? "SSL is active on the primary domain."
        : "SSL must be ACTIVE before production cutover. Non-HTTPS traffic will not be acceptable.",
      evidenceToCheck: [`Check domain SSL status on the Domains page for ${hostname || "the project domain"}`],
      recommendedAction: sslActive
        ? "No action needed."
        : "Provision SSL via the Domains page or ensure DNS is correctly pointed.",
      blocksLaunch: !sslActive && !!hostname,
    },
    {
      id: "ki-db-env",
      severity: hasDb ? "low" : "critical",
      category: "security",
      title: hasDb ? "Database env var confirmed" : "Database env var missing",
      description: hasDb
        ? "DATABASE_URL or equivalent is set in env vars."
        : "DATABASE_URL is not set. The application will fail to connect to the database on launch.",
      evidenceToCheck: ["Check env vars on the Settings or Env page (names only, no values)"],
      recommendedAction: hasDb
        ? "No action needed."
        : "Set DATABASE_URL in production env vars immediately.",
      blocksLaunch: !hasDb,
    },
    ...(isSardar
      ? [
          {
            id: "ki-stripe-env",
            severity: (hasStripe && hasStripeWH ? "low" : "critical") as FinalKnownIssue["severity"],
            category: "ecommerce" as const,
            title: (hasStripe && hasStripeWH)
              ? "Stripe env vars confirmed"
              : "Stripe env vars missing",
            description: (hasStripe && hasStripeWH)
              ? "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set."
              : "Stripe env vars are not set. Checkout will fail on launch.",
            evidenceToCheck: ["Check env vars on the Settings or Env page (names only)"],
            recommendedAction: (hasStripe && hasStripeWH)
              ? "No action needed."
              : "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in production env vars.",
            blocksLaunch: !(hasStripe && hasStripeWH),
          },
        ]
      : []),
    {
      id: "ki-team",
      severity: hasOwner ? "low" : "high",
      category: "team",
      title: hasOwner ? "Project owner assigned" : "No project owner assigned",
      description: hasOwner
        ? "A project owner is assigned."
        : "No owner is assigned to this project. Launch-day decisions require an owner.",
      evidenceToCheck: ["Check the Team page"],
      recommendedAction: hasOwner ? "No action needed." : "Assign an owner on the Team page.",
      blocksLaunch: !hasOwner,
    },
    {
      id: "ki-manual-steps",
      severity: "medium",
      category: "launch_day",
      title: "Multiple manual launch-day steps require operator attention",
      description:
        "The launch-day checklist has items that require manual operator verification before and during cutover. None of these can be automated from the panel.",
      evidenceToCheck: [
        "Review LAUNCH_DAY_SUPPORT_REPORT.md operator checklist",
        "Review FINAL_CUTOVER_REHEARSAL.md go/no-go questions",
      ],
      recommendedAction: "Run through the operator checklist in LAUNCH_DAY_SUPPORT_REPORT.md on launch day.",
      blocksLaunch: false,
    },
  ];

  // ── Score + status ──────────────────────────────────────────────────────────

  const requiredChecks = checks.filter((c) => c.required);
  const passedRequired = requiredChecks.filter(
    (c) => c.status === "pass" || c.status === "manual",
  );
  const blockedChecks  = requiredChecks.filter((c) => c.status === "blocked");
  const warnChecks     = requiredChecks.filter((c) => c.status === "warning");

  const score = requiredChecks.length > 0
    ? Math.round((passedRequired.length / requiredChecks.length) * 100)
    : 100;

  const launchBlockers = knownIssues.filter((ki) => ki.blocksLaunch);

  const blockers: string[] = [
    ...blockedChecks.map((c) => `${c.label}${c.nextStep ? ` — ${c.nextStep}` : ""}`),
    ...launchBlockers.map((ki) => `${ki.title} — ${ki.recommendedAction}`),
  ];

  const warnings: string[] = [
    ...warnChecks.map((c) => `Review: ${c.label}${c.nextStep ? ` — ${c.nextStep}` : ""}`),
  ];

  let status: FinalReadinessStatus;
  if (blockers.length > 0)   status = "blocked";
  else if (warnings.length > 0) status = "needs_fixes";
  else if (score === 100)    status = "ready_to_execute";
  else                       status = "needs_fixes";

  const recommendation =
    status === "blocked"
      ? `BLOCKED — ${blockers.length} critical issue${blockers.length > 1 ? "s" : ""} must be resolved before launch. Do not proceed to production cutover.`
      : status === "needs_fixes"
      ? `NEEDS FIXES — ${warnings.length} item${warnings.length > 1 ? "s" : ""} require attention. Resolve before cutover or accept risk with documented justification.`
      : `READY TO EXECUTE — All required checks are confirmed. Proceed to launch-day execution with the operator checklist and cutover rehearsal.`;

  const readyEvidence = checks
    .filter((c) => c.status === "pass" && c.evidence)
    .map((c) => c.evidence as string);

  const recommendedNextSteps = blockers.length > 0
    ? [
        "Resolve all blocked items listed above before proceeding.",
        "Re-generate this report after fixes to confirm readiness.",
        "Do not schedule production cutover until this report shows READY TO EXECUTE.",
      ]
    : [
        "Export FINAL_READINESS_AUDIT.md for handover documentation.",
        "Run the Stop-Build Gate report.",
        "Review LAUNCH_DAY_SUPPORT_REPORT.md operator checklist.",
        "Confirm rollback owner is available on launch day.",
        "Execute cutover manually when all checks pass.",
      ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score,
    checks,
    knownIssues,
    blockers,
    warnings,
    readyEvidence,
    finalRecommendation: recommendation,
    recommendedNextSteps,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function emptyAudit(
  projectId: string,
  status: FinalReadinessStatus,
  blockers: string[],
): FinalReadinessAudit {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score: 0,
    checks: [],
    knownIssues: [],
    blockers,
    warnings: [],
    readyEvidence: [],
    finalRecommendation: "Project not found.",
    recommendedNextSteps: [],
  };
}
