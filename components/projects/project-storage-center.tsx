"use client";

/**
 * components/projects/project-storage-center.tsx
 *
 * Sprint 34: Storage Center for a single project.
 *
 * Sections:
 *  1. Storage Summary — source, releases, backups totals + bar chart
 *  2. Cleanup Plan — list of eligible items with sizes
 *  3. CLEANUP Confirmation — typed confirmation required to execute
 *  4. Policy Settings — retention knobs (collapsible)
 *  5. Cleanup History — recent audit events for this project (storage category)
 *
 * Loading: report and plan are fetched client-side after mount.
 * Destructive: cleanup requires typing "CLEANUP" in a text field.
 */

import { useState, useEffect, useCallback } from "react";
import { HardDrive, RefreshCw, ShieldCheck, Trash2, AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight } from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Switch }   from "@/components/ui/switch";
import { cn }       from "@/lib/utils";
import {
  getProjectStorageReportAction,
  getProjectCleanupPlanAction,
  runProjectCleanupAction,
  saveProjectStoragePolicyAction,
} from "@/app/actions/project-storage";
import type {
  ProjectStorageReport,
  StorageCleanupPlan,
  CleanupResult,
  ProjectStoragePolicyDTO,
} from "@/lib/storage/storage-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1024)        return `${b} B`;
  if (b < 1024 ** 2)   return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)   return `${(b / (1024 ** 2)).toFixed(1)} MB`;
  return `${(b / (1024 ** 3)).toFixed(2)} GB`;
}

function fmtRelative(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)      return "just now";
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Storage bar ────────────────────────────────────────────────────────────────

function StorageBar({ source, releases, backups }: { source: number; releases: number; backups: number }) {
  const total = source + releases + backups;
  if (total === 0) return <div className="h-3 rounded-full bg-muted" />;
  const sp = (source   / total * 100).toFixed(1);
  const rp = (releases / total * 100).toFixed(1);
  const bp = (backups  / total * 100).toFixed(1);
  return (
    <div className="h-3 rounded-full overflow-hidden flex gap-0.5">
      {source   > 0 && <div className="bg-blue-500 h-full rounded-l-full" style={{ width: `${sp}%` }} title={`Source: ${fmtBytes(source)}`} />}
      {releases > 0 && <div className="bg-violet-500 h-full"              style={{ width: `${rp}%` }} title={`Releases: ${fmtBytes(releases)}`} />}
      {backups  > 0 && <div className="bg-amber-500 h-full rounded-r-full" style={{ width: `${bp}%` }} title={`Backups: ${fmtBytes(backups)}`} />}
    </div>
  );
}

// ── Section skeleton ───────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "loading"
  | "ready"
  | "confirming"   // showing the CLEANUP confirmation dialog
  | "running"
  | "done"
  | "error";

