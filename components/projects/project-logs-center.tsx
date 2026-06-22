"use client";

/**
 * components/projects/project-logs-center.tsx
 *
 * Sprint 28: Professional Logs Center UI.
 * Sprint 28 Hotfix: Fixed height/overflow layout so the log viewer fills the
 * available viewport instead of collapsing to a thin strip.
 *
 * Layout:
 *  ┌─────────────────────────────────────────────────┐
 *  │ [source label]   [level▾] [search] [↻] [⎘] [↓] │  ← toolbar (shrink-0)
 *  ├──────────────────────────────────────────────────┤
 *  │ Sources  │ [search banner (optional)]            │
 *  │ sidebar  │ ─────────────────────────────────────│
 *  │ (scroll) │  dark terminal log viewer  (scroll)  │
 *  │          │ ─────────────────────────────────────│
 *  │          │  [N lines]  [level badge]             │
 *  └──────────┴──────────────────────────────────────┘
 *
 * Height strategy:
 *  - The outer wrapper does NOT rely on flex-1 / h-full chains.
 *  - The body (sidebar + viewer) gets an explicit calc(100vh - 220px) height.
 *    220px ≈ TopBar (56px) + WorkspaceNav (49px) + toolbar row (48px) + buffer.
 *  - Every flex child that must scroll carries min-h-0.
 */

import {
  useState,
  useEffect,
  useCallback,
  useTransition,
  useRef,
} from "react";
import {
  Terminal,
  Layers,
  ListChecks,
  Rocket,
  Search,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  WifiOff,
  X,
} from "lucide-react";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import { Badge }      from "@/components/ui/badge";
import { cn }         from "@/lib/utils";
import {
  listLogSourcesAction,
  readLogSourceAction,
  searchLogsAction,
} from "@/app/actions/project-logs";
import type {
  LogSource,
  LogLine,
  LogSourceKind,
}                     from "@/lib/logs/project-log-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const GROUP_META: Record<
  string,
  { label: string; icon: React.ElementType; kinds: LogSourceKind[] }
> = {
  runtime:     { label: "Runtime",     icon: Terminal,   kinds: ["pm2_app", "pm2_service"] },
  structured:  { label: "Structured",  icon: Layers,     kinds: ["db_logs"] },
  operations:  { label: "Operations",  icon: ListChecks, kinds: ["operation"] },
  deployments: { label: "Deployments", icon: Rocket,     kinds: ["deployment"] },
};

const GROUP_ORDER = ["runtime", "structured", "operations", "deployments"] as const;

const LEVEL_CLASS: Record<string, string> = {
  FATAL: "text-red-500",
  ERROR: "text-red-400",
  WARN:  "text-yellow-400",
  INFO:  "text-blue-400",
  DEBUG: "text-gray-500",
};

const LEVEL_TEXT_CLASS: Record<string, string> = {
  FATAL: "text-red-300",
  ERROR: "text-red-300",
  WARN:  "text-yellow-200",
  INFO:  "text-gray-300",
  DEBUG: "text-gray-500",
};

const LEVEL_OPTIONS = ["ALL", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
type LevelFilter = typeof LEVEL_OPTIONS[number];

// ── Timestamp formatter ───────────────────────────────────────────────────────

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.slice(0, 13);
    return (
      d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  } catch {
    return ts.slice(0, 13);
  }
}

// ── Source sidebar ────────────────────────────────────────────────────────────

