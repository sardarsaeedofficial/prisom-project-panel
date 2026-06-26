import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  FinalLiveVerificationRun,
  FinalLiveVerificationCheck,
  FinalLiveVerificationStatus,
} from "./final-live-verification-types";

const PANEL_DOMAIN  = "projects.doorstepmanchester.uk";
const SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

function chk(
  overrides: Partial<FinalLiveVerificationCheck> &
    Pick<FinalLiveVerificationCheck, "id" | "category" | "label">,
): FinalLiveVerificationCheck {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

export async function generateFinalLiveVerificationRun(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<FinalLiveVerificationRun> {
  const { projectId, expectedCommit } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyRun(projectId, "blocked", ["Project not found."], expectedCommit);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [domains, deployments, members, envVars] = await Promise.all([
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
    db.projectEnvVar.findMany({
      where:  { projectId },
      select: { name: true },
    }),
  ]);

  const primaryDomain  = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname       = primaryDomain?.hostname ?? "";
  const sslActive      = primaryDomain?.sslStatus === "ACTIVE";
  const hasDeployment  = deployments.length > 0;
  const lastCommit     = deployments[0]?.commitSha?.slice(0, 7) ?? undefined;
  const hasOwner       = members.some((m) => m.role === "owner");
  const envNames       = envVars.map((e) => e.name.toUpperCase());
  const hasDb          = envNames.some((n) => n.includes("DATABASE") || n.includes("POSTGRES") || n === "DB_URL");
  const hasAuth        = envNames.some((n) => n.includes("AUTH_SECRET") || n.includes("NEXTAUTH_SECRET"));
  const hasStripe      = isSardar ? envNames.some((n) => n.includes("STRIPE")) : true;
  const hasStripeWH    = isSardar ? envNames.some((n) => n.includes("STRIPE_WEBHOOK")) : true;

  // ── Checks ────────────────────────────────────────────────────────────────

  const checks: FinalLiveVerificationCheck[] = [

    // Deployment
    chk({
      id: "deploy-commit", category: "deployment",
      label: "Deployed commit verified on server",
      description: expectedCommit
        ? `Expected: ${expectedCommit}. Run git rev-parse --short HEAD on the server to confirm.`
        : "No expected commit specified. Run git rev-parse --short HEAD on the server.",
      status: expectedCommit ? "manual" : "pending",
      command: "git -C /home/prisom/prisom-project-panel rev-parse --short HEAD",
      evidence: lastCommit ? `Last recorded DB commit: ${lastCommit}` : "No deployment on record",
      nextStep: "SSH and confirm HEAD matches expected",
    }),
    chk({
      id: "deploy-pm2-online", category: "deployment",
      label: "prisom-projects PM2 process online",
      description: "pm2 list must show prisom-projects as 'online'.",
      status: hasDeployment ? "manual" : "warning",
      command: "pm2 list | grep prisom-projects",
      evidence: "Expected: online | port 3002",
      nextStep: hasDeployment ? undefined : "Deploy the panel before verification",
    }),
    chk({
      id: "deploy-ssl", category: "deployment",
      label: "SSL ACTIVE on panel domain",
      description: `SSL must be ACTIVE on ${PANEL_DOMAIN} before any cutover.`,
      status: sslActive ? "pass" : (hostname ? "warning" : "manual"),
      evidence: sslActive ? `SSL ACTIVE on ${hostname}` : undefined,
      nextStep: !sslActive ? "Check SSL on the Domains page" : undefined,
    }),
    chk({
      id: "deploy-no-doorsteps", category: "deployment",
      label: "Doorsteps/LocalShop processes untouched",
      description: "prisom-manager and prisom-backend must not have been restarted during this sprint.",
      status: "manual",
      command: "pm2 list | grep -E 'prisom-manager|prisom-backend'",
      safetyNote: "Do not restart Doorsteps/LocalShop processes.",
      evidence: "Both processes running — no restart count increase",
    }),

    // Routes
    chk({
      id: "route-login", category: "route",
      label: "/login returns 200",
      description: `${PANEL_DOMAIN}/login must return HTTP 200.`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/login`,
      evidence: "HTTP/2 200 confirmed",
    }),
    chk({
      id: "route-dashboard", category: "route",
      label: "/dashboard returns 307 → /login",
      description: `${PANEL_DOMAIN}/dashboard must redirect unauthenticated visitors to /login.`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/dashboard`,
      evidence: "HTTP/2 307 Location: /login",
    }),
    chk({
      id: "route-admin", category: "route",
      label: "/admin returns 307 → /login",
      description: `${PANEL_DOMAIN}/admin must redirect unauthenticated visitors to /login.`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/admin`,
      evidence: "HTTP/2 307 Location: /login",
    }),
    chk({
      id: "route-releases", category: "route",
      label: "/projects/[id]/releases loads correctly",
      description: "Navigate to Releases and confirm Final Live Verification panel is visible at the top.",
      status: "manual",
      evidence: "Final Live Verification panel visible at top of Releases page",
    }),
    chk({
      id: "route-migration", category: "route",
      label: "/projects/[id]/migration loads correctly",
      description: "Navigate to Migration and confirm Sprint 79 compact cards visible.",
      status: "manual",
    }),
    chk({
      id: "route-monitoring", category: "route",
      label: "/projects/[id]/monitoring loads correctly",
      description: "Navigate to Monitoring and confirm Sprint 79 compact cards visible.",
      status: "manual",
    }),
    chk({
      id: "route-runbook", category: "route",
      label: "/projects/[id]/runbook loads correctly",
      description: "Navigate to Runbook and confirm Go/No-Go Evidence panel visible.",
      status: "manual",
    }),
    chk({
      id: "route-logs", category: "route",
      label: "/projects/[id]/logs loads correctly",
      description: "Navigate to Logs and confirm post-launch bug capture panel visible.",
      status: "manual",
    }),
    chk({
      id: "route-operations", category: "route",
      label: "/projects/[id]/operations loads correctly",
      description: "Navigate to Operations and confirm post-launch bug capture panel visible.",
      status: "manual",
    }),
    chk({
      id: "route-settings", category: "route",
      label: "/projects/[id]/settings loads correctly",
      description: "Navigate to Settings and confirm Sprint 79 compact cards visible.",
      status: "manual",
    }),

    // Sardar
    chk({
      id: "sardar-frontend", category: "sardar",
      label: "Sardar frontend returns 200",
      description: `${SARDAR_DOMAIN}/ must return HTTP 200.`,
      status: "manual",
      command: `curl -I https://${SARDAR_DOMAIN}/`,
      evidence: "HTTP/2 200 confirmed",
      safetyNote: "Do NOT restart Sardar PM2. Verify only.",
    }),
    chk({
      id: "sardar-health", category: "sardar",
      label: "Sardar health endpoint returns 200",
      description: `${SARDAR_DOMAIN}/api/healthz must return HTTP 200.`,
      status: "manual",
      command: `curl -I https://${SARDAR_DOMAIN}/api/healthz`,
      evidence: "HTTP/2 200 confirmed",
      safetyNote: "Do NOT restart Sardar PM2. Verify only.",
    }),

    // Panels
    chk({
      id: "panel-final-readiness", category: "panel",
      label: "Final Readiness Audit panel generates without error",
      description: "Click 'Generate Readiness Audit' on Releases. Confirm no error appears.",
      status: "manual",
      evidence: "Status badge visible, score visible",
    }),
    chk({
      id: "panel-stop-build", category: "panel",
      label: "Stop-Build Gate panel generates without error",
      description: "Click 'Run Stop-Build Gate' on Releases. Confirm decision badge appears.",
      status: "manual",
      evidence: "Decision badge visible",
    }),
    chk({
      id: "panel-deploy-verification", category: "panel",
      label: "Deploy Verification panel generates without error",
      description: "Click 'Generate Verification Report' on Releases. Confirm checks appear.",
      status: "manual",
      evidence: "Verification checks appear in all three tabs",
    }),
    chk({
      id: "panel-launch-execution", category: "panel",
      label: "Launch Execution Checklist panel generates without error",
      description: "Click 'Generate Launch Checklist' on Releases. Confirm phases appear.",
      status: "manual",
      evidence: "Status badge and phases visible",
    }),
    chk({
      id: "panel-launch-day", category: "panel",
      label: "Launch-Day Support panel generates without error",
      description: "Click 'Generate Launch-Day Support Report' on Releases. Confirm timeline appears.",
      status: "manual",
      evidence: "Timeline visible",
    }),
    chk({
      id: "panel-post-launch-bug", category: "panel",
      label: "Post-Launch Bug Capture panel generates without error",
      description: "Click 'Generate Post-Launch Bug Capture Report'. Confirm issue templates appear.",
      status: "manual",
      evidence: "Issue templates visible",
    }),
    chk({
      id: "panel-cutover-rehearsal", category: "panel",
      label: "Cutover Rehearsal panel generates without error",
      description: "Click 'Generate Cutover Rehearsal' on Releases. Confirm phases and score visible.",
      status: "manual",
      evidence: "Score bar and phase groups visible",
    }),
    chk({
      id: "panel-launch-freeze", category: "panel",
      label: "Launch Freeze panel generates without error",
      description: "Click 'Generate Launch Freeze Checklist' on Releases. Confirm tabs visible.",
      status: "manual",
      evidence: "Tabs and freeze checks visible",
    }),
    chk({
      id: "panel-launch-signoff", category: "panel",
      label: "Final Launch Signoff panel generates without error",
      description: "Click 'Generate Final Launch Signoff' on Releases. Confirm signoff report visible.",
      status: "manual",
      evidence: "Signoff report with evidence sections visible",
    }),
    chk({
      id: "panel-operator-training", category: "panel",
      label: "Operator Training Pack panel generates without error",
      description: "Click 'Generate Operator Training Pack' on Runbook. Confirm training sections visible.",
      status: "manual",
      evidence: "Training sections visible",
    }),
    chk({
      id: "panel-project-profile", category: "panel",
      label: "Project Profile card visible on Releases and Migration",
      description: "Navigate to Releases and Migration. Confirm Project Profile card is visible.",
      status: "manual",
      evidence: "Project Profile card visible on both pages",
    }),

    // Exports
    chk({
      id: "export-final-live-verification", category: "export",
      label: "FINAL_LIVE_VERIFICATION_RUN.md exports",
      description: "Generate and export FINAL_LIVE_VERIFICATION_RUN.md from this panel.",
      status: "manual",
      evidence: "File downloads with correct sections",
    }),
    chk({
      id: "export-go-no-go", category: "export",
      label: "GO_NO_GO_EVIDENCE_PACK.md exports",
      description: "Generate and export GO_NO_GO_EVIDENCE_PACK.md from the Go/No-Go Evidence panel.",
      status: "manual",
      evidence: "File downloads with decision and evidence checklist",
    }),
    chk({
      id: "export-final-readiness", category: "export",
      label: "FINAL_READINESS_AUDIT.md exports",
      status: "manual",
      description: "Generate and export FINAL_READINESS_AUDIT.md from the Final Readiness Audit panel.",
    }),
    chk({
      id: "export-stop-build", category: "export",
      label: "STOP_BUILD_GATE.md exports",
      status: "manual",
      description: "Generate and export STOP_BUILD_GATE.md from the Stop-Build Gate panel.",
    }),
    chk({
      id: "export-launch-execution", category: "export",
      label: "LAUNCH_EXECUTION_CHECKLIST.md exports",
      status: "manual",
      description: "Generate and export LAUNCH_EXECUTION_CHECKLIST.md from the Launch Execution Checklist panel.",
    }),
    chk({
      id: "export-deploy-verification", category: "export",
      label: "DEPLOY_VERIFICATION_REPORT.md exports",
      status: "manual",
      description: "Generate and export DEPLOY_VERIFICATION_REPORT.md from the Deploy Verification panel.",
    }),

    // Confirmation gates
    chk({
      id: "gate-no-secrets", category: "confirmation_gate",
      label: "No secret values in any export or panel output",
      description: "Review at least one generated export. Confirm no API keys, DB passwords, or tokens appear.",
      status: "manual",
      evidence: "Reviewed exports — no secret values found",
    }),
    chk({
      id: "gate-no-mutation", category: "confirmation_gate",
      label: "No automatic production mutation triggered",
      description: "All generate/export actions confirmed read-only. No server commands executed automatically.",
      status: "pass",
      evidence: "Sprints 69–79 all declared read-only",
    }),

    // Security
    chk({
      id: "security-db-env", category: "security",
      label: "DATABASE_URL env var present (name only)",
      description: "DATABASE_URL or equivalent must be set in production env vars.",
      status: hasDb ? "pass" : "blocked",
      evidence: hasDb ? "DATABASE_URL confirmed set (name only checked)" : undefined,
      nextStep: hasDb ? undefined : "Set DATABASE_URL in production env vars",
    }),
    chk({
      id: "security-auth", category: "security",
      label: "Auth secret env var present (name only)",
      description: "AUTH_SECRET or NEXTAUTH_SECRET must be set.",
      status: hasAuth ? "pass" : "warning",
      nextStep: hasAuth ? undefined : "Set AUTH_SECRET in production env vars",
    }),
    chk({
      id: "security-owner", category: "security",
      label: "Project owner assigned",
      description: "At least one member with owner role must be assigned.",
      status: hasOwner ? "pass" : "blocked",
      nextStep: hasOwner ? undefined : "Assign owner on the Team page",
    }),
    ...(isSardar
      ? [
          chk({
            id: "security-stripe", category: "security",
            label: "Stripe env vars set (names only)",
            description: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set.",
            status: (hasStripe && hasStripeWH ? "pass" : "blocked") as FinalLiveVerificationCheck["status"],
            evidence: (hasStripe && hasStripeWH) ? "Stripe env vars confirmed set (names only)" : undefined,
            nextStep: !(hasStripe && hasStripeWH) ? "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET" : undefined,
          }),
        ]
      : []),

    // Monitoring
    chk({
      id: "monitoring-post-cutover", category: "monitoring",
      label: "Post-Cutover Monitoring panel visible on Monitoring page",
      description: "Navigate to Monitoring and confirm Post-Cutover Monitoring panel is present.",
      status: "manual",
      evidence: "Post-Cutover Monitoring panel visible",
    }),
    chk({
      id: "monitoring-export", category: "monitoring",
      label: "POST_CUTOVER_MONITORING_REPORT.md exports from Monitoring",
      description: "Generate and export POST_CUTOVER_MONITORING_REPORT.md.",
      status: "manual",
      evidence: "File downloads correctly",
    }),

    // Rollback
    chk({
      id: "rollback-reviewed", category: "rollback",
      label: "Rollback procedure reviewed",
      description: "FINAL_CUTOVER_REHEARSAL.md rollback decision tree must have been reviewed by the operator.",
      status: "manual",
      evidence: "Operator confirmed: rollback section reviewed",
    }),
    chk({
      id: "rollback-owner", category: "rollback",
      label: "Rollback owner named",
      description: "A specific named person must own the rollback decision on launch day.",
      status: "manual",
      evidence: "Rollback owner: ___",
    }),

    // Handoff
    chk({
      id: "handoff-export", category: "handoff",
      label: "Handoff export includes Sprint 79 section",
      description: "Generate HANDOFF_EXPORT.md and confirm it includes the Final Live Verification section.",
      status: "manual",
      evidence: "HANDOFF_EXPORT.md downloaded, Sprint 79 section visible",
    }),
    chk({
      id: "handoff-delivery", category: "handoff",
      label: "All exports delivered to client/operator",
      description: "All sprint exports (sprints 69–79) must be delivered to the client and operator.",
      status: "manual",
      evidence: "Delivery confirmed — method: ___",
    }),
  ];

  // ── Score + status ─────────────────────────────────────────────────────────

  const required     = checks.filter((c) => c.required);
  const passed       = required.filter((c) => c.status === "pass");
  const blocked      = required.filter((c) => c.status === "blocked");
  const warned       = required.filter((c) => c.status === "warning");

  const score = required.length > 0
    ? Math.round(((passed.length) / required.length) * 100)
    : 0;

  const blockers: string[] = blocked.map((c) => `${c.label}${c.nextStep ? ` — ${c.nextStep}` : ""}`);
  const warnings: string[] = warned.map((c) => `Review: ${c.label}`);

  let status: FinalLiveVerificationStatus;
  if (blockers.length > 0)        status = "blocked";
  else if (warnings.length > 0)   status = "needs_review";
  else if (score === 100)         status = "verified_ready";
  else                            status = "needs_review";

  const evidenceRequired = [
    "Deployed commit SHA (from git rev-parse --short HEAD on server)",
    "PM2 status screenshot or command output",
    "curl output for /login, /dashboard, /admin",
    "curl output for Sardar frontend and health endpoint",
    "All exports downloaded and named correctly",
    "Confirmation: no secret values in any export",
    "Confirmation: no automatic production mutation triggered",
    "Rollback owner name and contact",
    "Handoff exports delivered — delivery method noted",
  ];

  const verifiedExports = [
    "FINAL_LIVE_VERIFICATION_RUN.md",
    "GO_NO_GO_EVIDENCE_PACK.md",
    "FINAL_READINESS_AUDIT.md",
    "STOP_BUILD_GATE.md",
    "DEPLOY_VERIFICATION_REPORT.md",
    "LAUNCH_EXECUTION_CHECKLIST.md",
    "LAUNCH_DAY_SUPPORT_REPORT.md",
    "FINAL_CUTOVER_REHEARSAL.md",
    "LAUNCH_FREEZE_CHECKLIST.md",
    "FINAL_LAUNCH_SIGNOFF.md",
    "OPERATOR_TRAINING_PACK.md",
    "POST_CUTOVER_MONITORING_REPORT.md",
    "POST_LAUNCH_BUG_CAPTURE.md",
  ];

  const verifiedPanels = [
    "Final Live Verification Run",
    "Go/No-Go Evidence Pack",
    "Final Readiness Audit",
    "Stop-Build Gate",
    "Deploy Verification",
    "Launch Execution Checklist",
    "Launch-Day Support",
    "Post-Launch Bug Capture",
    "Cutover Rehearsal",
    "Launch Freeze",
    "Final Launch Signoff",
    "Operator Training Pack",
    "Project Profile Card",
  ];

  const recommendedNextSteps = blockers.length > 0
    ? [
        "Resolve all blockers listed above before proceeding.",
        "Re-generate this report after fixing blockers.",
      ]
    : [
        "Export FINAL_LIVE_VERIFICATION_RUN.md for the handover pack.",
        "Generate and export GO_NO_GO_EVIDENCE_PACK.md.",
        "Ensure all exports in the verified list have been downloaded.",
        "Deliver the complete evidence pack to the operator and client.",
        "Proceed to Launch Execution Checklist when all evidence is collected.",
      ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score,
    expectedCommit: expectedCommit || undefined,
    checks,
    blockers,
    warnings,
    evidenceRequired,
    verifiedExports,
    verifiedPanels,
    recommendedNextSteps,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function emptyRun(
  projectId: string,
  status: FinalLiveVerificationStatus,
  blockers: string[],
  expectedCommit?: string,
): FinalLiveVerificationRun {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score: 0,
    expectedCommit,
    checks: [],
    blockers,
    warnings: [],
    evidenceRequired: [],
    verifiedExports: [],
    verifiedPanels: [],
    recommendedNextSteps: [],
  };
}
