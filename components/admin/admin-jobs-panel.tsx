"use client";

/**
 * components/admin/admin-jobs-panel.tsx
 *
 * Sprint 35: Jobs table with retry/cancel/mark-stale/prune.
 * Sprint 36: New Job modal, job details drawer, scheduler controls, empty state CTA.
 *
 * Safety rules:
 *  - storage_cleanup excluded from manual job runner
 *  - All job creation goes through server-side allowlisted templates
 *  - No raw env values or secrets rendered
 *  - All actions require OWNER/ADMIN (enforced server-side)
 */

import { useState, useEffect, useCallback } from "react";
import Link                                 from "next/link";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Activity,
  XCircle,
  RotateCcw,
  Trash2,
  AlertCircle,
  ChevronRight,
  Plus,
  X,
  Copy,
  Check,
  Zap,
  Info,
} from "lucide-react";
import { cn }                from "@/lib/utils";
import {
  listAdminJobsAction,
  retryAdminJobAction,
  cancelAdminJobAction,
  markStaleJobsAction,
  pruneOldJobsAction,
  getJobTemplatesAction,
  createBackgroundJobFromTemplateAction,
  getJobDetailsAction,
  getProjectsForJobTemplateAction,
  getSchedulerStatusAction,
  type ProjectForTemplate,
  type SchedulerStatusInfo,
} from "@/app/actions/admin-jobs";
import type {
  BackgroundJobDTO,
  JobStatus,
} from "@/lib/jobs/background-job-types";
import type { JobTemplatePublic } from "@/lib/jobs/background-job-templates";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "all" | "running" | "queued" | "failed" | "stale" | "success";

const TABS: { key: Tab; label: string }[] = [
  { key: "all",     label: "All" },
  { key: "running", label: "Running" },
  { key: "queued",  label: "Queued" },
  { key: "failed",  label: "Failed" },
  { key: "stale",   label: "Stale" },
  { key: "success", label: "Done" },
];

const TAB_STATUSES: Record<Tab, JobStatus[]> = {
  all:     [],
  running: ["running"],
  queued:  ["queued", "retrying"],
  failed:  ["failed"],
  stale:   ["stale"],
  success: ["success"],
};

type JobDetailJob = BackgroundJobDTO & { safeMetadata: Record<string, unknown> | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0)           return "just now";
  if (ms < 60_000)      return "just now";
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtAbsolute(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtJobType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Status badge ──────────────────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: JobStatus | string }) {
  const map: Record<string, string> = {
    queued:    "bg-blue-50    text-blue-700   border-blue-200",
    running:   "bg-purple-50  text-purple-700 border-purple-200",
    retrying:  "bg-orange-50  text-orange-700 border-orange-200",
    success:   "bg-green-50   text-green-700  border-green-200",
    failed:    "bg-red-50     text-red-700    border-red-200",
    cancelled: "bg-gray-50    text-gray-500   border-gray-200",
    stale:     "bg-yellow-50  text-yellow-700 border-yellow-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border",
      map[status] ?? "bg-gray-50 text-gray-500 border-gray-200",
    )}>
      {status}
    </span>
  );
}

// ── Overview card ─────────────────────────────────────────────────────────────

function OverviewCard({
  label, value, accent, onClick,
}: {
  label:   string;
  value:   number;
  accent?: "red" | "yellow" | "green" | "blue" | "purple";
  onClick?: () => void;
}) {
  const accentCls =
    accent === "red"    ? "border-l-red-500"    :
    accent === "yellow" ? "border-l-yellow-500" :
    accent === "green"  ? "border-l-green-500"  :
    accent === "blue"   ? "border-l-blue-500"   :
    accent === "purple" ? "border-l-purple-500" :
    "border-l-border";

  const inner = (
    <div className={cn(
      "rounded-lg border border-l-4 bg-card p-3 min-w-0 flex flex-col gap-0.5",
      accentCls,
      onClick && "cursor-pointer hover:bg-accent/50 transition-colors",
    )}>
      <span className="text-xs text-muted-foreground font-medium truncate">{label}</span>
      <span className="text-2xl font-bold leading-none">{value}</span>
    </div>
  );

  return onClick
    ? <button className="text-left w-full min-w-0" onClick={onClick}>{inner}</button>
    : inner;
}

