/**
 * lib/migration/trial-migration-export.ts
 *
 * Sprint 61: Generate TRIAL_MIGRATION_REPORT.md from a trial migration run.
 *
 * Safety: no secrets included. Only public metadata and step statuses.
 */

import type {
  TrialMigrationRun,
  TrialMigrationStep,
  StagingSmokeCheckReport,
} from "./trial-migration-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIcon(status: TrialMigrationStep["status"]): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "🔧";
    case "pending": return "⏳";
  }
}

function smokeIcon(status: "pass" | "warning" | "fail"): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
  }
}

function overallIcon(status: TrialMigrationRun["status"]): string {
  switch (status) {
    case "passed":      return "✅";
    case "complete":    return "✅";
    case "warning":     return "⚠️";
    case "blocked":     return "🔴";
    case "failed":      return "🔴";
    case "running":     return "⏳";
    case "ready":       return "🟢";
    case "not_started": return "⬜";
  }
}

// ── Export function ───────────────────────────────────────────────────────────

export function exportTrialMigrationReport(
  run:        TrialMigrationRun,
  projectName: string,
  smokeReport?: StagingSmokeCheckReport | null,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# TRIAL_MIGRATION_REPORT — \`${projectName}\``);
  lines.push("");
  lines.push(`> Generated: ${new Date(run.generatedAt).toUTCString()}`);
  lines.push("");
  lines.push(`**Overall Status:** ${overallIcon(run.status)} ${run.status.toUpperCase().replace("_", " ")}`);
  lines.push("");
  lines.push(
    `**Staging target:** \`${run.recommendedStagingSlug}\` — ` +
    `\`https://${run.recommendedStagingDomain}\``,
  );
  lines.push("");

  // Blockers
  if (run.blockers.length > 0) {
    lines.push("## ❌ Blockers");
    lines.push("");
    run.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  // Warnings
  if (run.warnings.length > 0) {
    lines.push("## ⚠️ Warnings");
    lines.push("");
    run.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  // Stage checklist
  lines.push("## Stage Checklist");
  lines.push("");
  lines.push("| Stage | Status | Required | Pass / Total |");
  lines.push("|-------|--------|----------|--------------|");
  for (const stage of run.stages) {
    const total  = stage.steps.length;
    const passed = stage.steps.filter((s) => s.status === "pass").length;
    const icon   = overallIcon(stage.status);
    lines.push(`| ${stage.title} | ${icon} ${stage.status} | — | ${passed}/${total} |`);
  }
  lines.push("");

  // Per-stage detail
  for (const stage of run.stages) {
    lines.push(`## ${stage.title}`);
    lines.push("");
    for (const step of stage.steps) {
      const req = step.required ? " *(required)*" : "";
      lines.push(`### ${stepIcon(step.status)} ${step.title}${req}`);
      lines.push("");
      lines.push(step.description);
      lines.push("");
      if (step.warning) {
        lines.push(`> ⚠️ ${step.warning}`);
        lines.push("");
      }
      if (step.command) {
        lines.push("```bash");
        lines.push(step.command);
        lines.push("```");
        lines.push("");
      }
      if (step.confirmationRequired) {
        lines.push(
          `> Confirmation required: \`${step.confirmationRequired}\``,
        );
        lines.push("");
      }
      if (step.evidence && step.evidence.length > 0) {
        step.evidence.forEach((e) => lines.push(`- Evidence: \`${e}\``));
        lines.push("");
      }
    }
  }

  // Smoke check results
  if (smokeReport) {
    lines.push("## Staging Smoke Check Results");
    lines.push("");
    lines.push(`**Domain:** \`${smokeReport.domain}\``);
    lines.push(`**Checked at:** ${new Date(smokeReport.checkedAt).toUTCString()}`);
    lines.push(`**Overall:** ${smokeIcon(smokeReport.overall)} ${smokeReport.overall.toUpperCase()}`);
    lines.push("");
    lines.push("| URL | Status | HTTP | Duration |");
    lines.push("|-----|--------|------|----------|");
    for (const r of smokeReport.results) {
      const http = r.httpStatus !== null ? String(r.httpStatus) : "—";
      const dur  = r.durationMs !== null ? `${r.durationMs}ms` : "—";
      lines.push(`| \`${r.url}\` | ${smokeIcon(r.status)} ${r.status} | ${http} | ${dur} |`);
    }
    lines.push("");
    for (const r of smokeReport.results) {
      if (r.status !== "pass") {
        lines.push(`> ${smokeIcon(r.status)} **${r.url}**: ${r.message}`);
      }
    }
    lines.push("");
  }

  // Manual evidence checklist
  lines.push("## Manual Evidence Checklist");
  lines.push("");
  lines.push("> Tick each item after manually verifying.");
  lines.push("");
  const evidenceItems = [
    "Staging source imported into staging project",
    "Staging env values entered manually (no production secrets copied)",
    "Staging DB URL configured — separate from production",
    "Drizzle migration reviewed manually before running",
    "API service configured (artifacts/api-server)",
    "Static frontend service configured (artifacts/sardar-security/dist/public)",
    "Route preview checked — /api/* → API, /* → frontend",
    "Staging root URL checked and returns 200",
    "Staging API health endpoint (/api/healthz) returns 200",
    "Staging SPA fallback returns 200 (not 404)",
    "Stripe test mode reviewed — sk_test_* / pk_test_* keys used",
    "Cloudinary upload manually tested in staging",
    "Email provider manually tested (test delivery confirmed)",
    "Backup/restore drill reviewed — backup integrity confirmed",
  ];
  evidenceItems.forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push("");

  // Next steps before production cutover
  lines.push("## Next Steps Before Production Cutover");
  lines.push("");
  lines.push("> Only proceed to production cutover after this staging trial fully passes.");
  lines.push("");
  run.nextSteps.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("### Production Cutover Checklist (after trial passes)");
  lines.push("");
  lines.push("- [ ] All staging smoke checks pass");
  lines.push("- [ ] Manual evidence checklist complete");
  lines.push("- [ ] Backup created and integrity verified");
  lines.push("- [ ] Restore drill completed");
  lines.push("- [ ] Team permissions reviewed (Team page)");
  lines.push("- [ ] Go-live readiness: no blockers");
  lines.push("- [ ] External services confirmed in live mode");
  lines.push("- [ ] DNS / domain updated to point to production server");
  lines.push("- [ ] Nginx production routes applied (APPLY ROUTES)");
  lines.push("- [ ] Smoke checks on live domain (RUN SMOKE CHECKS)");
  lines.push("- [ ] Mark Cutover Complete (MARK CUTOVER COMPLETE)");
  lines.push("");

  // Safety reminders
  lines.push("## Safety Reminders");
  lines.push("");
  lines.push("- This trial does NOT modify live Sardar production routing");
  lines.push("- This trial does NOT apply nginx production routes");
  lines.push("- This trial does NOT run production DB migrations");
  lines.push("- This trial does NOT restart live PM2 services");
  lines.push("- This trial does NOT expose secrets in this document");
  lines.push("- Doorsteps/LocalShop is untouched");
  lines.push("");

  // Footer
  lines.push("---");
  lines.push("");
  lines.push("> Generated by Prisom Project Panel — Sprint 61 Staging Trial Migration.");
  lines.push("> No secret values are included in this document.");
  lines.push("");

  return lines.join("\n");
}
