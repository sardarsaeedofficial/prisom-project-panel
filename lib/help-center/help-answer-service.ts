import { generateProjectKnowledgeBase } from "./project-knowledge-builder";
import { searchHelpKnowledge }           from "./help-search-index";
import { containsSecretPattern }         from "./help-redaction";
import type { HelpAnswer, HelpSearchResult, ProjectHelpCenterReport } from "./help-center-types";

// ── Canned question routing ───────────────────────────────────────────────────
// Maps common question patterns to the knowledge section categories most likely
// to hold the answer. Pre-routing improves result relevance for frequent queries.

interface CannedRoute {
  patterns: RegExp[];
  preferredCategories: string[];
  extraQuery:          string;
}

const CANNED_ROUTES: CannedRoute[] = [
  {
    patterns: [/deploy|deployment|how.*deploy|build.*project|pnpm.*build/i],
    preferredCategories: ["deployment", "commands"],
    extraQuery: "deploy deployment commands pm2 pnpm build",
  },
  {
    patterns: [/smoke.*check|smoke test|curl.*check|verify.*deploy/i],
    preferredCategories: ["deployment", "commands"],
    extraQuery: "smoke check curl verify deploy",
  },
  {
    patterns: [/server action|use server|actions.*folder|where.*actions/i],
    preferredCategories: ["server_actions", "architecture"],
    extraQuery: "server action app/actions use server",
  },
  {
    patterns: [/export|what.*export|download.*report|report.*download/i],
    preferredCategories: ["exports", "overview"],
    extraQuery: "export markdown download report",
  },
  {
    patterns: [/sardar|sardar.*(migration|project)|migration.*sardar/i],
    preferredCategories: ["sardar"],
    extraQuery: "sardar migration cutover production",
  },
  {
    patterns: [/not.*touch|do not.*touch|should.*avoid|forbidden|dangerous/i],
    preferredCategories: ["safety"],
    extraQuery: "do not touch forbidden safety rules never",
  },
  {
    patterns: [/confirmation.*phrase|confirm.*phrase|typed.*confirm|i confirm/i],
    preferredCategories: ["safety", "server_actions"],
    extraQuery: "confirmation phrase type confirm destructive",
  },
  {
    patterns: [/language|framework|tech.*stack|what.*built.*with|next\.?js|react|prisma|tailwind/i],
    preferredCategories: ["languages", "overview"],
    extraQuery: "language framework nextjs react prisma tailwind typescript",
  },
  {
    patterns: [/help.*center.*scan|what.*scan|file.*scan|scan.*files|excluded/i],
    preferredCategories: ["safety", "file_inventory", "overview"],
    extraQuery: "scan excluded files help center scope",
  },
  {
    patterns: [/route|page.*url|url.*page|navigation|where.*page/i],
    preferredCategories: ["routes", "architecture"],
    extraQuery: "route page url navigation dashboard",
  },
  {
    patterns: [/component|panel|ui.*component|which.*component/i],
    preferredCategories: ["components", "architecture"],
    extraQuery: "component panel ui client",
  },
  {
    patterns: [/pm2|restart|process.*manager|prisom-projects/i],
    preferredCategories: ["deployment", "safety"],
    extraQuery: "pm2 prisom-projects restart process",
  },
];

// ── Confidence ────────────────────────────────────────────────────────────────

function confidence(topScore: number): HelpAnswer["confidence"] {
  if (topScore >= 25) return "high";
  if (topScore >= 10) return "medium";
  return "low";
}

// ── Answer composition ────────────────────────────────────────────────────────

function extractRelevantLines(
  content: string,
  queryTokens: string[],
  maxLines = 8,
): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || l.startsWith("---") || containsSecretPattern(l)) return false;
      return true;
    })
    .filter((l) => {
      const lower = l.toLowerCase();
      return queryTokens.some((t) => lower.includes(t)) || l.startsWith("#") || l.startsWith("|");
    })
    .slice(0, maxLines);
}

function composeAnswer(
  question:     string,
  results:      HelpSearchResult[],
  report:       ProjectHelpCenterReport,
): string {
  if (results.length === 0) {
    return (
      "No matching information was found in the generated knowledge base for this question.\n\n" +
      "Try regenerating the knowledge base, or search with different keywords.\n\n" +
      "If the answer involves secret values, deployments, or live server operations, " +
      "those must be checked directly via SSH — this panel only shows documentation."
    );
  }

  const lines: string[] = [];
  const qTokens = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  // ── Direct answer from top section ──
  const top = results[0];
  const topSection = report.sections.find(
    (s) => s.id === top.sectionId || s.title === top.title,
  );

  lines.push(`**${top.title}**\n`);

  // Try to extract relevant lines from the full section
  if (topSection) {
    const relevant = extractRelevantLines(topSection.content, qTokens, 10);
    if (relevant.length > 0) {
      lines.push(relevant.join("\n"));
    } else {
      lines.push(top.snippet);
    }
  } else {
    lines.push(top.snippet);
  }

  // ── Supporting context from other results ──
  if (results.length > 1) {
    lines.push("\n**Also relevant:**");
    for (const r of results.slice(1, 4)) {
      if (!containsSecretPattern(r.snippet)) {
        lines.push(`- **${r.title}**: ${r.snippet}`);
      }
    }
  }

  // ── Source paths ──
  const allPaths = [...new Set(results.flatMap((r) => r.sourcePaths))].slice(0, 6);
  if (allPaths.length > 0) {
    lines.push("\n**Relevant source paths:**");
    for (const p of allPaths) {
      lines.push(`- \`${p}\``);
    }
  }

  return lines.join("\n");
}

