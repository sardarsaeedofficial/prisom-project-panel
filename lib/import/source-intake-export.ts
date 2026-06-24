/**
 * lib/import/source-intake-export.ts
 *
 * Sprint 57: Export a SourceIntakeReport to SOURCE_INTAKE_REPORT.md.
 *
 * Safety: no secret values are included — only env variable names.
 */

import type { SourceIntakeReport } from "./source-intake-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: SourceIntakeReport["status"]): string {
  switch (status) {
    case "ready":   return "✅";
    case "warning": return "⚠️";
    case "blocked": return "🔴";
    default:        return "❓";
  }
}

function checkIcon(status: "pass" | "warning" | "fail" | "manual"): string {
  switch (status) {
    case "pass":    return "✅";
    case "warning": return "⚠️";
    case "fail":    return "❌";
    case "manual":  return "📋";
  }
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const sep  = headers.map((h) => "-".repeat(Math.max(h.length, 3)));
  const head = `| ${headers.join(" | ")} |`;
  const div  = `| ${sep.join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, div, body].join("\n");
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportSourceIntakeReport(
  report:      SourceIntakeReport,
  projectName: string,
): string {
  const { detected, checks } = report;
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# SOURCE_INTAKE_REPORT.md`);
  lines.push(``);
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Generated:** ${new Date(report.generatedAt).toUTCString()}`);
  lines.push(`**Source type:** ${report.sourceType}`);
  lines.push(`**Overall status:** ${statusIcon(report.status)} ${report.status.toUpperCase()}`);
  lines.push(``);

  // ── Blockers ──────────────────────────────────────────────────────────────
  if (report.blockers.length > 0) {
    lines.push(`## 🔴 Blockers (${report.blockers.length})`);
    lines.push(``);
    report.blockers.forEach((b) => lines.push(`- ❌ ${b}`));
    lines.push(``);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (report.warnings.length > 0) {
    lines.push(`## ⚠️ Warnings (${report.warnings.length})`);
    lines.push(``);
    report.warnings.forEach((w) => lines.push(`- ⚠️ ${w}`));
    lines.push(``);
  }

  // ── Package manager ────────────────────────────────────────────────────────
  if (detected.packageManager) {
    lines.push(`## Package Manager`);
    lines.push(``);
    lines.push(`| Property | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Package manager | \`${detected.packageManager}\` |`);
    if (detected.monorepo) {
      lines.push(`| Workspace | ${detected.workspaceFile ?? "yes"} |`);
      lines.push(`| Packages found | ${detected.packageJsonCount ?? 0} |`);
    }
    lines.push(``);
  }

  // ── Services ──────────────────────────────────────────────────────────────
  if (detected.services && detected.services.length > 0) {
    lines.push(`## Detected Services`);
    lines.push(``);
    const rows = detected.services.map((s) => [
      `\`${s.name}\``,
      s.kind,
      `\`${s.root}\``,
      s.buildCommand ? `\`${s.buildCommand}\`` : "—",
      s.startCommand ? `\`${s.startCommand}\`` : "—",
      s.outputPath   ? `\`${s.outputPath}\``   : "—",
      s.healthPath   ? `\`${s.healthPath}\``   : "—",
    ]);
    lines.push(table(["Name", "Kind", "Root", "Build", "Start", "Output", "Health"], rows));
    lines.push(``);

    // Suggested service config
    lines.push(`### Suggested Service Configuration`);
    lines.push(``);
    for (const svc of detected.services) {
      lines.push(`#### ${svc.name} (${svc.kind})`);
      lines.push(``);
      lines.push(`\`\`\`yaml`);
      lines.push(`name: ${svc.name}`);
      lines.push(`kind: ${svc.kind}`);
      lines.push(`root: ${svc.root}`);
      if (svc.buildCommand)  lines.push(`buildCommand: ${svc.buildCommand}`);
      if (svc.startCommand)  lines.push(`startCommand: ${svc.startCommand}`);
      if (svc.outputPath)    lines.push(`outputPath: ${svc.outputPath}`);
      if (svc.healthPath)    lines.push(`healthPath: ${svc.healthPath}`);
      lines.push(`\`\`\``);
      lines.push(``);
    }
  }

  // ── Database ──────────────────────────────────────────────────────────────
  if (detected.database) {
    const { tool, provider } = detected.database;
    lines.push(`## Database`);
    lines.push(``);
    lines.push(`| Property | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| ORM/Tool | \`${tool}\` |`);
    lines.push(`| Provider | \`${provider}\` |`);
    lines.push(``);

    if (tool === "drizzle") {
      lines.push(`**Migration commands (run manually after configuring DATABASE_URL):**`);
      lines.push(``);
      lines.push(`\`\`\`sh`);
      lines.push(`# 1. Check schema (safe, read-only)`);
      lines.push(`pnpm drizzle-kit check`);
      lines.push(``);
      lines.push(`# 2. Push schema (backup database first)`);
      lines.push(`pnpm drizzle-kit push`);
      lines.push(`\`\`\``);
    } else if (tool === "prisma") {
      lines.push(`**Migration commands (run manually after configuring DATABASE_URL):**`);
      lines.push(``);
      lines.push(`\`\`\`sh`);
      lines.push(`# Deploy migrations (backup database first)`);
      lines.push(`pnpm prisma migrate deploy`);
      lines.push(`\`\`\``);
    }
    lines.push(``);
    lines.push(`> ⚠️ Always back up your database before running migrations.`);
    lines.push(`> Never run DROP TABLE, TRUNCATE, or force-reset commands on production data.`);
    lines.push(``);
  }

  // ── Env names (no values) ──────────────────────────────────────────────────
  if (detected.envNames && detected.envNames.length > 0) {
    lines.push(`## Environment Variables (names only — no values)`);
    lines.push(``);
    detected.envNames.forEach((name) => lines.push(`- \`${name}\``));
    lines.push(``);
    lines.push(`> Configure all values via the Prisom Secrets Vault. Never commit .env files.`);
    lines.push(``);
  }

  // ── Replit markers ─────────────────────────────────────────────────────────
  if (detected.replitMarkers && detected.replitMarkers.length > 0) {
    lines.push(`## Replit Markers`);
    lines.push(``);
    detected.replitMarkers.forEach((m) => lines.push(`- \`${m}\``));
    lines.push(``);
    lines.push(`> Apply portability patches before deployment to remove Replit-specific dependencies.`);
    lines.push(``);
  }

  // ── Check results ──────────────────────────────────────────────────────────
  lines.push(`## All Checks`);
  lines.push(``);
  const checkRows = checks.map((c) => [
    checkIcon(c.status),
    c.label,
    c.category,
    c.message.slice(0, 120),
  ]);
  lines.push(table(["", "Check", "Category", "Result"], checkRows));
  lines.push(``);

  // ── Next steps ────────────────────────────────────────────────────────────
  if (report.nextSteps.length > 0) {
    lines.push(`## Recommended Next Steps`);
    lines.push(``);
    report.nextSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push(``);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(``);
  lines.push(`> Generated by Prisom Project Manager — Source Intake (Sprint 57)`);
  lines.push(`> No secret values are included in this report.`);
  lines.push(`> Do not deploy automatically — review all checks before proceeding.`);
  lines.push(``);

  return lines.join("\n");
}
