"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  Loader2,
  ListChecks,
  Layers,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createFeatureAction,
  deleteFeatureAction,
  updateFeatureAction,
  createTaskAction,
  deleteTaskAction,
  updateTaskStatusAction,
} from "@/app/actions/workspace-modules";

// ── Types ─────────────────────────────────────────────────────────────────────

type Feature = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  _count: { tasks: number };
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  featureId: string | null;
};

// ── Badges ────────────────────────────────────────────────────────────────────

const FEATURE_STATUS_BADGE: Record<
  string,
  { label: string; variant: "secondary" | "warning" | "success" | "error" }
> = {
  PLANNED: { label: "Planned", variant: "secondary" },
  IN_PROGRESS: { label: "In Progress", variant: "warning" },
  DONE: { label: "Done", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "error" },
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-yellow-600 dark:text-yellow-400",
  HIGH: "text-orange-600 dark:text-orange-400",
  URGENT: "text-red-600 dark:text-red-400",
};

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
const FEATURE_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
] as const;

const SELECT_CLASS =
  "rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

// ── Inline add forms ──────────────────────────────────────────────────────────

function AddFeatureInline({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = () => {
    if (!title.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("title", title.trim());
    startTransition(async () => {
      const result = await createFeatureAction(fd);
      if (result?.error) { setError(result.error); return; }
      setTitle("");
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="flex gap-2 items-center">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Feature title…"
        className="h-8 text-sm flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
      />
      <Button size="sm" className="h-8" onClick={submit} disabled={isPending || !title.trim()}>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onDone}>
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

function AddTaskInline({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = () => {
    if (!title.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("title", title.trim());
    startTransition(async () => {
      const result = await createTaskAction(fd);
      if (result?.error) { setError(result.error); return; }
      setTitle("");
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="flex gap-2 items-center">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="h-8 text-sm flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
      />
      <Button size="sm" className="h-8" onClick={submit} disabled={isPending || !title.trim()}>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onDone}>
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// ── Features section ──────────────────────────────────────────────────────────

function FeaturesSection({
  features,
  projectId,
}: {
  features: Feature[];
  projectId: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const router = useRouter();

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Features
          <span className="text-muted-foreground font-normal">
            ({features.length})
          </span>
        </h2>
        {!showAdd && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="mb-3">
          <AddFeatureInline
            projectId={projectId}
            onDone={() => setShowAdd(false)}
          />
        </div>
      )}

      {features.length === 0 && !showAdd ? (
        <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
          No features yet.
        </p>
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {features.map((feat) => {
            const badge = FEATURE_STATUS_BADGE[feat.status] ?? {
              label: feat.status,
              variant: "secondary" as const,
            };
            const isExpanded = expanded.has(feat.id);

            return (
              <div key={feat.id} className="bg-background">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleExpand(feat.id)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <span className="flex-1 text-sm">{feat.title}</span>
                  {feat._count.tasks > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {feat._count.tasks} task{feat._count.tasks !== 1 ? "s" : ""}
                    </span>
                  )}
                  <Badge variant={badge.variant} className="text-xs">
                    {badge.label}
                  </Badge>
                  {/* Status update */}
                  <form
                    action={updateFeatureAction.bind(null, feat.id, projectId)}
                  >
                    <select
                      name="status"
                      defaultValue={feat.status}
                      className={`${SELECT_CLASS} hidden sm:block`}
                      onChange={(e) => {
                        const fd = new FormData();
                        fd.set("status", e.target.value);
                        updateFeatureAction(feat.id, projectId, fd).then(
                          () => router.refresh()
                        );
                      }}
                    >
                      {FEATURE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </form>
                  <form action={deleteFeatureAction.bind(null, feat.id, projectId)}>
                    <button
                      type="submit"
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      title="Delete feature"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
                {isExpanded && feat.description && (
                  <p className="px-10 pb-2.5 text-xs text-muted-foreground">
                    {feat.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tasks section ─────────────────────────────────────────────────────────────

function TasksSection({
  tasks,
  projectId,
}: {
  tasks: Task[];
  projectId: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();

  const done = tasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Tasks
          <span className="text-muted-foreground font-normal">
            ({done}/{tasks.length})
          </span>
        </h2>
        {!showAdd && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="mb-3">
          <AddTaskInline
            projectId={projectId}
            onDone={() => setShowAdd(false)}
          />
        </div>
      )}

      {tasks.length === 0 && !showAdd ? (
        <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
          No tasks yet.
        </p>
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {tasks.map((task) => {
            const isDone = task.status === "DONE";
            return (
              <div
                key={task.id}
                className="flex items-center gap-2.5 px-4 py-2.5 bg-background"
              >
                {/* Toggle done */}
                <button
                  type="button"
                  onClick={() => {
                    const newStatus = isDone ? "TODO" : "DONE";
                    const fd = new FormData();
                    fd.set("status", newStatus);
                    updateTaskStatusAction(task.id, projectId, fd).then(
                      () => router.refresh()
                    );
                  }}
                  className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </button>

                <span
                  className={`flex-1 text-sm ${
                    isDone ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {task.title}
                </span>

                <span
                  className={`text-xs font-medium ${
                    PRIORITY_COLOR[task.priority] ?? "text-muted-foreground"
                  }`}
                >
                  {task.priority}
                </span>

                {/* Status select */}
                <select
                  className={`${SELECT_CLASS} hidden sm:block`}
                  defaultValue={task.status}
                  onChange={(e) => {
                    const fd = new FormData();
                    fd.set("status", e.target.value);
                    updateTaskStatusAction(task.id, projectId, fd).then(
                      () => router.refresh()
                    );
                  }}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>

                <form action={deleteTaskAction.bind(null, task.id, projectId)}>
                  <button
                    type="submit"
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    title="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function FeatureTasksSection({
  projectId,
  features,
  tasks,
}: {
  projectId: string;
  features: Feature[];
  tasks: Task[];
}) {
  return (
    <>
      <FeaturesSection features={features} projectId={projectId} />
      <TasksSection tasks={tasks} projectId={projectId} />
    </>
  );
}
