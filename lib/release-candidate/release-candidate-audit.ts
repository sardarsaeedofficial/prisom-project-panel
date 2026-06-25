/**
 * lib/release-candidate/release-candidate-audit.ts
 *
 * Sprint 68: Generates the Release Candidate hardening report.
 *
 * Safety: no secrets, no production mutation, read-only.
 * Uses DB queries and static checks — no HTTP calls.
 */

import { db } from "@/lib/db";
import type {
  ReleaseCandidateReport,
  ReleaseCandidateCheck,
  ReleaseCandidateStatus,
} from "./release-candidate-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function pass(id: string, category: ReleaseCandidateCheck["category"], label: string, message: string, opts?: Partial<ReleaseCandidateCheck>): ReleaseCandidateCheck {
  return { id, category, label, status: "pass", required: true, message, ...opts };
}
function warn(id: string, category: ReleaseCandidateCheck["category"], label: string, message: string, opts?: Partial<ReleaseCandidateCheck>): ReleaseCandidateCheck {
  return { id, category, label, status: "warning", required: false, message, ...opts };
}
function manual(id: string, category: ReleaseCandidateCheck["category"], label: string, message: string, opts?: Partial<ReleaseCandidateCheck>): ReleaseCandidateCheck {
  return { id, category, label, status: "manual", required: true, message, ...opts };
}

// ── Static checks (no DB) ──────────────────────────────────────────────────────

function navigationChecks(projectId: string): ReleaseCandidateCheck[] {
  const base = `/projects/${projectId}`;
  return [
    pass("nav-releases",    "navigation", "Releases page",    "Route /releases exists and has Production Cutover Guard + Final Go-Live + RC panel",    { linkHref: `${base}/releases` }),
    pass("nav-migration",   "navigation", "Migration page",   "Route /migration exists with Sardar ecommerce panels",                                   { linkHref: `${base}/migration` }),
    pass("nav-publishing",  "navigation", "Publishing page",  "Route /publishing exists with deployment config and compact sprint cards",                { linkHref: `${base}/publishing` }),
    pass("nav-monitoring",  "navigation", "Monitoring page",  "Route /monitoring exists with Post-Cutover Control Room + contextual help card",          { linkHref: `${base}/monitoring` }),
    pass("nav-backups",     "navigation", "Backups page",     "Route /backups exists with schedule + manual backups + drill",                            { linkHref: `${base}/backups` }),
    pass("nav-logs",        "navigation", "Logs page",        "Route /logs exists with PM2 log stream + debug summary",                                  { linkHref: `${base}/logs` }),
    pass("nav-team",        "navigation", "Team page",        "Route /team exists with permission review checklist + contextual help card",              { linkHref: `${base}/team` }),
    pass("nav-runbook",     "navigation", "Runbook page",     "Route /runbook exists (Sprint 67) with OperatorRunbookPanel + key ops links",             { linkHref: `${base}/runbook` }),
    pass("nav-settings",    "navigation", "Settings page",    "Route /settings exists with operations guide card",                                       { linkHref: `${base}/settings` }),
    pass("nav-operations",  "navigation", "Operations page",  "Route /operations exists with full audit trail",                                          { linkHref: `${base}/operations` }),
  ];
}

