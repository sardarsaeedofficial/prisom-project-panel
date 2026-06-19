"use client";

/**
 * components/projects/project-alert-settings-panel.tsx
 *
 * Sprint 16: Background alert scheduler settings + notification delivery UI.
 *
 * Sections:
 *  1. Background Alert Checks (enable/disable, interval, last/next run, status)
 *  2. Notification Delivery (mode, email, recovery, cooldown, test button)
 *  3. Recent Alert Runs (notification attempt history + scheduled evaluation history)
 *
 * Safety copy displayed prominently:
 *  "Background checks are read-only. They never deploy, restart, or rollback your app."
 *
 * Types imported directly from lib (never from "use server" files).
 */

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useRef,
} from "react";
import {
  type AlertSettings,
  type AlertNotificationRecord,
  type AlertDeliveryMode,
  type ScheduledCheckResult,
  ALERT_INTERVALS,
  ALERT_DELIVERY_MODES,
  ALERT_DELIVERY_MODE_LABELS,
  ALERT_DELIVERY_MODE_DESCRIPTIONS,
} from "@/lib/projects/alert-rules";
import {
  getProjectAlertSettingsAction,
  updateProjectAlertSettingsAction,
  runScheduledAlertCheckNowAction,
  sendTestAlertNotificationAction,
  getRecentAlertNotificationsAction,
  getRecentScheduledEvaluationsAction,
} from "@/app/actions/project-alert-settings";
import {
  Clock,
  Bell,
  BellOff,
  Play,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  Mail,
  CalendarClock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtAbsTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtFutureTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

function NotifStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    log_only:             { color: "text-blue-600 bg-blue-50 border-blue-200",    label: "Logged"       },
    dry_run_sent:         { color: "text-purple-600 bg-purple-50 border-purple-200", label: "Dry-run"  },
    sent:                 { color: "text-green-600 bg-green-50 border-green-200",  label: "Sent"        },
    suppressed_cooldown:  { color: "text-amber-600 bg-amber-50 border-amber-200",  label: "Suppressed"  },
    failed:               { color: "text-red-600 bg-red-50 border-red-200",        label: "Failed"      },
    unavailable:          { color: "text-orange-600 bg-orange-50 border-orange-200", label: "Unavailable" },
    no_alerts:            { color: "text-muted-foreground bg-muted/20 border-border", label: "No alerts" },
    eval_failed:          { color: "text-red-600 bg-red-50 border-red-200",        label: "Eval error"  },
  };
  const style = map[status] ?? { color: "text-muted-foreground bg-muted/20 border-border", label: status };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${style.color}`}>
      {style.label}
    </span>
  );
}

function EvalStatusBadge({ status }: { status: string }) {
  const Icon =
    status === "ok"        ? CheckCircle2  :
    status === "triggered" ? XCircle       :
    status === "disabled"  ? BellOff       : AlertCircle;
  const color =
    status === "ok"        ? "text-green-600 bg-green-50 border-green-200"     :
    status === "triggered" ? "text-red-600 bg-red-50 border-red-200"           :
    status === "disabled"  ? "text-muted-foreground bg-muted/10 border-border" :
    "text-muted-foreground bg-muted/20 border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${color}`}>
      <Icon className="h-2.5 w-2.5" />
      {status}
    </span>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectAlertSettingsPanel({ projectId }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────

  const [settings, setSettings]         = useState<AlertSettings | null>(null);
  const [loading,  setLoading]          = useState(true);
  const [loadErr,  setLoadErr]          = useState<string | null>(null);
  const [flashMsg, setFlashMsg]         = useState<string | null>(null);
  const [saveErr,  setSaveErr]          = useState<string | null>(null);
  const [saving,   setSaving]           = useState(false);

  // Scheduler check result
  const [checkResult,  setCheckResult]  = useState<ScheduledCheckResult | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkErr,     setCheckErr]     = useState<string | null>(null);

  // Test notification result
  const [testResult,  setTestResult]   = useState<{ notificationStatus: string; message: string } | null>(null);
  const [testRunning, setTestRunning]  = useState(false);
  const [testErr,     setTestErr]      = useState<string | null>(null);

  // Recent data
  const [notifications,     setNotifications]     = useState<AlertNotificationRecord[]>([]);
  const [recentEvaluations, setRecentEvaluations] = useState<{
    ruleId: string | null; ruleName: string | null; type: string;
    severity: string; status: string; message: string; source: string; createdAt: string;
  }[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Form state (local editable copy)
  const [form, setForm] = useState({
    schedulerEnabled:      false,
    intervalMinutes:       15,
    deliveryMode:          "log_only" as AlertDeliveryMode,
    notificationEmail:     "",        // blank until user types — never pre-filled with masked value
    notifyOnRecovery:      true,
    repeatCooldownMinutes: 60,
  });

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();

  function flash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 4000);
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true);
    setLoadErr(null);
    startTransition(async () => {
      const [settingsRes, notifRes, evalRes] = await Promise.all([
        getProjectAlertSettingsAction(projectId),
        getRecentAlertNotificationsAction({ projectId, limit: 10 }),
        getRecentScheduledEvaluationsAction({ projectId, limit: 30 }),
      ]);

      setLoading(false);
      if (settingsRes.ok) {
        setSettings(settingsRes.data);
        // Sync form from loaded settings (email stays blank — user must re-enter to change)
        setForm((prev) => ({
          ...prev,
          schedulerEnabled:      settingsRes.data.schedulerEnabled,
          intervalMinutes:       settingsRes.data.intervalMinutes,
          deliveryMode:          settingsRes.data.deliveryMode,
          notifyOnRecovery:      settingsRes.data.notifyOnRecovery,
          repeatCooldownMinutes: settingsRes.data.repeatCooldownMinutes,
        }));
      } else {
        setLoadErr(settingsRes.error);
      }
      if (notifRes.ok) setNotifications(notifRes.data);
      if (evalRes.ok)  setRecentEvaluations(evalRes.data);
    });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // ── Save settings ─────────────────────────────────────────────────────────

  function handleSave() {
    setSaving(true);
    setSaveErr(null);
    startTransition(async () => {
      const payload: Parameters<typeof updateProjectAlertSettingsAction>[0] = {
        projectId,
        schedulerEnabled:      form.schedulerEnabled,
        intervalMinutes:       form.intervalMinutes,
        deliveryMode:          form.deliveryMode,
        notifyOnRecovery:      form.notifyOnRecovery,
        repeatCooldownMinutes: form.repeatCooldownMinutes,
      };
      // Only send email if user has typed something — keeps masked email intact server-side
      if (form.notificationEmail.trim()) {
        payload.notificationEmail = form.notificationEmail.trim();
      }

      const res = await updateProjectAlertSettingsAction(payload);
      setSaving(false);
      if (res.ok) {
        setSettings(res.data);
        setForm((prev) => ({ ...prev, notificationEmail: "" })); // clear field after save
        flash("Settings saved.");
      } else {
        setSaveErr(res.error);
      }
    });
  }

  // ── Run scheduled check ───────────────────────────────────────────────────

  function handleRunNow() {
    setCheckRunning(true);
    setCheckErr(null);
    setCheckResult(null);
    startTransition(async () => {
      const res = await runScheduledAlertCheckNowAction({ projectId });
      setCheckRunning(false);
      if (res.ok) {
        setCheckResult(res.data);
        flash("Scheduled check complete.");
        load(); // refresh settings + history
      } else {
        setCheckErr(res.error);
      }
    });
  }

  // ── Test notification ─────────────────────────────────────────────────────

  function handleTest() {
    setTestRunning(true);
    setTestErr(null);
    setTestResult(null);
    startTransition(async () => {
      const res = await sendTestAlertNotificationAction({ projectId });
      setTestRunning(false);
      if (res.ok) {
        setTestResult(res.data);
        load(); // refresh notification history
      } else {
        setTestErr(res.error);
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading scheduler settings…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive py-4">
        <XCircle className="h-4 w-4" />
        Failed to load settings: {loadErr}
        <button onClick={load} className="ml-2 text-xs underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Background Alert Checks</h3>
        </div>
        <button
          onClick={load}
          title="Refresh"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Safety banner ────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 p-2.5 rounded border border-green-400/20 bg-green-500/5 text-xs text-green-700">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          <strong>Background checks are read-only.</strong>{" "}
          They never deploy, restart, rollback your app, or modify any configuration.
        </span>
      </div>

      {/* ── Flash message ────────────────────────────────────────────────── */}
      {flashMsg && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {flashMsg}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1: Scheduler toggle + interval
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="rounded border border-border bg-muted/10 p-4 space-y-4 text-sm">

        {/* Scheduler enabled */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Scheduled checks</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically evaluate alert rules on a regular interval.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={form.schedulerEnabled}
            onClick={() => setForm((p) => ({ ...p, schedulerEnabled: !p.schedulerEnabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              form.schedulerEnabled ? "bg-primary" : "bg-muted border border-border"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                form.schedulerEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Interval */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Check interval</label>
          <select
            value={form.intervalMinutes}
            onChange={(e) => setForm((p) => ({ ...p, intervalMinutes: Number(e.target.value) }))}
            className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none w-40"
          >
            {ALERT_INTERVALS.map((n) => (
              <option key={n} value={n}>{n} minutes</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">Minimum: 5 minutes.</p>
        </div>

        {/* Status summary */}
        {settings && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Last run</span>
              <p className="font-medium">{fmtRelTime(settings.lastRunAt)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Next run</span>
              <p className="font-medium">
                {settings.schedulerEnabled && settings.nextRunAt
                  ? fmtFutureTime(settings.nextRunAt)
                  : "Scheduler disabled"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last status</span>
              <p className="font-medium">
                {settings.lastStatus
                  ? <span className={
                      settings.lastStatus === "triggered" ? "text-amber-600" :
                      settings.lastStatus === "error"     ? "text-red-600"   :
                      "text-green-600"
                    }>{settings.lastStatus}</span>
                  : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last triggered</span>
              <p className={`font-medium ${settings.lastTriggeredCount > 0 ? "text-amber-600" : ""}`}>
                {settings.lastTriggeredCount > 0
                  ? `${settings.lastTriggeredCount} rule${settings.lastTriggeredCount !== 1 ? "s" : ""}`
                  : "None"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2: Notification delivery
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="rounded border border-border bg-muted/10 p-4 space-y-4 text-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          <h4 className="text-sm font-medium">Notification Delivery</h4>
        </div>

        {/* Delivery mode */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Delivery mode</label>
          <select
            value={form.deliveryMode}
            onChange={(e) => setForm((p) => ({ ...p, deliveryMode: e.target.value as AlertDeliveryMode }))}
            className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none"
          >
            {ALERT_DELIVERY_MODES.map((m) => (
              <option key={m} value={m}>{ALERT_DELIVERY_MODE_LABELS[m]}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            {ALERT_DELIVERY_MODE_DESCRIPTIONS[form.deliveryMode]}
          </p>
          {form.deliveryMode === "email" && (
            <div className="flex items-start gap-2 mt-1 p-2 rounded border border-amber-400/20 bg-amber-500/5 text-[10px] text-amber-700">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              Email sends only if SMTP_HOST or RESEND_API_KEY is configured. If not set, delivery
              falls back to unavailable with a safe warning — no crash.
            </div>
          )}
        </div>

        {/* Notification email */}
        {(form.deliveryMode === "email_dry_run" || form.deliveryMode === "email") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Notification email</label>
            <input
              type="email"
              value={form.notificationEmail}
              onChange={(e) => setForm((p) => ({ ...p, notificationEmail: e.target.value }))}
              placeholder={
                settings?.notificationEmail
                  ? `Current: ${settings.notificationEmail} — type to change`
                  : "you@example.com"
              }
              maxLength={320}
              className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {settings?.notificationEmail && (
              <p className="text-[10px] text-muted-foreground">
                Current recipient (masked): <strong>{settings.notificationEmail}</strong>
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Leave blank to keep the current recipient. The address is never shown in full.
            </p>
          </div>
        )}

        {/* Notify on recovery */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Notify on recovery</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Send a notification when previously triggered alerts resolve.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={form.notifyOnRecovery}
            onClick={() => setForm((p) => ({ ...p, notifyOnRecovery: !p.notifyOnRecovery }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              form.notifyOnRecovery ? "bg-primary" : "bg-muted border border-border"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                form.notifyOnRecovery ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Cooldown */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Repeat cooldown <span className="text-muted-foreground/50">(5–1440 min)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={1440}
              value={form.repeatCooldownMinutes}
              onChange={(e) => setForm((p) => ({ ...p, repeatCooldownMinutes: Number(e.target.value) }))}
              className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none w-24"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            If the same alert keeps triggering, repeat notifications are suppressed for this duration.
          </p>
        </div>

        {/* Last notification status */}
        {settings?.lastNotificationStatus && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Last notification:</span>
            <NotifStatusBadge status={settings.lastNotificationStatus} />
          </div>
        )}
      </div>

      {/* ── Save button ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save settings
        </button>
        {saveErr && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" />
            {saveErr}
          </span>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3: Manual actions
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

        {/* Run scheduled check now */}
        <div className="rounded border border-border bg-muted/10 p-3 space-y-2">
          <div>
            <p className="text-xs font-medium">Run scheduled check now</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Evaluates rules and applies delivery mode/cooldown. Does not advance the schedule.
            </p>
          </div>
          <button
            onClick={handleRunNow}
            disabled={checkRunning}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            {checkRunning
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
              : <><Play className="h-3 w-3" /> Run check</>}
          </button>
          {checkErr && (
            <p className="text-[10px] text-destructive flex items-center gap-1">
              <XCircle className="h-3 w-3" />{checkErr}
            </p>
          )}
          {checkResult && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground">Triggered:</span>
                <span className={checkResult.triggeredCount > 0 ? "text-amber-600 font-semibold" : "text-green-600"}>
                  {checkResult.triggeredCount} rule{checkResult.triggeredCount !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground">Notification:</span>
                <NotifStatusBadge status={checkResult.notificationStatus} />
              </div>
              {checkResult.evaluationResults.filter((r) => r.triggered).map((r) => (
                <div key={r.ruleId} className="text-[10px] text-amber-700 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span><strong>{r.ruleName}:</strong> {r.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Send test notification */}
        <div className="rounded border border-border bg-muted/10 p-3 space-y-2">
          <div>
            <p className="text-xs font-medium">Send test notification</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Renders and delivers a safe test message using the current delivery mode.
              No alert content is used.
            </p>
          </div>
          <button
            onClick={handleTest}
            disabled={testRunning}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            {testRunning
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Sending…</>
              : <><Send className="h-3 w-3" /> Send test</>}
          </button>
          {testErr && (
            <p className="text-[10px] text-destructive flex items-center gap-1">
              <XCircle className="h-3 w-3" />{testErr}
            </p>
          )}
          {testResult && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground">Status:</span>
                <NotifStatusBadge status={testResult.notificationStatus} />
              </div>
              <p className="text-[10px] text-muted-foreground">{testResult.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Explanation of manual vs scheduled ─────────────────────────── */}
      <div className="flex items-start gap-2 p-2.5 rounded border border-blue-400/20 bg-blue-500/5 text-[10px] text-blue-700">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong>Manual alert check</strong> (Sprint 15 "Run alert check now"):
            Evaluates rules immediately. Never sends notifications. Preview only.
          </p>
          <p>
            <strong>Scheduled check test</strong> (above "Run check"):
            Evaluates rules using the full scheduler pipeline. Applies delivery mode and
            cooldown. Records a notification attempt. Useful for testing log-only or dry-run.
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 4: Recent alert runs history
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="border-t border-border/50 pt-4">
        <button
          onClick={() => setShowHistory((p) => !p)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="h-3.5 w-3.5" />
          <span className="font-medium">Recent Alert Runs</span>
          <span className="text-muted-foreground/60">({notifications.length} notification records)</span>
          {showHistory ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
        </button>

        {showHistory && (
          <div className="mt-3 space-y-4">

            {/* Notification attempts */}
            <div>
              <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Notification attempts
              </h5>
              {notifications.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No notifications recorded yet.</p>
              ) : (
                <div className="space-y-1">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-start gap-2 px-2 py-1.5 rounded border border-border/50 bg-background text-[10px]"
                    >
                      <span className="text-muted-foreground w-24 shrink-0">{fmtRelTime(n.createdAt)}</span>
                      <NotifStatusBadge status={n.status} />
                      <span className="text-muted-foreground capitalize">{n.source.replace(/_/g, " ")}</span>
                      {n.triggeredCount > 0 && (
                        <span className="text-amber-600 font-medium">
                          {n.triggeredCount} triggered
                        </span>
                      )}
                      {n.recipientMasked && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Mail className="h-2.5 w-2.5" />
                          {n.recipientMasked}
                        </span>
                      )}
                      {n.error && (
                        <span className="text-destructive truncate max-w-[200px]" title={n.error}>
                          {n.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Evaluation records */}
            {recentEvaluations.length > 0 && (
              <div>
                <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Scheduled evaluation records (last {recentEvaluations.length})
                </h5>
                <div className="space-y-1">
                  {recentEvaluations.slice(0, 20).map((e, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-2 py-1.5 rounded border border-border/50 bg-background text-[10px]"
                    >
                      <span className="text-muted-foreground w-20 shrink-0">{fmtRelTime(e.createdAt)}</span>
                      <EvalStatusBadge status={e.status} />
                      <span className="text-muted-foreground capitalize">
                        {e.source.replace(/_/g, " ")}
                      </span>
                      <span className="font-medium truncate">{e.ruleName ?? e.type}</span>
                      <span className="text-muted-foreground truncate max-w-[200px]">{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
