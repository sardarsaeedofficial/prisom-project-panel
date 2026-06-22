"use client";

/**
 * components/notifications/notifications-center.tsx
 *
 * Sprint 37: Notifications center — list, mark read, dismiss.
 */

import { useState, useEffect, useCallback } from "react";
import Link                                 from "next/link";
import {
  Bell, CheckCheck, X, Loader2, AlertTriangle,
  CheckCircle2, Info, AlertCircle, ChevronRight,
} from "lucide-react";
import { cn }                            from "@/lib/utils";
import {
  listNotificationsAction,
  markNotificationReadAction,
  markAllReadAction,
  dismissNotificationAction,
} from "@/app/actions/notifications";
import type {
  UserNotificationDTO,
  NotificationSeverity,
  NotificationCategory,
} from "@/lib/notifications/notification-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV_ICON: Record<NotificationSeverity, React.ElementType> = {
  info:    Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error:   AlertCircle,
};

const SEV_CLASSES: Record<NotificationSeverity, string> = {
  info:    "bg-blue-50   text-blue-700   border-blue-200",
  success: "bg-green-50  text-green-700  border-green-200",
  warning: "bg-yellow-50 text-yellow-700 border-yellow-200",
  error:   "bg-red-50    text-red-700    border-red-200",
};

const CAT_LABELS: Record<NotificationCategory, string> = {
  deployment: "Deployment",
  backup:     "Backup",
  domain:     "Domain",
  storage:    "Storage",
  job:        "Background Job",
  alert:      "Alert",
  security:   "Security",
  admin:      "Admin",
  system:     "System",
};

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)     return "just now";
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Notification row ──────────────────────────────────────────────────────────

function NotifRow({
  n,
  onRead,
  onDismiss,
}: {
  n:         UserNotificationDTO;
  onRead:    (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const SevIcon = SEV_ICON[n.severity];
  const isUnread = !n.readAt;

  return (
    <div className={cn(
      "flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors",
      isUnread ? "bg-primary/5" : "",
    )}>
      {/* Unread dot */}
      <div className="mt-1.5 shrink-0">
        {isUnread
          ? <span className="block h-2 w-2 rounded-full bg-primary" />
          : <span className="block h-2 w-2 rounded-full bg-transparent" />
        }
      </div>

      {/* Icon */}
      <div className={cn("shrink-0 rounded-full p-1.5 mt-0.5", SEV_CLASSES[n.severity])}>
        <SevIcon className="h-3 w-3" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("text-sm leading-snug truncate", isUnread && "font-medium")}>
              {n.href
                ? <Link href={n.href} className="hover:underline" onClick={() => onRead(n.id)}>{n.title}</Link>
                : n.title
              }
            </p>
            {n.body && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              {n.projectName && (
                <span className="text-xs text-muted-foreground">{n.projectName}</span>
              )}
              <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                {CAT_LABELS[n.category]}
              </span>
              <span className="text-xs text-muted-foreground">{fmtRelative(n.createdAt)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {n.href && (
              <Link
                href={n.href}
                onClick={() => onRead(n.id)}
                className="inline-flex items-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Open source"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
            {isUnread && (
              <button
                onClick={() => onRead(n.id)}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Mark as read"
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => onDismiss(n.id)}
              className="rounded p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "all" | "unread";

export function NotificationsCenter() {
  const [tab,        setTab]        = useState<Tab>("all");
  const [notifs,     setNotifs]     = useState<UserNotificationDTO[]>([]);
  const [unread,     setUnread]     = useState(0);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [marking,    setMarking]    = useState(false);
  const [actionMsg,  setActionMsg]  = useState<string | null>(null);

  const load = useCallback(async (t: Tab, p: number) => {
    setLoading(true);
    setError(null);
    const res = await listNotificationsAction({
      unreadOnly: t === "unread",
      dismissed:  false,
      page:       p,
      pageSize:   25,
    }).catch(() => null);

    if (!res || !res.ok) {
      setError(res?.error ?? "Failed to load notifications");
    } else {
      setNotifs(res.result.notifications);
      setUnread(res.result.unreadCount);
      setTotal(res.result.total);
      setTotalPages(res.result.totalPages);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(tab, page); }, [load, tab, page]);

  async function handleRead(id: string) {
    setNotifs((prev) =>
      prev.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n),
    );
    setUnread((u) => Math.max(0, u - 1));
    await markNotificationReadAction(id);
  }

  async function handleDismiss(id: string) {
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    const n = notifs.find((x) => x.id === id);
    if (n && !n.readAt) setUnread((u) => Math.max(0, u - 1));
    await dismissNotificationAction(id);
  }

  async function handleMarkAllRead() {
    setMarking(true);
    const res = await markAllReadAction();
    if (res.ok) {
      setActionMsg(`Marked ${res.count} notification${res.count !== 1 ? "s" : ""} as read.`);
      setNotifs((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnread(0);
    }
    setMarking(false);
    setTimeout(() => setActionMsg(null), 3000);
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Tabs */}
          {(["all", "unread"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1); }}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {t === "unread" ? `Unread (${unread})` : "All"}
            </button>
          ))}
        </div>

        {unread > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={marking}
            className="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {marking
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCheck className="h-3.5 w-3.5" />}
            Mark all read
          </button>
        )}
      </div>

      {/* Action feedback */}
      {actionMsg && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {actionMsg}
        </div>
      )}

      {/* List */}
      <div className="rounded-lg border bg-card">
        {loading && notifs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notifications…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 px-4 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : notifs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
            <div className="rounded-full bg-muted p-3">
              <Bell className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {tab === "unread" ? "You're all caught up!" : "No notifications yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {tab === "unread"
                ? "No unread notifications."
                : "Notifications will appear here for important events like job failures, backup results, and alerts."}
            </p>
          </div>
        ) : (
          <div>
            {notifs.map((n) => (
              <NotifRow key={n.id} n={n} onRead={handleRead} onDismiss={handleDismiss} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-xs text-muted-foreground">
              {total} notification{total !== 1 ? "s" : ""} · page {page}/{totalPages}
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40">Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Preferences placeholder */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-1">Notification Preferences</h3>
        <p className="text-xs text-muted-foreground">
          In-app notifications are enabled for job failures, backup results, and important system events.
          Email notifications are coming soon.
        </p>
      </div>
    </div>
  );
}

// ── Bell badge component (header) ─────────────────────────────────────────────

export function NotificationBellBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    import("@/app/actions/notifications").then(({ getUnreadCountAction }) => {
      getUnreadCountAction()
        .then((r) => { if (r.ok) setCount(r.count); })
        .catch(() => null);
    });
  }, []);

  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title={count > 0 ? `${count} unread notifications` : "Notifications"}
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
