import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { LogLevel, LogSource } from "@prisma/client";
import { ScrollText } from "lucide-react";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { getProjectLogs } from "@/lib/data/workspace-modules";

export const metadata: Metadata = { title: "Logs" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ level?: string; source?: string }>;
};

// ── Colour maps ───────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "text-gray-500",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  FATAL: "text-red-600",
};

const LEVEL_TEXT_COLOR: Record<LogLevel, string> = {
  DEBUG: "text-gray-400",
  INFO: "text-gray-300",
  WARN: "text-yellow-200",
  ERROR: "text-red-300",
  FATAL: "text-red-200",
};

const SOURCE_COLOR: Record<LogSource, string> = {
  APP: "text-blue-300",
  BUILD: "text-purple-300",
  SYSTEM: "text-gray-400",
  DEPLOY: "text-green-300",
  GITHUB: "text-orange-300",
};

function formatTs(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

const LEVELS = Object.values(LogLevel);
const SOURCES = Object.values(LogSource);

export default async function ProjectLogsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const { level: levelParam, source: sourceParam } = await searchParams;

  const exists = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!exists) notFound();

  const level = LEVELS.includes(levelParam as LogLevel)
    ? (levelParam as LogLevel)
    : undefined;
  const source = SOURCES.includes(sourceParam as LogSource)
    ? (sourceParam as LogSource)
    : undefined;

  const logs = await getProjectLogs(projectId, { level, source });

  const activeFilter = level ?? source ?? null;

  function filterHref(params: Record<string, string | null>) {
    const sp = new URLSearchParams();
    if (params.level) sp.set("level", params.level);
    if (params.source) sp.set("source", params.source);
    const qs = sp.toString();
    return `/projects/${projectId}/logs${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />

      {/* Toolbar */}
      <div className="border-b bg-background px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          Logs
          <span className="text-muted-foreground font-normal text-xs ml-1">
            ({logs.length})
          </span>
        </div>

        {/* Level filters */}
        <div className="flex items-center gap-1 flex-wrap">
          <a
            href={filterHref({ level: null, source: null })}
            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
              !activeFilter
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            All
          </a>
          {LEVELS.map((l) => (
            <a
              key={l}
              href={filterHref({ level: l, source: null })}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                level === l
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {l}
            </a>
          ))}
        </div>

        {/* Source filters */}
        <div className="flex items-center gap-1 flex-wrap ml-2 border-l pl-2">
          {SOURCES.map((s) => (
            <a
              key={s}
              href={filterHref({ level: null, source: s })}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                source === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-auto bg-[#0d1117] p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-gray-600">
              {activeFilter
                ? `No ${activeFilter} logs found.`
                : "No logs yet. Logs appear here after syncing from GitHub or triggering actions."}
            </p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex gap-3 hover:bg-white/5 px-2 py-0.5 rounded"
            >
              <span className="text-gray-600 shrink-0 tabular-nums">
                {formatTs(log.timestamp)}
              </span>
              <span
                className={`uppercase font-bold w-6 shrink-0 ${LEVEL_COLOR[log.level]}`}
              >
                {log.level.slice(0, 1)}
              </span>
              <span className={`w-14 shrink-0 ${SOURCE_COLOR[log.source]}`}>
                {log.source}
              </span>
              <span className={LEVEL_TEXT_COLOR[log.level]}>
                {log.message}
              </span>
              {log.metadata && (
                <span className="text-gray-600 truncate max-w-xs">
                  {JSON.stringify(log.metadata)}
                </span>
              )}
            </div>
          ))
        )}
        <div className="flex gap-3 px-2 py-0.5 mt-1">
          <span className="text-gray-700 animate-pulse">▊</span>
        </div>
      </div>
    </div>
  );
}
