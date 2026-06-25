/**
 * lib/release-candidate/release-candidate-export.ts
 *
 * Sprint 68: Exports RELEASE_CANDIDATE_REPORT.md — no secrets included.
 */

import type { ReleaseCandidateReport, ReleaseCandidateCategory, ReleaseCandidateCheck } from "./release-candidate-types";

const CATEGORY_LABELS: Record<ReleaseCandidateCategory, string> = {
  navigation:    "Navigation",
  actions:       "Actions",
  permissions:   "Permissions",
  confirmations: "Confirmations",
  exports:       "Exports",
  readiness:     "Readiness",
  monitoring:    "Monitoring",
  backup:        "Backup",
  staging:       "Staging",
  go_live:       "Go-Live",
  ecommerce:     "Ecommerce",
  runbook:       "Runbook",
  safety:        "Safety",
  ui:            "UI",
};

const STATUS_EMOJI: Record<ReleaseCandidateCheck["status"], string> = {
  pass:    "✅",
  warning: "⚠️",
  fail:    "❌",
  manual:  "☐",
  pending: "⏳",
};

// ── Final smoke commands ───────────────────────────────────────────────────────

const SMOKE_COMMANDS = [
  "curl -I https://projects.doorstepmanchester.uk/login",
  "curl -I https://projects.doorstepmanchester.uk/dashboard",
  "curl -I https://projects.doorstepmanchester.uk/admin",
  "curl -I https://sardar-security-project.doorstepmanchester.uk/",
  "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
];

const SMOKE_EXPECTED = [
  "/login       → 200 OK",
  "/dashboard   → 307 redirect (login if unauthenticated)",
  "/admin       → 307 redirect (login if unauthenticated)",
  "Sardar frontend → 200 OK",
  "Sardar health   → 200 OK",
];

// ── Confirmation phrase index ─────────────────────────────────────────────────