// ── Scheduler status chip ─────────────────────────────────────────────────────

function SchedulerChip({ s }: { s: SchedulerStatusInfo }) {
  const map = {
    running: "bg-green-50  text-green-700  border-green-200",
    stale:   "bg-yellow-50 text-yellow-700 border-yellow-200",
    unknown: "bg-gray-50   text-gray-500   border-gray-200",
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border shrink-0",
          map[s.status],
        )}>
          {s.status}
        </span>
        <span className="text-sm font-medium truncate">{s.label}</span>
      </div>
      <div className="text-xs text-muted-foreground text-right shrink-0">
        {s.lastHeartbeatAt
          ? <>{fmtRelative(s.lastHeartbeatAt)}{s.tickCount !== undefined && ` · ${s.tickCount} ticks`}</>
          : "no heartbeat yet"
        }
      </div>
    </div>
  );
}

// ── Job Details Drawer ────────────────────────────────────────────────────────

function JobDetailsDrawer({
  job,
  onClose,
  onRetry,
  onCancel,
}: {
  job:      JobDetailJob;
  onClose:  () => void;
  onRetry:  (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const canRetry  = ["failed", "stale", "cancelled"].includes(job.status) && job.jobType !== "storage_cleanup";
  const canCancel = ["queued", "retrying"].includes(job.status);

  function copyError() {
    const text = [
      `Job: ${job.title}`,
      `Type: ${job.jobType}`,
      `Status: ${job.status}`,
      `Error: ${job.lastError ?? "none"}`,
      `Attempts: ${job.attempts}/${job.maxAttempts}`,
      `Ref: ${job.jobRef}`,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => null);
  }

  const fields: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Job Ref",      value: job.jobRef },
    { label: "Type",         value: fmtJobType(job.jobType) },
    { label: "Status",       value: job.status },
    { label: "Project",      value: job.projectName ?? (job.projectId ? job.projectId : "global") },
    { label: "Scheduled",    value: fmtAbsolute(job.scheduledFor) },
    { label: "Started",      value: fmtAbsolute(job.startedAt) },
    { label: "Completed",    value: fmtAbsolute(job.completedAt) },
    { label: "Duration",     value: fmtDuration(job.durationMs) },
    { label: "Attempts",     value: `${job.attempts} / ${job.maxAttempts}` },
    { label: "Created",      value: fmtAbsolute(job.createdAt) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside className="w-full max-w-md bg-background border-l shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{job.title}</h2>
            {job.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{job.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status + actions */}
          <div className="flex items-center gap-2">
            <JobStatusBadge status={job.status} />
            {canRetry && (
              <button
                onClick={() => { onRetry(job.id); onClose(); }}
                className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-xs hover:bg-accent transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => { onCancel(job.id); onClose(); }}
                className="inline-flex items-center gap-1 rounded border border-red-200 bg-background px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                <XCircle className="h-3 w-3" /> Cancel
              </button>
            )}
          </div>

          {/* Fields */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {fields.map(({ label, value }) => (
              <div key={label} className={label === "Job Ref" ? "col-span-2" : ""}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={cn(
                  "text-sm font-medium break-all",
                  label === "Job Ref" && "font-mono text-xs",
                )}>
                  {value || "—"}
                </dd>
              </div>
            ))}
          </dl>

          {/* Last log line */}
          {job.lastLogLine && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Last Output</p>
              <p className="text-xs bg-muted rounded p-2 font-mono break-all">{job.lastLogLine}</p>
            </div>
          )}

          {/* Error */}
          {job.lastError && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-red-600">Error</p>
                <button
                  onClick={copyError}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs bg-red-50 border border-red-200 rounded p-2 font-mono text-red-700 break-all">
                {job.lastError}
              </p>
            </div>
          )}

          {/* Safe metadata */}
          {job.safeMetadata && Object.keys(job.safeMetadata).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Job Metadata</p>
              <dl className="space-y-1">
                {Object.entries(job.safeMetadata).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2 text-xs">
                    <dt className="text-muted-foreground w-28 shrink-0">{k}</dt>
                    <dd className="font-mono break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── New Job Modal ─────────────────────────────────────────────────────────────

function NewJobModal({
  onClose,
  onCreated,
}: {
  onClose:   () => void;
  onCreated: (jobId: string) => void;
}) {
  const [templates,    setTemplates]    = useState<JobTemplatePublic[]>([]);
  const [projects,     setProjects]     = useState<ProjectForTemplate[]>([]);
  const [loadingMeta,  setLoadingMeta]  = useState(true);

  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedProject,  setSelectedProject]  = useState<string>("");
  const [confirmation,     setConfirmation]      = useState<string>("");
  const [submitting,       setSubmitting]        = useState(false);
  const [error,            setError]             = useState<string | null>(null);

  // Load templates + projects on mount
  useEffect(() => {
    setLoadingMeta(true);
    Promise.all([
      getJobTemplatesAction(),
      getProjectsForJobTemplateAction(),
    ]).then(([tRes, pRes]) => {
      if (tRes.ok) setTemplates(tRes.templates);
      if (pRes.ok) setProjects(pRes.projects);
    }).catch(() => null).finally(() => setLoadingMeta(false));
  }, []);

  const template = templates.find((t) => t.id === selectedTemplate) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTemplate) return;
    setSubmitting(true);
    setError(null);

    const res = await createBackgroundJobFromTemplateAction({
      templateId:   selectedTemplate,
      projectId:    template?.requiresProject ? selectedProject : undefined,
      confirmation: template?.requiresConfirmation ? confirmation : undefined,
    }).catch(() => ({ ok: false as const, error: "Request failed" }));

    if (res.ok) {
      onCreated(res.jobId);
      onClose();
    } else {
      setError(res.error);
    }
    setSubmitting(false);
  }

  const canSubmit =
    selectedTemplate !== "" &&
    (!template?.requiresProject || selectedProject !== "") &&
    (!template?.requiresConfirmation || confirmation === template?.confirmationText);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-background rounded-lg border shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold">New Background Job</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingMeta ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <form id="new-job-form" onSubmit={handleSubmit} className="space-y-5">

              {/* Template selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Job Template</label>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {templates.map((t) => (
                    <label
                      key={t.id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                        selectedTemplate === t.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={t.id}
                        checked={selectedTemplate === t.id}
                        onChange={() => {
                          setSelectedTemplate(t.id);
                          setSelectedProject("");
                          setConfirmation("");
                          setError(null);
                        }}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">{t.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {t.requiresProject && (
                            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                              requires project
                            </span>
                          )}
                          {t.requiresConfirmation && (
                            <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded px-1.5 py-0.5">
                              confirmation required
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Project selector (conditional) */}
              {template?.requiresProject && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="project-select">
                    Project <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="project-select"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  >
                    <option value="">— Select a project —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Confirmation (conditional) */}
              {template?.requiresConfirmation && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="confirmation-input">
                    Confirmation <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {template.confirmationHint ?? `Type ${template.confirmationText} to confirm`}
                  </p>
                  <input
                    id="confirmation-input"
                    type="text"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={template.confirmationText}
                    className={cn(
                      "w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring",
                      confirmation && confirmation !== template.confirmationText && "border-red-300",
                    )}
                    autoComplete="off"
                    required
                  />
                  {confirmation && confirmation !== template.confirmationText && (
                    <p className="text-xs text-red-500">
                      Must match exactly: <span className="font-mono font-semibold">{template.confirmationText}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border bg-background px-4 py-2 text-sm hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-job-form"
            disabled={submitting || loadingMeta || !canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
              : <><Zap className="h-3.5 w-3.5" /> Queue Job</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({
  job,
  onRetry,
  onCancel,
  onSelect,
  retrying,
  cancelling,
}: {
  job:        BackgroundJobDTO;
  onRetry:    (id: string) => void;
  onCancel:   (id: string) => void;
  onSelect:   (id: string) => void;
  retrying:   Set<string>;
  cancelling: Set<string>;
}) {
  const canRetry  = ["failed", "stale", "cancelled"].includes(job.status) && job.jobType !== "storage_cleanup";
  const canCancel = ["queued", "retrying"].includes(job.status);

  return (
    <tr
      className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onSelect(job.id)}
    >
      <td className="px-3 py-2">
        <div className="text-sm font-medium truncate max-w-[180px]">{job.title}</div>
        <div className="text-xs text-muted-foreground">{fmtJobType(job.jobType)}</div>
      </td>
      <td className="px-3 py-2">
        <JobStatusBadge status={job.status} />
        {job.attempts > 1 && (
          <span className="ml-1 text-xs text-muted-foreground">×{job.attempts}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {job.projectName
          ? <Link
              href={`/projects/${job.projectId}`}
              className="hover:underline text-foreground"
              onClick={(e) => e.stopPropagation()}
            >{job.projectName}</Link>
          : <span className="italic">global</span>
        }
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {job.startedAt ? fmtRelative(job.startedAt) : fmtRelative(job.createdAt)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {fmtDuration(job.durationMs)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[140px]">
        {job.lastError && (
          <span className="text-red-600" title={job.lastError}>
            {job.lastError.slice(0, 70)}
          </span>
        )}
        {!job.lastError && job.lastLogLine && (
          <span>{job.lastLogLine.slice(0, 70)}</span>
        )}
      </td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          {canRetry && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(job.id); }}
              disabled={retrying.has(job.id)}
              title={job.jobType === "storage_cleanup"
                ? "Storage cleanup must be re-initiated from the project Storage Center"
                : "Re-queue this job"}
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {retrying.has(job.id)
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCcw className="h-3 w-3" />}
              Retry
            </button>
          )}
          {canCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(job.id); }}
              disabled={cancelling.has(job.id)}
              title="Cancel this job"
              className="inline-flex items-center gap-1 rounded border border-red-200 bg-background px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {cancelling.has(job.id)
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <XCircle className="h-3 w-3" />}
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminJobsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [page, setPage]           = useState(1);
  const [jobs, setJobs]           = useState<BackgroundJobDTO[]>([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  const [hasEverLoaded, setHasEverLoaded] = useState(false);

  // Summary counts
  const [summary, setSummary] = useState({ active: 0, queued: 0, failed: 0, stale: 0, success: 0 });

  // Scheduler status
  const [schedulers, setSchedulers] = useState<SchedulerStatusInfo[]>([]);

  // Action state
  const [retrying,   setRetrying]   = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [actionMsg,  setActionMsg]  = useState<{ text: string; ok: boolean } | null>(null);
  const [markingStale, setMarkingStale] = useState(false);
  const [pruning,      setPruning]      = useState(false);

  // Modal / drawer
  const [showNewJob,  setShowNewJob]  = useState(false);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [detailJob,   setDetailJob]   = useState<JobDetailJob | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async (tab: Tab = activeTab, p: number = page) => {
    setLoading(true);
    setError(null);

    const statuses = TAB_STATUSES[tab];

    try {
      const [result, activeRes, queuedRes, failedRes, staleRes, successRes, schRes] = await Promise.all([
        listAdminJobsAction({ status: statuses.length ? statuses : undefined, page: p, pageSize: 25 }),
        listAdminJobsAction({ status: ["running"],           page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["queued","retrying"], page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["failed"],            page: 1, pageSize: 1 }),
        listAdminJobsAction({ status: ["stale"],             page: 1, pageSize: 1 }),
        listAdminJobsAction({
          status: ["success"],
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          page: 1, pageSize: 1,
        }),
        getSchedulerStatusAction(),
      ]);

      if (!result.ok) { setError(result.error); return; }

      setJobs(result.result.jobs);
      setTotal(result.result.total);
      setTotalPages(result.result.totalPages);
      setLastLoaded(new Date().toISOString());
      setHasEverLoaded(true);

      setSummary({
        active:  activeRes.ok  ? activeRes.result.total  : 0,
        queued:  queuedRes.ok  ? queuedRes.result.total  : 0,
        failed:  failedRes.ok  ? failedRes.result.total  : 0,
        stale:   staleRes.ok   ? staleRes.result.total   : 0,
        success: successRes.ok ? successRes.result.total : 0,
      });

      if (schRes.ok) setSchedulers(schRes.schedulers);
    } catch {
      setError("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    loadJobs(activeTab, page);
  }, [activeTab, page, loadJobs]);

  // Auto-refresh every 15s when there are active/queued jobs
  useEffect(() => {
    const timer = setInterval(() => {
      if (summary.active > 0 || summary.queued > 0) {
        loadJobs(activeTab, page);
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [summary.active, summary.queued, activeTab, page, loadJobs]);

  // ── Detail drawer ────────────────────────────────────────────────────────────

  async function openDetail(jobId: string) {
    setDetailJobId(jobId);
    setDetailJob(null);
    setLoadingDetail(true);
    const res = await getJobDetailsAction(jobId).catch(() => null);
    if (res?.ok) setDetailJob(res.job);
    setLoadingDetail(false);
  }

  function closeDetail() {
    setDetailJobId(null);
    setDetailJob(null);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleRetry(jobId: string) {
    setRetrying((s) => new Set(s).add(jobId));
    setActionMsg(null);
    const res = await retryAdminJobAction(jobId).catch(() => ({ ok: false as const, error: "Request failed" }));
    setActionMsg(res.ok
      ? { text: "Job re-queued successfully.", ok: true }
      : { text: `Retry failed: ${(res as { ok: false; error: string }).error}`, ok: false });
    if (res.ok) await loadJobs();
    setRetrying((s) => { const n = new Set(s); n.delete(jobId); return n; });
  }

  async function handleCancel(jobId: string) {
    setCancelling((s) => new Set(s).add(jobId));
    setActionMsg(null);
    const res = await cancelAdminJobAction(jobId).catch(() => ({ ok: false as const, error: "Request failed" }));
    setActionMsg(res.ok
      ? { text: "Job cancelled.", ok: true }
      : { text: `Cancel failed: ${(res as { ok: false; error: string }).error}`, ok: false });
    if (res.ok) await loadJobs();
    setCancelling((s) => { const n = new Set(s); n.delete(jobId); return n; });
  }

  async function handleMarkStale() {
    setMarkingStale(true);
    setActionMsg(null);
    const res = await markStaleJobsAction().catch(() => ({ ok: false as const, error: "Request failed" }));
    setActionMsg(res.ok
      ? { text: `Marked ${(res as { ok: true; markedStale: number }).markedStale} job(s) as stale.`, ok: true }
      : { text: `Failed: ${(res as { ok: false; error: string }).error}`, ok: false });
    if (res.ok) await loadJobs();
    setMarkingStale(false);
  }

  async function handlePrune() {
    if (!confirm("Delete all old completed job records per retention policy? This cannot be undone.")) return;
    setPruning(true);
    setActionMsg(null);
    const res = await pruneOldJobsAction().catch(() => ({ ok: false as const, error: "Request failed" }));
    setActionMsg(res.ok
      ? { text: `Pruned ${(res as { ok: true; pruned: number }).pruned} old job record(s).`, ok: true }
      : { text: `Failed: ${(res as { ok: false; error: string }).error}`, ok: false });
    if (res.ok) await loadJobs();
    setPruning(false);
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setPage(1);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Modals / Drawers */}
      {showNewJob && (
        <NewJobModal
          onClose={() => setShowNewJob(false)}
          onCreated={async () => {
            setActionMsg({ text: "Job queued! It will run within 30 seconds.", ok: true });
            handleTabChange("queued");
            await loadJobs("queued", 1);
          }}
        />
      )}

      {detailJobId && (
        <div className="fixed inset-0 z-40">
          {loadingDetail || !detailJob ? (
            <div
              className="absolute inset-0 bg-black/20 flex items-center justify-center"
              onClick={closeDetail}
            >
              <div className="bg-background rounded-lg border p-6 flex items-center gap-3 shadow-xl">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading job details…</span>
              </div>
            </div>
          ) : (
            <JobDetailsDrawer
              job={detailJob}
              onClose={closeDetail}
              onRetry={(id) => { handleRetry(id); }}
              onCancel={(id) => { handleCancel(id); }}
            />
          )}
        </div>
      )}

      {/* Overview cards — fixed 5-col grid on large screens, 2+3 on medium */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <OverviewCard label="Active"        value={summary.active}  accent="purple" onClick={() => handleTabChange("running")} />
        <OverviewCard label="Queued"        value={summary.queued}  accent="blue"   onClick={() => handleTabChange("queued")} />
        <OverviewCard label="Failed (24h)"  value={summary.failed}  accent="red"    onClick={() => handleTabChange("failed")} />
        <OverviewCard label="Stale"         value={summary.stale}   accent="yellow" onClick={() => handleTabChange("stale")} />
        <OverviewCard label="Done (24h)"    value={summary.success} accent="green"  onClick={() => handleTabChange("success")} />
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={cn(
          "flex items-center gap-2 rounded border px-3 py-2 text-sm",
          actionMsg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800",
        )}>
          {actionMsg.ok
            ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            : <AlertCircle  className="h-4 w-4 text-red-500    shrink-0" />}
          {actionMsg.text}
          <button onClick={() => setActionMsg(null)} className="ml-auto text-current opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* Jobs table */}
      <div className="rounded-lg border bg-card">
        {/* Controls row */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
          {/* Tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  activeTab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            {lastLoaded && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {fmtRelative(lastLoaded)}
              </span>
            )}
            <button
              onClick={() => loadJobs(activeTab, page)}
              disabled={loading}
              title="Refresh"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </button>
            <button
              onClick={handleMarkStale}
              disabled={markingStale}
              title="Force-mark expired running jobs as stale"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              {markingStale ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
              Mark Stale
            </button>
            <button
              onClick={handlePrune}
              disabled={pruning}
              title="Delete old completed job records per retention policy"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-50"
            >
              {pruning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Prune
            </button>
            <button
              onClick={() => setShowNewJob(true)}
              className="inline-flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Job
            </button>
          </div>
        </div>

        {/* Table */}
        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading jobs…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 px-4 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : jobs.length === 0 && hasEverLoaded ? (
          <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
            <div className="rounded-full bg-muted p-3">
              <Activity className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No jobs yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {activeTab === "all"
                  ? "Background jobs will appear here as they run."
                  : `No jobs in the "${activeTab}" category.`}
              </p>
            </div>
            {activeTab === "all" && (
              <button
                onClick={() => setShowNewJob(true)}
                className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create your first background job
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Job</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Output</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onRetry={handleRetry}
                    onCancel={handleCancel}
                    onSelect={openDetail}
                    retrying={retrying}
                    cancelling={cancelling}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground text-xs">
              {total} job{total !== 1 ? "s" : ""} · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scheduler Controls */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            Scheduler Status
          </h2>
          <button
            onClick={() => loadJobs(activeTab, page)}
            disabled={loading}
            title="Refresh scheduler status"
            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>

        {schedulers.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Scheduler status will appear here after the first tick (~30s after server start).
          </div>
        ) : (
          <div>
            {schedulers.map((s) => (
              <SchedulerChip key={s.name} s={s} />
            ))}
          </div>
        )}

        {/* Quick action buttons */}
        <div className="pt-2 border-t flex flex-wrap gap-2">
          <button
            onClick={() => setShowNewJob(true)}
            className="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-1.5 text-xs hover:bg-accent transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Job
          </button>
          <button
            onClick={handleMarkStale}
            disabled={markingStale}
            className="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {markingStale ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
            Mark Stale Jobs
          </button>
          <button
            onClick={handlePrune}
            disabled={pruning}
            className="inline-flex items-center gap-1.5 rounded border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-50 transition-colors"
          >
            {pruning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Prune Old Jobs
          </button>
        </div>
      </div>
    </div>
  );
}