// ── Missing information detection ─────────────────────────────────────────────

function detectMissingInfo(
  question: string,
  results:  HelpSearchResult[],
): string[] {
  const missing: string[] = [];
  const q     = question.toLowerCase();
  const score = results[0]?.score ?? 0;

  if (score < 8) {
    if (/error|bug|exception|crash|fail/i.test(q)) {
      missing.push("Specific error details are not in the knowledge base — check PM2 logs: `pm2 logs prisom-projects --lines 100`");
    } else if (/secret|key|token|password|credential/i.test(q)) {
      missing.push("Secret values are never stored in the knowledge base — access .env file directly via SSH on the server");
    } else if (/when|schedule|cron|timer/i.test(q)) {
      missing.push("Scheduling or timing information is not in the knowledge base");
    } else if (/user|customer|client.*data|order|payment.*status/i.test(q)) {
      missing.push("Live customer/order data is not in the knowledge base — check the database directly");
    } else {
      missing.push("This topic may not be well covered — try regenerating the knowledge base or ask with different keywords");
    }
  } else if (score < 15 && results.length < 3) {
    missing.push("Limited information found — the knowledge base may not fully cover this topic yet");
  }

  return missing;
}

// ── Safety notes ──────────────────────────────────────────────────────────────

function buildSafetyNotes(question: string, results: HelpSearchResult[]): string[] {
  const notes: string[] = [];
  const q       = question.toLowerCase();
  const content = results.map((r) => r.snippet).join(" ").toLowerCase();

  const check = (haystack: string) => q.includes(haystack) || content.includes(haystack);

  if (check("pm2") || check("restart") || check("process")) {
    notes.push("PM2 restarts must be done manually via SSH — never from the UI");
  }
  if (check("dns") || check("domain") || check("nginx") || check("proxy")) {
    notes.push("DNS and nginx changes require SSH access — not available through the panel");
  }
  if (check("secret") || check("env") || check("key") || check(".env")) {
    notes.push("Secret values are never exposed — only variable names (not values) appear in any output");
  }
  if (check("sardar") || check("sardar-security")) {
    notes.push("Sardar Security is a live production service — do NOT restart project-sardar-security-project from UI");
  }
  if (check("doorstep") || check("prisom-manager") || check("prisom-backend")) {
    notes.push("Do NOT touch prisom-manager or prisom-backend — those are the live Doorsteps/LocalShop services");
  }
  if (check("migration") || check("db:migrate") || check("prisma migrate")) {
    notes.push("DB migrations must be run manually via SSH — never triggered from the UI automatically");
  }
  if (check("deploy") && !check("verify")) {
    notes.push("Deployments must be triggered via SSH — the UI shows documentation only, not live execution");
  }
  if (check("stripe") || check("payment") || check("charge")) {
    notes.push("Stripe/payment operations must never be triggered from the panel — live payment processing is server-side only");
  }

  return notes;
}

// ── Preferred-category boosting ───────────────────────────────────────────────

function applyPreferredCategoryBoost(
  results: HelpSearchResult[],
  preferredCategories: string[],
): HelpSearchResult[] {
  if (preferredCategories.length === 0) return results;

  return [...results].sort((a, b) => {
    const aPreferred = preferredCategories.includes(a.category) ? 1 : 0;
    const bPreferred = preferredCategories.includes(b.category) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    return b.score - a.score;
  });
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function answerHelpQuestion(input: {
  projectId: string;
  question:  string;
}): Promise<HelpAnswer> {
  const { projectId, question } = input;

  const report = await generateProjectKnowledgeBase({ projectId });

  // Detect canned route for the question
  let effectiveQuery = question;
  let preferredCategories: string[] = [];

  for (const canned of CANNED_ROUTES) {
    if (canned.patterns.some((re) => re.test(question))) {
      effectiveQuery       = question + " " + canned.extraQuery;
      preferredCategories  = canned.preferredCategories;
      break;
    }
  }

  const rawResults = searchHelpKnowledge({
    report,
    query: effectiveQuery,
    limit: 6,
  });

  const results = applyPreferredCategoryBoost(rawResults, preferredCategories);

  return {
    question,
    answer:             composeAnswer(question, results, report),
    confidence:         confidence(results[0]?.score ?? 0),
    matchedSections:    results,
    missingInformation: detectMissingInfo(question, results),
    safetyNotes:        buildSafetyNotes(question, results),
  };
}
