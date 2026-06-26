import type {
  ProjectHelpCenterReport,
  HelpKnowledgeSection,
  HelpSearchResult,
} from "./help-center-types";

// ── Tokenization ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "can",
  "could", "should", "may", "might", "this", "that", "these", "those",
  "it", "its", "i", "you", "we", "they", "what", "where", "how", "when",
  "which", "who", "not", "no", "if", "so", "as", "by", "from",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*#|_\[\]()]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9./\-_]/g, ""))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function extractSnippet(content: string, queryTokens: string[], maxLen = 200): string {
  const lines = content.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (queryTokens.some((t) => lower.includes(t))) {
      return line.trim().slice(0, maxLen) + (line.length > maxLen ? "…" : "");
    }
  }
  return lines.slice(0, 2).join(" ").trim().slice(0, maxLen) + "…";
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreSection(section: HelpKnowledgeSection, queryTokens: string[]): number {
  let score = 0;
  const titleLower   = section.title.toLowerCase();
  const contentLower = section.content.toLowerCase();
  const keywordsLower = section.keywords.map((k) => k.toLowerCase());
  const pathsText    = section.sourcePaths.join(" ").toLowerCase();

  for (const token of queryTokens) {
    // Title match — highest weight
    if (titleLower.includes(token)) score += 12;

    // Keyword match — high weight
    for (const kw of keywordsLower) {
      if (kw === token) score += 8;
      else if (kw.includes(token)) score += 4;
    }

    // Category match
    if (section.category.includes(token)) score += 6;

    // Content match — count occurrences
    let idx = 0;
    while ((idx = contentLower.indexOf(token, idx)) !== -1) {
      score += 1;
      idx += token.length;
      if (score > 50) break; // cap content matches
    }

    // Source path match
    if (pathsText.includes(token)) score += 3;
  }

  return score;
}

// ── Main search ───────────────────────────────────────────────────────────────

export function searchHelpKnowledge(input: {
  report: ProjectHelpCenterReport;
  query:  string;
  limit?: number;
}): HelpSearchResult[] {
  const { report, query, limit = 5 } = input;
  if (!query.trim()) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored: Array<{ section: HelpKnowledgeSection; score: number }> = [];

  for (const section of report.sections) {
    const score = scoreSection(section, queryTokens);
    if (score > 0) {
      scored.push({ section, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ section, score }) => ({
    sectionId:   section.id,
    title:       section.title,
    category:    section.category,
    snippet:     extractSnippet(section.content, queryTokens),
    score,
    sourcePaths: section.sourcePaths,
  }));
}
