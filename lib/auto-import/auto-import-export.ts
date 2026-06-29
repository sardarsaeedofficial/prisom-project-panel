/**
 * lib/auto-import/auto-import-export.ts
 *
 * Sprint 86: Exports AUTO_IMPORT_RUNBOOK.md from an AutoImportRun.
 * No secrets in output.
 */

import type { AutoImportRun } from "./auto-import-types";

export function exportAutoImportRunbook(run: AutoImportRun, projectName: string): string {
  const lines: string[] = [];
  const ts = new Date(run.generatedAt).toUTCString();

  lines.push(`# AUTO_IMPORT_RUNBOOK.md — ${projectName}`);
  lines.push(``);
  lines.push(`Generated: ${ts}  `);
  lines.push(`Status: \`${run.status}\``);
  lines.push(``);

  // ── Detected Stack ──────────────────────────────────────────────────────────
  lines.push(`## Detected Stack`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Package Manager | ${run.detectedStack.packageManager} |`);
  lines.push(`| Frameworks | ${run.detectedStack.framework.join(", ") || "—"} |`);
  lines.push(`| Database | ${run.detectedStack.database.join(", ") || "—"} |`);
  lines.push(`| Route Mode | ${run.detectedStack.routeMode ?? "—"} |`);
  lines.push(`| Static Output Path | ${run.detectedStack.staticOutputPath ?? "—"} |`);
  lines.push(`| Health Path | ${run.detectedStack.healthPath ?? "—"} |`);
  lines.push(``);
  if (run.detectedStack.services.length > 0) {
    lines.push(`### Services`);
    lines.push(``);
    for (const svc of run.detectedStack.services) {
      lines.push(`- ${svc}`);
    }
    lines.push(``);
  }

  // ── Domains / Preview URLs ──────────────────────────────────────────────────
  lines.push(`## Domains & Preview URLs`);
  lines.push(``);
  if (run.domains.length === 0) {
    lines.push(`_No domains or endpoints configured yet._`);
  } else {
    lines.push(`| Type | URL | Status |`);
    lines.push(`|---|---|---|`);
    for (const d of run.domains) {
      lines.push(`| ${d.type} | ${d.url} | ${d.status} |`);
    }
  }
  lines.push(``);

  // ── Required Env Names ──────────────────────────────────────────────────────
  lines.push(`## Required Env Vars (names only — no values)`);
  lines.push(``);
  const required = run.missingEnvNames.filter((e) => e.required);
  const optional = run.missingEnvNames.filter((e) => !e.required);
  if (required.length === 0 && optional.length === 0) {
    lines.push(`_All required env vars are configured._`);
  } else {
    if (required.length > 0) {
      lines.push(`### Missing Required`);
      lines.push(``);
      lines.push(`| Name | Purpose |`);
      lines.push(`|---|---|`);
      for (const e of required) {
        lines.push(`| \`${e.name}\` | ${e.purpose} |`);
      }
      lines.push(``);
    }
    if (optional.length > 0) {
      lines.push(`### Missing Optional`);
      lines.push(``);
      lines.push(`| Name | Purpose |`);
      lines.push(`|---|---|`);
      for (const e of optional) {
        lines.push(`| \`${e.name}\` | ${e.purpose} |`);
      }
      lines.push(``);
    }
  }

  // ── Database Guidance ───────────────────────────────────────────────────────
  lines.push(`## Database Guidance`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Required | ${run.database.required ? "Yes" : "No"} |`);
  lines.push(`| Target DB configured | ${run.database.targetConfigured ? "Yes" : "No"} |`);
  lines.push(`| Source migration available | ${run.database.sourceMigrationAvailable ? "Yes" : "No"} |`);
  lines.push(``);
  lines.push(`> **Key rule:** Your Prisom \`DATABASE_URL\` = target/runtime database. Old Replit \`DATABASE_URL\` = source (migration only). Never wipe target automatically.`);
  lines.push(``);

  // ── Issues Found ────────────────────────────────────────────────────────────
  lines.push(`## Issues Found`);
  lines.push(``);
  if (run.issues.length === 0) {
    lines.push(`_No issues detected._`);
  } else {
    for (const issue of run.issues) {
      lines.push(`### ${issue.title}`);
      lines.push(``);
      lines.push(`- **Kind:** \`${issue.kind}\``);
      lines.push(`- **Message:** ${issue.message}`);
      if (issue.evidence) lines.push(`- **Evidence:** ${issue.evidence}`);
      if (issue.fix) {
        lines.push(`- **Safe Fix:** ${issue.fix.label}`);
        lines.push(`  - Confirmation required: ${issue.fix.confirmationRequired ? `Type \`${issue.fix.confirmationPhrase}\`` : "No"}`);
        for (const change of issue.fix.changes) {
          lines.push(`  - ${change}`);
        }
      }
      lines.push(``);
    }
  }

  // ── Preview Checks ──────────────────────────────────────────────────────────
  lines.push(`## Preview Checks`);
  lines.push(``);
  if (run.previewChecks.length === 0) {
    lines.push(`_No preview checks run yet. Deploy the project first._`);
  } else {
    lines.push(`| Path | Status | Result |`);
    lines.push(`|---|---|---|`);
    for (const c of run.previewChecks) {
      const icon = c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      lines.push(`| \`${c.path}\` | ${icon} ${c.status} | ${c.result} |`);
    }
  }
  lines.push(``);

  // ── Recommended Next Steps ──────────────────────────────────────────────────
  lines.push(`## Recommended Next Steps`);
  lines.push(``);
  if (run.recommendedNextSteps.length === 0) {
    lines.push(`_Nothing outstanding._`);
  } else {
    for (const step of run.recommendedNextSteps) {
      lines.push(`1. ${step}`);
    }
  }
  lines.push(``);

  // ── Safety Notes ────────────────────────────────────────────────────────────
  lines.push(`## Safety Notes`);
  lines.push(``);
  lines.push(`- No secret values are included in this runbook.`);
  lines.push(`- All fixes require explicit user confirmation (type the confirmation phrase).`);
  lines.push(`- Database wipe is never run automatically.`);
  lines.push(`- DNS/nginx changes require manual confirmation.`);
  lines.push(`- Production go-live requires explicit "GO LIVE" confirmation.`);
  lines.push(`- Doorsteps/LocalShop systems are never touched by Auto Import.`);
  lines.push(``);

  return lines.join("\n");
}
