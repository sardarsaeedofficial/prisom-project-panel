/**
 * lib/backups/disaster-recovery-export.ts
 *
 * Sprint 60: Generate DISASTER_RECOVERY_REPORT.md from a DR report and optional
 * restore drill plan.
 *
 * Safety rules:
 *  - No secrets included — file names, sizes, checksums only.
 *  - No secret values, env values, or DB rows exposed.
 */

import type { DisasterRecoveryReport, RestoreDrillPlan, DisasterRecoveryCheck } from "./disaster-recovery-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: DisasterRecoveryCheck["status"]): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "🔧";
    case "pending": return "⏳";
  }
}

function drStatusIcon(s: DisasterRecoveryReport["status"]): string {
  switch (s) {
    case "ready":   return "✅";
    case "passed":  return "✅";
    case "warning": return "⚠️";
    case "blocked": return "🔴";
    case "failed":  return "🔴";
    case "running": return "⏳";
    default:        return "❓";
  }
}

function checkTable(checks: DisasterRecoveryCheck[]): string {
  if (checks.length === 0) return "_No checks._\n";
  const rows = checks
    .map((c) => `| ${statusIcon(c.status)} | ${c.label} | ${c.message.replace(/\|/g, "\\|").slice(0, 120)} |`)
    .join("\n");
  return `| Status | Check | Detail |\n|--------|-------|--------|\n${rows}\n`;
}

function checksForCategory(
  checks: DisasterRecoveryCheck[],
  category: DisasterRecoveryCheck["category"],
): DisasterRecoveryCheck[] {
  return checks.filter((c) => c.category === category);
}

// ── Export function ───────────────────────────────────────────────────────────

export function exportDisasterRecoveryReport(
  report: DisasterRecoveryReport,
  projectName: string,
  drillPlan?: RestoreDrillPlan | null,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# DISASTER_RECOVERY_REPORT — \`${projectName}\``);
  lines.push("");
  lines.push(`> Generated: ${new Date(report.generatedAt).toUTCString()}`);
  lines.push("");
  lines.push(`**Overall Status:** ${drStatusIcon(report.status)} ${report.status.toUpperCase()}`);
  lines.push("");
  lines.push(
    `**Summary:** ${report.summary.passed} passed · ${report.summary.warnings} warnings · ${report.summary.failed} failed · ${report.summary.manual} manual · ${report.summary.pending} pending`,
  );
  lines.push("");

  // Blockers
  if (report.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push("");
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push("## ⚠️ Warnings");
    lines.push("");
    report.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // Backup status
  lines.push("## Backup Status");
  lines.push("");
  lines.push(checkTable(checksForCategory(report.checks, "backup")));

  // Integrity
  const integrityChecks = checksForCategory(report.checks, "integrity");
  if (integrityChecks.length > 0) {
    lines.push("## Backup Integrity");
    lines.push("");
    lines.push(checkTable(integrityChecks));
  }

  // Restore drill plan
  if (drillPlan) {
    lines.push("## Restore Drill Plan");
    lines.push("");
    lines.push(
      `**Staging target:** \`${drillPlan.recommendedTargetSlug}\` — \`${drillPlan.recommendedTargetDomain}\``,
    );
    lines.push("");
    if (drillPlan.sourceBackupRef) {
      lines.push(
        `**Source backup:** \`${drillPlan.sourceBackupRef}\` — ${drillPlan.sourceBackupCreatedAt?.slice(0, 10) ?? "unknown date"}`,
      );
      lines.push("");
    }
    if (drillPlan.blockers.length > 0) {
      lines.push("**Blockers:**");
      drillPlan.blockers.forEach((b) => lines.push(`- ❌ ${b}`));
      lines.push("");
    }
    lines.push(checkTable(drillPlan.steps));
    if (drillPlan.nextSteps.length > 0) {
      lines.push("**Next steps:**");
      drillPlan.nextSteps.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
  }

  // Release rollback
  const releaseChecks = checksForCategory(report.checks, "release_rollback");
  if (releaseChecks.length > 0) {
    lines.push("## Release Rollback Readiness");
    lines.push("");
    lines.push(checkTable(releaseChecks));
    lines.push(
      "> **Note:** Application rollback does NOT automatically rollback database schema or data.",
    );
    lines.push("");
  }

  // Route rollback
  const routeChecks = checksForCategory(report.checks, "route_rollback");
  if (routeChecks.length > 0) {
    lines.push("## Route Rollback Plan");
    lines.push("");
    lines.push(checkTable(routeChecks));
    lines.push("**Manual nginx rollback steps:**");
    lines.push("1. `sudo cp /etc/nginx/sites-available/<project>.bak /etc/nginx/sites-available/<project>`");
    lines.push("2. `sudo nginx -t`");
    lines.push("3. If test passes: `sudo nginx -s reload`");
    lines.push("4. Verify domain resolves correctly.");
    lines.push("");
    lines.push("> Route rollback is manual. Never reload nginx without testing first.");
    lines.push("");
  }

  // Database rollback warning
  lines.push("## ⚠️ Database Rollback Warning");
  lines.push("");
  lines.push(
    "> **CRITICAL: Application rollback does NOT automatically rollback database schema or data.**",
  );
  lines.push("");
  lines.push(checkTable(checksForCategory(report.checks, "database")));
  lines.push("**Database rollback is manual only:**");
  lines.push("1. Take a DB dump before any migration: `pg_dump <db> > backup.sql`");
  lines.push("2. Keep the dump in a safe location outside the project directory.");
  lines.push("3. To restore: `psql <db> < backup.sql`");
  lines.push("4. Review all schema changes before applying in production.");
  lines.push("5. Test the restore on staging before applying to production.");
  lines.push("");
  lines.push(
    "> Database changes may be **irreversible** without a separate DB-level backup.",
  );
  lines.push("");

  // Monitoring
  lines.push("## Monitoring & Smoke Check Plan");
  lines.push("");
  lines.push("After any restore or rollback, run the following checks:");
  lines.push("");
  lines.push("```bash");
  lines.push("curl -I https://projects.doorstepmanchester.uk/login");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/");
  lines.push("curl -I https://sardar-security-project.doorstepmanchester.uk/api/healthz");
  lines.push("```");
  lines.push("");
  lines.push("Expected:");
  lines.push("- `/login` → HTTP 200");
  lines.push("- Sardar frontend → HTTP 200");
  lines.push("- Sardar health → HTTP 200");
  lines.push("");

  // Staging checks
  const stagingChecks = checksForCategory(report.checks, "staging");
  if (stagingChecks.length > 0) {
    lines.push("## Staging Restore Checklist");
    lines.push("");
    lines.push(checkTable(stagingChecks));
  }

  // Next steps
  if (report.nextSteps.length > 0) {
    lines.push("## Next Steps");
    lines.push("");
    report.nextSteps.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(
    "> This report was generated by Prisom Project Panel. No secret values are included.",
  );
  lines.push("> Always verify your backup and staging restore before production cutover.");
  lines.push("");

  return lines.join("\n");
}
