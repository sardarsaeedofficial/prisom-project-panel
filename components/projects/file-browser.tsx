"use client";

/**
 * components/projects/file-browser.tsx
 *
 * Sprint 6: safe project file browser + editor + AI patch suggestions.
 *
 * Read-only → user clicks file → loads content → user edits → user clicks Save.
 * AI patch → user clicks "Ask AI" → types instruction → AI proposes diff → user reviews → user applies.
 *
 * No automatic file modifications. No secret values displayed.
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

// ── Local type mirrors (shapes returned by server actions — no server imports) ──

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:    string;
  projectName?: string;
}

interface OpenFile {
  path:          string;
  content:       string;
  editedContent: string;
  size:          number;
  modifiedAt:    string;
  language:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0)        return "0 B";
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1_048_576)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function FileIcon({ name, className = "" }: { name: string; className?: string }) {
  const e = getExt(name);
  const color =
    ["ts","tsx","js","jsx","mjs","cjs"].includes(e) ? "text-blue-400" :
    ["json","yaml","yml","toml"].includes(e)         ? "text-yellow-400" :
    ["css","scss","sass","less"].includes(e)          ? "text-pink-400" :
    ["md","mdx","txt"].includes(e)                    ? "text-gray-400" :
    "text-muted-foreground";
  return <FileCode2 className={`h-3.5 w-3.5 shrink-0 ${color} ${className}`} />;
}

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
          line.startsWith("-") && !line.startsWith("---") ? "text-red-500 bg-red-500/10 block" :
          line.startsWith("@@")                           ? "text-cyan-500 block" :
          "block";
        return <span key={i} className={cls}>{line || " "}</span>;
      })}
    </pre>
  );
}

// ── AI Patch Panel ─────────────────────────────────────────────────────────────

function AiPatchPanel({
  projectId,
  openFile,
  onApplyPatch,
  onClose,
}: {
  projectId:    string;
  openFile:     OpenFile | null;
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
    if (!openFile || !instruction.trim()) return;
    setError(null);
    setSuggestion(null);
    startTransition(async () => {
      const res = await suggestProjectPatchAction({
        projectId,
        instruction,
        selectedFiles: [{
          path:    openFile.path,
          content: openFile.content,
        }],
      });
      if (res.ok && res.data) {
        setSuggestion(res.data);
      } else if (!res.ok) {
        setError((res as { ok: false; error: string }).error);
      }
    });
  }, [openFile, instruction, projectId]);

  const handleApply = useCallback(async (patchPath: string, proposedContent: string) => {
    setApplying(patchPath);
    setApplyErrors({});
    const res = await applyAiPatchAction({
      projectId,
      patches: [{
        path:                patchPath,
        proposedContent,
        expectedModifiedAt:  openFile?.modifiedAt,
      }],
    });
    setApplying(null);
    if (res.ok && res.data) {
      if (res.data.skipped.length > 0) {
        const err: Record<string, string> = {};
        res.data.skipped.forEach((s) => { err[s.path] = s.reason; });
        setApplyErrors(err);
      } else {
        // Notify parent to refresh the file
        onApplyPatch(proposedContent, patchPath);
      }
    } else if (!res.ok) {
      setApplyErrors({ [patchPath]: (res as { ok: false; error: string }).error });
    }
  }, [projectId, openFile, onApplyPatch]);

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

      {/* Context info */}
      {openFile && (
        <div className="px-4 py-2 border-b bg-muted/30 shrink-0">
          <p className="text-xs text-muted-foreground">
            Working on: <code className="font-mono bg-muted px-1 rounded">{openFile.path}</code>
          </p>
        </div>
      )}

      {!openFile && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <FileCode2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Open a file in the editor first, then ask AI to suggest changes.
            </p>
          </div>
        </div>
      )}

      {openFile && (
        <>
          {/* Instruction input */}
          <div className="px-4 py-3 border-b shrink-0 space-y-2">
            <label className="text-xs font-medium text-foreground">Instruction</label>
            <div className="flex gap-2">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Add TypeScript types to this function, add error handling…"
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
              AI will suggest a diff only. No files are changed until you click Apply.
              Secret values are never sent.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 my-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Suggestion output */}
          {suggestion && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* Summary */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-foreground mb-1">Summary</p>
                <p className="text-sm">{suggestion.summary}</p>
              </div>

              {/* Raw fallback */}
              {suggestion.rawFallback && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-50/10 px-3 py-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-amber-600">Unstructured suggestion</span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                    {suggestion.rawFallback}
                  </pre>
                  <CopyButton text={suggestion.rawFallback ?? ""} label="Copy suggestion" />
                </div>
              )}

              {/* Patches */}
              {suggestion.patches.map((patch, i) => (
                <div key={i} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <code className="text-xs font-mono flex-1 truncate">{patch.path}</code>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      patch.type === "create"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-blue-500/10 text-blue-600"
                    }`}>
                      {patch.type}
                    </span>
                  </div>

                  {/* Warnings */}
                  {patch.warnings.length > 0 && (
                    <div className="px-3 py-2 bg-amber-50/10 border-b border-border space-y-0.5">
                      {patch.warnings.map((w, j) => (
                        <p key={j} className="text-xs text-amber-600 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Diff */}
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
                            {applying === patch.path ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
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

              {/* Risks */}
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

              {/* Manual commands */}
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

          {/* Thinking indicator */}
          {isPending && (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── File tree sidebar ─────────────────────────────────────────────────────────

function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files:        FileTreeItem[];
  selectedPath: string | null;
  onSelect:     (file: FileTreeItem) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((dirPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  // Build a flat list respecting collapsed state
  const visible: FileTreeItem[] = [];
  const collapsedSet = collapsed;

  for (const file of files) {
    const parts = file.path.split("/");
    // Check if any ancestor is collapsed
    let hidden = false;
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (collapsedSet.has(ancestor)) {
        hidden = true;
        break;
      }
    }
    if (!hidden) visible.push(file);
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 gap-2 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          No editable files found.
        </p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {visible.map((file) => {
        const depth    = file.depth;
        const isDir    = file.isDir;
        const isCollap = isDir && collapsed.has(file.path);
        const isSel    = selectedPath === file.path;

        return (
          <div
            key={file.path}
            onClick={() => isDir ? toggle(file.path) : onSelect(file)}
            className={`flex items-center gap-1.5 py-0.5 pr-2 rounded text-xs cursor-pointer transition-colors select-none ${
              isSel
                ? "bg-accent text-foreground"
                : "text-foreground/75 hover:text-foreground hover:bg-accent/50"
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
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

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectFileBrowser({ projectId, projectName }: Props) {
  const [files,         setFiles]        = useState<FileTreeItem[]>([]);
  const [treeLabel,     setTreeLabel]    = useState<string>("");
  const [treeError,     setTreeError]    = useState<string | null>(null);
  const [treeLoading,   setTreeLoading]  = useState(true);
  const [openFile,      setOpenFile]     = useState<OpenFile | null>(null);
  const [fileLoading,   setFileLoading]  = useState(false);
  const [fileError,     setFileError]    = useState<string | null>(null);
  const [saveStatus,    setSaveStatus]   = useState<"idle" | "saving" | "saved" | "conflict" | "error">("idle");
  const [saveError,     setSaveError]    = useState<string | null>(null);
  const [showAi,        setShowAi]       = useState(false);
  const [isPending,     startTransition] = useTransition();
  const [newFileName,   setNewFileName]  = useState<string | null>(null); // null = not creating
  const [newFileError,  setNewFileError] = useState<string | null>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

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

  // ── Open a file ──────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (file: FileTreeItem) => {
    if (file.isDir) return;
    if (openFile?.editedContent !== openFile?.content) {
      if (!confirm("You have unsaved changes. Discard them?")) return;
    }

    setFileError(null);
    setSaveStatus("idle");
    setSaveError(null);
    setFileLoading(true);

    const res = await readProjectFileAction(projectId, file.path);
    setFileLoading(false);

    if (res.ok && res.data) {
      const d = res.data;
      setOpenFile({
        path:          d.path,
        content:       d.content,
        editedContent: d.content,
        size:          d.size,
        modifiedAt:    d.modifiedAt,
        language:      d.language,
      });
    } else if (!res.ok) {
      setFileError((res as { ok: false; error: string }).error);
      setOpenFile(null);
    }
  }, [projectId, openFile]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!openFile || openFile.editedContent === openFile.content) return;

    setSaveStatus("saving");
    setSaveError(null);

    const res = await saveProjectFileAction({
      projectId,
      relativePath:        openFile.path,
      content:             openFile.editedContent,
      expectedModifiedAt:  openFile.modifiedAt,
    });

    if (res.ok && res.data) {
      setOpenFile((prev) => prev ? {
        ...prev,
        content:    prev.editedContent,
        size:       res.data!.size,
        modifiedAt: res.data!.modifiedAt,
      } : null);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } else if (!res.ok) {
      const code  = (res as { ok: false; code?: string }).code;
      const error = (res as { ok: false; error: string }).error;
      setSaveStatus(code === "CONFLICT" ? "conflict" : "error");
      setSaveError(error);
    }
  }, [projectId, openFile]);

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (!openFile) return;
    setOpenFile((prev) => prev ? { ...prev, editedContent: prev.content } : null);
    setSaveStatus("idle");
    setSaveError(null);
  }, [openFile]);

  // ── Reload (after conflict) ───────────────────────────────────────────────

  const handleReload = useCallback(async () => {
    if (!openFile) return;
    setFileLoading(true);
    const res = await readProjectFileAction(projectId, openFile.path);
    setFileLoading(false);
    if (res.ok && res.data) {
      const d = res.data;
      setOpenFile({
        path:          d.path,
        content:       d.content,
        editedContent: d.content,
        size:          d.size,
        modifiedAt:    d.modifiedAt,
        language:      d.language,
      });
      setSaveStatus("idle");
      setSaveError(null);
    }
  }, [projectId, openFile]);

  // ── New file ─────────────────────────────────────────────────────────────

  const handleNewFileSubmit = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setNewFileError(null);
    const res = await createProjectFileAction({
      projectId,
      relativePath: name.trim(),
      content:      "",
    });
    if (res.ok && res.data) {
      setNewFileName(null);
      loadTree();
      // Auto-open the new file
      setOpenFile({
        path:          res.data.path,
        content:       "",
        editedContent: "",
        size:          0,
        modifiedAt:    res.data.modifiedAt,
        language:      "text",
      });
    } else if (!res.ok) {
      setNewFileError((res as { ok: false; error: string }).error);
    }
  }, [projectId, loadTree]);

  // ── AI patch applied ─────────────────────────────────────────────────────

  const handlePatchApplied = useCallback((content: string, patchPath: string) => {
    if (openFile && openFile.path === patchPath) {
      setOpenFile((prev) => prev ? {
        ...prev,
        content:       content,
        editedContent: content,
        modifiedAt:    new Date().toISOString(),
      } : null);
    }
    loadTree();
  }, [openFile, loadTree]);

  const isDirty   = openFile ? openFile.editedContent !== openFile.content : false;
  const lineCount = openFile ? openFile.editedContent.split("\n").length : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 border-r bg-muted/20 flex flex-col overflow-hidden shrink-0">
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

        {/* New file input */}
        {newFileName !== null && (
          <div className="px-2 py-1.5 border-b shrink-0 space-y-1">
            <input
              ref={newFileRef}
              type="text"
              value={newFileName}
              onChange={(e) => { setNewFileName(e.target.value); setNewFileError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFileSubmit(newFileName);
                if (e.key === "Escape") { setNewFileName(null); setNewFileError(null); }
              }}
              placeholder="e.g. src/utils.ts"
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {newFileError && (
              <p className="text-[10px] text-destructive">{newFileError}</p>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => handleNewFileSubmit(newFileName)}
                className="flex-1 rounded bg-primary text-primary-foreground text-[10px] py-0.5 hover:bg-primary/90 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => { setNewFileName(null); setNewFileError(null); }}
                className="px-2 rounded border border-border text-[10px] hover:bg-accent transition-colors"
              >
                Cancel
              </button>
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
              selectedPath={openFile?.path ?? null}
              onSelect={handleFileSelect}
            />
          </div>
        )}

        {treeLabel && (
          <div className="px-3 py-1.5 border-t shrink-0">
            <p className="text-[10px] text-muted-foreground truncate" title={treeLabel}>{treeLabel}</p>
          </div>
        )}
      </aside>

      {/* ── Editor / AI panel ── */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Editor pane */}
        <div className={`flex flex-col overflow-hidden ${showAi ? "flex-1 border-r" : "flex-1"}`}>
          {/* Top bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/10 flex-wrap">
            {openFile ? (
              <code className="text-xs font-mono text-muted-foreground flex-1 truncate min-w-0">
                {openFile.path}
              </code>
            ) : (
              <span className="text-xs text-muted-foreground flex-1">No file open</span>
            )}

            {isDirty && (
              <span className="text-[10px] bg-amber-500/10 text-amber-600 rounded px-1.5 py-0.5 font-medium shrink-0">
                unsaved
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-[10px] bg-green-500/10 text-green-600 rounded px-1.5 py-0.5 font-medium shrink-0">
                saved
              </span>
            )}

            {openFile && (
              <>
                {(saveStatus === "conflict") && (
                  <button
                    onClick={handleReload}
                    className="flex items-center gap-1 text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5 hover:bg-destructive/20 transition-colors shrink-0"
                  >
                    <RefreshCcw className="h-3 w-3" /> Reload
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={!isDirty}
                  className="flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40 shrink-0"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saveStatus === "saving"}
                  className="flex items-center gap-1 text-xs rounded bg-primary text-primary-foreground px-2 py-1 hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                >
                  {saveStatus === "saving"
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Save className="h-3 w-3" />}
                  Save
                </button>
                <button
                  onClick={() => setShowAi((s) => !s)}
                  title="Ask AI to suggest changes"
                  className={`flex items-center gap-1 text-xs rounded border px-2 py-1 transition-colors shrink-0 ${
                    showAi
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-3 w-3" /> Ask AI
                </button>
              </>
            )}
          </div>

          {/* Save error / conflict banner */}
          {saveError && (
            <div className={`flex items-start gap-2 px-4 py-2 text-xs border-b shrink-0 ${
              saveStatus === "conflict"
                ? "bg-amber-50/10 text-amber-600 border-amber-200/40"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="flex-1">{saveError}</span>
              <button onClick={() => setSaveError(null)} className="hover:opacity-70">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {fileLoading ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : fileError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{fileError}</p>
              </div>
            ) : openFile ? (
              <textarea
                value={openFile.editedContent}
                onChange={(e) =>
                  setOpenFile((prev) => prev
                    ? { ...prev, editedContent: e.target.value }
                    : null)
                }
                onKeyDown={(e) => {
                  if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                className="flex-1 w-full resize-none bg-transparent font-mono text-xs p-4 outline-none leading-relaxed text-foreground min-h-0"
                spellCheck={false}
                aria-label={`Edit ${openFile.path}`}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
                <FolderOpen className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">
                  Select a file from the tree to view and edit it.
                </p>
              </div>
            )}
          </div>

          {/* Status bar */}
          {openFile && (
            <div className="flex items-center gap-4 px-4 py-1 border-t shrink-0 bg-muted/10">
              <span className="text-[10px] text-muted-foreground">{openFile.language}</span>
              <span className="text-[10px] text-muted-foreground">{lineCount} lines</span>
              <span className="text-[10px] text-muted-foreground">{formatBytes(new TextEncoder().encode(openFile.editedContent).length)}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Modified {new Date(openFile.modifiedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* AI panel */}
        {showAi && (
          <div className="w-96 flex flex-col overflow-hidden shrink-0">
            <AiPatchPanel
              projectId={projectId}
              openFile={openFile}
              onApplyPatch={handlePatchApplied}
              onClose={() => setShowAi(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
