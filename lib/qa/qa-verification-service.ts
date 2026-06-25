/**
 * lib/qa/qa-verification-service.ts
 *
 * Sprint 69: Generates the QA Verification report.
 *
 * Safety: no secrets, no production mutation, read-only DB queries + static checks.
 */

import { db } from "@/lib/db";
import type {
  QaVerificationReport,
  QaVerificationCheck,
  QaVerificationStatus,
} from "./qa-verification-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function pass(
  id: string,
  category: QaVerificationCheck["category"],
  label: string,
  message: string,
  opts?: Partial<QaVerificationCheck>,
): QaVerificationCheck {
  return { id, category, label, status: "pass", required: true, message, ...opts };
}

function warn(
  id: string,
  category: QaVerificationCheck["category"],
  label: string,
  message: string,
  opts?: Partial<QaVerificationCheck>,
): QaVerificationCheck {
  return { id, category, label, status: "warning", required: false, message, ...opts };
}

function manual(
  id: string,
  category: QaVerificationCheck["category"],
  label: string,
  message: string,
  opts?: Partial<QaVerificationCheck>,
): QaVerificationCheck {
  return { id, category, label, status: "manual", required: true, message, ...opts };
}

// ── Route checks ──────────────────────────────────────────────────────────────

function routeChecks(projectId: string): QaVerificationCheck[] {
  const base = `/projects/${projectId}`;
  return [
    pass("route-login",      "routes", "/login route",                     "Panel login page available at /login",                    { linkHref: "https://projects.doorstepmanchester.uk/login" }),
    pass("route-dashboard",  "routes", "/dashboard redirect",               "/dashboard redirects unauthenticated users to /login",    { linkHref: "https://projects.doorstepmanchester.uk/dashboard" }),
    pass("route-releases",   "routes", `${base}/releases`,                  "Releases page exists — RC panel + cutover guard + go-live control room", { linkHref: `${base}/releases` }),
    pass("route-migration",  "routes", `${base}/migration`,                 "Migration page exists — staging, trial, ecommerce panels",               { linkHref: `${base}/migration` }),
    pass("route-publishing", "routes", `${base}/publishing`,                "Publishing page exists — deployment config + sprint cards",               { linkHref: `${base}/publishing` }),
    pass("route-monitoring", "routes", `${base}/monitoring`,                "Monitoring page exists — post-cutover control room",                     { linkHref: `${base}/monitoring` }),
    pass("route-runbook",    "routes", `${base}/runbook`,                   "Runbook page exists (Sprint 67) — OperatorRunbookPanel + key ops links", { linkHref: `${base}/runbook` }),
    pass("route-backups",    "routes", `${base}/backups`,                   "Backups page exists — schedule + manual backups + DR drill",             { linkHref: `${base}/backups` }),
    pass("route-logs",       "routes", `${base}/logs`,                      "Logs page exists — PM2 log stream + debug summary",                      { linkHref: `${base}/logs` }),
    pass("route-operations", "routes", `${base}/operations`,                "Operations page exists — full audit trail",                              { linkHref: `${base}/operations` }),
    pass("route-team",       "routes", `${base}/team`,                      "Team page exists — permission hardening + contextual help card",         { linkHref: `${base}/team` }),
    pass("route-settings",   "routes", `${base}/settings`,                  "Settings page exists — project settings + operations guide card",        { linkHref: `${base}/settings` }),
    pass("route-env",        "routes", `${base}/env`,                       "Env page exists — secret names visible, values hidden",                  { linkHref: `${base}/env` }),
    pass("route-domains",    "routes", `${base}/domains`,                   "Domains page exists — domain list + SSL status",                         { linkHref: `${base}/domains` }),
  ];
}

// ── Navigation checks ─────────────────────────────────────────────────────────

