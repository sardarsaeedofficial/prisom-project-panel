import { formatRelativeTime } from "@/lib/utils";
import {
  GitCommit,
  Rocket,
  AlertCircle,
  CheckCircle,
  Wrench,
  Github,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { LogLevel, LogSource } from "@prisma/client";

// ── Icon / colour mapping ─────────────────────────────────────────────────────

type IconDef = { icon: React.ComponentType<{ className?: string }>; color: string };

function resolveIcon(level: LogLevel, source: LogSource): IconDef {
  if (level === LogLevel.ERROR || level === LogLevel.FATAL)
    return { icon: AlertCircle, color: "text-red-500 bg-red-500/10" };
  if (source === LogSource.DEPLOY)
    return level === LogLevel.INFO
      ? { icon: Rocket, color: "text-blue-500 bg-blue-500/10" }
      : { icon: CheckCircle, color: "text-green-500 bg-green-500/10" };
  if (source === LogSource.GITHUB)
    return { icon: Github, color: "text-purple-500 bg-purple-500/10" };
  if (source === LogSource.BUILD)
    return { icon: Wrench, color: "text-yellow-500 bg-yellow-500/10" };
  if (source === LogSource.APP)
    return { icon: GitCommit, color: "text-purple-500 bg-purple-500/10" };
  return { icon: Activity, color: "text-muted-foreground bg-muted" };
}

// ── Component ─────────────────────────────────────────────────────────────────

export async function ActivityFeed() {
  let logs: Array<{
    id: string;
    level: LogLevel;
    source: LogSource;
    message: string;
    timestamp: Date;
    project: { id: string; name: string };
  }> = [];

  try {
    const workspaceId = await getCurrentWorkspaceId();
    logs = await db.projectLog.findMany({
      where: { project: { workspaceId } },
      orderBy: { timestamp: "desc" },
      take: 10,
      select: {
        id: true,
        level: true,
        source: true,
        message: true,
        timestamp: true,
        project: { select: { id: true, name: true } },
      },
    });
  } catch {
    // DB error — render empty state, dashboard already shows a banner
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <Activity className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No activity yet. Logs appear here after deployments, GitHub syncs, and other events.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => {
              const { icon: Icon, color } = resolveIcon(log.level, log.source);
              return (
                <div key={log.id} className="flex items-start gap-3">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${color}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{log.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.project.name} · {formatRelativeTime(log.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
