/**
 * lib/ai-import-agent/agent-run-export.ts
 *
 * Sprint 89: Exports AI_IMPORT_AGENT_RUNBOOK.md from an AgentRun.
 * No secret values — command output may include build logs only.
 */

import type { AgentRun } from "./agent-run-types";

export function exportAiImportAgentRunbook(run: AgentRun, projectName: string): string {
  const lines: string[] = [];

  lines.push(`# AI_IMPORT_AGENT_RUNBOOK.md — ${projectName}`);
  lines.push(``);
  lines.push(`Started: ${new Date(run.startedAt).toUTCString()}  `);
  lines.push(`Updated: ${new Date(run.updatedAt).toUTCString()}  `);
  lines.push(`Status: \`${run.status}\``);
  lines.push(``);
  lines.push(`> ${run.summary}`);
  lines.push(``);

  // ── Timeline ────────────────────────────────────────────────────────────────
  lines.push(`## Timeline`);
  lines.push(``);
  for (const step of run.steps) {
    const icon =
      step.status === "success" ? "✅" :
      step.status === "fixed"   ? "🛠️" :
      step.status === "warning" ? "⚠️" :
      step.status === "error"   ? "❌" :
      step.status === "running" ? "⏳" : "•";
    lines.push(`${icon} **${step.title}** — ${step.summary}`);
    if (step.command) lines.push(`   - Command: \`${step.command}\``);
    if (step.outputPreview) {
      lines.push(`   - Output:`);
      lines.push("   ```");
      lines.push(step.outputPreview.split("\n").map((l) => `   ${l}`).join("\n"));
      lines.push("   ```");
    }
    if (step.errorMessage) lines.push(`   - Error: ${step.errorMessage}`);
    if (step.fixAvailable) lines.push(`   - Safe fix available: \`${step.fixId}\``);
    lines.push(``);
  }

  // ── Last Error ──────────────────────────────────────────────────────────────
  if (run.lastError) {
    lines.push(`## Last Error`);
    lines.push(``);
    lines.push(`- **Kind:** \`${run.lastError.kind}\``);
    lines.push(`- **What happened:** ${run.lastError.whatHappened}`);
    lines.push(`- **Why:** ${run.lastError.why}`);
    lines.push(`- **What I can do:** ${run.lastError.whatICanDo}`);
    lines.push(`- **Fix safety:** ${run.lastError.fixSafetyLevel}`);
    if (run.lastError.safeFixId) lines.push(`- **Safe fix id:** \`${run.lastError.safeFixId}\``);
    if (run.lastError.manualInstructions) {
      lines.push(`- **Manual instructions:**`);
      lines.push("```bash");
      lines.push(run.lastError.manualInstructions);
      lines.push("```");
    }
    lines.push(``);
  }

  // ── Preview / Domain Status ────────────────────────────────────────────────
  lines.push(`## Preview / Domain Status`);
  lines.push(``);
  lines.push(run.publicUrl ? `Public URL: ${run.publicUrl}` : `No public domain attached yet — using the secure panel proxy.`);
  lines.push(``);

  // ── Safety Notes ────────────────────────────────────────────────────────────
  lines.push(`## Safety Notes`);
  lines.push(``);
  lines.push(`- No secret values are included in this runbook.`);
  lines.push(`- Only safe-fix-allowlisted config changes were applied automatically.`);
  lines.push(`- Database wipe, DNS changes, and public domain publishing always require manual confirmation.`);
  lines.push(`- 127.0.0.1/localhost is never shown as a browser link — preview always uses the panel proxy.`);
  lines.push(`- Only this project's PM2 process was managed. Doorsteps/LocalShop and other PM2 processes were never touched.`);
  lines.push(``);

  return lines.join("\n");
}
