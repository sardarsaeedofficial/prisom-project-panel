import { formatRelativeTime } from "@/lib/utils";
import { GitCommit, Rocket, AlertCircle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ActivityEvent = {
  id: string;
  type: "deploy" | "commit" | "error" | "success";
  message: string;
  project: string;
  timestamp: string;
};

const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: "evt_1",
    type: "deploy",
    message: "Deployed to production",
    project: "ai-chat-assistant",
    timestamp: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
  },
  {
    id: "evt_2",
    type: "commit",
    message: "feat: add streaming support",
    project: "ai-chat-assistant",
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: "evt_3",
    type: "error",
    message: "Build failed: missing env var",
    project: "api-gateway",
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: "evt_4",
    type: "success",
    message: "Health check passed",
    project: "portfolio-site",
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: "evt_5",
    type: "deploy",
    message: "Deployed to staging",
    project: "data-pipeline",
    timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
  },
];

const EVENT_ICONS = {
  deploy: { icon: Rocket, color: "text-blue-500 bg-blue-500/10" },
  commit: { icon: GitCommit, color: "text-purple-500 bg-purple-500/10" },
  error: { icon: AlertCircle, color: "text-red-500 bg-red-500/10" },
  success: { icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
};

export function ActivityFeed() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <div className="space-y-4">
          {MOCK_ACTIVITY.map((event) => {
            const { icon: Icon, color } = EVENT_ICONS[event.type];
            return (
              <div key={event.id} className="flex items-start gap-3">
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${color}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{event.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.project} · {formatRelativeTime(event.timestamp)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
