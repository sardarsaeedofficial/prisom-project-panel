/**
 * lib/launch-signoff/launch-signoff-export.ts
 *
 * Sprint 74: Generates FINAL_LAUNCH_SIGNOFF.md — a human-readable signoff
 * document for client handover. No secrets included.
 */

import type { LaunchSignoffReport, LaunchSignoffCheck, LaunchSignoffCheckCategory } from "./launch-signoff-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: LaunchSignoffCheck["status"]): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "blocked": return "🔴";
    case "manual":  return "🔲";
    default:        return "⬜";
  }
}

function overallIcon(status: LaunchSignoffReport["status"]): string {
  switch (status) {
    case "ready":      return "✅";
    case "in_progress":return "🔵";
    case "blocked":    return "🔴";
    case "signed_off": return "🏁";
    default:           return "⬜";
  }
}

function overallLabel(status: LaunchSignoffReport["status"]): string {
  switch (status) {
    case "ready":       return "READY FOR LAUNCH";
    case "in_progress": return "IN PROGRESS";
    case "blocked":     return "BLOCKED";
    case "signed_off":  return "SIGNED OFF";
    default:            return "NOT STARTED";
  }
}

const CATEGORY_LABELS: Record<LaunchSignoffCheckCategory, string> = {
  qa:               "QA Verification",
  release_candidate:"Release Candidate",
  staging:          "Staging & Deployment",
  ecommerce:        "Ecommerce",
  backups:          "Backups & Recovery",
  monitoring:       "Monitoring",
  security:         "Security & Secrets",
  team:             "Team & Permissions",
  runbook:          "Operator Runbook",
  client_handover:  "Client Handover",
};

const CATEGORY_ORDER: LaunchSignoffCheckCategory[] = [
  "staging", "ecommerce", "backups", "qa", "release_candidate",
  "monitoring", "security", "team", "runbook", "client_handover",
];

// ── Export ────────────────────────────────────────────────────────────────────

export function exportLaunchSignoffReport(report: LaunchSignoffReport): string {
  const generatedAt = new Date(report.generatedAt).toUTCString();
  const icon        = overallIcon(report.status);
  const label       = overallLabel(report.status);

  const sections: string[] = [];

  sections.push(`# Final Launch Signoff — Project ${report.projectId}

> Generated: ${generatedAt}
> **Do not share this document externally until the Manual Signoff section is completed.**

## Overall Status

${icon} **${label}**

| Item | Value |
|------|-------|
| Score | ${report.score}% of required checks passed |
| Blockers | ${report.blockers.length} |
| Warnings | ${report.warnings.length} |
| Required evidence items | ${report.requiredEvidence.length} |
`);

  // Blockers
  if (report.blockers.length > 0) {
    sections.push(`## 🔴 Blockers\n\nResolve these before launch:\n\n${report.blockers.map((b) => `- ${b}`).join("\n")}\n`);
  }

  // Warnings
  if (report.warnings.length > 0) {
    sections.push(`## ⚠️ Warnings\n\nReview before launch:\n\n${report.warnings.map((w) => `- ${w}`).join("\n")}\n`);
  }

  // Checks by category
  sections.push("## Signoff Checklist\n");
  for (const cat of CATEGORY_ORDER) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;
    sections.push(`### ${CATEGORY_LABELS[cat]}\n`);
    for (const c of catChecks) {
      const req  = c.required ? " *(required)*" : " *(optional)*";
      const evid = c.evidence ? `\n  - Evidence: \`${c.evidence}\`` : "";
      const next = c.nextStep ? `\n  - Next step: ${c.nextStep}` : "";
      sections.push(`- ${statusIcon(c.status)} **${c.label}**${req}\n  ${c.description}${evid}${next}\n`);
    }
  }

  // Required evidence
  if (report.requiredEvidence.length > 0) {
    sections.push(`## Evidence Checklist\n\nAll required evidence must be present before launch:\n\n${report.requiredEvidence.map((e) => `- [ ] ${e}`).join("\n")}\n`);
  }

  // Next steps
  if (report.recommendedNextSteps.length > 0) {
    sections.push(`## Recommended Next Steps\n\n${report.recommendedNextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`);
  }

  // Safety notes
  sections.push(`## Safety Notes

- Do not apply production routes from the panel UI.
- Do not reload nginx from the panel UI.
- Do not restart PM2 processes from the panel UI.
- Do not run database migrations from the panel.
- Do not restore backups to production without a verified backup.
- Do not share this document with external parties before the Manual Signoff is complete.
- Confirm the live Sardar health endpoint (/api/healthz) returns 200 before and after cutover.
`);

  // Manual signoff
  sections.push(`## Manual Signoff

Complete this section by hand before final launch approval.

| Field | Value |
|-------|-------|
| Operator name | ____________________________________________ |
| Date | ____________________________________________ |
| Final decision | ☐ Approved  ☐ Blocked  ☐ Deferred |
| Notes | ____________________________________________ |

---
*Generated by Prisom Project Panel — Sprint 74. This document is read-only and contains no secrets.*
`);

  return sections.join("\n");
}
