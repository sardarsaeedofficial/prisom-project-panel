"use client";

/**
 * components/projects/project-backup-schedule-panel.tsx
 *
 * Sprint 30: Backup schedule configuration and health display.
 *
 * Shows:
 *  - Schedule enable/disable toggle
 *  - Frequency (daily/weekly) + time + day picker
 *  - Retention count slider/input
 *  - Backup health status (healthy/warning/failed/disabled/never_run)
 *  - Last run / last success / last failure / next run timestamps
 *  - "Run backup now" button
 *  - Save button
 */

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  CalendarClock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Power,
  Play,
  RefreshCw,
  Save,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Label }  from "@/components/ui/label";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  getBackupScheduleAction,
  saveBackupScheduleAction,
  enableBackupScheduleAction,
  disableBackupScheduleAction,
  runScheduledBackupNowAction,
} from "@/app/actions/project-backup-schedules";
import type { BackupScheduleDTO, BackupScheduleHealthStatus } from "@/lib/backups/backup-schedule-types";
import { DAY_NAMES } from "@/lib/backups/backup-schedule-types";

// ── Health status display ──────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<BackupScheduleHealthStatus, {
  label: string;
  className: string;
  icon: React.ElementType;
}> = {
  healthy:   { label: "Healthy",    className: "text-green-600  bg-green-50   border-green-200",  icon: CheckCircle2 },
  warning:   { label: "Stale",      className: "text-amber-600  bg-amber-50   border-amber-200",  icon: AlertCircle  },
  failed:    { label: "Last run failed", className: "text-red-600 bg-red-50   border-red-200",    icon: XCircle      },
  disabled:  { label: "Disabled",   className: "text-gray-500   bg-gray-50    border-gray-200",   icon: Clock        },
  never_run: { label: "Never run",  className: "text-blue-600   bg-blue-50    border-blue-200",   icon: Info         },
};

function HealthBadge({ status }: { status: BackupScheduleHealthStatus }) {
  const cfg  = HEALTH_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", cfg.className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Timestamp display ─────────────────────────────────────────────────────────

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground/60">—</span>;
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  let relative: string;
  if (mins < 2)        relative = "just now";
  else if (mins < 60)  relative = `${mins}m ago`;
  else if (hrs < 24)   relative = `${hrs}h ago`;
  else if (days < 30)  relative = `${days}d ago`;
  else                 relative = d.toLocaleDateString();

  return (
    <time dateTime={iso} title={d.toLocaleString()} className="text-sm">
      {relative}
    </time>
  );
}

function FutureTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground/60">—</span>;
  const d    = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return <span className="text-amber-600 text-sm">Overdue</span>;
  const hrs  = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const label = hrs > 0 ? `in ${hrs}h ${mins}m` : `in ${mins}m`;
  return (
    <time dateTime={iso} title={d.toLocaleString()} className="text-sm">
      {label}
    </time>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  projectId:       string;
  initialSchedule?: BackupScheduleDTO | null;
};