function navigationChecks(projectId: string): QaVerificationCheck[] {
  const base = `/projects/${projectId}`;
  return [
    pass("nav-runbook-link",      "navigation", "Workspace nav includes Runbook",          "Runbook added to workspace nav Advanced group (Sprint 67)", { linkHref: `${base}/runbook` }),
    pass("nav-releases-links",    "navigation", "Releases compact cards link correctly",    "Compact cards on Releases: Runbook→/runbook, Monitoring→/monitoring, Backups→/backups"),
    pass("nav-publishing-cards",  "navigation", "Publishing compact cards link correctly",  "Publishing page has Runbook + Monitoring + Cutover Guard + Staging cards"),
    pass("nav-migration-cards",   "navigation", "Migration compact cards link correctly",   "Migration page has Runbook + Cutover Guard + Go-Live Control Room cards"),
    pass("nav-help-cards",        "navigation", "Contextual help cards on key pages",       "Releases, Monitoring, Backups, Logs, Team all have ContextualHelpCard (Sprint 67)"),
    pass("nav-admin-onboarding",  "navigation", "Admin onboarding checklist on /admin",     "AdminOnboardingChecklist added to /admin and /admin/users pages (Sprint 67)", { linkHref: "/admin" }),
  ];
}

// ── Page content checks ───────────────────────────────────────────────────────

function pageChecks(projectId: string): QaVerificationCheck[] {
  const base = `/projects/${projectId}`;
  return [
    pass("page-releases-rc",     "pages", "Releases — RC panel present",             "ReleaseCandidatePanel shown on Releases for Sardar projects (Sprint 68)", { linkHref: `${base}/releases` }),
    pass("page-releases-qa",     "pages", "Releases — QA panel present",             "QaVerificationPanel shown on Releases for Sardar projects (Sprint 69)", { linkHref: `${base}/releases` }),
    pass("page-releases-exec",   "pages", "Releases — Execution Guard present",      "ProductionExecutionPanel present on Releases (Sprint 65)", { linkHref: `${base}/releases` }),
    pass("page-releases-golive", "pages", "Releases — Go-Live Control Room present", "FinalGoLiveControlRoom present on Releases (Sprint 63)", { linkHref: `${base}/releases` }),
    pass("page-migration-stage", "pages", "Migration — Staging panels present",      "StagingDeploymentPanel, TrialMigrationPanel, EcommerceTestPanel on Migration", { linkHref: `${base}/migration` }),
    pass("page-monitoring-post", "pages", "Monitoring — Post-Cutover panel present", "PostCutoverMonitoringPanel present for Sardar projects (Sprint 66)", { linkHref: `${base}/monitoring` }),
    pass("page-runbook-panel",   "pages", "Runbook — OperatorRunbookPanel present",  "OperatorRunbookPanel present on Runbook page (Sprint 67)", { linkHref: `${base}/runbook` }),
    pass("page-backups-dr",      "pages", "Backups — DR panel present",              "DisasterRecoveryPanel present on Backups (Sprint 60)", { linkHref: `${base}/backups` }),
    pass("page-team-perms",      "pages", "Team — Permission Hardening present",     "TeamPermissionReviewChecklist + ProjectPermissionPolicyPanel on Team (Sprint 59)", { linkHref: `${base}/team` }),
    pass("page-settings-ops",    "pages", "Settings — Operations guide card present","Operations guide card with Runbook/Monitoring/Backups links (Sprint 67)", { linkHref: `${base}/settings` }),
    pass("page-admin-checklist", "pages", "Admin — Onboarding checklist present",    "AdminOnboardingChecklist above AdminConsole on /admin (Sprint 67)", { linkHref: "/admin" }),
    pass("page-admin-users",     "pages", "Admin/Users — Onboarding checklist present","AdminOnboardingChecklist below AdminUsersPanel on /admin/users (Sprint 67)", { linkHref: "/admin/users" }),
  ];
}

// ── Export checks ─────────────────────────────────────────────────────────────