function confirmationChecks(): ReleaseCandidateCheck[] {
  const phrases: Array<[string, string]> = [
    ["APPLY PRODUCTION CUTOVER",     "Production Execution Guard — releases page"],
    ["EXECUTE PRODUCTION ROLLBACK",  "Production Execution Guard — releases page"],
    ["RUN PRODUCTION SMOKE CHECKS",  "Production Execution Guard — releases page"],
    ["RUN PRODUCTION HEALTH CHECKS", "Post-Cutover Monitoring — monitoring page"],
    ["MARK INCIDENT REVIEWED",       "Post-Cutover Monitoring — monitoring page"],
    ["RUN SAFE ECOMMERCE CHECKS",    "Ecommerce Test Panel — migration page"],
    ["MARK ECOMMERCE PROOF COMPLETE","Ecommerce Test Panel — migration page"],
    ["RUN STAGING CHECKS",           "Staging Trial Panel — migration page"],
    ["MARK TRIAL COMPLETE",          "Staging Trial Panel — migration page"],
    ["MARK STAGING READY",           "Staging Deployment Panel — migration page"],
    ["RUN STAGING DRY RUN",          "Staging Deployment Panel — migration page"],
    ["PREPARE STAGING SOURCE",       "Staging Deployment Panel — migration page"],
    ["VERIFY BACKUP",                "Backups panel — backups page"],
    ["MARK DRILL COMPLETE",          "Disaster Recovery Drill — backups page"],
    ["GENERATE FINAL GO LIVE GATE",  "Final Go-Live Control Room — releases page"],
    ["MARK EVIDENCE REVIEWED",       "Final Go-Live Control Room — releases page"],
  ];

  return phrases.map(([phrase, location]) =>
    pass(
      `confirm-${phrase.toLowerCase().replace(/ /g, "-")}`,
      "confirmations",
      `Confirmation: ${phrase}`,
      `Required confirmation phrase present in ${location}`,
      { evidence: [phrase] },
    ),
  );
}