export function ProjectStorageCenter({ projectId }: { projectId: string }) {
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [report,      setReport]      = useState<ProjectStorageReport | null>(null);
  const [plan,        setPlan]        = useState<StorageCleanupPlan    | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult    | null>(null);
  const [errMsg,      setErrMsg]      = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [policyOpen,  setPolicyOpen]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null);

  // Policy edit state (mirrors the loaded policy)
  const [policyDraft, setPolicyDraft] = useState<ProjectStoragePolicyDTO | null>(null);

  // ── Initial load ─────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setPhase("loading");
    setErrMsg(null);
    const [reportRes, planRes] = await Promise.all([
      getProjectStorageReportAction(projectId),
      getProjectCleanupPlanAction(projectId),
    ]);
    if (!reportRes.ok) { setErrMsg(reportRes.error); setPhase("error"); return; }
    setReport(reportRes.report);
    setPolicyDraft({ ...reportRes.report.policy });
    if (planRes.ok) setPlan(planRes.plan);
    setPhase("ready");
  }, [projectId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Run cleanup ───────────────────────────────────────────────────────────────

  async function handleRunCleanup() {
    setPhase("running");
    const res = await runProjectCleanupAction(projectId, confirmation);
    if (!res.ok) { setErrMsg(res.error); setPhase("error"); return; }
    setCleanupResult(res.result);
    setPhase("done");
  }

  // ── Save policy ───────────────────────────────────────────────────────────────

  async function handleSavePolicy() {
    if (!policyDraft) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await saveProjectStoragePolicyAction(projectId, policyDraft);
    setSaving(false);
    if (res.ok) { setSaveMsg("Policy saved."); await loadAll(); }
    else        setSaveMsg(`Error: ${res.error}`);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Storage Center</h2>
        </div>
        {phase === "ready" && (
          <Button variant="ghost" size="sm" onClick={loadAll} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        )}
      </div>

      {/* Error state */}
      {phase === "error" && errMsg && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{errMsg}</span>
        </div>
      )}

      {/* Loading skeletons */}
      {phase === "loading" && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {/* Done */}
      {phase === "done" && cleanupResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Cleanup complete — freed {fmtBytes(cleanupResult.totalBytesFreed)}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>{cleanupResult.deletedItems.length} item(s) deleted.</div>
            {cleanupResult.failedItems.length > 0 && (
              <div className="text-amber-600">{cleanupResult.failedItems.length} item(s) failed.</div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => { setPhase("loading"); setCleanupResult(null); setConfirmation(""); loadAll(); }}>
            Back to Storage Center
          </Button>
        </div>
      )}

      {/* Main content */}
      {(phase === "ready" || phase === "confirming" || phase === "running") && report && (
        <>
          {/* Storage summary */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Usage Summary</h3>
            <StorageBar
              source={report.totals.sourceBytes}
              releases={report.totals.releasesBytes}
              backups={report.totals.backupsBytes}
            />
            <div className="grid grid-cols-3 gap-3 text-center">
              <SummaryTile label="Source" bytes={report.totals.sourceBytes} color="blue" />
              <SummaryTile label="Releases" bytes={report.totals.releasesBytes} color="violet" />
              <SummaryTile label="Backups" bytes={report.totals.backupsBytes} color="amber" />
            </div>
            <div className="pt-1 border-t flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">{fmtBytes(report.totals.totalBytes)}</span>
            </div>
          </div>

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div className="space-y-2">
              {report.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  {r}
                </div>
              ))}
            </div>
          )}

          {/* Cleanup plan */}
          {plan && (
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Cleanup Plan</h3>
                {plan.eligibleItems.length > 0 && phase === "ready" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPhase("confirming")}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Run Cleanup
                  </Button>
                )}
              </div>

              {plan.warnings.map((w, i) => (
                <div key={i} className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {w}
                </div>
              ))}

              {plan.eligibleItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Nothing to clean up. The project is within its retention policy.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    {plan.eligibleItems.length} item(s) eligible — would free{" "}
                    <span className="font-medium text-foreground">{fmtBytes(plan.totalBytesToFree)}</span>
                  </div>
                  <div className="divide-y rounded-md border text-sm">
                    {plan.eligibleItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-muted-foreground">{item.pathLabel}</div>
                          <div className="text-xs text-muted-foreground">{item.createdAt ? fmtRelative(item.createdAt) : ""}</div>
                        </div>
                        <div className="shrink-0 text-xs font-medium text-destructive">{fmtBytes(item.sizeBytes)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Protected items (collapsed) */}
              {plan.protectedItems.length > 0 && (
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {plan.protectedItems.length} item(s) protected
                    <ChevronRight className="h-3 w-3 group-open:hidden" />
                    <ChevronDown className="h-3 w-3 hidden group-open:block" />
                  </summary>
                  <div className="mt-2 divide-y rounded-md border text-xs">
                    {plan.protectedItems.map((item) => (
                      <div key={item.id} className="flex items-start justify-between px-3 py-2 gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-muted-foreground">{item.pathLabel}</div>
                          {item.reasonProtected && (
                            <div className="text-emerald-600 dark:text-emerald-400">{item.reasonProtected}</div>
                          )}
                        </div>
                        <div className="shrink-0 text-muted-foreground">{fmtBytes(item.sizeBytes)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* CLEANUP confirmation */}
          {(phase === "confirming" || phase === "running") && plan && plan.eligibleItems.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 space-y-4">
              <div className="flex items-center gap-2 font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Confirm Cleanup
              </div>
              <p className="text-sm text-muted-foreground">
                This will permanently delete{" "}
                <strong>{plan.eligibleItems.length} item(s)</strong> and free approximately{" "}
                <strong>{fmtBytes(plan.totalBytesToFree)}</strong>.{" "}
                This action <strong>cannot be undone</strong>.
              </p>
              <p className="text-sm text-muted-foreground">
                Type <code className="rounded bg-muted px-1 font-mono text-xs">CLEANUP</code> to confirm.
              </p>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="CLEANUP"
                className="font-mono max-w-xs"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={confirmation !== "CLEANUP" || phase === "running"}
                  onClick={handleRunCleanup}
                  className="gap-1.5"
                >
                  {phase === "running" ? (
                    <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Running...</>
                  ) : (
                    <><Trash2 className="h-3.5 w-3.5" /> Delete {plan.eligibleItems.length} item(s)</>
                  )}
                </Button>
                <Button variant="ghost" size="sm" disabled={phase === "running"} onClick={() => { setPhase("ready"); setConfirmation(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Policy settings */}
          {policyDraft && (
            <div className="rounded-lg border bg-card">
              <button
                className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold"
                onClick={() => setPolicyOpen((v) => !v)}
              >
                <span>Retention Policy</span>
                {policyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {policyOpen && (
                <div className="px-5 pb-5 space-y-5 border-t pt-4">
                  <PolicyField
                    label="Keep successful releases"
                    description="Newest N release directories to preserve."
                    value={policyDraft.keepSuccessfulReleases}
                    min={1} max={50}
                    onChange={(v) => setPolicyDraft((d) => d ? { ...d, keepSuccessfulReleases: v } : d)}
                  />
                  <PolicyField
                    label="Keep failed releases"
                    description="Newest N failed release directories to preserve."
                    value={policyDraft.keepFailedReleases}
                    min={0} max={20}
                    onChange={(v) => setPolicyDraft((d) => d ? { ...d, keepFailedReleases: v } : d)}
                  />
                  <PolicyField
                    label="Keep scheduled backups"
                    description="Newest N scheduled backups to preserve. Manual and pre-restore backups are always kept."
                    value={policyDraft.keepScheduledBackups}
                    min={1} max={100}
                    onChange={(v) => setPolicyDraft((d) => d ? { ...d, keepScheduledBackups: v } : d)}
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Auto cleanup</Label>
                      <p className="text-xs text-muted-foreground">Automatically delete items beyond retention limits.</p>
                    </div>
                    <Switch
                      checked={policyDraft.autoCleanupEnabled}
                      onCheckedChange={(v) => setPolicyDraft((d) => d ? { ...d, autoCleanupEnabled: v } : d)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={handleSavePolicy} disabled={saving}>
                      {saving ? "Saving…" : "Save Policy"}
                    </Button>
                    {saveMsg && (
                      <span className={cn("text-xs", saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-600")}>
                        {saveMsg}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryTile({ label, bytes, color }: { label: string; bytes: number; color: "blue" | "violet" | "amber" }) {
  const dot: Record<typeof color, string> = {
    blue:   "bg-blue-500",
    violet: "bg-violet-500",
    amber:  "bg-amber-500",
  };
  return (
    <div className="rounded-md border p-3 text-center space-y-1">
      <div className="flex items-center justify-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", dot[color])} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-sm font-semibold">{fmtBytes(bytes)}</div>
    </div>
  );
}

function PolicyField({
  label, description, value, min, max, onChange,
}: {
  label:       string;
  description: string;
  value:       number;
  min:         number;
  max:         number;
  onChange:    (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= min && n <= max) onChange(n);
        }}
        className="w-20 text-center shrink-0"
      />
    </div>
  );
}
