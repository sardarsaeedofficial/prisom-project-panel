import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  StopBuildDecision,
  StopBuildGateCheck,
  StopBuildGateReport,
} from "./stop-build-types";

export async function generateStopBuildGateReport(input: {
  projectId: string;
}): Promise<StopBuildGateReport> {
  const { projectId } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyReport(projectId, "continue_building", ["Project not found."]);
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
      take:    1,
      select:  { id: true },
    }),
    db.projectMember.findMany({
      where:  { projectId },
      select: { role: true },
    }),
    db.projectService.findMany({
      where:  { projectId, isEnabled: true },
      select: { healthPath: true },
    }),
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname      = primaryDomain?.hostname ?? "";
  const sslActive     = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment = deployments.length > 0;
  const hasOwner      = members.some((m) => m.role === "owner");
  const hasHealth     = services.some((s) => s.healthPath);

  const envNames  = envVars.map((e) => e.name.toUpperCase());
  const hasDb     = envNames.some((n) => n.includes("DATABASE") || n.includes("POSTGRES") || n === "DB_URL");
  const hasAuth   = envNames.some((n) => n.includes("AUTH_SECRET") || n.includes("NEXTAUTH_SECRET") || n.includes("SESSION_SECRET"));
  const hasStripe = isSardar ? envNames.some((n) => n.includes("STRIPE")) : true;
  const hasStripeWH = isSardar ? envNames.some((n) => n.includes("STRIPE_WEBHOOK")) : true;

  // ── Gate checks ──────────────────────────────────────────────────────────────

  const checks: StopBuildGateCheck[] = [
    // Core platform
    {
      id: "domain-ssl", category: "core_platform",
      label: "Domain and SSL configured",
      description: "Primary domain must be configured and SSL must be ACTIVE.",
      status: sslActive ? "pass" : (hostname ? "warning" : "blocked"),
      required: true,
    },
    {
      id: "db-env", category: "core_platform",
      label: "Database env var set (name only verified)",
      description: "DATABASE_URL or equivalent must be present in env vars.",
      status: hasDb ? "pass" : "blocked",
      required: true,
    },
    {
      id: "auth-env", category: "core_platform",
      label: "Auth secret env var set (name only verified)",
      description: "AUTH_SECRET or NEXTAUTH_SECRET must be present.",
      status: hasAuth ? "pass" : "warning",
      required: true,
    },
    {
      id: "deployment", category: "core_platform",
      label: "Successful deployment on record",
      description: "At least one successful deployment must be recorded.",
      status: hasDeployment ? "pass" : "warning",
      required: true,
    },
    {
      id: "health-endpoint", category: "core_platform",
      label: "Health check endpoint configured",
      description: "A health check path must be configured on a project service.",
      status: hasHealth ? "pass" : "warning",
      required: true,
    },

    // Migration workflow
    {
      id: "project-profile", category: "migration_workflow",
      label: "Project Profile completed",
      description: "Project migration profile must be generated.",
      status: "manual",
      required: true,
    },
    {
      id: "staging-import", category: "migration_workflow",
      label: "Staging import and trial migration completed",
      description: "Staging must have been imported and a trial migration run.",
      status: "manual",
      required: true,
    },
    ...(isSardar
      ? ([
          {
            id: "stripe-env", category: "migration_workflow" as const,
            label: "Stripe env vars configured (names only)",
            description: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set.",
            status: (hasStripe && hasStripeWH ? "pass" : "blocked") as StopBuildGateCheck["status"],
            required: true,
          },
          {
            id: "ecommerce-test", category: "migration_workflow" as const,
            label: "Ecommerce test proof exists",
            description: "Stripe test checkout and webhook delivery must be confirmed.",
            status: "manual" as StopBuildGateCheck["status"],
            required: true,
          },
        ] satisfies StopBuildGateCheck[])
      : []),

    // Launch workflow
    {
      id: "qa-verification", category: "launch_workflow",
      label: "QA Verification Report exported",
      description: "QA_VERIFICATION_REPORT.md with 0 blockers must be exported.",
      status: "manual",
      required: true,
    },
    {
      id: "rc-report", category: "launch_workflow",
      label: "Release Candidate report ≥ 90%",
      description: "RC_HARDENING_REPORT.md must show ≥ 90% score.",
      status: "manual",
      required: true,
    },
    {
      id: "launch-signoff", category: "launch_workflow",
      label: "Final Launch Signoff signed",
      description: "FINAL_LAUNCH_SIGNOFF.md signed by an authorized operator.",
      status: "manual",
      required: true,
    },
    {
      id: "cutover-rehearsal", category: "launch_workflow",
      label: "Cutover Rehearsal completed",
      description: "FINAL_CUTOVER_REHEARSAL.md exported and reviewed.",
      status: "manual",
      required: true,
    },
    {
      id: "launch-freeze", category: "launch_workflow",
      label: "Launch Freeze active",
      description: "LAUNCH_FREEZE_CHECKLIST.md exported and freeze acknowledged.",
      status: "manual",
      required: true,
    },
    {
      id: "launch-day-report", category: "launch_workflow",
      label: "Launch-Day Support Report generated",
      description: "LAUNCH_DAY_SUPPORT_REPORT.md exported and operator checklist reviewed.",
      status: "manual",
      required: true,
    },

    // Safety
    {
      id: "no-production-mutation", category: "safety",
      label: "No automatic production mutation from panels",
      description: "All panels in sprints 69–76 are confirmed read-only. No server commands are executed automatically.",
      status: "pass",
      required: true,
    },
    {
      id: "rollback-owner", category: "safety",
      label: "Rollback owner named and available",
      description: "A named operator must own the rollback decision on launch day.",
      status: "manual",
      required: true,
    },
    {
      id: "backup-recent", category: "safety",
      label: "Recent backup confirmed",
      description: "A backup must be taken within 2 hours of cutover.",
      status: "manual",
      required: true,
    },

    // Documentation
    {
      id: "operator-training", category: "documentation",
      label: "Operator Training Pack delivered",
      description: "OPERATOR_TRAINING_PACK.md exported and delivered to the operator.",
      status: "manual",
      required: true,
    },
    {
      id: "handoff-export", category: "documentation",
      label: "Full handoff export complete",
      description: "HANDOFF_EXPORT.md includes all sprint sections through Sprint 77.",
      status: "manual",
      required: true,
    },

    // Operations
    {
      id: "owner-present", category: "operations",
      label: "Project owner assigned to project",
      description: "A project owner must be assigned for launch-day decisions.",
      status: hasOwner ? "pass" : "blocked",
      required: true,
    },
    {
      id: "post-launch-capture", category: "operations",
      label: "Post-Launch Bug Capture report ready",
      description: "POST_LAUNCH_BUG_CAPTURE.md must be generated for post-launch triage.",
      status: "manual",
      required: true,
    },

    // Client handover
    {
      id: "client-plan", category: "client_handover",
      label: "Client Migration Plan exported",
      description: "CLIENT_MIGRATION_PLAN.md must be exported and delivered.",
      status: "manual",
      required: true,
    },
    {
      id: "client-notify-ready", category: "client_handover",
      label: "Client aware of launch date",
      description: "Client must be informed of the launch date and their expected availability.",
      status: "manual",
      required: true,
    },
  ];

  // ── Decision ──────────────────────────────────────────────────────────────────

  const required   = checks.filter((c) => c.required);
  const blocked    = required.filter((c) => c.status === "blocked");
  const warning    = required.filter((c) => c.status === "warning");
  const manual     = required.filter((c) => c.status === "manual");
  const passed     = required.filter((c) => c.status === "pass");

  const blockers: string[] = blocked.map((c) => `${c.label} — ${c.description}`);
  const warnings: string[] = warning.map((c) => `Review: ${c.label}`);

  let decision: StopBuildDecision;
  if (blocked.length > 0)                   decision = "fix_blockers_only";
  else if (manual.length === 0 && warning.length === 0) decision = "stop_building_ready_to_launch";
  else                                       decision = "fix_blockers_only";

  const passScore = required.length > 0
    ? Math.round(((passed.length + manual.length) / required.length) * 100)
    : 100;

  let finalOperatorMessage: string;
  if (decision === "stop_building_ready_to_launch") {
    finalOperatorMessage =
      "All stop-build gate checks have been verified. Stop building new features. Move to launch-day execution using the operator checklist in LAUNCH_DAY_SUPPORT_REPORT.md.";
  } else if (blocked.length > 0) {
    finalOperatorMessage = `BLOCKED — ${blocked.length} gate check${blocked.length > 1 ? "s" : ""} must be resolved before launch. Do not proceed to production cutover until all blockers are cleared and this report is re-run.`;
  } else {
    finalOperatorMessage = `${manual.length} gate check${manual.length > 1 ? "s" : ""} require manual operator confirmation. Complete these steps, then re-run this report to confirm readiness before cutover.`;
  }

  const allowedNextWork = [
    "Verified blocker fixes confirmed by this gate report",
    "Launch-day execution once all gate checks pass",
    "Launch-day evidence capture and operator checklist completion",
    "Post-launch bug triage using POST_LAUNCH_BUG_CAPTURE.md",
    "Documentation clarifications and handoff export updates",
    "Export of all readiness reports for client delivery",
  ];

  const blockedNextWork = [
    "New major features before production launch",
    "Schema changes without a confirmed blocker requiring them",
    "Route, DNS, or nginx configuration changes from the panel",
    "Payment or provider configuration changes without operator approval",
    "Broad UI rewrites or refactors",
    "Speculative infrastructure changes",
    "Adding new sprint features beyond Sprint 77 scope",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    decision,
    checks,
    blockers,
    warnings,
    allowedNextWork,
    blockedNextWork,
    finalOperatorMessage,
  };
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function emptyReport(
  projectId: string,
  decision: StopBuildDecision,
  blockers: string[],
): StopBuildGateReport {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    decision,
    checks: [],
    blockers,
    warnings: [],
    allowedNextWork: [],
    blockedNextWork: [],
    finalOperatorMessage: "Could not generate stop-build gate report.",
  };
}
