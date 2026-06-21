"use client";

/**
 * components/projects/portability-patch-panel.tsx
 *
 * Sprint 25: Portability patch cards for the Migration Assistant "Fix Issues" step.
 *
 * Per-patch flow:
 *   idle → planning → plan_ready → applying → applied
 *                ↘                          ↘
 *               error                       error
 *
 * Safety:
 *  - Apply requires typing "APPLY" explicitly
 *  - Diffs are shown before apply
 *  - Server re-generates the plan at apply time (never trusts client plan)
 *  - No file content (before/after) is shown to the user — only the unified diff
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  GitBranch,
  KeyRound,
  Loader2,
  Package,
  Wrench,
  XCircle,
  Info,
} from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listPatchesAction,
  planPatchAction,
  applyPatchAction,
} from "@/app/actions/project-portability-patches";
import type {
  PatchSummary,
  PortabilityPatchPlan,
  ApplyPatchResult,
  PatchId,
} from "@/lib/migration/portability-patch-types";
import { PATCH_IDS } from "@/lib/migration/portability-patch-types";

// ── Types ─────────────────────────────────────────────────────────────────────

type PatchPhase =
  | { phase: "idle" }
  | { phase: "loading_list" }
  | { phase: "list_error";  error: string }
  | { phase: "list_ready";  summaries: PatchSummary[] }
  | { phase: "planning";    patchId: PatchId }
  | { phase: "plan_error";  patchId: PatchId; error: string }
  | { phase: "plan_ready";  plan: PortabilityPatchPlan; confirmation: string }
  | { phase: "applying";    plan: PortabilityPatchPlan }
  | { phase: "apply_error"; plan: PortabilityPatchPlan; error: string }
  | { phase: "applied";     result: ApplyPatchResult; patchId: PatchId };

// ── Helpers ───────────────────────────────────────────────────────────────────

function PatchStatusBadge({ status }: { status: PatchSummary["status"] }) {
  switch (status) {
    case "available":
      return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 text-xs">Available</Badge>;
    case "already_applied":
      return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 text-xs">Already applied</Badge>;
    case "not_applicable":
      return <Badge variant="secondary" className="text-xs text-muted-foreground">Not applicable</Badge>;
    case "blocked":
      return <Badge variant="destructive" className="text-xs">Blocked</Badge>;
    default:
      return null;
  }
}

function SeverityBadge({ severity }: { severity: PatchSummary["severity"] }) {
  if (severity === "required")
    return <Badge variant="destructive" className="text-xs">Required</Badge>;
  if (severity === "recommended")
    return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 text-xs">Recommended</Badge>;
  return <Badge variant="secondary" className="text-xs">Optional</Badge>;
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function DiffBlock({ diff, filename }: { diff: string; filename: string }) {
  const [open, setOpen] = useState(true);
  const lines = diff.split("\n");

  return (
    <div className="rounded-md border overflow-hidden text-xs font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-muted/60 px-3 py-2 hover:bg-muted/80 transition-colors"
      >
        {open
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        }
        <Code2 className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{filename}</span>
      </button>
      {open && (
        <div className="overflow-x-auto bg-background max-h-72 overflow-y-auto">
          {lines.map((line, i) => {
            const isAdd    = line.startsWith("+") && !line.startsWith("+++");
            const isRemove = line.startsWith("-") && !line.startsWith("---");
            const isHunk   = line.startsWith("@@");
            return (
              <div
                key={i}
                className={
                  isAdd    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-pre" :
                  isRemove ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300 whitespace-pre" :
                  isHunk   ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 whitespace-pre" :
                             "text-muted-foreground whitespace-pre"
                }
              >
                <span className="select-none px-2 text-muted-foreground/40 inline-block w-8 text-right">{i + 1}</span>
                <span className="pl-1">{line}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Single patch card ─────────────────────────────────────────────────────────

function PatchCard({
  summary,
  projectId,
  onApplied,
}: {
  summary:   PatchSummary;
  projectId: string;
  onApplied: (result: ApplyPatchResult) => void;
}) {
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "planning" }
    | { phase: "plan_error";  error: string }
    | { phase: "plan_ready";  plan: PortabilityPatchPlan; confirmation: string }
    | { phase: "applying";    plan: PortabilityPatchPlan }
    | { phase: "apply_error"; plan: PortabilityPatchPlan; error: string }
    | { phase: "applied";     result: ApplyPatchResult }
  >({ phase: "idle" });

  const [isPending, startTransition] = useTransition();

  const showPlanButton =
    summary.status === "available" &&
    (state.phase === "idle" ||
     state.phase === "planning" ||
     state.phase === "plan_error" ||
     state.phase === "apply_error");
  const isPlanning = state.phase === "planning";
  const canRetry   = state.phase === "plan_error" || state.phase === "apply_error";

  function handlePlan() {
    setState({ phase: "planning" });
    startTransition(async () => {
      const res = await planPatchAction(projectId, summary.id);
      if (!res.ok) {
        setState({ phase: "plan_error", error: res.error });
        return;
      }
      setState({ phase: "plan_ready", plan: res.data, confirmation: "" });
    });
  }

  function handleApply(plan: PortabilityPatchPlan, confirmation: string) {
    setState({ phase: "applying", plan });
    startTransition(async () => {
      const res = await applyPatchAction(projectId, plan.id, confirmation);
      if (!res.ok) {
        setState({ phase: "apply_error", plan, error: res.error });
        return;
      }
      setState({ phase: "applied", result: res.data });
      onApplied(res.data);
    });
  }

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">{summary.title}</CardTitle>
            <SeverityBadge severity={summary.severity} />
            <PatchStatusBadge status={summary.status} />
          </div>
          {showPlanButton && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePlan}
              disabled={isPending || isPlanning}
            >
              {isPlanning ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Planning…</>
              ) : canRetry ? (
                "Retry"
              ) : (
                "Preview patch"
              )}
            </Button>
          )}
        </div>
        <CardDescription className="mt-1.5">{summary.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Meta chips */}
        <div className="flex flex-wrap gap-2">
          {summary.affectedFilesCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <Code2 className="h-3 w-3" />
              {summary.affectedFilesCount} file{summary.affectedFilesCount !== 1 ? "s" : ""}
            </span>
          )}
          {summary.requiredSecrets.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 px-2 py-1 text-xs border-amber-200">
              <KeyRound className="h-3 w-3" />
              {summary.requiredSecrets.join(", ")}
            </span>
          )}
          {summary.requiredPackages.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              {summary.requiredPackages.join(", ")}
            </span>
          )}
        </div>

        {/* Status: already applied */}
        {summary.status === "already_applied" && (
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>This patch has already been applied to your project.</span>
          </div>
        )}

        {/* Status: not applicable */}
        {summary.status === "not_applicable" && summary.statusReason && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{summary.statusReason}</span>
          </div>
        )}

        {/* Error states */}
        {state.phase === "plan_error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{state.error}</span>
          </div>
        )}

        {/* Plan ready: show diffs and confirm */}
        {(state.phase === "plan_ready" || state.phase === "applying" || state.phase === "apply_error") && (
          (() => {
            const plan = state.phase === "plan_ready"
              ? state.plan
              : state.phase === "applying" || state.phase === "apply_error"
              ? state.plan
              : null;
            if (!plan) return null;

            return (
              <div className="space-y-4">
                {/* Git / backup status */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span>
                    Git:{" "}
                    <span className={
                      plan.gitStatus === "clean"  ? "text-emerald-600 dark:text-emerald-400" :
                      plan.gitStatus === "dirty"  ? "text-amber-600 dark:text-amber-400" :
                                                    "text-muted-foreground"
                    }>
                      {plan.gitStatus === "clean"  ? "clean" :
                       plan.gitStatus === "dirty"  ? "dirty (uncommitted changes)" :
                                                     "no git repository"}
                    </span>
                  </span>
                  <span className="mx-1">·</span>
                  <span>Backup: {plan.hasRecentBackup
                    ? <span className="text-emerald-600 dark:text-emerald-400">recent backup found</span>
                    : <span className="text-amber-600 dark:text-amber-400">no recent backup</span>
                  }</span>
                </div>

                {/* Diffs */}
                {plan.files.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">File changes</p>
                    {plan.files.map((f) => (
                      <DiffBlock key={f.path} diff={f.diff} filename={f.path} />
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {plan.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> Warnings
                    </p>
                    <ul className="space-y-1">
                      {plan.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-700 dark:text-amber-400">• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Manual steps */}
                {plan.manualSteps.length > 0 && (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manual steps after apply</p>
                    <ol className="space-y-1 list-none">
                      {plan.manualSteps.map((step, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-2">
                          <span className="shrink-0 font-mono text-muted-foreground/60">{i + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Apply confirmation */}
                {state.phase === "apply_error" && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{state.error}</span>
                  </div>
                )}

                {state.phase !== "applying" && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">
                      Type <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">APPLY</code> to write these changes to your source files:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={state.phase === "plan_ready" ? state.confirmation : ""}
                        placeholder="APPLY"
                        onChange={(e) => {
                          if (state.phase === "plan_ready") {
                            setState({ ...state, confirmation: e.target.value });
                          }
                        }}
                        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                        disabled={isPending}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <Button
                        size="sm"
                        variant="default"
                        disabled={
                          isPending ||
                          state.phase !== "plan_ready" ||
                          state.confirmation.trim().toUpperCase() !== "APPLY"
                        }
                        onClick={() => {
                          if (state.phase === "plan_ready") {
                            handleApply(state.plan, state.confirmation);
                          }
                        }}
                      >
                        {isPending ? (
                          <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Applying…</>
                        ) : (
                          "Apply patch"
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {state.phase === "applying" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Writing files… do not close this page.</span>
                  </div>
                )}
              </div>
            );
          })()
        )}

        {/* Applied success */}
        {state.phase === "applied" && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-medium text-sm">Patch applied successfully</span>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-emerald-700 dark:text-emerald-400">
              {state.result.filesCreated > 0 && (
                <span>✦ {state.result.filesCreated} file{state.result.filesCreated !== 1 ? "s" : ""} created</span>
              )}
              {state.result.filesUpdated > 0 && (
                <span>✦ {state.result.filesUpdated} file{state.result.filesUpdated !== 1 ? "s" : ""} updated</span>
              )}
            </div>
            {state.result.requiredPackages.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Install these packages:</p>
                <code className="block text-xs bg-background rounded px-3 py-2 font-mono border">
                  pnpm add {state.result.requiredPackages.join(" ")}
                </code>
              </div>
            )}
            {state.result.requiredSecrets.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Set these environment variables:</p>
                <div className="flex flex-wrap gap-1.5">
                  {state.result.requiredSecrets.map((s) => (
                    <code key={s} className="text-xs bg-background rounded px-2 py-0.5 font-mono border">{s}</code>
                  ))}
                </div>
              </div>
            )}
            {state.result.manualSteps.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Remaining manual steps:</p>
                <ol className="space-y-1">
                  {state.result.manualSteps.map((step, i) => (
                    <li key={i} className="text-xs text-emerald-700 dark:text-emerald-400 flex gap-2">
                      <span className="font-mono text-emerald-600/60 shrink-0">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PortabilityPatchPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [phase, setPhase] = useState<PatchPhase>({ phase: "idle" });
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleLoad() {
    setPhase({ phase: "loading_list" });
    startTransition(async () => {
      const res = await listPatchesAction(projectId);
      if (!res.ok) {
        setPhase({ phase: "list_error", error: res.error });
        return;
      }
      setPhase({ phase: "list_ready", summaries: res.data });
    });
  }

  function handleApplied(result: ApplyPatchResult) {
    setAppliedIds((prev) => new Set([...prev, result.patchId]));
    // Re-fetch summaries to reflect new state
    startTransition(async () => {
      const res = await listPatchesAction(projectId);
      if (res.ok) setPhase({ phase: "list_ready", summaries: res.data });
    });
  }

  if (phase.phase === "idle") {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 text-center space-y-3">
        <Wrench className="h-7 w-7 mx-auto text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Portability patches</p>
          <p className="text-xs text-muted-foreground">
            Automated fixes for common Replit-specific blockers. Each patch is previewed with a diff before writing.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleLoad} disabled={isPending}>
          {isPending ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Loading…</> : "Check available patches"}
        </Button>
      </div>
    );
  }

  if (phase.phase === "loading_list") {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 flex items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Scanning for applicable patches…</span>
      </div>
    );
  }

  if (phase.phase === "list_error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
        <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm text-destructive">{phase.error}</p>
          <Button size="sm" variant="outline" onClick={handleLoad} disabled={isPending}>Retry</Button>
        </div>
      </div>
    );
  }

  if (phase.phase === "list_ready") {
    const available = phase.summaries.filter((s) => s.status === "available");
    const rest      = phase.summaries.filter((s) => s.status !== "available");

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            Portability patches
            {available.length > 0 && (
              <Badge variant="outline" className="ml-1 text-xs border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
                {available.length} available
              </Badge>
            )}
          </h3>
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={handleLoad} disabled={isPending}>
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>

        {available.length === 0 && rest.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No patches found. This project may not use any Replit-specific APIs.
          </div>
        )}

        {available.length > 0 && (
          <div className="space-y-3">
            {available.map((summary) => (
              <PatchCard
                key={summary.id}
                summary={summary}
                projectId={projectId}
                onApplied={handleApplied}
              />
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <div className="space-y-2">
            {available.length > 0 && (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Other patches</p>
            )}
            {rest.map((summary) => (
              <PatchCard
                key={summary.id}
                summary={summary}
                projectId={projectId}
                onApplied={handleApplied}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