const CONFIRMATION_PHRASES = [
  ["APPLY PRODUCTION CUTOVER",     "Production Execution Guard — /releases"],
  ["EXECUTE PRODUCTION ROLLBACK",  "Production Execution Guard — /releases"],
  ["RUN PRODUCTION SMOKE CHECKS",  "Production Execution Guard — /releases"],
  ["RUN PRODUCTION HEALTH CHECKS", "Post-Cutover Monitoring — /monitoring"],
  ["MARK INCIDENT REVIEWED",       "Post-Cutover Monitoring — /monitoring"],
  ["RUN SAFE ECOMMERCE CHECKS",    "Ecommerce Test Panel — /migration"],
  ["MARK ECOMMERCE PROOF COMPLETE","Ecommerce Test Panel — /migration"],
  ["RUN STAGING CHECKS",           "Staging Trial Panel — /migration"],
  ["MARK TRIAL COMPLETE",          "Staging Trial Panel — /migration"],
  ["MARK STAGING READY",           "Staging Deployment Panel — /migration"],
  ["RUN STAGING DRY RUN",          "Staging Deployment Panel — /migration"],
  ["PREPARE STAGING SOURCE",       "Staging Deployment Panel — /migration"],
  ["VERIFY BACKUP",                "Backups panel — /backups"],
  ["MARK DRILL COMPLETE",          "Disaster Recovery Drill — /backups"],
  ["GENERATE FINAL GO LIVE GATE",  "Final Go-Live Control Room — /releases"],
  ["MARK EVIDENCE REVIEWED",       "Final Go-Live Control Room — /releases"],
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function exportReleaseCandidateReport(report: ReleaseCandidateReport): string {
  const lines: string[] = [];

  // Header
  lines.push("# RELEASE_CANDIDATE_REPORT.md");
  lines.push(``);
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}  `);
  lines.push(`Project ID: ${report.projectId}  `);
  lines.push(`Status: **${report.status.toUpperCase()}**  `);
  lines.push(`Score: **${report.score}%** (${report.summary.passed}/${report.summary.total - report.summary.manual - report.summary.pending} automated checks passing)  `);
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Summary table
  lines.push("## Summary");
  lines.push(``);
  lines.push("| | Count |");
  lines.push("| --- | --- |");
  lines.push(`| ✅ Passed   | ${report.summary.passed}   |`);
  lines.push(`| ⚠️  Warnings | ${report.summary.warnings} |`);
  lines.push(`| ❌ Failed   | ${report.summary.failed}   |`);
  lines.push(`| ☐  Manual  | ${report.summary.manual}   |`);
  lines.push(`| ⏳ Pending  | ${report.summary.pending}  |`);
  lines.push(`| Total      | ${report.summary.total}    |`);
  lines.push(``);

  // Blockers
  if (report.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push(``);
    for (const b of report.blockers) {
      lines.push(`- ❌ ${b}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push("## ⚠️  Warnings");
    lines.push(``);
    for (const w of report.warnings) {
      lines.push(`- ⚠️  ${w}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Category matrix
  lines.push("## Category Matrix");
  lines.push(``);
  const categories = [...new Set(report.checks.map((c) => c.category))] as ReleaseCandidateCategory[];
  lines.push("| Category | Passed | Warnings | Failed | Manual |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const cat of categories) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    const p = catChecks.filter((c) => c.status === "pass").length;
    const w = catChecks.filter((c) => c.status === "warning").length;
    const f = catChecks.filter((c) => c.status === "fail").length;
    const m = catChecks.filter((c) => c.status === "manual").length;
    lines.push(`| ${CATEGORY_LABELS[cat]} | ${p} | ${w} | ${f} | ${m} |`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // All checks
  lines.push("## All Checks");
  lines.push(``);
  for (const cat of categories) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    lines.push(`### ${CATEGORY_LABELS[cat]}`);
    lines.push(``);
    for (const c of catChecks) {
      lines.push(`${STATUS_EMOJI[c.status]} **${c.label}**`);
      lines.push(`  ${c.message}`);
      if (c.warning) lines.push(`  > ⚠️  ${c.warning}`);
      lines.push(``);
    }
  }
  lines.push("---");
  lines.push(``);

  // Manual checks required
  const manualChecks = report.checks.filter((c) => c.status === "manual");
  if (manualChecks.length > 0) {
    lines.push("## Required Manual Checks");
    lines.push(``);
    for (const c of manualChecks) {
      lines.push(`- [ ] **${c.label}** — ${c.message}`);
      if (c.linkHref) lines.push(`  → ${c.linkHref}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Export coverage
  lines.push("## Export Coverage");
  lines.push(``);
  lines.push("All exports are available from the panel without secrets:");
  lines.push(``);
  const exportChecks = report.checks.filter((c) => c.category === "exports" || c.id.startsWith("export-"));
  for (const c of exportChecks) {
    lines.push(`- [ ] ${c.label.replace("Export: ", "")} — ${c.message.split(". No secrets")[0]}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Confirmation phrase index
  lines.push("## Confirmation Phrase Index");
  lines.push(``);
  lines.push("> **Reference only.** Do not enter these phrases unless intentionally executing that workflow.");
  lines.push(``);
  lines.push("| Phrase | Location |");
  lines.push("| --- | --- |");
  for (const [phrase, location] of CONFIRMATION_PHRASES) {
    lines.push(`| \`${phrase}\` | ${location} |`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Safety checklist
  lines.push("## Safety Checklist");
  lines.push(``);
  lines.push("Before deploying to production, confirm:");
  lines.push(``);
  lines.push("- [ ] No nginx write/reload will happen automatically");
  lines.push("- [ ] No PM2 restart will happen automatically");
  lines.push("- [ ] No DNS change is pending");
  lines.push("- [ ] No DB migration is queued");
  lines.push("- [ ] Exports contain no secrets");
  lines.push("- [ ] Doorsteps/LocalShop (/home/prisom/prisom-panel) is untouched");
  lines.push("- [ ] Live Sardar frontend returns 200 OK");
  lines.push("- [ ] Live Sardar health endpoint returns 200 OK");
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Final smoke commands
  lines.push("## Final Smoke Commands");
  lines.push(``);
  lines.push("Run on the server after deployment:");
  lines.push(``);
  lines.push("```bash");
  for (const cmd of SMOKE_COMMANDS) {
    lines.push(cmd);
  }
  lines.push("```");
  lines.push(``);
  lines.push("Expected:");
  lines.push(``);
  for (const expected of SMOKE_EXPECTED) {
    lines.push(`- ${expected}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Next steps
  if (report.nextSteps.length > 0) {
    lines.push("## Next Steps");
    lines.push(``);
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  lines.push("*This report was generated by Prisom Project Panel. No secrets are included.*");
  lines.push(``);

  return lines.join("\n");
}

export { SMOKE_COMMANDS, SMOKE_EXPECTED, CONFIRMATION_PHRASES };
