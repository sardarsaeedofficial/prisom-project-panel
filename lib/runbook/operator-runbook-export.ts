/**
 * lib/runbook/operator-runbook-export.ts
 *
 * Sprint 67: Exports OPERATOR_RUNBOOK.md — no secrets included.
 */

import type { OperatorRunbook, RunbookSection } from "./operator-runbook-types";

const PRIORITY_LABEL: Record<RunbookSection["priority"], string> = {
  critical: "CRITICAL",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
};

function sectionBlock(s: RunbookSection): string {
  const lines: string[] = [
    `## ${s.title}`,
    ``,
    `**Priority:** ${PRIORITY_LABEL[s.priority]}  `,
    `**Audience:** ${s.audience.join(", ")}  `,
    ``,
    `${s.summary}`,
    ``,
  ];

  for (const step of s.steps) {
    lines.push(`### ${step.label}`);
    lines.push(``);
    lines.push(step.description);
    if (step.command) {
      lines.push(``);
      lines.push("```bash");
      lines.push(step.command);
      lines.push("```");
    }
    if (step.linkHref) {
      lines.push(``);
      lines.push(`→ ${step.linkHref}`);
    }
    if (step.warning) {
      lines.push(``);
      lines.push(`> ⚠️  ${step.warning}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function exportOperatorRunbook(runbook: OperatorRunbook): string {
  const lines: string[] = [];

  lines.push(`# ${runbook.title}`);
  lines.push(``);
  lines.push(`Generated: ${new Date(runbook.generatedAt).toLocaleString()}  `);
  lines.push(`Status: ${runbook.status.toUpperCase()}  `);
  if (runbook.projectId) {
    lines.push(`Project ID: ${runbook.projectId}  `);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Warnings
  if (runbook.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push(``);
    for (const w of runbook.warnings) {
      lines.push(`- ⚠️  ${w}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  // Table of contents
  lines.push("## Table of Contents");
  lines.push(``);
  for (const s of runbook.sections) {
    lines.push(`- [${s.title}](#${s.id}) — ${s.summary}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Sections
  for (const s of runbook.sections) {
    lines.push(sectionBlock(s));
    lines.push("---");
    lines.push(``);
  }

  // Daily operations checklist (standalone)
  lines.push("## Daily Operator Checklist");
  lines.push(``);
  lines.push("Use this as a quick reference each day:");
  lines.push(``);
  const daily = runbook.sections.find((s) => s.id === "daily_operations");
  if (daily) {
    for (const step of daily.steps) {
      lines.push(`- [ ] ${step.label} — ${step.description}`);
    }
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Admin onboarding checklist
  lines.push("## Admin Onboarding Checklist");
  lines.push(``);
  const onboarding = [
    "Login tested",
    "Admin users reviewed (/admin/users)",
    "Project team reviewed",
    "Owner/admin confirmed",
    "Deploy permissions reviewed",
    "Env/secret access reviewed",
    "Backup page reviewed",
    "Monitoring page reviewed",
    "Logs/debug page reviewed",
    "Final Go-Live Control Room reviewed",
    "Incident response process reviewed",
    "Handoff exports reviewed",
  ];
  for (const item of onboarding) {
    lines.push(`- [ ] ${item}`);
  }
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Incident response quick guide
  lines.push("## Incident Response Quick Guide");
  lines.push(``);
  lines.push("| Severity | Condition | Action |");
  lines.push("| --- | --- | --- |");
  lines.push("| Critical | Root or API unreachable | Check PM2/nginx logs immediately. Consider rollback. |");
  lines.push("| High | Products API down | Check app logs, DB connection. Assess checkout. |");
  lines.push("| Medium | External service warning | Check Stripe/email/Cloudinary dashboards. |");
  lines.push("| Low | Manual checks pending | Complete ecommerce checklist. Monitor 30 min. |");
  lines.push("| None | All checks pass | Continue monitoring. Re-run checks in 10-15 min. |");
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Rollback warning
  lines.push("## Rollback Warning");
  lines.push(``);
  lines.push("> **IMPORTANT:** Rollback does NOT rollback the database automatically.");
  lines.push("> If a DB migration ran before cutover, coordinate with DBA for a separate pg_dump restore.");
  lines.push("> Never restore from backup without confirming DB state first.");
  lines.push(``);
  lines.push("Rollback steps:");
  lines.push("1. Identify previous deployment ref (Releases page)");
  lines.push("2. Confirm backup exists (Backups page)");
  lines.push("3. Type EXECUTE PRODUCTION ROLLBACK in Production Execution Guard (records request only)");
  lines.push("4. Operator manually: sudo cp nginx.bak → sudo nginx -t → sudo nginx -s reload");
  lines.push("5. Verify: Run production health checks on Monitoring page");
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Key exports
  lines.push("## Key Documentation Exports");
  lines.push(``);
  lines.push("| File | Location | Description |");
  lines.push("| --- | --- | --- |");
  lines.push("| SARDAR_MIGRATION_HANDOFF.md | Migration page | Complete migration handoff |");
  lines.push("| FINAL_GO_LIVE_PACK.md | Releases → Final Go-Live Control Room | Go-live gate export |");
  lines.push("| PRODUCTION_CUTOVER_EXECUTION_PLAN.md | Releases → Production Cutover Guard | Cutover execution plan |");
  lines.push("| POST_CUTOVER_MONITORING_REPORT.md | Monitoring → Post-Cutover Control Room | Monitoring report |");
  lines.push("| OPERATOR_RUNBOOK.md | Settings/Runbook page | This document |");
  lines.push(``);
  lines.push("---");
  lines.push(``);

  // Next steps
  if (runbook.nextSteps.length > 0) {
    lines.push("## Recommended Next Steps");
    lines.push(``);
    for (const step of runbook.nextSteps) {
      lines.push(`- ${step}`);
    }
    lines.push(``);
    lines.push("---");
    lines.push(``);
  }

  lines.push("*This document was generated by Prisom Project Panel. No secrets are included.*");
  lines.push(``);

  return lines.join("\n");
}