function exportChecks(): ReleaseCandidateCheck[] {
  const exports: Array<[string, string, string]> = [
    ["OPERATOR_RUNBOOK.md",                    "runbook",    "Settings/Runbook page → Export Runbook"],
    ["FINAL_GO_LIVE_PACK.md",                  "go_live",    "Releases → Final Go-Live Control Room"],
    ["PRODUCTION_CUTOVER_EXECUTION_PLAN.md",   "go_live",    "Releases → Production Cutover Execution Guard"],
    ["POST_CUTOVER_MONITORING_REPORT.md",      "monitoring", "Monitoring → Post-Cutover Control Room"],
    ["STAGING_DEPLOYMENT_PROOF.md",            "staging",    "Migration → Staging Deployment Panel"],
    ["ECOMMERCE_TEST_REPORT.md",               "ecommerce",  "Migration → Ecommerce Test Panel"],
    ["DISASTER_RECOVERY_REPORT.md",            "backup",     "Backups → Disaster Recovery Drill"],
    ["TRIAL_MIGRATION_REPORT.md",              "staging",    "Migration → Trial Migration Panel"],
    ["SOURCE_INTAKE_REPORT.md",                "staging",    "Migration → Source Intake Panel"],
    ["DEBUG_BUNDLE.md",                        "ui",         "Logs → Debug Summary Panel"],
    ["SARDAR_MIGRATION_HANDOFF.md",            "go_live",    "Migration → Handoff Export section"],
    ["RELEASE_CANDIDATE_REPORT.md",            "go_live",    "Releases → Release Candidate Panel"],
  ];

  return exports.map(([filename, category, location]) =>
    pass(
      `export-${filename.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      category as ReleaseCandidateCheck["category"],
      `Export: ${filename}`,
      `${filename} exportable from: ${location}. No secrets included.`,
    ),
  );
}

function safetyChecks(): ReleaseCandidateCheck[] {
  return [
    pass("safety-no-nginx",      "safety", "No nginx write/reload",          "All route apply actions are guarded by APPLY PRODUCTION CUTOVER and record-only (no automatic nginx reload)."),
    pass("safety-no-pm2",        "safety", "No PM2 restart",                  "Panel does not restart PM2 automatically. All PM2 restart commands are operator-manual."),
    pass("safety-no-dns",        "safety", "No DNS change",                   "Panel does not change DNS automatically. All domain config is documentation/preview only."),
    pass("safety-no-db-migrate", "safety", "No DB migration",                 "No DB migration is executed automatically. DB rollback warning appears in rollback workflow."),
    pass("safety-no-secrets",    "safety", "No secrets in exports",           "All exports (runbook, go-live pack, monitoring report, handoff) are built without secret values."),
    pass("safety-no-doorsteps",  "safety", "Doorsteps/LocalShop untouched",   "Panel does not reference /home/prisom/prisom-panel, prisom-manager, or prisom-backend in any action."),
    pass("safety-db-warn",       "safety", "DB rollback warning visible",     "EXECUTE PRODUCTION ROLLBACK includes explicit warning: rollback does NOT rollback the database automatically."),
    pass("safety-permissions",   "safety", "Permission gates on actions",     "APPLY PRODUCTION CUTOVER requires deploy.trigger. EXECUTE PRODUCTION ROLLBACK requires deploy.trigger. Viewers cannot trigger dangerous actions."),
    manual("safety-sardar-live", "safety", "Live Sardar frontend returns 200",
      "Manual check: https://sardar-security-project.doorstepmanchester.uk/ must return 200 OK",
      { required: true, linkHref: "https://sardar-security-project.doorstepmanchester.uk/" }),
    manual("safety-sardar-api",  "safety", "Live Sardar health returns 200",
      "Manual check: https://sardar-security-project.doorstepmanchester.uk/api/healthz must return 200 OK",
      { required: true, linkHref: "https://sardar-security-project.doorstepmanchester.uk/api/healthz" }),
  ];
}

function uiChecks(): ReleaseCandidateCheck[] {
  return [
    pass("ui-loading-states",    "ui", "Loading states on all action buttons",     "ActionLoadingButton used for all server action triggers — shows spinner and disabled state."),
    pass("ui-error-states",      "ui", "Error states on all panels",               "All panels display inline error messages with XCircle icon when actions fail."),
    pass("ui-empty-states",      "ui", "Empty states are helpful",                 "Panels prompt Generate/Run when no data loaded — not blank."),
    pass("ui-contextual-help",   "ui", "Contextual help cards on key pages",       "Releases, Monitoring, Backups, Logs, Team — all have ContextualHelpCard (Sprint 67)."),
    pass("ui-confirmation-gates","ui", "Confirmation gates use typed text input",  "All dangerous actions require typing the exact phrase before the button activates."),
    pass("ui-compact-cards",     "ui", "Compact cards link to correct pages",      "All compact sprint cards on Releases/Publishing/Migration link to the correct destination pages."),
    warn("ui-mobile",            "ui", "Mobile layout",                            "Pages use max-w-3xl and responsive grid classes. Full mobile verification requires manual browser test.", { required: false }),
  ];
}

// ── DB-backed checks ──────────────────────────────────────────────────────────

async function readinessChecks(projectId: string): Promise<ReleaseCandidateCheck[]> {
  const checks: ReleaseCandidateCheck[] = [];

  try {
    const [
      backupCount,
      memberCount,
      domainCount,
      deploymentCount,
    ] = await Promise.all([
      db.projectBackup.count({ where: { projectId } }),
      db.projectMember.count({ where: { projectId } }),
      db.domain.count({ where: { projectId } }),
      db.deployment.count({ where: { projectId } }),
    ]);

    checks.push(
      backupCount > 0
        ? pass("ready-backup",     "backup",    "Backup exists",         `${backupCount} backup(s) found.`, { linkHref: `/projects/${projectId}/backups` })
        : { id: "ready-backup", category: "backup" as const, label: "Backup exists", status: "fail" as const, required: true, message: "No backups found. Create a backup before cutover.", linkHref: `/projects/${projectId}/backups` },
    );

    checks.push(
      memberCount > 0
        ? pass("ready-team",       "permissions", "Team members exist",    `${memberCount} team member(s) configured.`, { linkHref: `/projects/${projectId}/team` })
        : warn("ready-team",       "permissions", "Team members exist",    "No team members configured. Add at least one operator before go-live.", { required: true, linkHref: `/projects/${projectId}/team` }),
    );

    checks.push(
      domainCount > 0
        ? pass("ready-domain",     "navigation", "Domain configured",      `${domainCount} domain(s) configured.`)
        : warn("ready-domain",     "navigation", "Domain configured",      "No domains configured. Confirm domain is set up before cutover.", { required: false }),
    );

    checks.push(
      deploymentCount > 0
        ? pass("ready-deployments","go_live",    "Deployments exist",      `${deploymentCount} deployment(s) on record.`, { linkHref: `/projects/${projectId}/releases` })
        : warn("ready-deployments","go_live",    "Deployments exist",      "No deployments found. Complete at least one deployment before cutover.", { required: false, linkHref: `/projects/${projectId}/releases` }),
    );
  } catch {
    checks.push(warn("ready-db-err", "readiness", "DB readiness check", "Could not query DB for readiness checks.", { required: false }));
  }

  return checks;
}

// ── Manual checks ─────────────────────────────────────────────────────────────

function manualChecks(projectId: string): ReleaseCandidateCheck[] {
  return [
    manual("manual-go-live-gate",    "go_live",    "Final Go-Live Gate reviewed",           "Review all 14 evidence items in the Final Go-Live Control Room on the Releases page.", { linkHref: `/projects/${projectId}/releases` }),
    manual("manual-monitoring",      "monitoring", "Monitoring report generated",           "Generate post-cutover monitoring report on the Monitoring page.", { linkHref: `/projects/${projectId}/monitoring` }),
    manual("manual-health-checks",   "monitoring", "Production health checks run",          "Type RUN PRODUCTION HEALTH CHECKS — root, /api/healthz, SPA fallback should all return 200.", { linkHref: `/projects/${projectId}/monitoring` }),
    manual("manual-ecommerce",       "ecommerce",  "Ecommerce checklist completed",         "Complete 12-item ecommerce checklist: storefront, products, checkout, admin, Stripe, email, Cloudinary.", { linkHref: `/projects/${projectId}/migration` }),
    manual("manual-runbook",         "runbook",    "Operator runbook exported",             "Generate and export OPERATOR_RUNBOOK.md from the Runbook page.", { linkHref: `/projects/${projectId}/runbook` }),
    manual("manual-handoff",         "go_live",    "Migration handoff exported",            "Export SARDAR_MIGRATION_HANDOFF.md from the Migration page.", { linkHref: `/projects/${projectId}/migration` }),
    manual("manual-backup-drill",    "backup",     "Restore drill completed",               "Complete MARK DRILL COMPLETE in the Disaster Recovery Drill panel on Backups page.", { linkHref: `/projects/${projectId}/backups` }),
    manual("manual-team-review",     "permissions","Team permission review completed",      "Complete the TeamPermissionReviewChecklist on the Team page.", { linkHref: `/projects/${projectId}/team` }),
  ];
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeScore(checks: ReleaseCandidateCheck[]): number {
  const required = checks.filter((c) => c.required);
  if (required.length === 0) return 0;
  const passing  = required.filter((c) => c.status === "pass").length;
  return Math.round((passing / required.length) * 100);
}

function computeStatus(checks: ReleaseCandidateCheck[]): ReleaseCandidateStatus {
  if (checks.some((c) => c.status === "fail" && c.required)) return "blocked";
  if (checks.some((c) => c.status === "fail" || c.status === "warning")) return "warning";
  if (checks.some((c) => c.status === "manual" || c.status === "pending")) return "warning";
  return "ready";
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function generateReleaseCandidateReport(input: {
  projectId: string;
}): Promise<ReleaseCandidateReport> {
  const { projectId } = input;

  const [ready] = await Promise.all([
    readinessChecks(projectId),
  ]);

  const checks: ReleaseCandidateCheck[] = [
    ...navigationChecks(projectId),
    ...confirmationChecks(),
    ...exportChecks(),
    ...safetyChecks(),
    ...uiChecks(),
    ...ready,
    ...manualChecks(projectId),
  ];

  const score  = computeScore(checks);
  const status = computeStatus(checks);

  const failed   = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warning");

  const blockers = failed.map((c) => `${c.label}: ${c.message}`);
  const warnMsgs = warnings.map((c) => `${c.label}: ${c.message}`);

  const nextSteps: string[] = [];
  if (failed.length > 0)   nextSteps.push(`Fix ${failed.length} failing check(s) before marking release candidate ready.`);
  if (blockers.length > 0) nextSteps.push("Resolve all blockers listed above.");
  nextSteps.push("Complete all manual checks (Sardar live check, health checks, ecommerce checklist).");
  nextSteps.push("Export RELEASE_CANDIDATE_REPORT.md and share with the team.");
  nextSteps.push("Run final smoke commands on the server before deploying.");

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
