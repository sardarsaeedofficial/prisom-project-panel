import { generateProjectKnowledgeBase } from "./project-knowledge-builder";
import { searchHelpKnowledge }           from "./help-search-index";
import type { HelpAnswer }               from "./help-center-types";

// ── Answer composition ────────────────────────────────────────────────────────

function confidence(topScore: number): HelpAnswer["confidence"] {
  if (topScore >= 20) return "high";
  if (topScore >= 8)  return "medium";
  return "low";
}

function composeAnswer(
  question:  string,
  results:   ReturnType<typeof searchHelpKnowledge>,
): string {
  if (results.length === 0) {
    return "No matching information was found in the generated knowledge base for this question.";
  }

  const lines: string[] = [];
  const topResult = results[0];

  // Lead paragraph from top match
  const topContent = topResult.snippet;
  lines.push(`Based on **${topResult.title}**:\n`);
  lines.push(topContent);
  lines.push("");

  // Additional context from other results
  if (results.length > 1) {
    lines.push("**Related sections:**");
    for (const r of results.slice(1, 4)) {
      lines.push(`- **${r.title}**: ${r.snippet}`);
    }
    lines.push("");
  }

  // Source paths
  const allPaths = [...new Set(results.flatMap((r) => r.sourcePaths))].slice(0, 6);
  if (allPaths.length > 0) {
    lines.push("**Relevant source paths:**");
    for (const p of allPaths) {
      lines.push(`- \`${p}\``);
    }
  }

  return lines.join("\n");
}

function detectMissingInfo(
  question: string,
  results:  ReturnType<typeof searchHelpKnowledge>,
): string[] {
  const missing: string[] = [];

  const q = question.toLowerCase();

  // If very low score and question suggests specific knowledge
  if (results.length === 0 || (results[0]?.score ?? 0) < 4) {
    if (q.includes("error") || q.includes("bug") || q.includes("issue")) {
      missing.push("Specific error message or stack trace not found — check PM2 logs for details");
    }
    if (q.includes("secret") || q.includes("key") || q.includes("token") || q.includes("password")) {
      missing.push("Secret values are never stored in the knowledge base — check .env file directly via SSH");
    }
    if (q.includes("when") || q.includes("schedule") || q.includes("cron")) {
      missing.push("Scheduling or cron information not in the knowledge base");
    }
    if (missing.length === 0) {
      missing.push("This topic may not be covered by the current knowledge base — try regenerating or check the source files directly");
    }
  }

  return missing;
}

function getSafetyNotes(results: ReturnType<typeof searchHelpKnowledge>): string[] {
  const notes: string[] = [];
  const allContent = results.map((r) => r.snippet).join(" ").toLowerCase();

  if (allContent.includes("pm2") || allContent.includes("restart")) {
    notes.push("PM2 restarts must be performed manually via SSH only — never from the UI");
  }
  if (allContent.includes("dns") || allContent.includes("nginx")) {
    notes.push("DNS and nginx changes require manual server access — not done through the panel");
  }
  if (allContent.includes("secret") || allContent.includes("env")) {
    notes.push("Secret values are never exposed by the panel — only variable names are shown");
  }
  if (allContent.includes("sardar") || allContent.includes("doorstep")) {
    notes.push("Sardar Security and Doorsteps/LocalShop are production services — exercise caution");
  }

  return notes;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function answerHelpQuestion(input: {
  projectId: string;
  question:  string;
}): Promise<HelpAnswer> {
  const { projectId, question } = input;

  const report  = await generateProjectKnowledgeBase({ projectId });
  const results = searchHelpKnowledge({ report, query: question, limit: 5 });

  return {
    question,
    answer:             composeAnswer(question, results),
    confidence:         confidence(results[0]?.score ?? 0),
    matchedSections:    results,
    missingInformation: detectMissingInfo(question, results),
    safetyNotes:        getSafetyNotes(results),
  };
}
