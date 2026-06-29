/**
 * lib/ai-import-operator/ai-import-operator-export.ts
 *
 * Sprint 87: Exports AI_IMPORT_OPERATOR_RUNBOOK.md from an AiImportOperatorRun.
 * No secret values in output.
 */

import type { AiImportOperatorRun } from "./ai-import-operator-types";

export function exportAiImportOperatorRunbook(
  run: AiImportOperatorRun,
  projectName: string,
): string {
  const lines: string[] = [];
  const ts = new Date(run.generatedAt).toUTCString();

  lines.push(`# AI_IMPORT_OPERATOR_RUNBOOK.md — ${projectName}`);
  lines.push(``);
  lines.push(`Generated: ${ts}  `);
  lines.push(`Status: \`${run.status}\``);
  lines.push(``);

  // ── Plain English Status ────────────────────────────────────────────────────
  lines.push(`## Status`);
  lines.push(``);
  lines.push(`> ${run.plainEnglishSummary}`);
  lines.push(``);
  if (run.currentQuestion) {
    lines.push(`**Next question:** ${run.currentQuestion}`);
    lines.push(``);
  }

  // ── Preview / Domain URLs ───────────────────────────────────────────────────
  lines.push(`## URLs`);
  lines.push(``);
  lines.push(`| Type | URL |`);
  lines.push(`|---|---|`);
  lines.push(`| Preview | ${run.previewUrl ?? "—"} |`);
  lines.push(`| Public domain | ${run.publicDomain ?? "Not configured"} |`);
  lines.push(`| Health check | ${run.healthUrl ?? "—"} |`);
  lines.push(``);

  // ── User Inputs Needed ─────────────────────────────────────────────────────
  lines.push(`## Required Inputs (names only — no values)`);
  lines.push(``);
  if (run.userInputsNeeded.length === 0) {
    lines.push(`_All required values are configured._`);
  } else {
    lines.push(`| Field | Required | Purpose |`);
    lines.push(`|---|---|---|`);
    for (const inp of run.userInputsNeeded) {
      lines.push(`| \`${inp.fieldName ?? inp.id}\` | ${inp.required ? "Yes" : "No"} | ${inp.description} |`);
    }
  }
  lines.push(``);

  // ── Fix Plan ────────────────────────────────────────────────────────────────
  if (run.fixPlan) {
    lines.push(`## Recommended Fix`);
    lines.push(``);
    lines.push(`**${run.fixPlan.title}**`);
    lines.push(``);
    lines.push(run.fixPlan.plainEnglishSummary);
    lines.push(``);
    lines.push(`Technical changes:`);
    for (const c of run.fixPlan.technicalChanges) {
      lines.push(`- ${c}`);
    }
    lines.push(``);
    lines.push(`Confirmation required: type \`${run.fixPlan.confirmationPhrase}\` to apply.`);
    lines.push(``);
  }

  // ── Steps ──────────────────────────────────────────────────────────────────
  lines.push(`## Steps`);
  lines.push(``);
  lines.push(`| Step | Status | Message |`);
  lines.push(`|---|---|---|`);
  const statusIcon = (s: string) =>
    s === "passed" ? "✅" : s === "warning" ? "⚠️" : s === "blocked" ? "❌" : "⏳";
  for (const step of run.steps) {
    lines.push(`| ${step.label} | ${statusIcon(step.status)} ${step.status} | ${step.message} |`);
  }
  lines.push(``);

  // ── Preview Checks ─────────────────────────────────────────────────────────
  lines.push(`## Preview Checks`);
  lines.push(``);
  if (run.previewChecks.length === 0) {
    lines.push(`_No preview checks yet. Deploy first._`);
  } else {
    lines.push(`| Path | Status | Result |`);
    lines.push(`|---|---|---|`);
    for (const c of run.previewChecks) {
      const icon = c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      lines.push(`| \`${c.urlOrPath}\` | ${icon} ${c.status} | ${c.result} |`);
    }
  }
  lines.push(``);

  // ── Technical Details ──────────────────────────────────────────────────────
  lines.push(`## Technical Details`);
  lines.push(``);
  const td = run.hiddenTechnicalDetails;
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  if (td.packageManager) lines.push(`| Package manager | ${td.packageManager} |`);
  if (td.installCommand) lines.push(`| Install command | \`${td.installCommand}\` |`);
  if (td.buildCommand)   lines.push(`| Build command | \`${td.buildCommand}\` |`);
  if (td.startCommand)   lines.push(`| Start command | \`${td.startCommand}\` |`);
  if (td.routeMode)      lines.push(`| Route mode | \`${td.routeMode}\` |`);
  if (td.staticOutputPath) lines.push(`| Static output | \`${td.staticOutputPath}\` |`);
  if (td.healthPath)     lines.push(`| Health path | \`${td.healthPath}\` |`);
  lines.push(``);
  if (td.missingEnvNames.length > 0) {
    lines.push(`Missing env names (no values): ${td.missingEnvNames.map((n) => `\`${n}\``).join(", ")}`);
    lines.push(``);
  }

  // ── Safety Notes ────────────────────────────────────────────────────────────
  lines.push(`## Safety Notes`);
  lines.push(``);
  lines.push(`- No secret values are included in this runbook.`);
  lines.push(`- All fixes require typing a confirmation phrase.`);
  lines.push(`- No automatic go-live — requires explicit "GO LIVE" confirmation.`);
  lines.push(`- Database wipe is never run automatically.`);
  lines.push(`- DNS/nginx changes require manual confirmation.`);
  lines.push(`- Doorsteps/LocalShop systems are never touched by the AI Import Operator.`);
  lines.push(``);

  return lines.join("\n");
}
