/**
 * lib/smart-import/smart-import-export.ts
 *
 * Sprint 85: Generates SMART_IMPORT_REPORT.md from a SmartImportReport.
 * No secrets. No async. Pure string builder.
 */

import type { SmartImportReport } from "./smart-import-types";
import { getAllKnownFixes } from "./smart-import-fixes";

const STATUS_ICON: Record<string, string> = {
  passed:  "✅",
  warning: "⚠️",
  blocked: "❌",
  pending: "⏳",
  skipped: "—",
  running: "🔄",
};

function icon(status: string): string {
  return STATUS_ICON[status] ?? "•";
}

export function exportSmartImportMarkdown(
  report: SmartImportReport,
  projectName: string,
): string {
  const lines: string[] = [];

  lines.push(`# Smart Import Report — ${projectName}`);
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Project ID:** ${report.projectId}`);
  lines.push(`**Source type:** ${report.sourceType}`);
  lines.push("");

  // ── Blockers ───────────────────────────────────────────────────────────────
  if (report.blockers.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## ❌ Blockers");
    lines.push("");
    for (const b of report.blockers) lines.push(`- ${b}`);
    lines.push("");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (report.warnings.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## ⚠️ Warnings");
    lines.push("");
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  // ── Detected stack ─────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Detected Stack");
  lines.push("");
  const s = report.detectedStack;
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Package manager | \`${s.packageManager}\` |`);
  lines.push(`| Frameworks | ${s.framework.length > 0 ? s.framework.join(", ") : "none detected"} |`);
  lines.push(`| Languages | ${s.language.join(", ")} |`);
  lines.push(`| Database | ${s.database.tool ?? "none"} / ${s.database.provider ?? "unknown"} |`);
  lines.push(`| Replit markers | ${s.replitMarkers.length > 0 ? s.replitMarkers.join(", ") : "none"} |`);
  lines.push("");

  // ── Services ───────────────────────────────────────────────────────────────
  if (s.services.length > 0) {
    lines.push("### Services");
    lines.push("");
    for (const svc of s.services) {
      lines.push(`**${svc.name}** (\`${svc.type}\`)`);
      lines.push(`- Root: \`${svc.root}\``);
      if (svc.buildCommand)  lines.push(`- Build: \`${svc.buildCommand}\``);
      if (svc.startCommand)  lines.push(`- Start: \`${svc.startCommand}\``);
      if (svc.outputPath)    lines.push(`- Output: \`${svc.outputPath}\``);
      if (svc.healthPath)    lines.push(`- Health: \`${svc.healthPath}\``);
      if (svc.route)         lines.push(`- Route: \`${svc.route}\``);
      lines.push("");
    }
  }

  // ── Selected preset ────────────────────────────────────────────────────────
  if (report.selectedPreset) {
    lines.push("---");
    lines.push("");
    lines.push("## Recommended Deployment Preset");
    lines.push("");
    const p = report.selectedPreset;
    lines.push(`**${p.label}** — confidence: **${p.confidence}**`);
    lines.push("");
    lines.push("```");
    lines.push(`install: ${p.installCommand}`);
    lines.push(`build:   ${p.buildCommand}`);
    if (p.startCommand) lines.push(`start:   ${p.startCommand}`);
    lines.push(`health:  ${p.healthPath}`);
    lines.push(`mode:    ${p.routeMode}`);
    if (p.staticOutputPath) lines.push(`static:  ${p.staticOutputPath}`);
    if (p.apiPrefix)        lines.push(`prefix:  ${p.apiPrefix}`);
    lines.push("```");
    lines.push("");
    if (p.notes.length > 0) {
      lines.push("**Notes:**");
      for (const n of p.notes) lines.push(`- ${n}`);
      lines.push("");
    }
  }

  // ── Env names ─────────────────────────────────────────────────────────────
  if (s.envNames.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Env Var Names");
    lines.push("");
    lines.push("| Name | Required | Secret | Purpose |");
    lines.push("|---|---|---|---|");
    for (const e of s.envNames) {
      lines.push(`| \`${e.name}\` | ${e.required ? "Yes" : "No"} | ${e.secret ? "Yes" : "No"} | ${e.purpose} |`);
    }
    lines.push("");
    lines.push("> Values are not shown here. Add them via the Environment tab in the panel.");
    lines.push("");
  }

  // ── Missing env names ─────────────────────────────────────────────────────
  if (report.missingEnvNames.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## ⚠️ Missing Env Vars");
    lines.push("");
    lines.push("The following env var names are required but not yet configured:");
    lines.push("");
    for (const n of report.missingEnvNames) lines.push(`- \`${n}\``);
    lines.push("");
    lines.push("Add them in the **Environment** tab before deploying.");
    lines.push("");
  }

  // ── Import steps ──────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Import Steps");
  lines.push("");
  for (const step of report.steps) {
    lines.push(`${icon(step.status)} **${step.label}** — ${step.message}`);
    if (step.evidence)       lines.push(`  - Evidence: ${step.evidence}`);
    if (step.recommendedFix) lines.push(`  - Fix: ${step.recommendedFix}`);
  }
  lines.push("");

  // ── Preview checks ────────────────────────────────────────────────────────
  if (report.previewChecks.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Preview Checks");
    lines.push("");
    lines.push("| Path | Expected | Status | Result |");
    lines.push("|---|---|---|---|");
    for (const c of report.previewChecks) {
      lines.push(`| \`${c.path}\` | ${c.expected} | ${icon(c.status)} ${c.status} | ${c.result ?? ""} |`);
    }
    lines.push("");
  }

  // ── Recommended next steps ─────────────────────────────────────────────────
  if (report.recommendedNextSteps.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Recommended Next Steps");
    lines.push("");
    report.recommendedNextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  // ── Known auto-fixes ──────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Known Auto-Fix Patterns");
  lines.push("");
  for (const fix of getAllKnownFixes()) {
    lines.push(`### ${fix.title}`);
    lines.push(`**Fix:** ${fix.recommendedFix}`);
    lines.push(`**Auto-fix available:** ${fix.safeAutoFixAvailable ? "Yes" : "No"}`);
    lines.push("");
  }

  // ── Safety notes ──────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("");
  lines.push("- Go-live still requires **manual confirmation** — Smart Import never auto-promotes.");
  lines.push("- No secrets are shown or stored in this report.");
  lines.push("- No DB migrations are triggered automatically.");
  lines.push("- No DNS or nginx mutations happen from the Import panel.");
  lines.push("- No PM2 restarts are triggered from Smart Import (only normal deploy flow).");
  lines.push("- Doorsteps/LocalShop project is not affected by Smart Import.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`*Generated by Prisom Project Panel Smart Import — ${new Date().toISOString()}*`);

  return lines.join("\n");
}
