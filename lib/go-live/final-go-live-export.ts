/**
 * lib/go-live/final-go-live-export.ts
 *
 * Sprint 63: Generate FINAL_GO_LIVE_PACK.md from a gate report.
 *
 * Safety: no secrets, no production mutations.
 */

import type {
  FinalGoLiveGateReport,
  FinalGoLiveCheck,
  FinalGoLiveCategory,
} from "./final-go-live-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(s: FinalGoLiveCheck["status"]): string {
  switch (s) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "🔧";
    case "pending": return "⏳";
  }
}

function overallIcon(s: FinalGoLiveGateReport["status"]): string {
  switch (s) {
    case "ready":   return "✅";
    case "warning": return "⚠️";
    case "blocked": return "🔴";
    case "unknown": return "❓";
  }
}

const CATEGORY_LABELS: Record<FinalGoLiveCategory, string> = {
  source:            "Source",
  staging:           "Staging",
  ecommerce:         "Ecommerce",
  env:               "Env / Secrets",
  database:          "Database",
  external_services: "External Services",
  routing:           "Routing",
  domains:           "Domains",
  deployment:        "Deployment",
  backup:            "Backup",
  permissions:       "Permissions",
  monitoring:        "Monitoring",
  rollback:          "Rollback",
  manual:            "Manual Sign-Off",
};

const CATEGORY_ORDER: FinalGoLiveCategory[] = [
  "source", "staging", "ecommerce", "env", "database",
  "external_services", "routing", "domains", "deployment",
  "backup", "permissions", "monitoring", "rollback", "manual",
];

// ── Main export ───────────────────────────────────────────────────────────────