function SourceSidebar({
  sources,
  selectedId,
  onSelect,
  loading,
  onRefresh,
  refreshing,
}: {
  sources:    LogSource[];
  selectedId: string | null;
  onSelect:   (id: string) => void;
  loading:    boolean;
  onRefresh:  () => void;
  refreshing: boolean;
}) {
  return (
    <aside className="w-64 shrink-0 flex flex-col border-r bg-muted/20 overflow-hidden">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sources
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          title="Refresh source list"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Source list — scrolls independently */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {GROUP_ORDER.map((groupKey) => {
          const { label, icon: Icon, kinds } = GROUP_META[groupKey];
          const group = sources.filter((s) => kinds.includes(s.kind));
          if (group.length === 0) return null;

          return (
            <div key={groupKey} className="mt-1">
              <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Icon className="h-3 w-3" />
                {label}
              </p>
              {group.map((src) => (
                <button
                  key={src.id}
                  disabled={!src.available || loading}
                  onClick={() => onSelect(src.id)}
                  className={cn(
                    "w-full text-left flex flex-col px-3 py-2 text-xs transition-colors",
                    "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    selectedId === src.id
                      ? "bg-primary/10 text-primary font-medium border-l-2 border-primary"
                      : "text-foreground border-l-2 border-transparent",
                    !src.available && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <span className="truncate leading-snug">{src.label}</span>
                  {src.subLabel && (
                    <span className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {src.subLabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}

        {sources.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">
            No log sources found.
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({
  lines,
  loading,
  error,
  truncated,
  levelFilter,
  searchQuery,
}: {
  lines:       LogLine[];
  loading:     boolean;
  error:       string | null;
  truncated:   boolean;
  levelFilter: LevelFilter;
  searchQuery: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && lines.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, loading]);

  const filtered = lines.filter((l) => {
    if (levelFilter === "ALL") return true;
    return l.level === levelFilter;
  });

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#0d1117] p-4 font-mono text-xs leading-relaxed">
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-40 text-gray-600">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" />
          Loading logs…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-red-400 py-8 px-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && lines.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600">
          <WifiOff className="h-6 w-6" />
          {searchQuery
            ? "No matching log entries."
            : "No log output found for this source."}
        </div>
      )}

      {/* Truncation warning */}
      {!loading && truncated && (
        <div className="flex items-center gap-2 text-yellow-500/70 text-xs mb-2 px-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Showing last 500 lines — older entries were truncated.
        </div>
      )}

      {/* Log lines */}
      {!loading && !error && filtered.map((line, i) => (
        <div
          key={i}
          className="flex gap-2 hover:bg-white/5 px-2 py-0.5 rounded"
        >
          {line.ts && (
            <span className="text-gray-600 shrink-0 tabular-nums w-[6.5rem] truncate">
              {formatTs(line.ts)}
            </span>
          )}
          {line.level && (
            <span className={cn("shrink-0 w-5 font-bold uppercase text-center", LEVEL_CLASS[line.level] ?? "text-gray-400")}>
              {line.level.slice(0, 1)}
            </span>
          )}
          {line.source && (
            <span className="text-purple-400/80 shrink-0 w-14 truncate">
              {line.source}
            </span>
          )}
          <span
            className={cn(
              "break-all min-w-0",
              line.level ? (LEVEL_TEXT_CLASS[line.level] ?? "text-gray-300") : "text-gray-300",
            )}
          >
            {line.text}
          </span>
        </div>
      ))}

      {/* Level filter mismatch */}
      {!loading && !error && lines.length > 0 && filtered.length === 0 && (
        <div className="flex items-center justify-center h-20 text-gray-600">
          No {levelFilter} entries in current output.
        </div>
      )}

      {/* Cursor blink */}
      {!loading && !error && (
        <div className="px-2 py-0.5 mt-1">
          <span className="text-gray-700 animate-pulse">▊</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type CenterState =
  | { phase: "idle" }
  | { phase: "loading_source" }
  | { phase: "loaded"; lines: LogLine[]; truncated: boolean }
  | { phase: "searching" }
  | { phase: "search_results"; lines: LogLine[]; query: string }
  | { phase: "error"; error: string };

export function ProjectLogsCenter({
  projectId,
  initialSources,
  initialSelectedId,
}: {
  projectId:          string;
  initialSources:     LogSource[];
  initialSelectedId?: string;
}) {
  const [sources, setSources]         = useState<LogSource[]>(initialSources);
  const [selectedId, setSelectedId]   = useState<string | null>(
    initialSelectedId ??
    initialSources.find((s) => s.available)?.id ??
    null,
  );
  const [centerState, setCenterState] = useState<CenterState>({ phase: "idle" });
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [copied, setCopied]           = useState(false);
  const [isPending, startTransition]  = useTransition();
  const [refreshingSources, setRefreshingSources] = useState(false);

  // ── Load source ───────────────────────────────────────────────────────────
  const loadSource = useCallback(
    (sourceId: string) => {
      setCenterState({ phase: "loading_source" });
      setSearchInput("");
      startTransition(async () => {
        try {
          const r = await readLogSourceAction(projectId, sourceId);
          if (!r.ok) {
            setCenterState({ phase: "error", error: r.error });
            return;
          }
          setCenterState({ phase: "loaded", lines: r.lines, truncated: r.truncated });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setCenterState({ phase: "error", error: msg });
        }
      });
    },
    [projectId],
  );

  useEffect(() => {
    if (selectedId) loadSource(selectedId);
    else setCenterState({ phase: "idle" });
  }, [selectedId, loadSource]);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(
    (q: string) => {
      if (q.trim().length < 2) return;
      setCenterState({ phase: "searching" });
      startTransition(async () => {
        try {
          const r = await searchLogsAction(projectId, q.trim());
          if (!r.ok) {
            setCenterState({ phase: "error", error: r.error });
            return;
          }
          setCenterState({ phase: "search_results", lines: r.lines, query: q.trim() });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setCenterState({ phase: "error", error: msg });
        }
      });
    },
    [projectId],
  );

  function clearSearch() {
    setSearchInput("");
    if (selectedId) loadSource(selectedId);
    else setCenterState({ phase: "idle" });
  }

  // ── Refresh sources ───────────────────────────────────────────────────────
  async function refreshSources() {
    setRefreshingSources(true);
    try {
      const r = await listLogSourcesAction(projectId);
      if (r.ok) setSources(r.sources);
    } finally {
      setRefreshingSources(false);
    }
  }

  // ── Copy ──────────────────────────────────────────────────────────────────
  function handleCopy() {
    const lines =
      centerState.phase === "loaded"         ? centerState.lines :
      centerState.phase === "search_results" ? centerState.lines : [];
    const text = lines.map((l) => l.text).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Download ──────────────────────────────────────────────────────────────
  function handleDownload() {
    if (!selectedId) return;
    const url = `/projects/${projectId}/logs/download?source=${encodeURIComponent(selectedId)}`;
    const a   = document.createElement("a");
    a.href    = url;
    a.download = "";
    a.click();
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isLoading    = centerState.phase === "loading_source" || centerState.phase === "searching" || isPending;
  const isSearchMode = centerState.phase === "search_results";
  const currentLines =
    centerState.phase === "loaded"         ? centerState.lines :
    centerState.phase === "search_results" ? centerState.lines : [];
  const truncated    = centerState.phase === "loaded" ? centerState.truncated : false;
  const viewError    = centerState.phase === "error"  ? centerState.error    : null;
  const selectedSource = sources.find((s) => s.id === selectedId);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden">

      {/* ── Toolbar ── (shrink-0, stays at top) */}
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2 shrink-0 flex-wrap">
        {/* Source label */}
        <div className="flex items-center gap-1.5 text-sm font-medium min-w-0">
          <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
          {isSearchMode ? (
            <span className="text-muted-foreground">Search results</span>
          ) : selectedSource ? (
            <>
              <span className="truncate max-w-[180px]">{selectedSource.label}</span>
              {selectedSource.subLabel && (
                <span className="text-muted-foreground font-normal text-xs hidden sm:inline">
                  <ChevronRight className="inline h-3 w-3" />
                  {selectedSource.subLabel}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Select a log source</span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Level filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {/* Search bar */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch(searchInput);
                if (e.key === "Escape") clearSearch();
              }}
              placeholder="Search DB logs…"
              className="h-7 pl-6 pr-6 text-xs w-44 sm:w-52"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={isLoading || !selectedId}
            onClick={() => selectedId && loadSource(selectedId)}
            title="Refresh logs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>

          {/* Copy */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={currentLines.length === 0}
            onClick={handleCopy}
            title="Copy all to clipboard"
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-green-500" />
              : <Copy className="h-3.5 w-3.5" />
            }
          </Button>

          {/* Download */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!selectedId || isSearchMode}
            onClick={handleDownload}
            title="Download as .txt"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body: sidebar + viewer ──────────────────────────────────────────── */}
      {/*
       * KEY FIX: explicit height so the body doesn't depend on h-full
       * propagating correctly through the flex chain.
       *
       * 220px ≈ TopBar (56px) + WorkspaceNav (49px) + toolbar above (48px) + buffer.
       * min-h ensures usability on short viewports / mobile.
       * On narrow screens the layout stacks vertically (flex-col); on lg+ it goes side-by-side.
       */}
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-220px)] h-[calc(100vh-220px)] overflow-hidden border-t">

        {/* Sidebar */}
        <SourceSidebar
          sources={sources}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          loading={isLoading}
          onRefresh={refreshSources}
          refreshing={refreshingSources}
        />

        {/* Right panel */}
        <section className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Search mode banner */}
          {isSearchMode && (
            <div className="flex items-center gap-2 bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-700 shrink-0">
              <Search className="h-3 w-3 shrink-0" />
              Showing results for&nbsp;
              <span className="font-medium">"{(centerState as { query: string }).query}"</span>
              <span className="text-blue-500">({currentLines.length} match{currentLines.length !== 1 ? "es" : ""})</span>
              <button
                onClick={clearSearch}
                className="ml-auto flex items-center gap-1 hover:text-blue-900"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          )}

          {/* Log viewer — fills all remaining height */}
          <LogViewer
            lines={currentLines}
            loading={isLoading}
            error={viewError}
            truncated={truncated}
            levelFilter={levelFilter}
            searchQuery={isSearchMode ? (centerState as { query: string }).query : ""}
          />

          {/* Footer: line count */}
          {!isLoading && currentLines.length > 0 && (
            <div className="shrink-0 border-t bg-muted/20 px-4 py-1 text-[10px] text-muted-foreground flex items-center gap-3">
              <span>{currentLines.length} line{currentLines.length !== 1 ? "s" : ""}</span>
              {levelFilter !== "ALL" && (
                <Badge variant="outline" className="h-4 text-[10px] py-0">
                  {levelFilter} filter active
                </Badge>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
