"use client";

/**
 * components/projects/project-alert-rules-panel.tsx
 *
 * Sprint 15: Alert rules management and manual evaluation UI.
 *
 * Sections:
 *  1. Header — title, "Create recommended rules", "Run alert check now"
 *  2. Rules list — enabled toggle, name, type, severity, last status/checked, edit, delete
 *  3. Create/Edit inline form
 *  4. Evaluation results — triggered count, per-rule status, no-notifications banner
 *
 * Read-only evaluation. No automatic notifications.
 */

import {
  useState,
  useCallback,
  useTransition,
  useEffect,
  useRef,
} from "react";
import {
  Bell,
  BellOff,
  Plus,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  Info,
  Zap,
} from "lucide-react";
import {
  getProjectAlertRulesAction,
  createProjectAlertRuleAction,
  updateProjectAlertRuleAction,
  deleteProjectAlertRuleAction,
  evaluateProjectAlertRulesAction,
  createDefaultProjectAlertRulesAction,
  type AlertRule,
  type AlertRuleType,
  type AlertSeverity,
  type AlertRuleConfig,
  type EvaluationBatchResult,
} from "@/app/actions/project-alert-rules";
import {
  ALERT_RULE_TYPES,
  ALERT_RULE_TYPE_LABELS,
  ALERT_SEVERITY_LABELS,
  ruleHasThreshold,
  DEFAULT_THRESHOLDS,
} from "@/lib/projects/alert-rules";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ── Severity / status colour helpers ─────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: { text: "text-red-600",    bg: "bg-red-500/10",   border: "border-red-400/30",   badge: "bg-red-100 text-red-700 border-red-300"   },
  warning:  { text: "text-amber-600",  bg: "bg-amber-500/10", border: "border-amber-400/30", badge: "bg-amber-100 text-amber-700 border-amber-300" },
  info:     { text: "text-blue-600",   bg: "bg-blue-500/10",  border: "border-blue-400/30",  badge: "bg-blue-100 text-blue-700 border-blue-300"  },
} as const;

const EVAL_STATUS_COLORS = {
  ok:        { text: "text-green-600", bg: "bg-green-500/10",  border: "border-green-400/30",  label: "OK"       },
  triggered: { text: "text-red-600",   bg: "bg-red-500/10",    border: "border-red-400/30",    label: "Triggered"},
  unknown:   { text: "text-muted-foreground", bg: "bg-muted/30", border: "border-border",      label: "Unknown"  },
  disabled:  { text: "text-muted-foreground", bg: "bg-muted/10", border: "border-border/50",   label: "Disabled" },
} as const;

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const c = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${c.badge}`}>
      {ALERT_SEVERITY_LABELS[severity]}
    </span>
  );
}

function EvalStatusBadge({ status }: { status: keyof typeof EVAL_STATUS_COLORS }) {
  const c  = EVAL_STATUS_COLORS[status] ?? EVAL_STATUS_COLORS.unknown;
  const Icon =
    status === "ok"        ? CheckCircle2  :
    status === "triggered" ? XCircle       :
    status === "disabled"  ? BellOff       : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${c.bg} ${c.text} ${c.border}`}>
      <Icon className="h-2.5 w-2.5" />
      {c.label}
    </span>
  );
}

function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Rule form ─────────────────────────────────────────────────────────────────

type FormState = {
  name:                  string;
  type:                  AlertRuleType;
  severity:              AlertSeverity;
  enabled:               boolean;
  memoryMbThreshold:     number;
  restartCountThreshold: number;
  latencyMsThreshold:    number;
  endpointName:          NonNullable<AlertRuleConfig["endpointName"]>;
};

const EMPTY_FORM: FormState = {
  name:                  "",
  type:                  "frontend_down",
  severity:              "warning",
  enabled:               true,
  memoryMbThreshold:     DEFAULT_THRESHOLDS.memoryMbThreshold,
  restartCountThreshold: DEFAULT_THRESHOLDS.restartCountThreshold,
  latencyMsThreshold:    DEFAULT_THRESHOLDS.latencyMsThreshold,
  endpointName:          "frontend",
};

function formToConfig(form: FormState): AlertRuleConfig {
  const c: AlertRuleConfig = {};
  if (form.type === "high_memory")        c.memoryMbThreshold     = form.memoryMbThreshold;
  if (form.type === "high_restart_count") c.restartCountThreshold = form.restartCountThreshold;
  if (form.type === "high_latency") {
    c.latencyMsThreshold = form.latencyMsThreshold;
    c.endpointName       = form.endpointName;
  }
  return c;
}

