"use client";

/**
 * components/projects/file-browser.tsx
 *
 * Sprint 10: Multi-tab Monaco-powered code editor shell.
 *
 * Sprint 6 safety guarantees preserved:
 *  - All file I/O goes through server actions (readProjectFileAction,
 *    saveProjectFileAction, createProjectFileAction, applyAiPatchAction).
 *  - No absolute paths, no traversal, no .env, no secrets.
 *  - Optimistic concurrency (expectedModifiedAt) on every save.
 *  - Read-only fallback for oversized/unsupported files.
 *
 * Sprint 10 additions:
 *  - Multi-file tabs (OpenFileTab[])
 *  - Monaco Editor (syntax highlighting, line numbers, Ctrl+S)
 *  - File tree search filter
 *  - JSON formatting (marks dirty, does not auto-save)
 *  - Cursor line/col status bar
 *  - Word-wrap toggle
 *  - Git save hint after successful save
 */

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useRef,
} from "react";
import {
  Folder,
  FileCode2,
  FilePlus,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Info,
  Save,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  RefreshCcw,
  FolderOpen,
  Send,
  X,
  AlertCircle,
  WrapText,
  Code2,
  GitBranch,
} from "lucide-react";
import {
  getProjectFileTreeAction,
  readProjectFileAction,
  saveProjectFileAction,
  createProjectFileAction,
  applyAiPatchAction,
  type FileTreeItem,
} from "@/app/actions/project-files";
import { suggestProjectPatchAction } from "@/app/actions/project-ai";
import { CodeEditor } from "@/components/projects/code-editor";
import { getEditorLanguage } from "@/lib/projects/editor-language";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:    string;
  projectName?: string;
}

/**
 * One open editor tab.  `content` = last-saved server state;
 * `editedContent` = current Monaco value (may be dirty).
 */
interface OpenFileTab {
  path:          string;
  content:       string;       // last saved from server
  editedContent: string;       // current editor value
  modifiedAt:    string;
  language:      string;
  size:          number;
  isDirty:       boolean;
  isSaving:      boolean;
  saveStatus:    "idle" | "saving" | "saved" | "conflict" | "error";
  saveError:     string | null;
}

// ── AI panel local type mirrors ───────────────────────────────────────────────

interface PatchHunk {
  path:             string;
  type:             "modify" | "create";
  unifiedDiff:      string;
  proposedContent?: string;
  warnings:         string[];
}

interface PatchSuggestion {
  summary:                string;
  patches:                PatchHunk[];
  commandsToRunManually?: string[];
  risks:                  string[];
  rawFallback?:           string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0)       return "0 B";
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function makeTab(
  path:       string,
  content:    string,
  modifiedAt: string,
  size:       number,
): OpenFileTab {
  return {
    path,
    content,
    editedContent: content,
    modifiedAt,
    size,
    language:   getEditorLanguage(path),
    isDirty:    false,
    isSaving:   false,
    saveStatus: "idle",
    saveError:  null,
  };
}

// ── File icon ─────────────────────────────────────────────────────────────────

function FileIcon({ name, className = "" }: { name: string; className?: string }) {
  const e = getExt(name);
  const color =
    ["ts","tsx","js","jsx","mjs","cjs"].includes(e) ? "text-blue-400"         :
    ["json","yaml","yml","toml"].includes(e)         ? "text-yellow-400"       :
    ["css","scss","sass","less"].includes(e)          ? "text-pink-400"         :
    ["md","mdx","txt"].includes(e)                    ? "text-gray-400"         :
    "text-muted-foreground";
  return <FileCode2 className={`h-3.5 w-3.5 shrink-0 ${color} ${className}`} />;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="text-xs text-muted-foreground italic">No diff produced.</p>;
  return (
    <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto bg-muted/60 border border-border rounded p-3 whitespace-pre">
      {diff.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++") ? "text-green-500 bg-green-500/10 block" :
          line.startsWith("-") && !line.startsWith("---") ? "text-red-500 bg-red-500/10 block"     :
          line.startsWith("@@")                           ? "text-cyan-500 block"                  :
          "block";
        return <span key={i} className={cls}>{line || " "}</span>;
      })}
    </pre>
  );
}

