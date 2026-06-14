import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { promises as fs } from "fs";
import path from "path";
import { FileCode2, Folder, Github, FolderOpen, HardDrive } from "lucide-react";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { SyncButton } from "@/components/github/sync-button";
import { db } from "@/lib/db";
import { getProjectFiles } from "@/lib/data/github";
import { FileType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Files" };

type Props = { params: Promise<{ projectId: string }> };

// ── Local storage file reader ─────────────────────────────────────────────────

type StorageFile = { path: string; name: string; size: number; isDir: boolean };

// Directories to hide from the browser (build artifacts, secrets, internals)
const HIDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".nuxt",
  ".output",
  ".vercel",
  "__pycache__",
]);

async function listStorageFiles(slug: string): Promise<StorageFile[]> {
  const root = path.join(process.cwd(), "storage", "projects", slug);
  try {
    await fs.access(root);
  } catch {
    return [];
  }

  const results: StorageFile[] = [];
  const MAX_ENTRIES = 1000;

  async function walk(dir: string, relative: string) {
    if (results.length >= MAX_ENTRIES) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= MAX_ENTRIES) break;
      // Hide .env files and known junk dirs
      const lower = entry.name.toLowerCase();
      if (lower === ".env" || lower === ".env.local" || lower === ".env.production") continue;
      if (entry.isDirectory() && HIDE_DIRS.has(lower)) continue;

      const rel = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push({ path: rel, name: entry.name, size: 0, isDir: true });
        await walk(path.join(dir, entry.name), rel);
      } else {
        let size = 0;
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          size = stat.size;
        } catch {/* ignore */}
        results.push({ path: rel, name: entry.name, size, isDir: false });
      }
    }
  }

  await walk(root, "");
  return results;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "rb", "php", "java", "swift", "kt",
  "c", "cpp", "h", "cs", "scala", "vue", "svelte",
  "sh", "bash", "zsh",
]);

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function FileIcon({ name }: { name: string }) {
  const e = fileExt(name);
  const color = CODE_EXTENSIONS.has(e)
    ? "text-blue-400"
    : ["json", "yaml", "yml", "toml", "env"].includes(e)
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProjectFilesPage({ params }: Props) {
  const { projectId } = await params;

  const [project, dbFiles] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        framework: true,
        language: true,
        githubRepository: {
          select: {
            id: true,
            installationId: true,
            syncedAt: true,
            latestCommitSha: true,
          },
        },
      },
    }),
    getProjectFiles(projectId),
  ]);

  if (!project) notFound();

  // Load local storage files for projects without a GitHub repo (e.g. uploaded zips)
  const storageFiles = await listStorageFiles(project.slug);
  const hasStorageFiles = storageFiles.length > 0;

  // Decide which file source to use for the sidebar tree
  // Prefer GitHub DB files; fall back to local storage files
  const useStorageFiles = !project.githubRepository && hasStorageFiles;

  // Stats from whichever source is active
  const dbFileItems = dbFiles.filter((f) => f.type === FileType.FILE);
  const dbDirItems = dbFiles.filter((f) => f.type === FileType.DIRECTORY);
  const dbCodeFiles = dbFileItems.filter((f) => CODE_EXTENSIONS.has(fileExt(f.name)));

  const storFileItems = storageFiles.filter((f) => !f.isDir);
  const storDirItems = storageFiles.filter((f) => f.isDir);
  const storCodeFiles = storFileItems.filter((f) => CODE_EXTENSIONS.has(fileExt(f.name)));

  const totalFiles = useStorageFiles ? storFileItems.length : dbFileItems.length;
  const totalDirs = useStorageFiles ? storDirItems.length : dbDirItems.length;
  const totalCode = useStorageFiles ? storCodeFiles.length : dbCodeFiles.length;

  // Tree entries for the sidebar
  const treeEntries = useStorageFiles ? storageFiles : dbFiles;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <aside className="w-60 border-r bg-muted/20 flex flex-col overflow-hidden shrink-0">
          <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
              {project.name}
            </span>
            <span className="text-xs text-muted-foreground shrink-0 ml-2">
              {totalFiles} files
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {treeEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-4 gap-2 text-center">
                <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {project.githubRepository
                    ? "Sync from GitHub to see files"
                    : "No files yet — upload a zip or link a GitHub repo"}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {/* DB (GitHub-synced) tree */}
                {!useStorageFiles && dbFiles.slice(0, 500).map((file) => {
                  const depth = file.path.split("/").length - 1;
                  const isDir = file.type === FileType.DIRECTORY;
                  return (
                    <div
                      key={file.id}
                      className="flex items-center gap-1.5 py-0.5 pr-2 rounded text-xs text-foreground/75 hover:text-foreground hover:bg-accent cursor-default transition-colors"
                      style={{ paddingLeft: `${8 + depth * 12}px` }}
                      title={file.path}
                    >
                      {isDir ? (
                        <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <FileIcon name={file.name} />
                      )}
                      <span className="truncate">{file.name}</span>
                      {!isDir && file.size != null && file.size > 0 && (
                        <span className="ml-auto text-muted-foreground/50 shrink-0 tabular-nums pl-1">
                          {formatBytes(file.size)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!useStorageFiles && dbFiles.length > 500 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">
                    … and {(dbFiles.length - 500).toLocaleString()} more
                  </p>
                )}

                {/* Storage tree */}
                {useStorageFiles && storageFiles.slice(0, 500).map((file) => {
                  const depth = file.path.split("/").length - 1;
                  return (
                    <div
                      key={file.path}
                      className="flex items-center gap-1.5 py-0.5 pr-2 rounded text-xs text-foreground/75 hover:text-foreground hover:bg-accent cursor-default transition-colors"
                      style={{ paddingLeft: `${8 + depth * 12}px` }}
                      title={file.path}
                    >
                      {file.isDir ? (
                        <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <FileIcon name={file.name} />
                      )}
                      <span className="truncate">{file.name}</span>
                      {!file.isDir && file.size > 0 && (
                        <span className="ml-auto text-muted-foreground/50 shrink-0 tabular-nums pl-1">
                          {formatBytes(file.size)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {useStorageFiles && storageFiles.length > 500 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">
                    … and {(storageFiles.length - 500).toLocaleString()} more
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Main panel */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-lg space-y-6">
            {/* Stats */}
            <div>
              <h2 className="text-sm font-semibold mb-3">Overview</h2>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Total files" value={totalFiles} />
                <StatCard label="Folders" value={totalDirs} />
                <StatCard label="Code files" value={totalCode} />
              </div>
            </div>

            {/* Source info */}
            {useStorageFiles && (
              <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
                <HardDrive className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium text-sm">Uploaded from zip</p>
                  <p className="text-xs text-muted-foreground">
                    Files extracted to{" "}
                    <code className="font-mono bg-muted px-1 rounded">
                      storage/projects/{project.slug}/
                    </code>
                  </p>
                </div>
              </div>
            )}

            {/* GitHub sync */}
            {project.githubRepository ? (
              <div>
                <h2 className="text-sm font-semibold mb-3">Sync</h2>
                <SyncButton projectId={projectId} />
                {project.githubRepository.syncedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last synced:{" "}
                    {project.githubRepository.syncedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {project.githubRepository.latestCommitSha && (
                      <>
                        {" "}
                        &middot;{" "}
                        <code className="font-mono bg-muted px-1 py-0.5 rounded">
                          {project.githubRepository.latestCommitSha.slice(0, 7)}
                        </code>
                      </>
                    )}
                    {!project.githubRepository.installationId && (
                      <span className="ml-1 text-amber-500">(installation ID missing)</span>
                    )}
                  </p>
                )}
              </div>
            ) : !hasStorageFiles ? (
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Github className="h-5 w-5 shrink-0" />
                <span>
                  No repository linked and no uploaded files.{" "}
                  <a
                    href="/integrations/github"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Connect a GitHub repo
                  </a>{" "}
                  or{" "}
                  <a
                    href="/projects/new"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    upload a zip
                  </a>{" "}
                  to see files here.
                </span>
              </div>
            ) : null}

            {/* Detected info */}
            {(project.framework || project.language || treeEntries.length > 0) && (
              <div>
                <h2 className="text-sm font-semibold mb-3">Detected</h2>
                <div className="rounded-lg border bg-card p-4 text-sm space-y-1.5">
                  {project.framework && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">Framework</span>
                      <span className="font-medium">{project.framework}</span>
                    </div>
                  )}
                  {project.language && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">Language</span>
                      <span className="font-medium">{project.language}</span>
                    </div>
                  )}
                  {treeEntries.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">Tree entries</span>
                      <span className="font-medium">{treeEntries.length.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
