import { db }             from "@/lib/db";
import { isSardarProject } from "@/lib/migration/sardar-migration-types";
import type {
  DeployVerificationReport,
  DeployVerificationCheck,
  DeployVerificationStatus,
} from "./deploy-verification-types";

// ── Production context (no secrets) ──────────────────────────────────────────

const PANEL_DOMAIN = "projects.doorstepmanchester.uk";
const SARDAR_DOMAIN = "sardar-security-project.doorstepmanchester.uk";

function chk(
  overrides: Partial<DeployVerificationCheck> &
    Pick<DeployVerificationCheck, "id" | "category" | "label">,
): DeployVerificationCheck {
  return {
    description: "",
    required: true,
    status: "manual",
    ...overrides,
  };
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function generateDeployVerificationReport(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<DeployVerificationReport> {
  const { projectId, expectedCommit } = input;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });

  if (!project) {
    return emptyReport(projectId, "blocked", ["Project not found."], expectedCommit);
  }

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  const [domains, deployments] = await Promise.all([
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
  ]);

  const primaryDomain = domains.find((d) => d.isPrimary) ?? domains[0];
  const hostname      = primaryDomain?.hostname ?? "";
  const sslActive     = primaryDomain?.sslStatus === "ACTIVE";
  const lastDeploy    = deployments[0];
  const observedCommit = lastDeploy?.commitSha?.slice(0, 7) ?? undefined;

  // ── Checks ────────────────────────────────────────────────────────────────

  const checks: DeployVerificationCheck[] = [

    // Commit
    chk({
      id: "commit-match", category: "commit",
      label: "Deployed commit matches expected",
      description: expectedCommit
        ? `Expected commit: ${expectedCommit}. Verify by running: git rev-parse --short HEAD`
        : "No expected commit provided. Run 'git rev-parse --short HEAD' on the server to verify.",
      status: expectedCommit ? "manual" : "pending",
      evidence: observedCommit ? `Last recorded commit SHA: ${observedCommit}` : undefined,
      nextStep: "SSH to server and run: git -C /home/prisom/prisom-project-panel rev-parse --short HEAD",
    }),
    chk({
      id: "commit-log", category: "commit",
      label: "Recent git log verified on server",
      description: "Verify the last 8 commits are as expected by running: git log --oneline -8",
      status: "manual",
      nextStep: "git -C /home/prisom/prisom-project-panel log --oneline -8",
    }),

    // Panel routes
    chk({
      id: "route-login", category: "panel_route",
      label: "/login returns 200",
      description: `${PANEL_DOMAIN}/login must return HTTP 200`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/login`,
      evidence: "Expected: HTTP/2 200",
    }),
    chk({
      id: "route-dashboard", category: "panel_route",
      label: "/dashboard returns 307 → /login (unauthenticated)",
      description: `${PANEL_DOMAIN}/dashboard must redirect to /login when unauthenticated`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/dashboard`,
      evidence: "Expected: HTTP/2 307 Location: /login",
    }),
    chk({
      id: "route-admin", category: "panel_route",
      label: "/admin returns 307 → /login (unauthenticated)",
      description: `${PANEL_DOMAIN}/admin must redirect to /login when unauthenticated`,
      status: "manual",
      command: `curl -I https://${PANEL_DOMAIN}/admin`,
      evidence: "Expected: HTTP/2 307 Location: /login",
    }),

    // Project routes (manual — need projectId in URL)
    chk({
      id: "route-releases", category: "project_route",
      label: "/projects/[id]/releases loads and shows Final Readiness + Stop-Build panels",
      description: "Navigate to the Releases page and confirm both Sprint 77 panels are visible at the top.",
      status: "manual",
      evidence: "Final Readiness Audit and Stop-Build Gate panels visible",
    }),
    chk({
      id: "route-migration", category: "project_route",
      label: "/projects/[id]/migration loads with Sprint 77 compact cards",
      description: "Navigate to Migration and confirm Final Readiness + Stop-Build compact cards are visible.",
      status: "manual",
    }),
    chk({
      id: "route-monitoring", category: "project_route",
      label: "/projects/[id]/monitoring loads with Sprint 77 compact cards",
      description: "Navigate to Monitoring and confirm Final Readiness + Stop-Build compact cards are visible.",
      status: "manual",
    }),
    chk({
      id: "route-runbook", category: "project_route",
      label: "/projects/[id]/runbook loads with Sprint 78 launch execution checklist",
      description: "Navigate to Runbook and confirm Launch Execution Checklist is visible.",
      status: "manual",
    }),
    chk({
      id: "route-publishing", category: "project_route",
      label: "/projects/[id]/publishing loads with Sprint 78 compact cards",
      description: "Navigate to Publishing and confirm Deploy Verification + Launch Execution compact cards are visible.",
      status: "manual",
    }),

    // Sardar routes
    chk({
      id: "sardar-frontend", category: "panel_route",
      label: `Sardar frontend (${SARDAR_DOMAIN}) returns 200`,
      description: "Sardar production frontend must remain live throughout deploy verification.",
      status: "manual",
      command: `curl -I https://${SARDAR_DOMAIN}/`,
      evidence: "Expected: HTTP/2 200",
      safetyNote: "Do not restart sardar PM2 process. Verify only.",
    }),
    chk({
      id: "sardar-health", category: "panel_route",
      label: `Sardar health endpoint returns 200`,
      description: `${SARDAR_DOMAIN}/api/healthz must return HTTP 200`,
      status: "manual",
      command: `curl -I https://${SARDAR_DOMAIN}/api/healthz`,
      evidence: "Expected: HTTP/2 200",
      safetyNote: "Do not restart sardar PM2 process. Verify only.",
    }),

    // Exports
    chk({
      id: "export-final-readiness", category: "export",
      label: "FINAL_READINESS_AUDIT.md exports from Releases",
      description: "Generate and export FINAL_READINESS_AUDIT.md from the Final Readiness Audit panel.",
      status: "manual",
      evidence: "File downloaded with correct sections",
    }),
    chk({
      id: "export-stop-build", category: "export",
      label: "STOP_BUILD_GATE.md exports from Releases",
      description: "Generate and export STOP_BUILD_GATE.md from the Stop-Build Gate panel.",
      status: "manual",
      evidence: "File downloaded with decision and gate checks",
    }),
    chk({
      id: "export-launch-day", category: "export",
      label: "LAUNCH_DAY_SUPPORT_REPORT.md exports from Releases",
      description: "Generate and export LAUNCH_DAY_SUPPORT_REPORT.md from the Launch-Day Support panel.",
      status: "manual",
    }),
    chk({
      id: "export-cutover-rehearsal", category: "export",
      label: "FINAL_CUTOVER_REHEARSAL.md exports from Releases",
      description: "Generate and export FINAL_CUTOVER_REHEARSAL.md from the Cutover Rehearsal panel.",
      status: "manual",
    }),
    chk({
      id: "export-launch-freeze", category: "export",
      label: "LAUNCH_FREEZE_CHECKLIST.md exports from Releases",
      description: "Generate and export LAUNCH_FREEZE_CHECKLIST.md from the Launch Freeze panel.",
      status: "manual",
    }),
    chk({
      id: "export-launch-signoff", category: "export",
      label: "FINAL_LAUNCH_SIGNOFF.md exports from Releases",
      description: "Generate and export FINAL_LAUNCH_SIGNOFF.md from the Launch Signoff panel.",
      status: "manual",
    }),
    chk({
      id: "export-operator-training", category: "export",
      label: "OPERATOR_TRAINING_PACK.md exports from Runbook",
      description: "Generate and export OPERATOR_TRAINING_PACK.md from the Operator Training panel.",
      status: "manual",
    }),
    chk({
      id: "export-production-execution", category: "export",
      label: "Production execution plan exports (if applicable)",
      description: "Verify the production execution panel can generate its export from Releases.",
      status: "manual",
    }),
    chk({
      id: "export-post-cutover", category: "export",
      label: "POST_CUTOVER_MONITORING_REPORT.md exports from Monitoring",
      description: "Generate and export POST_CUTOVER_MONITORING_REPORT.md from the Post-Cutover Monitoring panel.",
      status: "manual",
    }),
    chk({
      id: "export-deploy-verification", category: "export",
      label: "DEPLOY_VERIFICATION_REPORT.md exports from Releases",
      description: "Generate and export DEPLOY_VERIFICATION_REPORT.md from this panel.",
      status: "manual",
    }),
    chk({
      id: "export-launch-execution", category: "export",
      label: "LAUNCH_EXECUTION_CHECKLIST.md exports from Releases",
      description: "Generate and export LAUNCH_EXECUTION_CHECKLIST.md from the Launch Execution Checklist panel.",
      status: "manual",
    }),

    // Action gates
    chk({
      id: "action-final-readiness", category: "action",
      label: "Final Readiness action succeeds without error",
      description: "Click 'Generate Readiness Audit' and confirm no error toast or error message appears.",
      status: "manual",
    }),
    chk({
      id: "action-stop-build", category: "action",
      label: "Stop-Build Gate action succeeds without error",
      description: "Click 'Run Stop-Build Gate' and confirm no error toast or error message appears.",
      status: "manual",
    }),
    chk({
      id: "action-launch-day", category: "action",
      label: "Launch-Day Support action succeeds without error",
      description: "Click 'Generate Launch-Day Support Report' and confirm no error appears.",
      status: "manual",
    }),

    // Safety
    chk({
      id: "safety-no-mutation", category: "safety",
      label: "No production mutation triggered during verification",
      description: "All panels are read-only. No server commands are executed automatically during generate or export.",
      status: "pass",
      evidence: "Sprints 69–78 panels all declared read-only",
    }),
    chk({
      id: "safety-no-secrets", category: "safety",
      label: "No secret values appear in any export or panel",
      description: "All env var checks show only var names, not values. No credentials, API keys, or tokens in exports.",
      status: "manual",
    }),
    chk({
      id: "safety-doorsteps-untouched", category: "safety",
      label: "Doorsteps/LocalShop processes untouched",
      description: "prisom-manager and prisom-backend processes must not have been restarted during this sprint.",
      status: "manual",
      command: "pm2 list | grep -E 'prisom-manager|prisom-backend'",
      evidence: "Both processes still running with no restart count increase",
    }),

    // Runtime
    chk({
      id: "runtime-pm2-status", category: "runtime",
      label: "prisom-projects PM2 process is online",
      description: "pm2 list must show prisom-projects as 'online'",
      status: "manual",
      command: "pm2 list | grep prisom-projects",
      evidence: "Expected: online status, port 3002",
    }),
    chk({
      id: "runtime-ssl", category: "runtime",
      label: "SSL active on panel domain",
      description: `SSL must be ACTIVE on ${PANEL_DOMAIN}`,
      status: sslActive ? "pass" : (hostname ? "warning" : "manual"),
      evidence: sslActive ? `SSL ACTIVE on ${hostname}` : undefined,
    }),
  ];

  // ── Status ────────────────────────────────────────────────────────────────

  const blockedChecks = checks.filter((c) => c.required && c.status === "blocked");
  const warnChecks    = checks.filter((c) => c.required && c.status === "warning");

  const blockers: string[] = blockedChecks.map((c) => `${c.label}${c.nextStep ? ` — ${c.nextStep}` : ""}`);
  const warnings: string[] = warnChecks.map((c) => `Review: ${c.label}`);

  let status: DeployVerificationStatus;
  if (blockers.length > 0)   status = "blocked";
  else if (warnings.length > 0) status = "warnings";
  else                       status = "not_checked";

  const verifiedRoutes = [
    `https://${PANEL_DOMAIN}/login`,
    `https://${PANEL_DOMAIN}/dashboard`,
    `https://${PANEL_DOMAIN}/admin`,
    `https://${SARDAR_DOMAIN}/`,
    `https://${SARDAR_DOMAIN}/api/healthz`,
    `/projects/[id]/releases`,
    `/projects/[id]/migration`,
    `/projects/[id]/monitoring`,
    `/projects/[id]/runbook`,
    `/projects/[id]/publishing`,
  ];

  const exportsToVerify = [
    "FINAL_READINESS_AUDIT.md",
    "STOP_BUILD_GATE.md",
    "LAUNCH_DAY_SUPPORT_REPORT.md",
    "FINAL_CUTOVER_REHEARSAL.md",
    "LAUNCH_FREEZE_CHECKLIST.md",
    "FINAL_LAUNCH_SIGNOFF.md",
    "OPERATOR_TRAINING_PACK.md",
    "POST_CUTOVER_MONITORING_REPORT.md",
    "DEPLOY_VERIFICATION_REPORT.md",
    "LAUNCH_EXECUTION_CHECKLIST.md",
  ];

  const actionsToVerify = [
    "Final Readiness Audit — generate + export",
    "Stop-Build Gate — generate + export",
    "Launch-Day Support — generate + export",
    "Cutover Rehearsal — generate + export",
    "Launch Freeze — generate + export",
    "Final Launch Signoff — generate + export",
    "Deploy Verification — generate + export",
    "Launch Execution Checklist — generate + export",
  ];

  const recommendedNextSteps = [
    "SSH to server: verify git HEAD matches expected commit",
    "Run curl smoke checks against all listed routes",
    "Generate and export all listed exports from the panel",
    "Confirm no error messages appear during any generate/export action",
    "Confirm no secrets appear in any generated export",
    "Confirm Sardar frontend and health remain 200 throughout",
    "Export DEPLOY_VERIFICATION_REPORT.md for handover documentation",
    "Proceed to Launch Execution Checklist panel",
  ];

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    expectedCommit: expectedCommit || undefined,
    observedCommit: observedCommit || undefined,
    checks,
    blockers,
    warnings,
    verifiedRoutes,
    exportsToVerify,
    actionsToVerify,
    recommendedNextSteps,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function emptyReport(
  projectId: string,
  status: DeployVerificationStatus,
  blockers: string[],
  expectedCommit?: string,
): DeployVerificationReport {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    expectedCommit,
    checks: [],
    blockers,
    warnings: [],
    verifiedRoutes: [],
    exportsToVerify: [],
    actionsToVerify: [],
    recommendedNextSteps: [],
  };
}