export function exportFinalGoLivePack(
  report:      FinalGoLiveGateReport,
  projectName: string,
): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# FINAL_GO_LIVE_PACK — \`${projectName}\``);
  lines.push("");
  lines.push(`> Generated: ${new Date(report.generatedAt).toUTCString()}`);
  lines.push(`> **Overall:** ${overallIcon(report.status)} ${report.status.toUpperCase()}`);
  lines.push(`> **Readiness Score:** ${report.readinessScore}%`);
  lines.push("");
  lines.push("| Passed | Warnings | Failed | Manual | Total |");
  lines.push("|--------|----------|--------|--------|-------|");
  lines.push(`| ${report.summary.passed} | ${report.summary.warnings} | ${report.summary.failed} | ${report.summary.manual} | ${report.summary.total} |`);
  lines.push("");

  // ── Safety ────────────────────────────────────────────────────────────────
  lines.push("## ⚠️  Safety Notice");
  lines.push("");
  lines.push("This pack is a readiness assessment only. No production changes are automatic.");
  lines.push("");
  lines.push("- No nginx routes are applied by exporting this document");
  lines.push("- No DNS changes are made");
  lines.push("- No PM2 processes are restarted");
  lines.push("- No DB migrations are run");
  lines.push("- No secrets are included in this document");
  lines.push("- Doorsteps/LocalShop is untouched");
  lines.push("");

  // ── Blockers ──────────────────────────────────────────────────────────────
  if (report.blockers.length > 0) {
    lines.push("## ❌ Blockers — Must Resolve Before Go-Live");
    lines.push("");
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (report.warnings.length > 0) {
    lines.push("## ⚠️  Warnings");
    lines.push("");
    report.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // ── Category matrix ───────────────────────────────────────────────────────
  lines.push("## Category Readiness Matrix");
  lines.push("");
  lines.push("| Category | Pass | Warn | Fail | Manual | Status |");
  lines.push("|----------|------|------|------|--------|--------|");
  for (const cat of CATEGORY_ORDER) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;
    const pass   = catChecks.filter((c) => c.status === "pass").length;
    const warn   = catChecks.filter((c) => c.status === "warning").length;
    const fail   = catChecks.filter((c) => c.status === "fail").length;
    const manual = catChecks.filter((c) => c.status === "manual").length;
    const catStatus = fail > 0 ? "❌" : warn > 0 ? "⚠️" : "✅";
    lines.push(`| ${CATEGORY_LABELS[cat]} | ${pass} | ${warn} | ${fail} | ${manual} | ${catStatus} |`);
  }
  lines.push("");

  // ── Per-category detail ───────────────────────────────────────────────────
  for (const cat of CATEGORY_ORDER) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[cat]}`);
    lines.push("");
    for (const c of catChecks) {
      const req = c.required ? " *(required)*" : "";
      lines.push(`### ${statusIcon(c.status)} ${c.label}${req}`);
      lines.push("");
      lines.push(c.message);
      if (c.warning) {
        lines.push("");
        lines.push(`> ⚠️  ${c.warning}`);
      }
      if (c.command) {
        lines.push("");
        lines.push("```bash");
        lines.push(c.command);
        lines.push("```");
      }
      if (c.evidence?.length) {
        lines.push("");
        c.evidence.forEach((e) => lines.push(`- Evidence: \`${e}\``));
      }
      lines.push("");
    }
  }

  // ── Final evidence checklist ──────────────────────────────────────────────
  lines.push("## Final Evidence Checklist");
  lines.push("");
  lines.push("> Complete all items before production cutover.");
  lines.push("");
  [
    "Source intake reviewed",
    "Staging trial migration reviewed (MARK TRIAL COMPLETE)",
    "Ecommerce proof reviewed (MARK ECOMMERCE PROOF COMPLETE)",
    "Backup/restore drill reviewed (MARK DRILL COMPLETE)",
    "Team permissions reviewed",
    "Env/secrets reviewed (no placeholders, no localhost)",
    "Database readiness reviewed (connection test passed)",
    "External services reviewed (Stripe/Cloudinary/email on staging)",
    "Routing plan reviewed (nginx preview approved)",
    "Domain/SSL health reviewed",
    "Build dry run reviewed",
    "Rollback plan reviewed",
    "Debug/logs page checked",
    "Owner sign-off obtained",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // ── Pre-cutover commands ──────────────────────────────────────────────────
  lines.push("## Pre-Cutover Commands (Reference Only — Do Not Auto-Execute)");
  lines.push("");
  lines.push("> Run these manually with team present. Do not execute from this document.");
  lines.push("");
  lines.push("```bash");
  lines.push("# 1. Verify live Sardar project is healthy");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz");
  lines.push("");
  lines.push("# 2. Verify panel is healthy");
  lines.push("curl -I https://projects.doorstepmanchester.uk/login");
  lines.push("");
  lines.push("# 3. Create final backup BEFORE cutover");
  lines.push("# (Use Backups page → Create Backup)");
  lines.push("");
  lines.push("# 4. Review nginx config before applying");
  lines.push("sudo nginx -t");
  lines.push("");
  lines.push("# 5. Check PM2 status before restart");
  lines.push("pm2 list");
  lines.push("pm2 logs project-sardar-security-project --lines 20 --nostream");
  lines.push("```");
  lines.push("");

  // ── Post-cutover smoke checklist ──────────────────────────────────────────
  lines.push("## Post-Cutover Smoke Checklist");
  lines.push("");
  lines.push("> Run after applying production routes and restarting services.");
  lines.push("> **Do not run real payment/order tests against production without explicit business approval.**");
  lines.push("");
  lines.push("```bash");
  lines.push("# Production smoke checks");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/products");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/non-existent-route");
  lines.push("```");
  lines.push("");
  [
    "Production root URL returns 200",
    "Production /api/healthz returns 200",
    "SPA fallback route returns 200",
    "Product listing loads",
    "Product detail loads",
    "Cart functionality works",
    "Checkout page loads (no real payments yet)",
    "Admin login works",
    "Admin orders page accessible",
    "PM2 logs show no errors",
    "Nginx logs show no 502/503 errors",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");
  lines.push("> ⚠️  **IMPORTANT:** Do not place real production orders until you have confirmed");
  lines.push("> Stripe live keys are configured and the Stripe live dashboard shows correct products/prices.");
  lines.push("");

  // ── Rollback checklist ────────────────────────────────────────────────────
  lines.push("## Rollback Decision Checklist");
  lines.push("");
  lines.push("> ⚠️  Application rollback does NOT rollback database schema/data.");
  lines.push("> If you applied DB migrations, restore from a pg_dump instead.");
  lines.push("");
  [
    "App rollback target selected (previous deployment ref noted)",
    "Route rollback preview reviewed (nginx .bak file confirmed)",
    "DB rollback limitation understood (schema/data not rolled back)",
    "Backup location known (Backups page)",
    "Rollback owner assigned",
    "Health checks after rollback documented",
  ].forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");
  lines.push("### Rollback Commands (Reference Only)");
  lines.push("");
  lines.push("```bash");
  lines.push("# App rollback: use Releases page → Rollback → type ROLLBACK");
  lines.push("");
  lines.push("# Route rollback (nginx):");
  lines.push("sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>");
  lines.push("sudo nginx -t");
  lines.push("sudo nginx -s reload");
  lines.push("");
  lines.push("# DB rollback (if migration was applied):");
  lines.push("psql <db_url> < backup_before_migration.sql");
  lines.push("```");
  lines.push("");

  // ── Key URLs ──────────────────────────────────────────────────────────────
  lines.push("## Key URLs");
  lines.push("");
  lines.push("| Resource | URL |");
  lines.push("|----------|-----|");
  lines.push("| Live Sardar | `https://sardar-security-project.doorstepmanchester.uk/` |");
  lines.push("| Sardar health | `https://sardar-security-project.doorstepmanchester.uk/api/healthz` |");
  lines.push("| Staging | `https://staging-sardar-security-project.doorstepmanchester.uk/` |");
  lines.push("| Panel | `https://projects.doorstepmanchester.uk/login` |");
  lines.push("");

  // ── Next steps ────────────────────────────────────────────────────────────
  lines.push("## Next Steps");
  lines.push("");
  report.nextSteps.forEach((s) => lines.push(`- ${s}`));
  lines.push("");

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("> Generated by Prisom Project Panel — Sprint 63 Final Go-Live Control Room.");
  lines.push("> No secret values are included in this document.");
  lines.push("> No production changes are applied by exporting this document.");
  lines.push("");

  return lines.join("\n");
}