function ruleToForm(rule: AlertRule): FormState {
  return {
    name:     rule.name,
    type:     rule.type,
    severity: rule.severity,
    enabled:  rule.enabled,
    memoryMbThreshold:     rule.config.memoryMbThreshold     ?? DEFAULT_THRESHOLDS.memoryMbThreshold,
    restartCountThreshold: rule.config.restartCountThreshold ?? DEFAULT_THRESHOLDS.restartCountThreshold,
    latencyMsThreshold:    rule.config.latencyMsThreshold    ?? DEFAULT_THRESHOLDS.latencyMsThreshold,
    endpointName:          rule.config.endpointName          ?? "frontend",
  };
}

// ── RuleForm component ────────────────────────────────────────────────────────

function RuleForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial:  FormState;
  onSave:   (form: FormState) => void;
  onCancel: () => void;
  saving:   boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  const hasThreshold = ruleHasThreshold(form.type);

  return (
    <div className="rounded border border-border bg-muted/20 p-4 space-y-3 text-sm">
      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Frontend Down"
          maxLength={80}
          className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Type + Severity row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            value={form.type}
            onChange={(e) => set("type", e.target.value as AlertRuleType)}
            className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none"
          >
            {ALERT_RULE_TYPES.map((t) => (
              <option key={t} value={t}>{ALERT_RULE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Severity</label>
          <select
            value={form.severity}
            onChange={(e) => set("severity", e.target.value as AlertSeverity)}
            className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none"
          >
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
      </div>

      {/* Threshold fields — only shown for threshold-based rule types */}
      {hasThreshold && (
        <div className="flex flex-col gap-1">
          {form.type === "high_memory" && (
            <>
              <label className="text-xs font-medium text-muted-foreground">
                Memory threshold (MB) <span className="text-muted-foreground/50">32–8192</span>
              </label>
              <input
                type="number"
                min={32} max={8192}
                value={form.memoryMbThreshold}
                onChange={(e) => set("memoryMbThreshold", Number(e.target.value))}
                className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none w-32"
              />
            </>
          )}
          {form.type === "high_restart_count" && (
            <>
              <label className="text-xs font-medium text-muted-foreground">
                Restart count threshold <span className="text-muted-foreground/50">1–1000</span>
              </label>
              <input
                type="number"
                min={1} max={1000}
                value={form.restartCountThreshold}
                onChange={(e) => set("restartCountThreshold", Number(e.target.value))}
                className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none w-32"
              />
            </>
          )}
          {form.type === "high_latency" && (
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Latency threshold (ms) <span className="text-muted-foreground/50">100–60000</span>
                </label>
                <input
                  type="number"
                  min={100} max={60000}
                  value={form.latencyMsThreshold}
                  onChange={(e) => set("latencyMsThreshold", Number(e.target.value))}
                  className="border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
                <select
                  value={form.endpointName}
                  onChange={(e) => set("endpointName", e.target.value as FormState["endpointName"])}
                  className="border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none w-40"
                >
                  <option value="frontend">Frontend</option>
                  <option value="health">Health</option>
                  <option value="login">Login</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Enabled toggle */}
      <div className="flex items-center gap-2">
        <input
          id="rule-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="h-4 w-4 rounded accent-primary"
        />
        <label htmlFor="rule-enabled" className="text-xs font-medium">Enabled</label>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── DeleteConfirm ─────────────────────────────────────────────────────────────

function DeleteConfirm({
  ruleName,
  onConfirm,
  onCancel,
  deleting,
}: {
  ruleName: string;
  onConfirm: () => void;
  onCancel:  () => void;
  deleting:  boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-xs rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
      <span className="flex-1">Delete <strong>{ruleName}</strong>?</span>
      <button
        onClick={onConfirm}
        disabled={deleting}
        className="px-2 py-1 rounded text-[11px] font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
      >
        {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
      </button>
      <button
        onClick={onCancel}
        disabled={deleting}
        className="px-2 py-1 rounded text-[11px] border border-border hover:bg-muted disabled:opacity-50"
      >
        Keep
      </button>
    </div>
  );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
  toggling,
}: {
  rule:     AlertRule;
  onToggle: (rule: AlertRule) => void;
  onEdit:   (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
  toggling: boolean;
}) {
  const sevColors = SEVERITY_COLORS[rule.severity] ?? SEVERITY_COLORS.info;
  const evalColors = rule.lastStatus
    ? EVAL_STATUS_COLORS[rule.lastStatus as keyof typeof EVAL_STATUS_COLORS]
    : null;

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 rounded border transition-colors ${rule.enabled ? "bg-background border-border" : "bg-muted/20 border-border/50"}`}>
      {/* Toggle */}
      <button
        onClick={() => onToggle(rule)}
        disabled={toggling}
        title={rule.enabled ? "Disable rule" : "Enable rule"}
        className={`shrink-0 transition-colors ${rule.enabled ? "text-primary" : "text-muted-foreground/40"} hover:opacity-80 disabled:opacity-40`}
      >
        {rule.enabled
          ? <ToggleRight className="h-5 w-5" />
          : <ToggleLeft  className="h-5 w-5" />}
      </button>

      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${rule.enabled ? "" : "text-muted-foreground"}`}>
          {rule.name}
        </p>
        <p className="text-[11px] text-muted-foreground">{ALERT_RULE_TYPE_LABELS[rule.type]}</p>
      </div>

      {/* Severity */}
      <div className="shrink-0 hidden sm:block">
        <SeverityBadge severity={rule.severity} />
      </div>

      {/* Last status */}
      <div className="shrink-0 hidden md:flex flex-col items-end gap-0.5">
        {rule.lastStatus && evalColors ? (
          <>
            <EvalStatusBadge status={rule.lastStatus as keyof typeof EVAL_STATUS_COLORS} />
            <span className="text-[10px] text-muted-foreground">{fmtRelTime(rule.lastCheckedAt)}</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">Not checked</span>
        )}
      </div>

      {/* Last triggered */}
      {rule.lastTriggeredAt && (
        <div className="shrink-0 hidden lg:block">
          <span className="text-[10px] text-amber-600">⚡ {fmtRelTime(rule.lastTriggeredAt)}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(rule)}
          title="Edit rule"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDelete(rule)}
          title="Delete rule"
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Evaluation results panel ──────────────────────────────────────────────────

function EvalResults({
  result,
}: {
  result: EvaluationBatchResult;
}) {
  const [expanded, setExpanded] = useState(true);

  const triggered = result.results.filter((r) => r.triggered);
  const ok        = result.results.filter((r) => r.status === "ok");
  const disabled  = result.results.filter((r) => r.status === "disabled");
  const unknown   = result.results.filter((r) => r.status === "unknown");

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs">
          <XCircle className="h-3.5 w-3.5 text-red-500" />
          <span className="font-semibold text-red-600">{triggered.length} triggered</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          {ok.length} OK
        </div>
        {disabled.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BellOff className="h-3.5 w-3.5" />
            {disabled.length} disabled
          </div>
        )}
        {unknown.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            {unknown.length} unknown
          </div>
        )}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {/* Timestamp + snapshot severity */}
      <p className="text-[11px] text-muted-foreground">
        Snapshot severity: <strong>{result.snapshotSeverity}</strong> ·{" "}
        Evaluated {fmtRelTime(result.generatedAt)} ·{" "}
        Environment: {result.environment}
      </p>

      {/* No-notifications banner */}
      <div className="flex items-start gap-2 p-2.5 rounded border border-blue-400/20 bg-blue-500/5 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          <strong>No notifications were sent.</strong>{" "}
          This is a manual evaluation preview.
          Background checks and real notifications come in Sprint 16.
        </span>
      </div>

      {/* Per-rule results */}
      {expanded && (
        <div className="space-y-1.5">
          {result.results.map((r) => {
            const isSevCritical = r.severity === "critical";
            return (
              <div
                key={r.ruleId}
                className={`flex items-start gap-2 px-3 py-2 rounded border text-xs
                  ${r.triggered
                    ? isSevCritical
                      ? "border-red-400/30 bg-red-500/5"
                      : "border-amber-400/30 bg-amber-500/5"
                    : r.status === "disabled"
                    ? "border-border/50 bg-muted/10"
                    : "border-green-400/20 bg-green-500/5"
                  }`}
              >
                <EvalStatusBadge status={r.status as keyof typeof EVAL_STATUS_COLORS} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{r.ruleName}</span>
                  <span className="text-muted-foreground ml-2">{r.message}</span>
                </div>
                <SeverityBadge severity={r.severity} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProjectAlertRulesPanel({ projectId }: Props) {
  const [rules,          setRules]          = useState<AlertRule[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [flashMsg,       setFlashMsg]       = useState<string | null>(null);

  // Create/Edit form
  const [formMode,       setFormMode]       = useState<"create" | "edit" | null>(null);
  const [editingRuleId,  setEditingRuleId]  = useState<string | null>(null);
  const [formInitial,    setFormInitial]    = useState<FormState>(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);

  // Delete confirm
  const [deleteTarget,   setDeleteTarget]   = useState<AlertRule | null>(null);
  const [deleting,       setDeleting]       = useState(false);

  // Toggle
  const [togglingId,     setTogglingId]     = useState<string | null>(null);

  // Default rules
  const [creatingDefaults, setCreatingDefaults] = useState(false);

  // Evaluation
  const [evaluating,     setEvaluating]     = useState(false);
  const [evalResult,     setEvalResult]     = useState<EvaluationBatchResult | null>(null);
  const [evalError,      setEvalError]      = useState<string | null>(null);

  const [, startTransition] = useTransition();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 3000);
  }

  // ── Load rules ──────────────────────────────────────────────────────────────

  const loadRules = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const res = await getProjectAlertRulesAction(projectId);
      setLoading(false);
      if (res.ok) setRules(res.data);
      else        setError(res.error);
    });
  }, [projectId]);

  useEffect(() => { loadRules(); }, [loadRules]);

  // ── Create defaults ─────────────────────────────────────────────────────────

  function handleCreateDefaults() {
    setCreatingDefaults(true);
    startTransition(async () => {
      const res = await createDefaultProjectAlertRulesAction(projectId);
      setCreatingDefaults(false);
      if (res.ok) {
        flash(res.data.created > 0
          ? `Created ${res.data.created} recommended rule${res.data.created !== 1 ? "s" : ""}.`
          : "All recommended rules already exist.");
        loadRules();
      } else {
        setError(res.error);
      }
    });
  }

  // ── Toggle enable/disable ───────────────────────────────────────────────────

  function handleToggle(rule: AlertRule) {
    setTogglingId(rule.id);
    startTransition(async () => {
      const res = await updateProjectAlertRuleAction({
        projectId,
        ruleId:  rule.id,
        enabled: !rule.enabled,
      });
      setTogglingId(null);
      if (res.ok) {
        setRules((prev) => prev.map((r) => r.id === rule.id ? res.data : r));
        flash(`"${rule.name}" ${res.data.enabled ? "enabled" : "disabled"}.`);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Open edit form ──────────────────────────────────────────────────────────

  function handleEdit(rule: AlertRule) {
    setFormMode("edit");
    setEditingRuleId(rule.id);
    setFormInitial(ruleToForm(rule));
    setDeleteTarget(null);
  }

  // ── Open create form ────────────────────────────────────────────────────────

  function handleCreateNew() {
    setFormMode("create");
    setEditingRuleId(null);
    setFormInitial(EMPTY_FORM);
    setDeleteTarget(null);
  }

  // ── Save (create or update) ──────────────────────────────────────────────────

  function handleSave(form: FormState) {
    setSaving(true);
    startTransition(async () => {
      if (formMode === "create") {
        const res = await createProjectAlertRuleAction({
          projectId,
          name:     form.name,
          type:     form.type,
          severity: form.severity,
          enabled:  form.enabled,
          config:   formToConfig(form),
        });
        setSaving(false);
        if (res.ok) {
          setRules((prev) => [...prev, res.data]);
          setFormMode(null);
          flash(`Rule "${res.data.name}" created.`);
        } else {
          setError(res.error);
        }
      } else if (formMode === "edit" && editingRuleId) {
        const res = await updateProjectAlertRuleAction({
          projectId,
          ruleId:   editingRuleId,
          name:     form.name,
          severity: form.severity,
          enabled:  form.enabled,
          config:   formToConfig(form),
        });
        setSaving(false);
        if (res.ok) {
          setRules((prev) => prev.map((r) => r.id === editingRuleId ? res.data : r));
          setFormMode(null);
          setEditingRuleId(null);
          flash(`Rule "${res.data.name}" updated.`);
        } else {
          setError(res.error);
        }
      }
    });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function handleDelete(rule: AlertRule) {
    setDeleteTarget(rule);
    setFormMode(null);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    startTransition(async () => {
      const res = await deleteProjectAlertRuleAction({
        projectId,
        ruleId: deleteTarget.id,
      });
      setDeleting(false);
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
        flash(`Rule "${deleteTarget.name}" deleted.`);
        setDeleteTarget(null);
      } else {
        setError(res.error);
      }
    });
  }

  // ── Evaluate ────────────────────────────────────────────────────────────────

  function handleEvaluate() {
    setEvaluating(true);
    setEvalError(null);
    startTransition(async () => {
      const res = await evaluateProjectAlertRulesAction({ projectId });
      setEvaluating(false);
      if (res.ok) {
        setEvalResult(res.data);
        // Refresh rule list so lastCheckedAt / lastStatus are up to date
        loadRules();
      } else {
        setEvalError(res.error);
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* ── Sprint 15 info banner ── */}
      <div className="flex items-start gap-2 p-3 rounded border border-blue-400/20 bg-blue-500/5 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          <strong>Sprint 15:</strong> alert evaluation is manual.
          Background checks and real notifications will be added in Sprint 16.
        </span>
      </div>

      {/* ── Flash message ── */}
      {flashMsg && (
        <div className="flex items-center gap-2 p-2 rounded border border-green-400/20 bg-green-500/5 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {flashMsg}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Alert Rules</h3>
          {!loading && (
            <span className="text-[11px] text-muted-foreground">
              ({rules.filter((r) => r.enabled).length} enabled / {rules.length} total)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rules.length === 0 && !loading && (
            <button
              onClick={handleCreateDefaults}
              disabled={creatingDefaults}
              className="flex items-center gap-1 text-xs border border-border rounded px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40"
            >
              {creatingDefaults ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Create recommended rules
            </button>
          )}
          {rules.length > 0 && (
            <button
              onClick={handleCreateDefaults}
              disabled={creatingDefaults}
              title="Add any missing recommended rules"
              className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-1 hover:bg-muted transition-colors disabled:opacity-40"
            >
              {creatingDefaults ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Add recommended
            </button>
          )}
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1 text-xs border border-border rounded px-2 py-1 hover:bg-muted transition-colors"
          >
            <Plus className="h-3 w-3" />
            Create rule
          </button>
          <button
            onClick={handleEvaluate}
            disabled={evaluating || rules.length === 0}
            className="flex items-center gap-1 text-xs bg-primary text-primary-foreground rounded px-2 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {evaluating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run alert check now
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading rules…
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && rules.length === 0 && formMode === null && (
        <div className="flex flex-col items-center text-center py-6 gap-2 rounded border border-dashed border-border">
          <BellOff className="h-7 w-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No alert rules yet.</p>
          <p className="text-xs text-muted-foreground/60">Create recommended rules or add one manually.</p>
        </div>
      )}

      {/* ── Create form (at top when creating) ── */}
      {formMode === "create" && (
        <RuleForm
          initial={formInitial}
          onSave={handleSave}
          onCancel={() => setFormMode(null)}
          saving={saving}
        />
      )}

      {/* ── Rules list ── */}
      {!loading && rules.length > 0 && (
        <div className="space-y-1.5">
          {rules.map((rule) => (
            <div key={rule.id}>
              {deleteTarget?.id === rule.id ? (
                <DeleteConfirm
                  ruleName={rule.name}
                  onConfirm={handleConfirmDelete}
                  onCancel={() => setDeleteTarget(null)}
                  deleting={deleting}
                />
              ) : formMode === "edit" && editingRuleId === rule.id ? (
                <RuleForm
                  initial={formInitial}
                  onSave={handleSave}
                  onCancel={() => { setFormMode(null); setEditingRuleId(null); }}
                  saving={saving}
                />
              ) : (
                <RuleRow
                  rule={rule}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  toggling={togglingId === rule.id}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Evaluation error ── */}
      {evalError && (
        <div className="flex items-start gap-2 p-3 rounded border bg-destructive/10 border-destructive/20 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Evaluation failed: {evalError}</span>
        </div>
      )}

      {/* ── Evaluation results ── */}
      {evalResult && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Last Evaluation Results
          </p>
          <EvalResults result={evalResult} />
        </div>
      )}
    </div>
  );
}
