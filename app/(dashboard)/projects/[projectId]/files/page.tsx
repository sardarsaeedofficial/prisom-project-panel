import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileCode2, Folder, Github, FolderOpen } from "lucide-react";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { SyncButton } from "@/components/github/sync-button";
import { db } from "@/lib/db";
import { getProjectFiles } from "@/lib/data/github";
import { FileType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Files" };

type Props = { params: Promise<{ projectId: string }> };

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

export default async function ProjectFilesPage({ params }: Props) {
  const { projectId } = await params;

  const [project, files] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
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

  const fileItems = files.filter((f) => f.type === FileType.FILE);
  const dirItems = files.filter((f) => f.type === FileType.DIRECTORY);
  const codeFiles = fileItems.filter((f) => CODE_EXTENSIONS.has(fileExt(f.name)));

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
              {fileItems.length} files
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-4 gap-2 text-center">
                <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {project.githubRepository
                    ? "Sync from GitHub to see files"
                    : "No GitHub repository linked"}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {files.slice(0, 500).map((file) => {
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
                {files.length > 500 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">
                    … and {(files.length - 500).toLocaleString()} more
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
                <StatCard label="Total files" value={fileItems.length} />
                <StatCard label="Folders" value={dirItems.length} />
                <StatCard label="Code files" value={codeFiles.length} />
              </div>
            </div>

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
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Github className="h-5 w-5 shrink-0" />
                <span>
                  No repository linked.{" "}
                  <a
                    href="/integrations/github"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Connect one
                  </a>{" "}
                  to sync files.
                </span>
              </div>
            )}

            {/* Detected info */}
            {(project.framework || project.language || files.length > 0) && (
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
                  {files.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-28 shrink-0">Tree entries</span>
                      <span className="font-medium">{files.length.toLocaleString()}</span>
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
