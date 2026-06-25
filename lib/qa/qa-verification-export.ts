/**
 * lib/qa/qa-verification-export.ts
 *
 * Sprint 69: Exports QA_VERIFICATION_REPORT.md — no secrets included.
 */

import type { QaVerificationReport, QaVerificationCategory, QaVerificationCheck, LiveSmokeReport } from "./qa-verification-types";

const CATEGORY_LABELS: Record<QaVerificationCategory, string> = {
  routes:        "Routes",
  navigation:    "Navigation",
  pages:         "Pages",
  exports:       "Exports",
  confirmations: "Confirmations",
  permissions:   "Permissions",
  safety:        "Safety",
  smoke_checks:  "Smoke Checks",
  sardar:        "Sardar",
  admin:         "Admin",
  ui:            "UI",
  manual:        "Manual QA",
};

const STATUS_ICON: Record<QaVerificationCheck["status"], string> = {
  pass:    "✅",
  warning: "⚠️",
  fail:    "❌",
  manual:  "☐",
  pending: "⏳",
};

const SMOKE_COMMANDS = [
  "curl -I https://projects.doorstepmanchester.uk/login",
  "curl -I https://projects.doorstepmanchester.uk/dashboard",
  "curl -I https://projects.doorstepmanchester.uk/admin",
  "curl -I https://sardar-security-project.doorstepmanchester.uk/",
  "curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz",
];

const SMOKE_EXPECTED = [
  "/login       → 200 OK",
  "/dashboard   → 307 redirect (unauthenticated)",
  "/admin       → 307 redirect (unauthenticated)",
  "Sardar root  → 200 OK",
  "Sardar health → 200 OK",
];

export function exportQaVerificationReport(
  report: QaVerificationReport,
  smokeReport?: LiveSmokeReport,
): string {
  const lines: string[] = [];

  // Header
  lines.push("# QA_VERIFICATION_REPORT.md");
  lines.push(``);
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}  `);
  lines.push(`Project ID: ${report.projectId}  `);
  lines.push(`Status: **${report.status.toUpperCase()}**  `);
  lines.push(`Score: **${report.score}%** (automated checks)  `);
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Summary
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
    for (const b of report.blockers) lines.push(`- ❌ ${b}`);
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push("## ⚠️  Warnings");
    lines.push(``);
    for (const w of report.warnings) lines.push(`- ⚠️  ${w}`);
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Category matrix
  const categories = [...new Set(report.checks.map((c) => c.category))] as QaVerificationCategory[];
  lines.push("## Category Matrix");
  lines.push(``);
  lines.push("| Category | Passed | Warnings | Failed | Manual |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const cat of categories) {
    const cc = report.checks.filter((c) => c.category === cat);
    const p  = cc.filter((c) => c.status === "pass").length;
    const w  = cc.filter((c) => c.status === "warning").length;
    const f  = cc.filter((c) => c.status === "fail").length;
    const m  = cc.filter((c) => c.status === "manual").length;
    lines.push(`| ${CATEGORY_LABELS[cat]} | ${p} | ${w} | ${f} | ${m} |`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Route/page checklist
  lines.push("## Route & Page Checklist");
  lines.push(``);
  const routePages = report.checks.filter((c) => c.category === "routes" || c.category === "pages");
  for (const c of routePages) {
    lines.push(`${STATUS_ICON[c.status]} **${c.label}**`);
    lines.push(`  ${c.message}`);
    lines.push(``);
  }
  lines.push("---");
  lines.push(``);

  // Export checklist
  lines.push("## Export Coverage");
  lines.push(``);
  const exportChecks = report.checks.filter((c) => c.category === "exports");
  for (const c of exportChecks) {
    lines.push(`${STATUS_ICON[c.status]} ${c.label.replace("Export: ", "")}`);
    lines.push(`  ${c.message}`);
    lines.push(``);
  }
  lines.push("---");
  lines.push(``);

  // Confirmation phrase checklist
  lines.push("## Confirmation Phrase Checklist");
  lines.push(``);
  lines.push("> **Reference only** — do not enter these phrases unless intentionally executing that workflow.");
  lines.push(``);
  const confirmChecks = report.checks.filter((c) => c.category === "confirmations");
  for (const c of confirmChecks) {
    const phrase = c.evidence?.[0] ?? c.label.replace("Confirmation: ", "");
    lines.push(`${STATUS_ICON[c.status]} \`${phrase}\` — ${c.message.replace(/Required typed confirmation present — /, "")}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Safety checklist
  lines.push("## Safety Checklist");
  lines.push(``);
  const safetyChecks = report.checks.filter((c) => c.category === "safety");
  for (const c of safetyChecks) {
    lines.push(`${STATUS_ICON[c.status]} **${c.label}** — ${c.message}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Live smoke results (if run)
  if (smokeReport) {
    lines.push("## Live Smoke Check Results");
    lines.push(``);
    lines.push(`Status: **${smokeReport.status.toUpperCase()}**`);
    lines.push(`Run at: ${new Date(smokeReport.generatedAt).toLocaleString()}`);
    lines.push(``);
    lines.push("| Check | URL | Status | HTTP |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of smokeReport.results) {
      const icon = r.status === "pass" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
      lines.push(`| ${icon} ${r.label} | ${r.url} | ${r.status} | ${r.httpStatus ?? "—"} |`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Smoke commands
  lines.push("## Smoke Commands");
  lines.push(``);
  lines.push("```bash");
  for (const cmd of SMOKE_COMMANDS) lines.push(cmd);
  lines.push("```");
  lines.push(``);
  lines.push("Expected:");
  lines.push(``);
  for (const exp of SMOKE_EXPECTED) lines.push(`- ${exp}`);
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Manual QA checks
  const manualChecks = report.checks.filter((c) => c.status === "manual");
  if (manualChecks.length > 0) {
    lines.push("## Remaining Manual QA");
    lines.push(``);
    for (const c of manualChecks) {
      lines.push(`- [ ] **${c.label}** — ${c.message}`);
      if (c.linkHref) lines.push(`  → ${c.linkHref}`);
      if (c.command)  lines.push(`  \`${c.command}\``);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Next steps
  if (report.nextSteps.length > 0) {
    lines.push("## Next Steps");
    lines.push(``);
    for (const step of report.nextSteps) lines.push(`- ${step}`);
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  lines.push("*This report was generated by Prisom Project Panel. No secrets are included.*");
  lines.push(``);

  return lines.join("\n");
}
