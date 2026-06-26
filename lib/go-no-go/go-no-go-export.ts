import { db }                    from "@/lib/db";
import { generateGoNoGoEvidencePack } from "./go-no-go-service";
import type { GoNoGoEvidencePack }    from "./go-no-go-types";

export async function exportGoNoGoEvidencePack(input: {
  projectId: string;
}): Promise<{ markdown: string; filename: string }> {
  const project = await db.project.findUnique({
    where:  { id: input.projectId },
    select: { name: true, slug: true },
  });

  const domain = await db.domain.findFirst({
    where:  { projectId: input.projectId, isPrimary: true },
    select: { hostname: true },
  });

  const pack = await generateGoNoGoEvidencePack(input);
  const md   = buildMarkdown(pack, project?.name ?? input.projectId, domain?.hostname ?? "—");

  return { markdown: md, filename: "GO_NO_GO_EVIDENCE_PACK.md" };
}

function decisionLabel(d: GoNoGoEvidencePack["decision"]): string {
  switch (d) {
    case "go":                  return "GO";
    case "no_go":               return "NO GO";
    case "go_with_warnings":    return "GO WITH WARNINGS";
    case "needs_manual_review": return "NEEDS MANUAL REVIEW";
  }
}

function buildMarkdown(
  p: GoNoGoEvidencePack,
  projectName: string,
  hostname: string,
): string {
  const lines: string[] = [];

  lines.push("# Go/No-Go Evidence Pack", "");
  lines.push(`> **Decision: ${decisionLabel(p.decision)}**`, "");

  lines.push("## Context", "");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Project | ${projectName} |`);
  lines.push(`| Domain | ${hostname} |`);
  lines.push(`| Generated | ${p.generatedAt} |`);
  lines.push(`| Decision | **${decisionLabel(p.decision)}** |`);
  lines.push("");

  lines.push("## Final Operator Message", "");
  lines.push(`> ${p.finalOperatorMessage}`);
  lines.push("");

  if (p.blockers.length > 0) {
    lines.push("## Blockers", "");
    for (const b of p.blockers) lines.push(`- ❌ ${b}`);
    lines.push("");
  }

  if (p.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of p.warnings) lines.push(`- ⚠️ ${w}`);
    lines.push("");
  }

  const categories = [
    "deployment", "qa", "release", "migration",
    "backup", "monitoring", "security",
    "rollback", "operator", "client",
  ] as const;

  const catLabels: Record<string, string> = {
    deployment: "Deployment Evidence",
    qa:         "QA Evidence",
    release:    "Release Evidence",
    migration:  "Migration Evidence",
    backup:     "Backup Evidence",
    monitoring: "Monitoring Evidence",
    security:   "Security Evidence",
    rollback:   "Rollback Evidence",
    operator:   "Operator Evidence",
    client:     "Client Evidence",
  };

  const statusIcon: Record<string, string> = {
    collected: "✅",
    warning:   "⚠️",
    blocked:   "❌",
    missing:   "❌",
    manual:    "👤",
  };

  lines.push("## Evidence Checklist", "");
  for (const cat of categories) {
    const group = p.evidence.filter((e) => e.category === cat);
    if (group.length === 0) continue;

    lines.push(`### ${catLabels[cat]}`, "");
    for (const e of group) {
      const icon   = statusIcon[e.status] ?? "—";
      const status = e.status.charAt(0).toUpperCase() + e.status.slice(1);
      lines.push(`- ${icon} **${e.label}** (${status})`);
      lines.push(`  - ${e.description}`);
      lines.push(`  - *Evidence prompt:* ${e.evidencePrompt}`);
    }
    lines.push("");
  }

  lines.push("## Required Approvals", "");
  for (const a of p.requiredApprovals) lines.push(`- [ ] ${a}`);
  lines.push("");

  lines.push("## Final Go/No-Go Questions", "");
  for (const q of p.finalQuestions) lines.push(`- [ ] ${q}`);
  lines.push("");

  lines.push("## Launch Allowed Only If", "");
  for (const l of p.launchAllowedOnlyIf) lines.push(`- ✅ ${l}`);
  lines.push("");

  lines.push("## Launch Blocked If", "");
  for (const l of p.launchBlockedIf) lines.push(`- ❌ ${l}`);
  lines.push("");

  lines.push("---");
  lines.push("## Manual Go/No-Go Signoff", "");
  lines.push("```");
  lines.push("Operator:");
  lines.push("Approver:");
  lines.push("Decision:");
  lines.push("Date/time:");
  lines.push("Notes:");
  lines.push("```");
  lines.push("");

  lines.push("---");
  lines.push("## Safety Notes", "");
  lines.push("- This evidence pack is **read-only**. No production actions were taken automatically.");
  lines.push("- Do not restart Doorsteps/LocalShop processes.");
  lines.push("- Do not restart Sardar PM2 from this panel.");
  lines.push("- No DNS changes, no nginx reloads, no DB migrations.");
  lines.push("- No secrets are included in this export.");
  lines.push("");

  return lines.join("\n");
}