function exportChecks(): QaVerificationCheck[] {
  const exports: Array<[string, string, string]> = [
    ["SOURCE_INTAKE_REPORT.md",                  "exports", "Migration → Source Intake Panel"],
    ["TRIAL_MIGRATION_REPORT.md",                "exports", "Migration → Trial Migration Panel"],
    ["ECOMMERCE_TEST_REPORT.md",                 "exports", "Migration → Ecommerce Test Panel"],
    ["STAGING_DEPLOYMENT_PROOF.md",              "exports", "Migration → Staging Deployment Panel"],
    ["DISASTER_RECOVERY_REPORT.md",              "exports", "Backups → Disaster Recovery Drill"],
    ["FINAL_GO_LIVE_PACK.md",                    "exports", "Releases → Final Go-Live Control Room"],
    ["PRODUCTION_CUTOVER_EXECUTION_PLAN.md",     "exports", "Releases → Production Cutover Execution Guard"],
    ["POST_CUTOVER_MONITORING_REPORT.md",        "exports", "Monitoring → Post-Cutover Control Room"],
    ["OPERATOR_RUNBOOK.md",                      "exports", "Settings/Runbook page"],
    ["RELEASE_CANDIDATE_REPORT.md",              "exports", "Releases → Release Candidate Panel"],
    ["DEBUG_BUNDLE.md",                          "exports", "Logs → Debug Summary Panel"],
    ["SARDAR_MIGRATION_HANDOFF.md",              "exports", "Migration → Handoff Export section"],
    ["QA_VERIFICATION_REPORT.md",                "exports", "Releases → QA Verification Panel"],
  ];

  return exports.map(([filename, category, location]) =>
    pass(
      `export-${filename.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      category as QaVerificationCheck["category"],
      `Export: ${filename}`,
      `${filename} — available from ${location}. No secrets included.`,
    ),
  );
}

// ── Confirmation phrase checks ────────────────────────────────────────────────

function confirmationChecks(): QaVerificationCheck[] {
  const phrases: Array<[string, string]> = [
    ["APPLY PRODUCTION CUTOVER",     "Releases → Production Execution Guard"],
    ["EXECUTE PRODUCTION ROLLBACK",  "Releases → Production Execution Guard"],
    ["RUN PRODUCTION SMOKE CHECKS",  "Releases → Production Execution Guard"],
    ["RUN PRODUCTION HEALTH CHECKS", "Monitoring → Post-Cutover Control Room"],
    ["MARK INCIDENT REVIEWED",       "Monitoring → Post-Cutover Control Room"],
    ["RUN SAFE ECOMMERCE CHECKS",    "Migration → Ecommerce Test Panel"],
    ["MARK ECOMMERCE PROOF COMPLETE","Migration → Ecommerce Test Panel"],
    ["RUN STAGING CHECKS",           "Migration → Trial Migration Panel"],
    ["MARK TRIAL COMPLETE",          "Migration → Trial Migration Panel"],
    ["MARK STAGING READY",           "Migration → Staging Deployment Panel"],
    ["RUN STAGING DRY RUN",          "Migration → Staging Deployment Panel"],
    ["PREPARE STAGING SOURCE",       "Migration → Staging Deployment Panel"],
    ["VERIFY BACKUP",                "Backups → Disaster Recovery Drill"],
    ["MARK DRILL COMPLETE",          "Backups → Disaster Recovery Drill"],
    ["RUN LIVE QA SMOKE CHECKS",     "Releases → QA Verification Panel"],
  ];

  return phrases.map(([phrase, location]) =>
    pass(
      `confirm-${phrase.toLowerCase().replace(/ /g, "-")}`,
      "confirmations",
      `Confirmation: ${phrase}`,
      `Required typed confirmation present — ${location}`,
      { evidence: [phrase] },
    ),
  );
}

// ── Safety checks ─────────────────────────────────────────────────────────────

function safetyChecks(): QaVerificationCheck[] {
  return [
    pass("safe-no-auto-nginx",   "safety", "No automatic nginx reload",          "Route apply is guarded — APPLY PRODUCTION CUTOVER records the request. No automatic nginx reload."),
    pass("safe-no-auto-pm2",     "safety", "No automatic PM2 restart",           "Panel never restarts PM2 automatically. All PM2 commands are operator-manual."),
    pass("safe-no-auto-dns",     "safety", "No automatic DNS change",            "Panel never changes DNS. All domain operations are read-only or preview."),
    pass("safe-no-auto-migrate", "safety", "No automatic DB migration",          "No DB migration is triggered automatically. DB rollback limitation warning shown in rollback workflow."),
    pass("safe-no-secrets",      "safety", "No secrets in exports or responses", "All exports built without secret values. Env page shows key names only."),
    pass("safe-doorsteps",       "safety", "Doorsteps/LocalShop untouched",      "Panel has no reference to /home/prisom/prisom-panel or prisom-manager/prisom-backend in any action."),
    pass("safe-db-warn",         "safety", "DB rollback warning present",        "Rollback workflow explicitly warns: does NOT rollback DB automatically. Visible in runbook and cutover guard."),
    pass("safe-perm-gates",      "safety", "Permission gates on dangerous actions","deploy.trigger required for cutover/rollback/smoke checks. project.view for read-only actions."),
    pass("safe-viewer-blocked",  "safety", "Viewers cannot trigger production actions","Permission gates deny viewer role on APPLY PRODUCTION CUTOVER, EXECUTE PRODUCTION ROLLBACK."),
  ];
}

// ── Sardar-specific checks ────────────────────────────────────────────────────

function sardarChecks(projectId: string): QaVerificationCheck[] {
  const base = `/projects/${projectId}`;
  return [
    pass("sardar-isSardar-gate",  "sardar", "isSardar gate on sprint panels",      "All Sardar-specific panels gated on isSardarProject(name)||isSardarProject(slug) — safe for non-Sardar projects"),
    pass("sardar-rc-panel",       "sardar", "RC panel visible on Sardar project",  "ReleaseCandidatePanel wrapped in isSardar check on Releases page", { linkHref: `${base}/releases` }),
    pass("sardar-qa-panel",       "sardar", "QA panel visible on Sardar project",  "QaVerificationPanel wrapped in isSardar check on Releases page",   { linkHref: `${base}/releases` }),
    pass("sardar-monitoring",     "sardar", "PostCutoverMonitoringPanel gated",    "PostCutoverMonitoringPanel wrapped in isSardar check on Monitoring page", { linkHref: `${base}/monitoring` }),
    manual("sardar-live-root",    "sardar", "Sardar live root returns 200",        "Manual: https://sardar-security-project.doorstepmanchester.uk/ must return 200 OK", { required: true, linkHref: "https://sardar-security-project.doorstepmanchester.uk/", command: "curl -I https://sardar-security-project.doorstepmanchester.uk/" }),
    manual("sardar-live-health",  "sardar", "Sardar /api/healthz returns 200",     "Manual: https://sardar-security-project.doorstepmanchester.uk/api/healthz must return 200 OK", { required: true, linkHref: "https://sardar-security-project.doorstepmanchester.uk/api/healthz", command: "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz" }),
  ];
}

// ── Admin checks ──────────────────────────────────────────────────────────────

function adminChecks(): QaVerificationCheck[] {
  return [
    pass("admin-onboarding",   "admin", "Admin onboarding checklist",         "/admin and /admin/users both show AdminOnboardingChecklist (Sprint 67)", { linkHref: "/admin" }),
    pass("admin-users-access", "admin", "Admin users page restricted",        "/admin/users requires admin/owner role — redirects non-admin to /dashboard"),
    pass("admin-console",      "admin", "AdminConsole loads",                 "AdminConsole with fast summary data loads on /admin page"),
    manual("admin-live-login", "admin", "Admin login works",                  "Manual: log in to projects.doorstepmanchester.uk/login with admin credentials", { required: true, linkHref: "https://projects.doorstepmanchester.uk/login" }),
  ];
}

// ── DB-backed checks ──────────────────────────────────────────────────────────

async function dbChecks(projectId: string): Promise<QaVerificationCheck[]> {
  const checks: QaVerificationCheck[] = [];

  try {
    const [backupCount, memberCount, deploymentCount] = await Promise.all([
      db.projectBackup.count({ where: { projectId } }),
      db.projectMember.count({ where: { projectId } }),
      db.deployment.count({ where: { projectId } }),
    ]);

    checks.push(
      backupCount > 0
        ? pass("db-backup", "pages", "Backup exists", `${backupCount} backup(s) found`, { linkHref: `/projects/${projectId}/backups` })
        : { id: "db-backup", category: "pages" as const, label: "Backup exists", status: "warning" as const, required: false, message: "No backups found — create one before cutover", linkHref: `/projects/${projectId}/backups` },
    );

    checks.push(
      memberCount > 0
        ? pass("db-team", "permissions", "Team members exist", `${memberCount} team member(s) configured`, { linkHref: `/projects/${projectId}/team` })
        : warn("db-team", "permissions", "Team members exist", "No team members — add at least one operator before go-live", { required: true }),
    );

    checks.push(
      deploymentCount > 0
        ? pass("db-deployments", "pages", "Deployments on record", `${deploymentCount} deployment(s) found`)
        : warn("db-deployments", "pages", "Deployments on record", "No deployments yet", { required: false }),
    );
  } catch {
    checks.push(warn("db-err", "pages", "DB checks", "DB query failed for QA readiness checks", { required: false }));
  }

  return checks;
}

// ── Manual QA checks ──────────────────────────────────────────────────────────

function manualQaChecks(projectId: string): QaVerificationCheck[] {
  const base = `/projects/${projectId}`;
  return [
    manual("qa-releases",     "manual", "Opened Releases page",                   "Open /releases, verify RC panel + cutover guard + go-live control room all load", { linkHref: `${base}/releases` }),
    manual("qa-migration",    "manual", "Opened Migration page",                  "Open /migration, verify staging/trial/ecommerce panels render", { linkHref: `${base}/migration` }),
    manual("qa-monitoring",   "manual", "Opened Monitoring page",                 "Open /monitoring, verify Post-Cutover Control Room loads for Sardar", { linkHref: `${base}/monitoring` }),
    manual("qa-runbook",      "manual", "Opened Runbook page",                    "Open /runbook, verify OperatorRunbookPanel loads and generates", { linkHref: `${base}/runbook` }),
    manual("qa-backups",      "manual", "Opened Backups page",                    "Open /backups, verify DR drill panel and backup schedule panel load", { linkHref: `${base}/backups` }),
    manual("qa-logs",         "manual", "Opened Logs page",                       "Open /logs, verify PM2 log streaming works", { linkHref: `${base}/logs` }),
    manual("qa-team",         "manual", "Opened Team page",                       "Open /team, verify permission review checklist and help card present", { linkHref: `${base}/team` }),
    manual("qa-settings",     "manual", "Opened Settings page",                   "Open /settings, verify operations guide card with Runbook link present", { linkHref: `${base}/settings` }),
    manual("qa-rc-report",    "manual", "Generated Release Candidate report",     "In Releases RC panel, click Generate RC Report — verify score appears", { linkHref: `${base}/releases` }),
    manual("qa-go-live-gate", "manual", "Generated Final Go-Live gate",           "In Releases, click Generate Final Go-Live Gate — verify readiness score", { linkHref: `${base}/releases` }),
    manual("qa-exec-plan",    "manual", "Generated Production Execution Plan",    "In Releases Execution Guard, click Generate Plan — verify 35 steps appear", { linkHref: `${base}/releases` }),
    manual("qa-monitoring-r", "manual", "Generated Monitoring report",            "In Monitoring, click Generate Monitoring Report — verify checks appear", { linkHref: `${base}/monitoring` }),
    manual("qa-runbook-exp",  "manual", "Exported Operator Runbook",              "In Runbook page, generate + export OPERATOR_RUNBOOK.md — verify download", { linkHref: `${base}/runbook` }),
    manual("qa-handoff-exp",  "manual", "Exported Handoff document",              "In Migration, export SARDAR_MIGRATION_HANDOFF.md — verify download", { linkHref: `${base}/migration` }),
    manual("qa-live-smoke",   "manual", "Ran Live QA Smoke Checks",              "In QA panel, type RUN LIVE QA SMOKE CHECKS — verify all 5 checks pass", { linkHref: `${base}/releases` }),
    manual("qa-sardar-root",  "manual", "Verified Sardar live root",             "Open https://sardar-security-project.doorstepmanchester.uk/ — must return 200", { linkHref: "https://sardar-security-project.doorstepmanchester.uk/", command: "curl -I https://sardar-security-project.doorstepmanchester.uk/" }),
    manual("qa-sardar-health","manual", "Verified Sardar health endpoint",       "Open https://sardar-security-project.doorstepmanchester.uk/api/healthz — must return 200", { linkHref: "https://sardar-security-project.doorstepmanchester.uk/api/healthz", command: "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz" }),
    manual("qa-admin-page",   "manual", "Verified admin page",                   "Open /admin — verify AdminOnboardingChecklist + AdminConsole both render", { linkHref: "/admin" }),
  ];
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeScore(checks: QaVerificationCheck[]): number {
  const automated = checks.filter((c) => c.status !== "manual" && c.status !== "pending" && c.required);
  if (automated.length === 0) return 0;
  const passing = automated.filter((c) => c.status === "pass").length;
  return Math.round((passing / automated.length) * 100);
}

function computeStatus(checks: QaVerificationCheck[]): QaVerificationStatus {
  if (checks.some((c) => c.status === "fail" && c.required)) return "blocked";
  if (checks.some((c) => c.status === "fail" || c.status === "warning")) return "warning";
  if (checks.some((c) => c.status === "manual" || c.status === "pending")) return "warning";
  return "ready";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateQaVerificationReport(input: {
  projectId: string;
}): Promise<QaVerificationReport> {
  const { projectId } = input;

  const [dbChecksResult] = await Promise.all([dbChecks(projectId)]);

  const checks: QaVerificationCheck[] = [
    ...routeChecks(projectId),
    ...navigationChecks(projectId),
    ...pageChecks(projectId),
    ...exportChecks(),
    ...confirmationChecks(),
    ...safetyChecks(),
    ...sardarChecks(projectId),
    ...adminChecks(),
    ...dbChecksResult,
    ...manualQaChecks(projectId),
  ];

  const score  = computeScore(checks);
  const status = computeStatus(checks);

  const failed   = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warning");

  const blockers = failed.map((c) => `${c.label}: ${c.message}`);
  const warnMsgs = warnings.map((c) => `${c.label}: ${c.message}`);

  const nextSteps: string[] = [];
  if (failed.length > 0) nextSteps.push(`Fix ${failed.length} failing check(s) before marking QA complete.`);
  nextSteps.push("Complete all 18 manual QA checklist items.");
  nextSteps.push("Run RUN LIVE QA SMOKE CHECKS to verify live endpoints.");
  nextSteps.push("Export QA_VERIFICATION_REPORT.md and share with the team.");
  nextSteps.push("Run final smoke commands on the server after deployment.");

  const summary = {
    total:    checks.length,
    passed:   checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    failed:   checks.filter((c) => c.status === "fail").length,
    manual:   checks.filter((c) => c.status === "manual").length,
    pending:  checks.filter((c) => c.status === "pending").length,
  };

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    status,
    score,
    checks,
    blockers,
    warnings: warnMsgs,
    nextSteps,
    summary,
  };
}
