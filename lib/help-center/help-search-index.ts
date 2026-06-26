import { containsSecretPattern } from "./help-redaction";
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
  "which", "who", "not", "no", "if", "so", "as", "by", "from", "get",
  "my", "your", "our", "all", "more", "also", "then",
]);

// Important domain terms that get an extra boost when they appear in keywords
const IMPORTANT_TERMS = new Set([
  "deploy", "deployment", "smoke", "launch", "go-no-go", "help",
  "sardar", "sardar-security", "server action", "export", "exports",
  "confirmation", "route", "pm2", "nginx", "prisma", "env", "environment",
  "secret", "safety", "safety rules", "what not to touch",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*#|_\[\]()]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9./\-_]/g, ""))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}

// ── Snippet extraction ────────────────────────────────────────────────────────

function extractSnippet(content: string, queryTokens: string[], maxLen = 220): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("|"));

  // Prefer a line that contains query tokens and isn't secret-looking
  for (const line of lines) {
    if (containsSecretPattern(line)) continue;
    const lower = line.toLowerCase();
    const matchCount = queryTokens.filter((t) => lower.includes(t)).length;
    if (matchCount > 0) {
      const clean = line.replace(/^\s*[-*•]\s*/, "").trim();
      return clean.slice(0, maxLen) + (clean.length > maxLen ? "…" : "");
    }
  }

  // Fall back to first non-secret, non-header paragraph line
  for (const line of lines) {
    if (containsSecretPattern(line)) continue;
    if (line.length > 20) {
      const clean = line.replace(/^\s*[-*•]\s*/, "").trim();
      return clean.slice(0, maxLen) + (clean.length > maxLen ? "…" : "");
    }
  }

  return content.slice(0, maxLen).trim() + "…";
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreSection(
  section:      HelpKnowledgeSection,
  queryTokens:  string[],
  rawQuery:     string,
): number {
  let score = 0;
  const titleLower    = section.title.toLowerCase();
  const contentLower  = section.content.toLowerCase();
  const keywordsLower = section.keywords.map((k) => k.toLowerCase());
  const pathsText     = section.sourcePaths.join(" ").toLowerCase();
  const catText       = section.category.toLowerCase();
  const qLower        = normalizeQuery(rawQuery);

  // ── Exact phrase boosts ──

  // Exact phrase in title: +30
  if (qLower.length > 2 && titleLower.includes(qLower)) score += 30;

  // All query tokens in title: +20
  if (queryTokens.length > 0 && queryTokens.every((t) => titleLower.includes(t))) score += 20;

  // Exact phrase in any keyword: +18
  for (const kw of keywordsLower) {
    if (qLower.length > 2 && kw.includes(qLower)) score += 18;
  }

  // All query tokens in keywords: +14
  if (queryTokens.length > 0 && queryTokens.every((t) => keywordsLower.some((kw) => kw.includes(t))))
    score += 14;

  // Exact phrase in source path: +12
  if (qLower.length > 2 && pathsText.includes(qLower)) score += 12;

  // All query tokens in content: +8
  if (queryTokens.length > 0 && queryTokens.every((t) => contentLower.includes(t))) score += 8;

  // ── Per-token boosts ──

  for (const token of queryTokens) {
    // Title match per token: +12
    if (titleLower.includes(token)) score += 12;

    // Keyword match per token
    for (const kw of keywordsLower) {
      if (kw === token)        score += 10;
      else if (kw.includes(token)) score += 5;
    }

    // Category match
    if (catText.includes(token)) score += 6;

    // Important file path match: +10
    if (pathsText.includes(token)) score += token.length > 3 ? 10 : 3;

    // Content occurrence count
    let idx = 0;
    let hits = 0;
    while ((idx = contentLower.indexOf(token, idx)) !== -1) {
      hits++;
      idx += token.length;
      if (hits >= 10) break;
    }
    score += hits;

    // Important domain term boost: +6
    if (IMPORTANT_TERMS.has(token)) score += 6;
  }

  return score;
}

// ── Main search ───────────────────────────────────────────────────────────────

export function searchHelpKnowledge(input: {
  report: ProjectHelpCenterReport;
  query:  string;
  limit?: number;
}): HelpSearchResult[] {
  const { report, query, limit = 6 } = input;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) return [];

  const scored: Array<{ section: HelpKnowledgeSection; score: number }> = [];

  for (const section of report.sections) {
    const score = scoreSection(section, queryTokens, trimmed);
    if (score > 0) scored.push({ section, score });
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
