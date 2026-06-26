"use client";

import { useState, useTransition, useRef } from "react";
import {
  searchProjectHelpAction,
  answerProjectHelpQuestionAction,
}                                           from "@/app/actions/help-center";
import { ActionLoadingButton }             from "@/components/common/action-loading-button";
import { Badge }                            from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
}                                           from "@/components/ui/card";
import { Input }                            from "@/components/ui/input";
import {
  Search, HelpCircle, AlertTriangle, ShieldCheck,
  CheckCircle2, BookOpen, ChevronDown, ChevronUp,
}                                           from "lucide-react";
import type {
  HelpSearchResult,
  HelpAnswer,
} from "@/lib/help-center/help-center-types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface HelpSearchPanelProps {
  projectId: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: HelpAnswer["confidence"] }) {
  const map = {
    high:   { variant: "success"   as const, label: "High confidence" },
    medium: { variant: "warning"   as const, label: "Medium confidence" },
    low:    { variant: "secondary" as const, label: "Low confidence" },
  };
  const { variant, label } = map[level];
  return <Badge variant={variant} className="text-[10px]">{label}</Badge>;
}

function SearchResultCard({ result }: { result: HelpSearchResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="outline" className="text-[10px] shrink-0">
              {result.category.replace(/_/g, " ")}
            </Badge>
            <span className="text-sm font-medium truncate">{result.title}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">score: {result.score}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{result.snippet}</p>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        }
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 border-t bg-muted/20 space-y-1">
          <p className="text-xs">{result.snippet}</p>
          {result.sourcePaths.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Sources: {result.sourcePaths.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Example questions ─────────────────────────────────────────────────────────

const SEARCH_EXAMPLES = [
  "deploy", "server actions", "exports", "Sardar", "safety rules", "routes",
];

const ASK_EXAMPLES = [
  "How do I deploy this project?",
  "What should I not touch?",
  "How do I run smoke checks?",
  "What exports are available?",
  "Where are server actions stored?",
  "How does Sardar migration work?",
];

// ── Main component ────────────────────────────────────────────────────────────

export function HelpSearchPanel({ projectId }: HelpSearchPanelProps) {
  const [query,        setQuery]        = useState("");
  const [question,     setQuestion]     = useState("");
  const [searchResults, setSearchResults] = useState<HelpSearchResult[] | null>(null);
  const [answer,       setAnswer]       = useState<HelpAnswer | null>(null);
  const [activeTab,    setActiveTab]    = useState<"search" | "ask">("search");
  const [searchError,  setSearchError]  = useState("");
  const [askError,     setAskError]     = useState("");

  const [isSearching, startSearch] = useTransition();
  const [isAsking,    startAsk]    = useTransition();
  const searchFlight = useRef(false);
  const askFlight    = useRef(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSearch() {
    if (!query.trim() || searchFlight.current) return;
    searchFlight.current = true;
    setSearchError("");
    setSearchResults(null);

    startSearch(async () => {
      try {
        const res = await searchProjectHelpAction({ projectId, query });
        if (!res.ok) { setSearchError(res.error); return; }
        setSearchResults(res.data);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        searchFlight.current = false;
      }
    });
  }

  function handleAsk() {
    if (!question.trim() || askFlight.current) return;
    askFlight.current = true;
    setAskError("");
    setAnswer(null);

    startAsk(async () => {
      try {
        const res = await answerProjectHelpQuestionAction({ projectId, question });
        if (!res.ok) { setAskError(res.error); return; }
        setAnswer(res.data);
      } catch (e) {
        setAskError(e instanceof Error ? e.message : "Failed to get answer.");
      } finally {
        askFlight.current = false;
      }
    });
  }

  function useSearchExample(q: string) { setQuery(q); }
  function useAskExample(q: string)    { setQuestion(q); }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Search & Ask Help</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Search project knowledge sections or ask a question. Answers come from generated documentation only — no hallucination.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Safety note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <span>Read-only — no secrets exposed. Answers grounded in generated knowledge only.</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["search", "ask"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tab === "search" ? <><Search className="h-3 w-3" /> Search</> : <><HelpCircle className="h-3 w-3" /> Ask Help</>}
            </button>
          ))}
        </div>

        {/* Search tab */}
        {activeTab === "search" && (
          <div className="space-y-3">
            {/* Search examples */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Try searching for:</p>
              <div className="flex flex-wrap gap-1.5">
                {SEARCH_EXAMPLES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => useSearchExample(q)}
                    className="text-[10px] border rounded px-2 py-0.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground font-mono"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. deploy, server actions, Sardar, exports…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="text-sm h-9"
              />
              <ActionLoadingButton
                type="button"
                loading={isSearching}
                loadingLabel="Searching…"
                onClick={handleSearch}
                disabled={!query.trim()}
                variant="outline"
              >
                <Search className="h-4 w-4" />
                Search
              </ActionLoadingButton>
            </div>

            {searchError && (
              <p className="text-xs text-destructive">{searchError}</p>
            )}

            {!query.trim() && searchResults === null && (
              <p className="text-xs text-muted-foreground">
                The knowledge base must be generated first (use the Sections tab above). Then search by keyword.
              </p>
            )}

            {searchResults !== null && searchResults.length === 0 && (
              <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/20">
                No matching sections found for <strong>&ldquo;{query}&rdquo;</strong>.
                Try broader keywords, or regenerate the knowledge base if it&apos;s out of date.
              </div>
            )}

            {searchResults !== null && searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {searchResults.length} section(s) matched &ldquo;{query}&rdquo;
                </p>
                {searchResults.map((r) => (
                  <SearchResultCard key={r.sectionId + r.title} result={r} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ask tab */}
        {activeTab === "ask" && (
          <div className="space-y-3">
            {/* Ask examples */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Example questions:</p>
              <div className="flex flex-wrap gap-1.5">
                {ASK_EXAMPLES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => useAskExample(q)}
                    className="text-[10px] border rounded px-2 py-0.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. How do I deploy this project?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                className="text-sm h-9"
              />
              <ActionLoadingButton
                type="button"
                loading={isAsking}
                loadingLabel="Answering…"
                onClick={handleAsk}
                disabled={!question.trim()}
                variant="outline"
              >
                <HelpCircle className="h-4 w-4" />
                Ask
              </ActionLoadingButton>
            </div>

            {askError && (
              <p className="text-xs text-destructive">{askError}</p>
            )}

            {answer && (
              <div className="space-y-3">
                {/* Answer box */}
                <div className="border rounded-md p-3 bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Answer</span>
                    </div>
                    <ConfidenceBadge level={answer.confidence} />
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
                    {answer.answer}
                  </pre>
                </div>

                {/* Low confidence warning */}
                {answer.confidence === "low" && answer.missingInformation.length === 0 && (
                  <div className="flex items-start gap-2 bg-muted/30 border rounded-md px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Low confidence — the knowledge base may not fully cover this topic. Try regenerating or searching with different keywords.
                    </p>
                  </div>
                )}

                {/* Missing information */}
                {answer.missingInformation.length > 0 && (
                  <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Not enough information:</p>
                      {answer.missingInformation.map((m, i) => (
                        <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">{m}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Safety notes */}
                {answer.safetyNotes.length > 0 && (
                  <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Safety notes:</p>
                      {answer.safetyNotes.map((n, i) => (
                        <p key={i} className="text-xs text-blue-700 dark:text-blue-400">{n}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Matched sections */}
                {answer.matchedSections.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">
                      Matched sections ({answer.matchedSections.length}):
                    </p>
                    {answer.matchedSections.map((r) => (
                      <div key={r.sectionId + r.title} className="flex items-start gap-2 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-medium">{r.title}</span>
                          {r.sourcePaths.length > 0 && (
                            <span className="text-muted-foreground ml-1">
                              — <code className="text-[10px]">{r.sourcePaths[0]}</code>
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
