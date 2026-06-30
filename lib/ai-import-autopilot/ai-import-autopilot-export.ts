/**
 * lib/ai-import-autopilot/ai-import-autopilot-export.ts
 *
 * Sprint 88: Exports AI_IMPORT_AUTOPILOT_RUNBOOK.md from an AiImportAutopilotRun.
 * No secret values in output — only env var names.
 */

import type { AiImportAutopilotRun } from "./ai-import-autopilot-types";
import { GROUP_LABELS } from "./ai-import-autopilot-question-service";

export function exportAiImportAutopilotRunbook(run: AiImportAutopilotRun, projectName: string): string {
  const lines: string[] = [];
  const ts = new Date(run.generatedAt).toUTCString();

  lines.push(`# AI_IMPORT_AUTOPILOT_RUNBOOK.md — ${projectName}`);
  lines.push(``);
  lines.push(`Generated: ${ts}  `);
  lines.push(`State: \`${run.state}\``);
  lines.push(``);
  lines.push(`> ${run.summary}`);
  lines.push(``);

  // ── Detected Stack ──────────────────────────────────────────────────────────
  lines.push(`## Detected Stack`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Sardar preset detected | ${run.detectedStack.isSardarPreset ? "Yes" : "No"} |`);
  lines.push(`| Package manager | ${run.detectedStack.packageManager} |`);
  lines.push(`| Frameworks | ${run.detectedStack.framework.join(", ") || "—"} |`);
  lines.push(`| Services | ${run.detectedStack.services.join(", ") || "—"} |`);
  lines.push(``);
  if (run.detectedStack.evidence.length > 0) {
    lines.push(`### Evidence`);
    lines.push(``);
    for (const e of run.detectedStack.evidence) lines.push(`- ${e}`);
    lines.push(``);
  }

  // ── Questions Asked ─────────────────────────────────────────────────────────
  lines.push(`## Questions Asked (names only — no values)`);
  lines.push(``);
  if (run.requiredInputs.length === 0) {
    lines.push(`_No missing values — all secrets were already configured._`);
  } else {
    const byGroup = new Map<string, typeof run.requiredInputs>();
    for (const ri of run.requiredInputs) {
      const arr = byGroup.get(ri.group) ?? [];
      arr.push(ri);
      byGroup.set(ri.group, arr);
    }
    for (const [group, items] of byGroup) {
      lines.push(`### ${GROUP_LABELS[group as keyof typeof GROUP_LABELS] ?? group}`);
      lines.push(``);
      for (const i of items) lines.push(`- \`${i.fieldName}\` — ${i.label}${i.required ? " (required)" : " (optional)"}`);
      lines.push(``);
    }
  }

  // ── Fixes Applied ───────────────────────────────────────────────────────────
  lines.push(`## Safe Fixes Applied`);
  lines.push(``);
  if (run.safeFixesApplied.length === 0) {
    lines.push(`_No fixes were needed._`);
  } else {
    lines.push(`| Fix | Applied At | Fields Changed |`);
    lines.push(`|---|---|---|`);
    for (const f of run.safeFixesApplied) {
      lines.push(`| ${f.label} | ${new Date(f.appliedAt).toUTCString()} | ${f.fieldsChanged.join(", ") || "—"} |`);
    }
  }
  lines.push(``);

  if (run.pendingFix) {
    lines.push(`## Pending / Needs Approval`);
    lines.push(``);
    lines.push(`- **${run.pendingFix.title}**`);
    lines.push(`  - ${run.pendingFix.plainEnglishSummary}`);
    if (run.pendingFix.approvalReason) lines.push(`  - Reason: ${run.pendingFix.approvalReason}`);
    lines.push(``);
  }

  // ── Deployment Attempts ─────────────────────────────────────────────────────
  lines.push(`## Deployment Attempts`);
  lines.push(``);
  const attempts = run.hiddenTechnicalDetails.fixAttempts;
  if (Object.keys(attempts).length === 0) {
    lines.push(`_No automatic retries were needed._`);
  } else {
    lines.push(`| Issue Kind | Attempts |`);
    lines.push(`|---|---|`);
    for (const [kind, count] of Object.entries(attempts)) lines.push(`| ${kind} | ${count} |`);
  }
  lines.push(``);

  // ── Logs Summary ────────────────────────────────────────────────────────────
  lines.push(`## Run Log`);
  lines.push(``);
  for (const line of run.log) lines.push(`- ${line}`);
  lines.push(``);

  // ── Preview Checks ──────────────────────────────────────────────────────────
  lines.push(`## Preview Checks`);
  lines.push(``);
  if (run.checks.length === 0) {
    lines.push(`_No preview checks run yet._`);
  } else {
    lines.push(`| Scope | Check | Status | Result |`);
    lines.push(`|---|---|---|---|`);
    for (const c of run.checks) {
      const icon = c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      lines.push(`| ${c.scope} | ${c.label} | ${icon} ${c.status} | ${c.result} |`);
    }
  }
  lines.push(``);

  // ── Public Domain Status ────────────────────────────────────────────────────
  lines.push(`## Public Domain Status`);
  lines.push(``);
  lines.push(run.publicUrl ? `Public URL: ${run.publicUrl}` : `No public domain attached yet — using the secure panel proxy.`);
  lines.push(``);

  // ── Remaining Manual Steps ──────────────────────────────────────────────────
  lines.push(`## Remaining Manual Steps`);
  lines.push(``);
  lines.push(`- ${run.nextAction.description}`);
  lines.push(``);

  // ── Safety Notes ────────────────────────────────────────────────────────────
  lines.push(`## Safety Notes`);
  lines.push(``);
  lines.push(`- No secret values are included in this runbook.`);
  lines.push(`- Only safe-fix-allowlisted config changes were applied automatically.`);
  lines.push(`- Database wipe, DNS changes, and public domain publishing always require manual confirmation.`);
  lines.push(`- 127.0.0.1/localhost is never shown as a browser link — preview always uses the panel proxy.`);
  lines.push(`- Doorsteps/LocalShop systems are never touched by the Autopilot.`);
  lines.push(``);

  return lines.join("\n");
}
