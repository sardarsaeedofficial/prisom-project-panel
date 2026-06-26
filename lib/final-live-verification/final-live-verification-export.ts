import { db }                            from "@/lib/db";
import { generateFinalLiveVerificationRun } from "./final-live-verification-service";
import type { FinalLiveVerificationRun }    from "./final-live-verification-types";

export async function exportFinalLiveVerificationRun(input: {
  projectId: string;
  expectedCommit?: string;
}): Promise<{ markdown: string; filename: string }> {
  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true, slug: true },
  });

  const domain = await db.domain.findFirst({
    where:  { projectId: input.projectId, isPrimary: true },
    select: { hostname: true },
  });

  const report = await generateFinalLiveVerificationRun(input);
  const md     = buildMarkdown(report, project?.name ?? input.projectId, domain?.hostname ?? "—");

  return { markdown: md, filename: "FINAL_LIVE_VERIFICATION_RUN.md" };
}

function statusLabel(status: FinalLiveVerificationRun["status"]): string {
  switch (status) {
    case "verified_ready": return "VERIFIED READY";
    case "needs_review":   return "NEEDS REVIEW";
    case "blocked":        return "BLOCKED";
    default:               return "NOT STARTED";
  }
}

function buildMarkdown(
  r: FinalLiveVerificationRun,
  projectName: string,
  hostname: string,
): string {
  const lines: string[] = [];

  lines.push("# Final Live Verification Run", "");
  lines.push("## Context", "");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Project | ${projectName} |`);
  lines.push(`| Domain | ${hostname} |`);
  lines.push(`| Generated | ${r.generatedAt} |`);
  lines.push(`| Status | **${statusLabel(r.status)}** |`);
  lines.push(`| Score | ${r.score}% |`);
  if (r.expectedCommit) {
    lines.push(`| Expected Commit | \`${r.expectedCommit}\` |`);
  }
  lines.push("");

  if (r.blockers.length > 0) {
    lines.push("## Blockers", "");
    for (const b of r.blockers) lines.push(`- ❌ ${b}`);
    lines.push("");
  }

  if (r.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of r.warnings) lines.push(`- ⚠️ ${w}`);
    lines.push("");
  }

  const categories = [
    "deployment", "route", "panel", "export",
    "confirmation_gate", "sardar", "security",
    "monitoring", "rollback", "handoff",
  ] as const;

  const catLabels: Record<string, string> = {
    deployment:         "Deployment Checks",
    route:              "Route Checks",
    panel:              "Panel Checks",
    export:             "Export Checks",
    confirmation_gate:  "Confirmation Gates",
    sardar:             "Sardar Checks",
    security:           "Security Checks",
    monitoring:         "Monitoring Checks",
    rollback:           "Rollback Checks",
    handoff:            "Handoff Checks",
  };

  const statusIcon: Record<string, string> = {
    pass:    "✅",
    warning: "⚠️",
    blocked: "❌",
    manual:  "👤",
    pending: "⏳",
  };

  for (const cat of categories) {
    const group = r.checks.filter((c) => c.category === cat);
    if (group.length === 0) continue;

    lines.push(`## ${catLabels[cat]}`, "");
    for (const c of group) {
      const icon = statusIcon[c.status] ?? "—";
      lines.push(`### ${icon} ${c.label}`);
      lines.push(`${c.description}`);
      if (c.command)     lines.push("", `**Command:** \`${c.command}\``);
      if (c.evidence)    lines.push("", `**Evidence:** ${c.evidence}`);
      if (c.nextStep)    lines.push("", `**Next step:** ${c.nextStep}`);
      if (c.safetyNote)  lines.push("", `> ⚠️ **Safety:** ${c.safetyNote}`);
      lines.push("");
    }
  }

  lines.push("## Evidence Required", "");
  for (const e of r.evidenceRequired) lines.push(`- [ ] ${e}`);
  lines.push("");

  lines.push("## Verified Exports Checklist", "");
  for (const x of r.verifiedExports) lines.push(`- [ ] ${x}`);
  lines.push("");

  lines.push("## Verified Panels Checklist", "");
  for (const p of r.verifiedPanels) lines.push(`- [ ] ${p}`);
  lines.push("");

  lines.push("## Recommended Next Steps", "");
  for (const s of r.recommendedNextSteps) lines.push(`1. ${s}`);
  lines.push("");

  lines.push("---");
  lines.push("## Safety Notes", "");
  lines.push("- This report is **read-only**. No production routes were changed automatically.");
  lines.push("- Do not restart Doorsteps/LocalShop processes (prisom-manager, prisom-backend).");
  lines.push("- Do not restart Sardar PM2 from this panel.");
  lines.push("- No DNS was changed, no nginx was reloaded, no DB migration was run.");
  lines.push("- No secrets are included in this export.");
  lines.push("");

  return lines.join("\n");
}