// ── AI Patch Panel ────────────────────────────────────────────────────────────

function AiPatchPanel({
  projectId,
  activeTab,
  onApplyPatch,
  onClose,
}: {
  projectId:    string;
  activeTab:    OpenFileTab | null;
  onApplyPatch: (content: string, path: string) => void;
  onClose:      () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [suggestion,  setSuggestion]  = useState<PatchSuggestion | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [isPending,   startTransition] = useTransition();
  const [applying,    setApplying]    = useState<string | null>(null);
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});

  const handleAsk = useCallback(() => {
    if (!activeTab || !instruction.trim()) return;
    setError(null);
    setSuggestion(null);
    startTransition(async () => {
      const res = await suggestProjectPatchAction({
        projectId,
        instruction,
        selectedFiles: [{
          path:    activeTab.path,
          // Use current editor content (includes unsaved edits), not stale server content
          content: activeTab.editedContent,
        }],
      });
      if (res.ok && res.data) {
        setSuggestion(res.data);
      } else if (!res.ok) {
        setError((res as { ok: false; error: string }).error);
      }
    });
  }, [activeTab, instruction, projectId]);

  const handleApply = useCallback(async (patchPath: string, proposedContent: string) => {
    setApplying(patchPath);
    setApplyErrors({});
    const res = await applyAiPatchAction({
      projectId,
      patches: [{
        path:               patchPath,
        proposedContent,
        expectedModifiedAt: activeTab?.modifiedAt,
      }],
    });
    setApplying(null);
    if (res.ok && res.data) {
      if (res.data.skipped.length > 0) {
        const err: Record<string, string> = {};
        res.data.skipped.forEach((s) => { err[s.path] = s.reason; });
        setApplyErrors(err);
      } else {
        onApplyPatch(proposedContent, patchPath);
      }
    } else if (!res.ok) {
      setApplyErrors({ [patchPath]: (res as { ok: false; error: string }).error });
    }
  }, [projectId, activeTab, onApplyPatch]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium flex-1">AI Patch Suggestions</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted transition-colors">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {activeTab ? (
        <div className="px-4 py-2 border-b bg-muted/30 shrink-0 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Working on: <code className="font-mono bg-muted px-1 rounded">{activeTab.path}</code>
          </p>
          {activeTab.isDirty && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Unsaved changes included — will not be auto-saved.
            </p>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <FileCode2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">Open a file in the editor first.</p>
          </div>
        </div>
      )}

      {activeTab && (
        <>
          {/* Instruction */}
          <div className="px-4 py-3 border-b shrink-0 space-y-2">
            <label className="text-xs font-medium text-foreground">Instruction</label>
            <div className="flex gap-2">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Add TypeScript types, add error handling…"
                disabled={isPending}
                rows={3}
                className="flex-1 resize-none rounded border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <button
                onClick={handleAsk}
                disabled={isPending || !instruction.trim()}
                className="shrink-0 self-end rounded-lg bg-primary text-primary-foreground p-2 hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Ask AI"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              AI suggests a diff only. No files change until you click Apply. Secrets are never sent.
            </p>
          </div>

          {error && (
            <div className="mx-4 my-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {isPending && !suggestion && (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking…</span>
            </div>
          )}

          {suggestion && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-foreground mb-1">Summary</p>
                <p className="text-sm">{suggestion.summary}</p>
              </div>

              {suggestion.rawFallback && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-50/10 px-3 py-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-amber-600">Unstructured suggestion</span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">{suggestion.rawFallback}</pre>
                  <CopyButton text={suggestion.rawFallback ?? ""} label="Copy suggestion" />
                </div>
              )}

              {suggestion.patches.map((patch, i) => (
                <div key={i} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <code className="text-xs font-mono flex-1 truncate">{patch.path}</code>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      patch.type === "create"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-blue-500/10 text-blue-600"
                    }`}>{patch.type}</span>
                  </div>
                  {patch.warnings.length > 0 && (
                    <div className="px-3 py-2 bg-amber-50/10 border-b border-border space-y-0.5">
                      {patch.warnings.map((w, j) => (
                        <p key={j} className="text-xs text-amber-600 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}
                        </p>
                      ))}
                    </div>
                  )}
                  {patch.unifiedDiff && !patch.warnings.some((w) => w.startsWith("⛔")) && (
                    <div className="p-3 space-y-2">
                      <DiffViewer diff={patch.unifiedDiff} />
                      <div className="flex items-center gap-2 flex-wrap">
                        <CopyButton text={patch.unifiedDiff} label="Copy diff" />
                        {patch.proposedContent && (
                          <CopyButton text={patch.proposedContent} label="Copy full file" />
                        )}
                        {patch.proposedContent && !patch.warnings.some((w) => w.startsWith("⛔")) && (
                          <button
                            onClick={() => handleApply(patch.path, patch.proposedContent!)}
                            disabled={applying === patch.path}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {applying === patch.path
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Check className="h-3 w-3" />}
                            Apply patch
                          </button>
                        )}
                      </div>
                      {applyErrors[patch.path] && (
                        <p className="text-xs text-destructive">⚠ {applyErrors[patch.path]}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {suggestion.risks.length > 0 && (
                <div className="rounded border border-amber-200/40 bg-amber-50/10 px-3 py-2 space-y-1">
                  <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Risks to consider
                  </p>
                  {suggestion.risks.map((r, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{r}</p>
                  ))}
                </div>
              )}

              {suggestion.commandsToRunManually && suggestion.commandsToRunManually.length > 0 && (
                <div className="rounded border border-border bg-muted/30 px-3 py-2 space-y-2">
                  <p className="text-xs font-medium text-foreground flex items-center gap-1">
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    Run manually after applying
                  </p>
                  {suggestion.commandsToRunManually.map((cmd, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-xs bg-muted/80 border border-border rounded px-2 py-1">{cmd}</code>
                      <CopyButton text={cmd} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── File tree ─────────────────────────────────────────────────────────────────

function FileTree({
  files,
  activeTabPath,
  search,
  onSelect,
}: {
  files:         FileTreeItem[];
  activeTabPath: string | null;
  search:        string;
  onSelect:      (file: FileTreeItem) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((dirPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });
  }, []);

  const q = search.trim().toLowerCase();

  // When searching: keep only files matching query + their ancestor dirs
  const filteredFiles = q
    ? (() => {
        const matchingPaths = new Set(
          files
            .filter((f) => !f.isDir && f.path.toLowerCase().includes(q))
            .map((f) => f.path),
        );
        const toShow = new Set<string>();
        for (const p of matchingPaths) {
          const parts = p.split("/");
          for (let i = 1; i < parts.length; i++) {
            toShow.add(parts.slice(0, i).join("/"));
          }
          toShow.add(p);
        }
        return files.filter((f) => toShow.has(f.path));
      })()
    : files;

  // Build visible list, respecting collapsed state (only when not searching)
  const visible: FileTreeItem[] = [];
  for (const file of filteredFiles) {
    if (q) {
      visible.push(file);
    } else {
      const parts = file.path.split("/");
      let hidden = false;
      for (let i = 1; i < parts.length; i++) {
        if (collapsed.has(parts.slice(0, i).join("/"))) { hidden = true; break; }
      }
      if (!hidden) visible.push(file);
    }
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 gap-2 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground leading-relaxed">No editable files found.</p>
      </div>
    );
  }

  if (q && visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 p-4 gap-2 text-center">
        <p className="text-xs text-muted-foreground">No files match &quot;{q}&quot;.</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {visible.map((file) => {
        const isDir    = file.isDir;
        const isCollap = isDir && collapsed.has(file.path) && !q;
        const isSel    = activeTabPath === file.path;
        return (
          <div
            key={file.path}
            onClick={() => isDir ? toggle(file.path) : onSelect(file)}
            className={`flex items-center gap-1.5 py-0.5 pr-2 rounded text-xs cursor-pointer transition-colors select-none ${
              isSel
                ? "bg-accent text-foreground"
                : "text-foreground/75 hover:text-foreground hover:bg-accent/50"
            }`}
            style={{ paddingLeft: `${8 + file.depth * 12}px` }}
            title={file.path}
          >
            {isDir ? (
              <>
                {isCollap
                  ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  : <ChevronDown  className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                <FileIcon name={file.name} />
              </>
            )}
            <span className="flex-1 truncate">{file.name}</span>
            {!isDir && file.size > 0 && (
              <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">
                {formatBytes(file.size)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({
  tabs,
  activeTabPath,
  onSelect,
  onClose,
}: {
  tabs:          OpenFileTab[];
  activeTabPath: string | null;
  onSelect:      (path: string) => void;
  onClose:       (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div
      className="flex items-stretch overflow-x-auto border-b bg-muted/10 shrink-0"
      style={{ minHeight: 34 }}
    >
      {tabs.map((tab) => {
        const name     = tab.path.split("/").pop() ?? tab.path;
        const isActive = tab.path === activeTabPath;
        return (
          <div
            key={tab.path}
            onClick={() => onSelect(tab.path)}
            title={tab.path}
            className={`group flex items-center gap-1.5 px-3 border-r cursor-pointer select-none whitespace-nowrap text-xs transition-colors ${
              isActive
                ? "bg-background text-foreground border-b-2 border-b-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            {tab.isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                title="Unsaved changes"
              />
            )}
            <span className="max-w-[120px] truncate">{name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(tab.path); }}
              className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-all shrink-0"
              title="Close tab"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectFileBrowser({ projectId, projectName }: Props) {
  // ── File tree ────────────────────────────────────────────────────────────
  const [files,       setFiles]       = useState<FileTreeItem[]>([]);
  const [treeLabel,   setTreeLabel]   = useState<string>("");
  const [treeError,   setTreeError]   = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeSearch,  setTreeSearch]  = useState("");

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const [tabs,          setTabs]          = useState<OpenFileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [fileLoading,   setFileLoading]   = useState(false);
  const [fileError,     setFileError]     = useState<string | null>(null);

  // ── Editor options ───────────────────────────────────────────────────────
  const [wordWrap,  setWordWrap]  = useState(true);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [formatErr, setFormatErr] = useState<string | null>(null);
  const [gitHint,   setGitHint]   = useState(false);

  // ── New file input ───────────────────────────────────────────────────────
  const [newFileName,  setNewFileName]  = useState<string | null>(null);
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

  // ── AI panel ─────────────────────────────────────────────────────────────
  const [showAi, setShowAi] = useState(false);

  const [isPending, startTransition] = useTransition();

  // Derived
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  // ── Load file tree ───────────────────────────────────────────────────────

  const loadTree = useCallback(() => {
    setTreeLoading(true);
    startTransition(async () => {
      const res = await getProjectFileTreeAction(projectId);
      setTreeLoading(false);
      if (res.ok && res.data) {
        setFiles(res.data.files);
        setTreeLabel(res.data.label);
        setTreeError(null);
      } else if (!res.ok) {
        setTreeError((res as { ok: false; error: string }).error);
      }
    });
  }, [projectId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  // ── Open file in tab ─────────────────────────────────────────────────────

  const openFileInTab = useCallback(async (file: FileTreeItem) => {
    if (file.isDir) return;

    // Focus existing tab if already open
    const existing = tabs.find((t) => t.path === file.path);
    if (existing) {
      setActiveTabPath(file.path);
      return;
    }

    setFileError(null);
    setFileLoading(true);

    const res = await readProjectFileAction(projectId, file.path);
    setFileLoading(false);

    if (res.ok && res.data) {
      const d   = res.data;
      const tab = makeTab(d.path, d.content, d.modifiedAt, d.size);
      setTabs((prev) => [...prev, tab]);
      setActiveTabPath(d.path);
      setFormatErr(null);
      setGitHint(false);
      setCursorPos({ line: 1, col: 1 });
    } else if (!res.ok) {
      setFileError((res as { ok: false; error: string }).error);
    }
  }, [projectId, tabs]);

  // ── Close tab ────────────────────────────────────────────────────────────

  const closeTab = useCallback((path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (tab?.isDirty) {
      const name = path.split("/").pop() ?? path;
      if (!confirm(`"${name}" has unsaved changes. Close anyway?`)) return;
    }
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        const idx  = prev.findIndex((t) => t.path === path);
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveTabPath(next?.path ?? null);
      }
      return remaining;
    });
    setFormatErr(null);
  }, [tabs, activeTabPath]);

  // ── Editor change ────────────────────────────────────────────────────────

  const handleEditorChange = useCallback((value: string) => {
    setTabs((prev) => prev.map((t) =>
      t.path === activeTabPath
        ? { ...t, editedContent: value, isDirty: value !== t.content }
        : t
    ));
    setFormatErr(null);
    setGitHint(false);
  }, [activeTabPath]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty || activeTab.isSaving) return;

    setTabs((prev) => prev.map((t) =>
      t.path === activeTab.path
        ? { ...t, isSaving: true, saveStatus: "saving", saveError: null }
        : t
    ));

    const res = await saveProjectFileAction({
      projectId,
      relativePath:       activeTab.path,
      content:            activeTab.editedContent,
      expectedModifiedAt: activeTab.modifiedAt,
    });

    if (res.ok && res.data) {
      const { size, modifiedAt } = res.data;
      setTabs((prev) => prev.map((t) =>
        t.path === activeTab.path
          ? {
              ...t,
              content:    t.editedContent,
              size,
              modifiedAt,
              isDirty:    false,
              isSaving:   false,
              saveStatus: "saved",
              saveError:  null,
            }
          : t
      ));
      setGitHint(true);
      setTimeout(() => setGitHint(false), 5000);
      setTimeout(() => {
        setTabs((prev) => prev.map((t) =>
          t.path === activeTab.path && t.saveStatus === "saved"
            ? { ...t, saveStatus: "idle" }
            : t
        ));
      }, 2500);
    } else if (!res.ok) {
      const r = res as { ok: false; error: string; code?: string };
      setTabs((prev) => prev.map((t) =>
        t.path === activeTab.path
          ? {
              ...t,
              isSaving:   false,
              saveStatus: r.code === "CONFLICT" ? "conflict" : "error",
              saveError:  r.error,
            }
          : t
      ));
    }
  }, [projectId, activeTab]);

  // ── Reset ────────────────────────────────────────────────────────────────

  const resetActiveTab = useCallback(() => {
    if (!activeTab) return;
    setTabs((prev) => prev.map((t) =>
      t.path === activeTab.path
        ? { ...t, editedContent: t.content, isDirty: false, saveStatus: "idle", saveError: null }
        : t
    ));
    setFormatErr(null);
  }, [activeTab]);

  // ── Reload after conflict ────────────────────────────────────────────────

  const reloadActiveTab = useCallback(async () => {
    if (!activeTab) return;
    setFileLoading(true);
    const res = await readProjectFileAction(projectId, activeTab.path);
    setFileLoading(false);
    if (res.ok && res.data) {
      const d = res.data;
      setTabs((prev) => prev.map((t) =>
        t.path === activeTab.path
          ? {
              ...t,
              content:      d.content,
              editedContent:d.content,
              size:         d.size,
              modifiedAt:   d.modifiedAt,
              isDirty:      false,
              saveStatus:   "idle",
              saveError:    null,
            }
          : t
      ));
      setFormatErr(null);
    }
  }, [projectId, activeTab]);

  // ── Format (JSON only) ───────────────────────────────────────────────────

  const formatActiveTab = useCallback(() => {
    if (!activeTab) return;
    setFormatErr(null);
    if (activeTab.language !== "json") {
      setFormatErr("Formatting is only supported for JSON files.");
      return;
    }
    try {
      const parsed    = JSON.parse(activeTab.editedContent);
      const formatted = JSON.stringify(parsed, null, 2) + "\n";
      setTabs((prev) => prev.map((t) =>
        t.path === activeTab.path
          ? { ...t, editedContent: formatted, isDirty: formatted !== t.content }
          : t
      ));
    } catch (e) {
      setFormatErr(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeTab]);

  // ── New file ─────────────────────────────────────────────────────────────

  const handleNewFileSubmit = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setNewFileError(null);
    const res = await createProjectFileAction({ projectId, relativePath: name.trim(), content: "" });
    if (res.ok && res.data) {
      setNewFileName(null);
      loadTree();
      const tab = makeTab(res.data.path, "", res.data.modifiedAt, 0);
      setTabs((prev) => [...prev, tab]);
      setActiveTabPath(res.data.path);
    } else if (!res.ok) {
      setNewFileError((res as { ok: false; error: string }).error);
    }
  }, [projectId, loadTree]);

  // ── AI patch applied ─────────────────────────────────────────────────────

  const handlePatchApplied = useCallback((content: string, patchPath: string) => {
    setTabs((prev) => prev.map((t) =>
      t.path === patchPath
        ? {
            ...t,
            content,
            editedContent: content,
            isDirty:       false,
            modifiedAt:    new Date().toISOString(),
            saveStatus:    "saved",
          }
        : t
    ));
    loadTree();
  }, [loadTree]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isFormatSupported = activeTab?.language === "json";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 border-r bg-muted/20 flex flex-col overflow-hidden shrink-0">
        {/* Header */}
        <div className="px-2 py-1.5 border-b flex items-center gap-1 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate px-1">
            {projectName ?? "Files"}
          </span>
          <button
            onClick={() => {
              setNewFileName("");
              setNewFileError(null);
              setTimeout(() => newFileRef.current?.focus(), 50);
            }}
            title="New file"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={loadTree}
            title="Refresh"
            disabled={treeLoading || isPending}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {treeLoading || isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCcw className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b shrink-0">
          <input
            type="text"
            value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
            placeholder="Filter files…"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* New file input */}
        {newFileName !== null && (
          <div className="px-2 py-1.5 border-b shrink-0 space-y-1">
            <input
              ref={newFileRef}
              type="text"
              value={newFileName}
              onChange={(e) => { setNewFileName(e.target.value); setNewFileError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter")  handleNewFileSubmit(newFileName);
                if (e.key === "Escape") { setNewFileName(null); setNewFileError(null); }
              }}
              placeholder="e.g. src/utils.ts"
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {newFileError && <p className="text-[10px] text-destructive">{newFileError}</p>}
            <div className="flex gap-1">
              <button
                onClick={() => handleNewFileSubmit(newFileName)}
                className="flex-1 rounded bg-primary text-primary-foreground text-[10px] py-0.5 hover:bg-primary/90 transition-colors"
              >Create</button>
              <button
                onClick={() => { setNewFileName(null); setNewFileError(null); }}
                className="px-2 rounded border border-border text-[10px] hover:bg-accent transition-colors"
              >Cancel</button>
            </div>
          </div>
        )}

        {treeError ? (
          <div className="flex flex-col items-center justify-center flex-1 p-4 gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{treeError}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <FileTree
              files={files}
              activeTabPath={activeTabPath}
              search={treeSearch}
              onSelect={openFileInTab}
            />
          </div>
        )}

        {treeLabel && (
          <div className="px-3 py-1.5 border-t shrink-0">
            <p className="text-[10px] text-muted-foreground truncate" title={treeLabel}>{treeLabel}</p>
          </div>
        )}
      </aside>

      {/* ── Editor + AI panel ── */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Editor pane */}
        <div className={`flex flex-col overflow-hidden ${showAi ? "flex-1 border-r" : "flex-1"}`}>
          {/* Tab bar */}
          <TabBar
            tabs={tabs}
            activeTabPath={activeTabPath}
            onSelect={setActiveTabPath}
            onClose={closeTab}
          />

          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0 bg-muted/10 flex-wrap min-h-[38px]">
            {activeTab ? (
              <code className="text-xs font-mono text-muted-foreground flex-1 truncate min-w-0">
                {activeTab.path}
              </code>
            ) : (
              <span className="text-xs text-muted-foreground flex-1">No file open</span>
            )}

            {activeTab?.isDirty && (
              <span className="text-[10px] bg-amber-500/10 text-amber-600 rounded px-1.5 py-0.5 font-medium shrink-0">
                unsaved
              </span>
            )}
            {activeTab?.saveStatus === "saved" && (
              <span className="text-[10px] bg-green-500/10 text-green-600 rounded px-1.5 py-0.5 font-medium shrink-0">
                saved
              </span>
            )}

            {activeTab && (
              <>
                {activeTab.saveStatus === "conflict" && (
                  <button
                    onClick={reloadActiveTab}
                    className="flex items-center gap-1 text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5 hover:bg-destructive/20 transition-colors shrink-0"
                  >
                    <RefreshCcw className="h-3 w-3" /> Reload
                  </button>
                )}
                <button
                  onClick={() => setWordWrap((w) => !w)}
                  title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
                  className={`h-6 w-6 flex items-center justify-center rounded border transition-colors shrink-0 ${
                    wordWrap
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <WrapText className="h-3 w-3" />
                </button>
                <button
                  onClick={formatActiveTab}
                  disabled={!isFormatSupported}
                  title={isFormatSupported ? "Format JSON" : "Formatting supported for JSON only"}
                  className="flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40 shrink-0"
                >
                  <Code2 className="h-3 w-3" /> Format
                </button>
                <button
                  onClick={resetActiveTab}
                  disabled={!activeTab.isDirty}
                  className="flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40 shrink-0"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
                <button
                  onClick={saveActiveTab}
                  disabled={!activeTab.isDirty || activeTab.isSaving}
                  className="flex items-center gap-1 text-xs rounded bg-primary text-primary-foreground px-2 py-1 hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                >
                  {activeTab.isSaving
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Save className="h-3 w-3" />}
                  Save
                </button>
                <button
                  onClick={() => setShowAi((s) => !s)}
                  title="AI patch suggestions"
                  className={`flex items-center gap-1 text-xs rounded border px-2 py-1 transition-colors shrink-0 ${
                    showAi
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-3 w-3" /> AI
                </button>
              </>
            )}
          </div>

          {/* Error banners */}
          {activeTab?.saveError && (
            <div className={`flex items-start gap-2 px-4 py-2 text-xs border-b shrink-0 ${
              activeTab.saveStatus === "conflict"
                ? "bg-amber-50/10 text-amber-600 border-amber-200/40"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="flex-1">{activeTab.saveError}</span>
              <button
                onClick={() => setTabs((prev) => prev.map((t) =>
                  t.path === activeTab.path ? { ...t, saveError: null } : t
                ))}
                className="hover:opacity-70"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {formatErr && (
            <div className="flex items-start gap-2 px-4 py-2 text-xs border-b shrink-0 bg-destructive/10 text-destructive border-destructive/20">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="flex-1">{formatErr}</span>
              <button onClick={() => setFormatErr(null)} className="hover:opacity-70">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Git save hint */}
          {gitHint && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-xs border-b shrink-0 bg-green-500/5 text-green-700 border-green-200/40">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              Saved. Review changes in the Git tab before committing.
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {fileLoading ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground bg-[#1e1e1e]">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : fileError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{fileError}</p>
              </div>
            ) : activeTab ? (
              <CodeEditor
                key={activeTab.path}
                value={activeTab.editedContent}
                language={activeTab.language}
                wordWrap={wordWrap}
                onChange={handleEditorChange}
                onSave={saveActiveTab}
                onCursorChange={(line, col) => setCursorPos({ line, col })}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6 bg-[#1e1e1e]">
                <FolderOpen className="h-10 w-10 text-[#505050]" />
                <p className="text-sm text-[#858585]">
                  Select a file from the tree to open it in the editor.
                </p>
              </div>
            )}
          </div>

          {/* Status bar */}
          {activeTab && (
            <div className="flex items-center gap-4 px-4 py-1 border-t shrink-0 bg-[#007acc] text-white">
              <span className="text-[10px] font-medium">{activeTab.language}</span>
              <span className="text-[10px] opacity-80">Ln {cursorPos.line}, Col {cursorPos.col}</span>
              <span className="text-[10px] opacity-80">
                {formatBytes(new TextEncoder().encode(activeTab.editedContent).length)}
              </span>
              <span className="text-[10px] opacity-80 ml-auto">
                Modified {new Date(activeTab.modifiedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* AI panel */}
        {showAi && (
          <div className="w-96 flex flex-col overflow-hidden shrink-0">
            <AiPatchPanel
              projectId={projectId}
              activeTab={activeTab}
              onApplyPatch={handlePatchApplied}
              onClose={() => setShowAi(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