export function ProjectBackupSchedulePanel({ projectId, initialSchedule }: Props) {
  const [schedule, setSchedule]    = useState<BackupScheduleDTO | null>(initialSchedule ?? null);
  const [error, setError]          = useState<string | null>(null);
  const [success, setSuccess]      = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRunning, startRunTransition] = useTransition();

  // Form state (mirrors schedule fields)
  const [enabled,        setEnabled]        = useState(initialSchedule?.enabled        ?? false);
  const [frequency,      setFrequency]      = useState<"daily"|"weekly">(initialSchedule?.frequency ?? "daily");
  const [timeOfDay,      setTimeOfDay]      = useState(initialSchedule?.timeOfDay      ?? "02:00");
  const [dayOfWeek,      setDayOfWeek]      = useState(initialSchedule?.dayOfWeek      ?? 0);
  const [retentionCount, setRetentionCount] = useState(initialSchedule?.retentionCount ?? 7);
  const [includeSource,  setIncludeSource]  = useState(initialSchedule?.includeSource  ?? true);
  const [includeEnvMeta, setIncludeEnvMeta] = useState(initialSchedule?.includeEnvMetadata ?? true);

  const syncFromSchedule = useCallback((s: BackupScheduleDTO) => {
    setEnabled(s.enabled);
    setFrequency(s.frequency);
    setTimeOfDay(s.timeOfDay);
    setDayOfWeek(s.dayOfWeek ?? 0);
    setRetentionCount(s.retentionCount);
    setIncludeSource(s.includeSource);
    setIncludeEnvMeta(s.includeEnvMetadata);
  }, []);

  // Load schedule if not pre-loaded
  useEffect(() => {
    if (schedule) return;
    startTransition(async () => {
      const res = await getBackupScheduleAction(projectId);
      if (res.ok) { setSchedule(res.data.schedule); syncFromSchedule(res.data.schedule); }
      else setError(res.error);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function clearMessages() { setError(null); setSuccess(null); }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    clearMessages();
    startTransition(async () => {
      const res = await saveBackupScheduleAction(projectId, {
        enabled,
        frequency,
        timeOfDay,
        dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
        retentionCount,
        includeSource,
        includeEnvMetadata: includeEnvMeta,
      });
      if (res.ok) {
        setSchedule(res.data.schedule);
        syncFromSchedule(res.data.schedule);
        setSuccess("Schedule saved.");
      } else {
        setError(res.error);
      }
    });
  }

  // ── Toggle enable/disable ─────────────────────────────────────────────────

  function handleToggle() {
    clearMessages();
    if (enabled) {
      startTransition(async () => {
        const res = await disableBackupScheduleAction(projectId);
        if (res.ok) { setSchedule(res.data.schedule); setEnabled(false); setSuccess("Schedule disabled."); }
        else setError(res.error);
      });
    } else {
      startTransition(async () => {
        const res = await enableBackupScheduleAction(projectId);
        if (res.ok) { setSchedule(res.data.schedule); setEnabled(true); setSuccess("Schedule enabled."); }
        else setError(res.error);
      });
    }
  }

  // ── Run now ───────────────────────────────────────────────────────────────

  function handleRunNow() {
    clearMessages();
    startRunTransition(async () => {
      const res = await runScheduledBackupNowAction(projectId);
      if (res.ok) {
        setSuccess(`Backup created (ID: ${res.data.backupId.slice(-8)}).`);
        // Refresh schedule state
        const schedRes = await getBackupScheduleAction(projectId);
        if (schedRes.ok) { setSchedule(schedRes.data.schedule); syncFromSchedule(schedRes.data.schedule); }
      } else {
        setError(res.error);
      }
    });
  }

  const isLoading = isPending || isRunning;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">Scheduled Backups</h3>
            <p className="text-xs text-muted-foreground">
              Automatic recurring backups with configurable retention.
            </p>
          </div>
        </div>
        {schedule && <HealthBadge status={schedule.healthStatus} />}
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Status row */}
      {schedule && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border bg-muted/20 px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Last run</p>
            <RelativeTime iso={schedule.lastRunAt} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Last success</p>
            <RelativeTime iso={schedule.lastSuccessAt} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Next run</p>
            <FutureTime iso={schedule.nextRunAt} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Status</p>
            <HealthBadge status={schedule.healthStatus} />
          </div>
          {schedule.lastFailureText && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground mb-0.5">Last failure</p>
              <p className="text-xs text-red-600 line-clamp-2">{schedule.lastFailureText}</p>
            </div>
          )}
        </div>
      )}

      {/* Schedule configuration form */}
      <div className="space-y-4 rounded-lg border bg-card p-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable scheduled backups</Label>
            <p className="text-xs text-muted-foreground">
              Automatically create backups on the schedule below.
            </p>
          </div>
          <Button
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={handleToggle}
            disabled={isLoading}
            className="h-8 gap-1.5"
          >
            <Power className="h-3.5 w-3.5" />
            {enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        <hr className="border-border" />

        {/* Frequency */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Frequency</Label>
            <div className="flex gap-2">
              {(["daily", "weekly"] as const).map((f) => (
                <Button
                  key={f}
                  variant={frequency === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setFrequency(f); clearMessages(); }}
                  disabled={isLoading}
                  className="h-8 text-xs capitalize"
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>

          {/* Time of day */}
          <div className="space-y-1.5">
            <Label htmlFor="timeOfDay" className="text-xs font-medium">Time (server local)</Label>
            <Input
              id="timeOfDay"
              type="time"
              value={timeOfDay}
              onChange={(e) => { setTimeOfDay(e.target.value); clearMessages(); }}
              disabled={isLoading}
              className="h-8 text-sm w-36"
            />
          </div>
        </div>

        {/* Day of week (weekly only) */}
        {frequency === "weekly" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Day of week</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((day, idx) => (
                <Button
                  key={day}
                  variant={dayOfWeek === idx ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setDayOfWeek(idx); clearMessages(); }}
                  disabled={isLoading}
                  className="h-8 text-xs px-3"
                >
                  {day.slice(0, 3)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Retention */}
        <div className="space-y-1.5">
          <Label htmlFor="retention" className="text-xs font-medium">
            Keep last <span className="text-foreground font-semibold">{retentionCount}</span> scheduled backups
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="retention"
              type="range"
              min={1}
              max={30}
              value={retentionCount}
              onChange={(e) => { setRetentionCount(Number(e.target.value)); clearMessages(); }}
              disabled={isLoading}
              className="h-8 w-40 accent-primary"
            />
            <Input
              type="number"
              min={1}
              max={100}
              value={retentionCount}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 100) { setRetentionCount(v); clearMessages(); } }}
              disabled={isLoading}
              className="h-8 w-20 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Older successful scheduled backups are automatically deleted. Manual backups are never deleted.
          </p>
        </div>

        {/* Include options */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Include in backup</Label>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSource}
                onChange={(e) => { setIncludeSource(e.target.checked); clearMessages(); }}
                disabled={isLoading}
                className="rounded"
              />
              Source files
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeEnvMeta}
                onChange={(e) => { setIncludeEnvMeta(e.target.checked); clearMessages(); }}
                disabled={isLoading}
                className="rounded"
              />
              Env key names (no values)
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={handleSave}
            disabled={isLoading}
            size="sm"
            className="h-8 gap-1.5"
          >
            {isPending
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            Save schedule
          </Button>

          <Button
            onClick={handleRunNow}
            disabled={isLoading}
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
          >
            {isRunning
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            Run backup now
          </Button>
        </div>
      </div>
    </div>
  );
}
