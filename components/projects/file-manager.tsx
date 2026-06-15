"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Folder,
  FileCode2,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  HardDrive,
  FolderOpen,
  Save,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createFolderAction,
  createTextFileAction,
  readTextFileAction,
  writeTextFileAction,
  deleteFileAction,
  renameFileAction,
} from "@/app/actions/files";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StorageFile = {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
};

type Props = {
  projectId: string;
  projectSlug: string;
  initialFiles: StorageFile[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "rb", "php", "java", "swift", "kt",
  "c", "cpp", "h", "cs", "scala", "vue", "svelte",
  "sh", "bash", "zsh",
]);

const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  "json", "yaml", "yml", "toml", "env", "md", "mdx", "txt",
  "css", "scss", "sass", "less", "html", "htm", "xml", "svg",
  "gitignore", "dockerignore", "editorconfig", "prettierrc",
  "eslintrc", "babelrc", "npmrc", "nvmrc",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function isTextFile(name: string): boolean {
  const ext = fileExt(name);
  return TEXT_EXTENSIONS.has(ext) || (!name.includes(".") && name.length < 30);
}

function FileIcon({ name }: { name: string }) {
  const e = fileExt(name);
  const color = CODE_EXTENSIONS.has(e)
    ? "text-blue-400"
    : ["json", "yaml", "yml", "toml"].includes(e)
    ? "text-yellow-400"
    : ["css", "scss", "sass", "less"].includes(e)
    ? "text-pink-400"
    : ["md", "mdx", "txt"].includes(e)
    ? "text-gray-400"
    : ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(e)
    ? "text-green-400"
    : "text-muted-foreground";
  return <FileCode2 className={`h-3.5 w-3.5 shrink-0 ${color}`} />;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StorageFileManager({ projectId, projectSlug, initialFiles }: Props) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null); // path being deleted/renamed

  // Stats (computed from props)
  const fileItems = initialFiles.filter((f) => !f.isDir);
  const dirItems = initialFiles.filter((f) => f.isDir);
  const codeFiles = fileItems.filter((f) => CODE_EXTENSIONS.has(fileExt(f.name)));

  const selectedFile = selectedPath
    ? initialFiles.find((f) => f.path === selectedPath)
    : null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function refresh() {
    startRefresh(() => router.refresh());
  }

  /** Returns the relative directory to use as parent for new items. */
  function currentParentDir(): string {
    if (!selectedPath) return "";
    const sel = initialFiles.find((f) => f.path === selectedPath);
    if (sel?.isDir) return selectedPath;
    const slash = selectedPath.lastIndexOf("/");
    return slash >= 0 ? selectedPath.slice(0, slash) : "";
  }

  // ── File selection / content loading ──────────────────────────────────────

  async function handleFileClick(file: StorageFile) {
    if (file.isDir) {
      setSelectedPath(file.path);
      setFileContent(null);
      setEditedContent(null);
      setIsDirty(false);
      setFileError(null);
      return;
    }

    if (isDirty && !confirm("You have unsaved changes. Discard them?")) return;

    setSelectedPath(file.path);
    setFileContent(null);
    setEditedContent(null);
    setIsDirty(false);
    setFileError(null);

    if (!isTextFile(file.name)) {
      setFileError("Binary file — content cannot be displayed or edited.");
      return;
    }

    setIsLoadingFile(true);
    try {
      const result = await readTextFileAction(projectId, file.path);
      if (result.ok && result.content !== undefined) {
        setFileContent(result.content);
        setEditedContent(result.content);
      } else {
        setFileError(result.error ?? "Failed to read file.");
      }
    } finally {
      setIsLoadingFile(false);
    }
  }

  function handleContentChange(v: string) {
    setEditedContent(v);
    setIsDirty(v !== fileContent);
  }

  async function handleSave() {
    if (!selectedPath || editedContent === null) return;
    setIsSaving(true);
    setFileError(null);
    try {
      const result = await writeTextFileAction(projectId, selectedPath, editedContent);
      if (result.ok) {
        setFileContent(editedContent);
        setIsDirty(false);
      } else {
        setFileError(result.error ?? "Save failed.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset() {
    setEditedContent(fileContent);
    setIsDirty(false);
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  async function handleNewFolder() {
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    if (/[/\\<>:"|?*\0]/.test(name)) {
      setActionError("Folder name contains invalid characters.");
      return;
    }
    const parent = currentParentDir();
    const rel = parent ? `${parent}/${name.trim()}` : name.trim();
    setActionError(null);
    const result = await createFolderAction(projectId, rel);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to create folder.");
      return;
    }
    refresh();
  }

  async function handleNewFile() {
    const name = prompt("New file name (e.g. index.ts):");
    if (!name?.trim()) return;
    if (/[/\\<>:"|?*\0]/.test(name)) {
      setActionError("File name contains invalid characters.");
      return;
    }
    const parent = currentParentDir();
    const rel = parent ? `${parent}/${name.trim()}` : name.trim();
    setActionError(null);
    const result = await createTextFileAction(projectId, rel);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to create file.");
      return;
    }
    // Pre-select the new file for editing
    setSelectedPath(rel);
    setFileContent("");
    setEditedContent("");
    setIsDirty(false);
    setFileError(null);
    refresh();
  }

  // ── Per-file actions ───────────────────────────────────────────────────────

  async function handleDelete(file: StorageFile, e: React.MouseEvent) {
    e.stopPropagation();
    const label = file.isDir ? `folder "${file.name}" and all its contents` : `"${file.name}"`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    if (selectedPath === file.path || selectedPath?.startsWith(file.path + "/")) {
      setSelectedPath(null);
      setFileContent(null);
      setEditedContent(null);
      setIsDirty(false);
    }
    setActionError(null);
    setBusyPath(file.path);
    const result = await deleteFileAction(projectId, file.path);
    setBusyPath(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to delete.");
      return;
    }
    refresh();
  }

  async function handleRename(file: StorageFile, e: React.MouseEvent) {
    e.stopPropagation();
    const newName = prompt(
      `Rename "${file.name}" to:`,
      file.name
    );
    if (!newName?.trim() || newName.trim() === file.name) return;
    if (/[/\\<>:"|?*\0]/.test(newName)) {
      setActionError("Name contains invalid characters.");
      return;
    }
    const slash = file.path.lastIndexOf("/");
    const parentDir = slash >= 0 ? file.path.slice(0, slash) : "";
    const newPath = parentDir ? `${parentDir}/${newName.trim()}` : newName.trim();
    setActionError(null);
    setBusyPath(file.path);
    const result = await renameFileAction(projectId, file.path, newPath);
    setBusyPath(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to rename.");
      return;
    }
    if (selectedPath === file.path) setSelectedPath(newPath);
    refresh();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Sidebar ── */}
      <aside className="w-60 border-r bg-muted/20 flex flex-col overflow-hidden shrink-0">
        {/* Toolbar header */}
        <div className="px-2 py-1.5 border-b flex items-center gap-1 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate px-1">
            Files
          </span>
          <button
            type="button"
            onClick={handleNewFolder}
            disabled={isRefreshing}
            title="New folder"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleNewFile}
            disabled={isRefreshing}
            title="New file"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          {isRefreshing && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-0.5" />
          )}
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto">
          {initialFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 gap-2 text-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                No files yet.{" "}
                <button
                  type="button"
                  onClick={handleNewFile}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Create a file
                </button>{" "}
                to get started.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {initialFiles.slice(0, 500).map((file) => {
                const depth = file.path.split("/").length - 1;
                const isSelected = selectedPath === file.path;
                const isBusy = busyPath === file.path;

                return (
                  <div
                    key={file.path}
                    onClick={() => !isBusy && handleFileClick(file)}
                    className={`group flex items-center gap-1.5 py-0.5 pr-1 rounded text-xs transition-colors ${
                      isBusy
                        ? "opacity-40 cursor-wait"
                        : isSelected
                        ? "bg-accent text-foreground cursor-default"
                        : "text-foreground/75 hover:text-foreground hover:bg-accent/50 cursor-pointer"
                    }`}
                    style={{ paddingLeft: `${8 + depth * 12}px` }}
                    title={file.path}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : file.isDir ? (
                      <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    ) : (
                      <FileIcon name={file.name} />
                    )}
                    <span className="flex-1 truncate">{file.name}</span>
                    {!file.isDir && file.size > 0 && (
                      <span className="ml-auto text-muted-foreground/40 shrink-0 tabular-nums text-[10px] pl-1 opacity-0 group-hover:opacity-100">
                        {formatBytes(file.size)}
                      </span>
                    )}

                    {/* Hover actions */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0 shrink-0 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => handleRename(file, e)}
                        title="Rename"
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(file, e)}
                        title="Delete"
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {initialFiles.length > 500 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  … and {(initialFiles.length - 500).toLocaleString()} more
                </p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main panel ── */}
      <div className="flex-1 overflow-auto flex flex-col min-w-0">
        {/* Action error banner */}
        {actionError && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-destructive bg-destructive/5 border-b shrink-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-muted-foreground hover:text-foreground ml-1"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {selectedPath ? (
          /* ── File / folder viewer ── */
          <div className="flex flex-col flex-1 min-h-0">
            {/* File header bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/10">
              <span className="text-xs font-mono text-muted-foreground flex-1 truncate">
                {selectedPath}
              </span>
              {isDirty && (
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  unsaved
                </Badge>
              )}
              {!selectedFile?.isDir && fileContent !== null && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 gap-1"
                    onClick={handleReset}
                    disabled={!isDirty || isSaving}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2 gap-1"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Save
                  </Button>
                </>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-auto">
              {selectedFile?.isDir ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <Folder className="h-10 w-10 text-blue-400/40" />
                  <p className="text-sm font-mono">{selectedPath}/</p>
                  <p className="text-xs text-muted-foreground">
                    Select a file from the tree to view or edit it.
                  </p>
                </div>
              ) : isLoadingFile ? (
                <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : fileError ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <AlertCircle className="h-8 w-8" />
                  <p className="text-sm text-center max-w-xs">{fileError}</p>
                </div>
              ) : editedContent !== null ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="w-full h-full resize-none bg-transparent font-mono text-xs p-4 outline-none leading-relaxed text-foreground"
                  spellCheck={false}
                  aria-label={`Edit ${selectedPath}`}
                />
              ) : null}
            </div>
          </div>
        ) : (
          /* ── No file selected — show stats ── */
          <div className="p-6 max-w-lg">
            <h2 className="text-sm font-semibold mb-3">Overview</h2>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="Total files" value={fileItems.length} />
              <StatCard label="Folders" value={dirItems.length} />
              <StatCard label="Code files" value={codeFiles.length} />
            </div>

            <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
              <HardDrive className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="font-medium text-sm">Uploaded from zip</p>
                <p className="text-xs text-muted-foreground">
                  Files live at{" "}
                  <code className="font-mono bg-muted px-1 rounded text-[10px]">
                    storage/projects/{projectSlug}/
                  </code>
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Click a file in the tree to view or edit it. Use the{" "}
              <FolderPlus className="h-3 w-3 inline" /> and{" "}
              <FilePlus className="h-3 w-3 inline" /> buttons above to create new entries.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
