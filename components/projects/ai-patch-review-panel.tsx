"use client";

/**
 * components/projects/ai-patch-review-panel.tsx
 *
 * Sprint 11: Full AI patch review panel.
 *
 * Workflow:
 *  1. User selects scope (active file / open tabs).
 *  2. User enters instruction and clicks "Generate plan".
 *  3. Server returns a validated AiPatchPlan with per-patch safe/blocked status.
 *  4. User reviews each patch (diff, explanation, risk).
 *  5. User selects patches to apply and clicks "Apply selected".
 *  6. Server applies selected patches; parent is notified to refresh tabs + tree.
 *  7. Git reminder shown.
 *
 * Safety:
 *  - AI cannot apply changes autonomously.
 *  - No auto-commit, auto-push, auto-deploy.
 *  - Blocked patches are shown but cannot be selected.
 *  - Delete operations require separate confirmation.
 */

import {
  useState,
  useCallback,
  useTransition,
  useMemo,
} from "react";
import {
  Sparkles,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Shield,
  Loader2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  FileCode2,
  FilePlus,
  Trash2,
  Info,
  RefreshCcw,
  Terminal,
  AlertCircle,
} from "lucide-react";

import {
  generateProjectPatchPlanAction,
  applyProjectPatchPlanAction,
  type PatchPlanInput,
} from "@/app/actions/project-ai-patches";
import type { AiPatchPlan, AiFilePatch } from "@/lib/ai/project-patches";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal tab info needed by this panel. */
export interface TabInfo {
  path:          string;
  editedContent: string;
  modifiedAt:    string;
  isDirty:       boolean;
}

export interface AppliedPatchResult {
  id:         string;
  path:       string;
  action:     string;
  newContent: string;
  size:       number;
  modifiedAt: string;
}

interface Props {
  projectId:      string;
  tabs:           TabInfo[];
  activeTabPath:  string | null;
  onPatchApplied: (results: AppliedPatchResult[]) => void;
  onClose:        () => void;
}

// ── Simple line diff ──────────────────────────────────────────────────────────

type DiffLine = { type: "same" | "add" | "del"; text: string };

/** LCS-based line diff — capped at 300 lines each side for performance. */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const CAP = 300;
  const o   = oldText.split("\n").slice(0, CAP);
  const n   = newText.split("\n").slice(0, CAP);
  const m   = o.length;
  const nn  = n.length;

  // dp[i][j] = LCS length for o[0..i-1] and n[0..j-1]
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(nn + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= nn; j++) {
      dp[i][j] = o[i - 1] === n[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = nn;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && o[i - 1] === n[j - 1]) {
      result.push({ type: "same", text: o[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", text: n[j - 1] }); j--;
    } else {
      result.push({ type: "del", text: o[i - 1] }); i--;
    }
  }
  return result.reverse();
}

/** Format diff lines as a unified-diff-like display string, with context. */
function formatDiffForDisplay(ops: DiffLine[], truncated: boolean): string {
  const CONTEXT = 3;
  const changes = ops.map((op, idx) => ({ idx, changed: op.type !== "same" }));
  const changedIdxs = changes.filter((c) => c.changed).map((c) => c.idx);

  if (changedIdxs.length === 0) return "";

  // Merge context windows into hunks
  const hunks: [number, number][] = [];
  let hs = Math.max(0, changedIdxs[0] - CONTEXT);
  let he = Math.min(ops.length - 1, changedIdxs[0] + CONTEXT);

  for (let k = 1; k < changedIdxs.length; k++) {
    const ns = Math.max(0, changedIdxs[k] - CONTEXT);
    const ne = Math.min(ops.length - 1, changedIdxs[k] + CONTEXT);
    if (ns <= he + 1) { he = Math.max(he, ne); }
    else { hunks.push([hs, he]); hs = ns; he = ne; }
  }
  hunks.push([hs, he]);

  const lines: string[] = [];
  for (const [start, end] of hunks) {
    // Compute line numbers
    let oldLn = 1, newLn = 1;
    for (let k = 0; k < start; k++) {
      if (ops[k].type !== "add") oldLn++;
      if (ops[k].type !== "del") newLn++;
    }
    let oldCnt = 0, newCnt = 0;
    for (let k = start; k <= end; k++) {
      if (ops[k].type !== "add") oldCnt++;
      if (ops[k].type !== "del") newCnt++;
    }
    lines.push(`@@ -${oldLn},${oldCnt} +${newLn},${newCnt} @@`);
    for (let k = start; k <= end; k++) {
      const op     = ops[k];
      const prefix = op.type === "same" ? " " : op.type === "add" ? "+" : "-";
      lines.push(`${prefix}${op.text}`);
    }
  }

  if (truncated) lines.push("... [file too large — diff truncated at 300 lines]");
  return lines.join("\n");
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function DiffViewer({ patch }: { patch: AiFilePatch }) {
  const diffText = useMemo(() => {
    // Prefer unifiedDiff from AI if provided and non-trivial
    if (patch.unifiedDiff && patch.unifiedDiff.trim().length > 10) {
      return patch.unifiedDiff;
    }

    if (patch.action === "create" && patch.newContent) {
      // Show entire new file as additions
      return patch.newContent
        .split("\n")
        .slice(0, 300)
        .map((l) => `+${l}`)
        .join("\n") +
        (patch.newContent.split("\n").length > 300 ? "\n... [truncated]" : "");
    }

    if (patch.action === "modify" && patch.oldContent !== undefined && patch.newContent) {
      const truncated =
        patch.oldContent.split("\n").length > 300 || patch.newContent.split("\n").length > 300;
      const ops = diffLines(patch.oldContent, patch.newContent);
      const hasChanges = ops.some((op) => op.type !== "same");
      if (!hasChanges) return "";
      return formatDiffForDisplay(ops, truncated);
    }

    if (patch.action === "delete" && patch.oldContent) {
      return patch.oldContent
        .split("\n")
        .slice(0, 50)
        .map((l) => `-${l}`)
        .join("\n") +
        (patch.oldContent.split("\n").length > 50 ? "\n... [truncated]" : "");
    }

    return "";
  }, [patch]);

  if (!diffText.trim()) {
    return (
      <p className="text-[11px] text-muted-foreground italic px-3 py-2">
        No diff to display.
      </p>
    );
  }

  return (
    <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto bg-[#1e1e1e] border border-[#3c3c3c] rounded p-3 whitespace-pre max-h-80 overflow-y-auto">
      {diffText.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++")
            ? "text-green-400 bg-green-900/20 block"
            : line.startsWith("-") && !line.startsWith("---")
            ? "text-red-400 bg-red-900/20 block"
            : line.startsWith("@@")
            ? "text-cyan-400 block"
            : "text-[#d4d4d4] block";
        return (
          <span key={i} className={cls}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

// ── Risk badge ────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const [label, cls] =
    level === "low"
      ? ["Low risk", "bg-green-500/10 text-green-600 border-green-300/30"]
      : level === "medium"
      ? ["Medium risk", "bg-amber-500/10 text-amber-600 border-amber-300/30"]
      : ["High risk", "bg-red-500/10 text-red-600 border-red-300/30"];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded border px-1.5 py-0.5 ${cls}`}>
      {level === "low"
        ? <Shield className="h-2.5 w-2.5" />
        : <ShieldAlert className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

// ── Action badge ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const [label, cls, Icon] =
    action === "create"
      ? ["create", "bg-green-500/10 text-green-600", FilePlus]
      : action === "delete"
      ? ["delete", "bg-red-500/10 text-red-600", Trash2]
      : ["modify", "bg-blue-500/10 text-blue-600", FileCode2];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 ${cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

// ── Single patch card ─────────────────────────────────────────────────────────

function PatchCard({
  patch,
  selected,
  onToggle,
  deleteConfirmed,
  onConfirmDelete,
}: {
  patch:            AiFilePatch;
  selected:         boolean;
  onToggle:         (id: string) => void;
  deleteConfirmed:  boolean;
  onConfirmDelete:  (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const name = patch.path.split("/").pop() ?? patch.path;
  const canSelect = patch.safeToApply && patch.action !== "delete";
  const canDelete = patch.safeToApply && patch.action === "delete" && deleteConfirmed;

  return (
    <div className={`rounded-lg border overflow-hidden ${
      patch.safeToApply ? "border-border" : "border-destructive/30 opacity-80"
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(patch.id)}
          disabled={!canSelect && !canDelete}
          className="h-3.5 w-3.5 rounded accent-primary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
          title={!patch.safeToApply ? patch.blockedReason : undefined}
        />

        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? <ChevronDown  className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <code className="text-xs font-mono flex-1 truncate min-w-0">{patch.path}</code>
        <ActionBadge action={patch.action} />

        {patch.safeToApply ? (
          <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
            <CheckCircle2 className="h-3 w-3" /> safe
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-destructive shrink-0">
            <ShieldAlert className="h-3 w-3" /> blocked
          </span>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="divide-y divide-border/50">
          {/* Title + explanation */}
          <div className="px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-foreground">{patch.title}</p>
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {patch.explanation}
            </p>
          </div>

          {/* Blocked reason */}
          {!patch.safeToApply && patch.blockedReason && (
            <div className="flex items-start gap-2 px-3 py-2 bg-destructive/5">
              <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-[11px] text-destructive">{patch.blockedReason}</p>
            </div>
          )}

          {/* Delete confirmation */}
          {patch.action === "delete" && patch.safeToApply && !deleteConfirmed && (
            <div className="px-3 py-2 bg-red-50/10 flex items-center gap-3">
              <Trash2 className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <p className="text-[11px] text-red-600 flex-1">
                This patch deletes a file. Confirm to enable selection.
              </p>
              <button
                onClick={() => onConfirmDelete(patch.id)}
                className="text-[10px] rounded border border-red-400/40 bg-red-500/10 text-red-600 px-2 py-0.5 hover:bg-red-500/20 transition-colors shrink-0"
              >
                Confirm delete
              </button>
            </div>
          )}

          {/* Diff */}
          {patch.safeToApply && (patch.action === "modify" || patch.action === "create" || patch.action === "delete") && (
            <div className="px-3 py-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                {patch.action === "delete" ? "File content (will be deleted)" : "Diff preview"}
              </p>
              <DiffViewer patch={patch} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AiPatchReviewPanel({
  projectId,
  tabs,
  activeTabPath,
  onPatchApplied,
  onClose,
}: Props) {
  // ── Scope selection ──────────────────────────────────────────────────────────
  type Scope = "active" | "tabs";
  const [scope,       setScope]       = useState<Scope>("active");
  const [instruction, setInstruction] = useState("");

  // ── Plan state ───────────────────────────────────────────────────────────────
  const [plan,        setPlan]        = useState<AiPatchPlan | null>(null);
  const [genError,    setGenError]    = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();

  // ── Selection + apply state ─────────────────────────────────────────────────
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set());
  const [confirmedDeletes,  setConfirmedDeletes]  = useState<Set<string>>(new Set());
  const [isApplying,        startApply]           = useTransition();
  const [applyResult,       setApplyResult]       = useState<{
    applied: Array<{ id: string; path: string; action: string }>;
    skipped: Array<{ id: string; path: string; reason: string }>;
  } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [gitHint,    setGitHint]    = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  const scopedPaths: string[] = useMemo(() => {
    if (scope === "active") {
      return activeTab ? [activeTab.path] : [];
    }
    return tabs.map((t) => t.path);
  }, [scope, activeTab, tabs]);

  const hasDirtyTabs = tabs.some((t) => t.isDirty && scopedPaths.includes(t.path));

  // ── Generate ─────────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    if (!instruction.trim() || scopedPaths.length === 0) return;
    setGenError(null);
    setPlan(null);
    setSelectedIds(new Set());
    setConfirmedDeletes(new Set());
    setApplyResult(null);
    setApplyError(null);
    setGitHint(false);

    startGenerate(async () => {
      const input: PatchPlanInput = {
        projectId,
        instruction,
        paths: scopedPaths,
        openEditorContents: tabs
          .filter((t) => scopedPaths.includes(t.path))
          .map((t) => ({ path: t.path, content: t.editedContent, modifiedAt: t.modifiedAt })),
      };
      const res = await generateProjectPatchPlanAction(input);
      if (res.ok && res.data) {
        setPlan(res.data);
        // Auto-select all safe modify/create patches
        const autoSel = new Set(
          res.data.patches
            .filter((p) => p.safeToApply && p.action !== "delete")
            .map((p) => p.id),
        );
        setSelectedIds(autoSel);
      } else if (!res.ok) {
        setGenError((res as { ok: false; error: string }).error);
      }
    });
  }, [projectId, instruction, scopedPaths, tabs]);

  // ── Toggle patch selection ────────────────────────────────────────────────────

  const togglePatch = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const confirmDelete = useCallback((id: string) => {
    setConfirmedDeletes((prev) => new Set([...prev, id]));
    setSelectedIds((prev) => new Set([...prev, id]));
  }, []);

  // ── Apply ─────────────────────────────────────────────────────────────────────

  const handleApply = useCallback(() => {
    if (!plan || selectedIds.size === 0) return;
    setApplyError(null);

    const toApply = plan.patches
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({
        id:                  p.id,
        path:                p.path,
        action:              p.action,
        newContent:          p.newContent,
        expectedModifiedAt:  tabs.find((t) => t.path === p.path)?.modifiedAt,
      }));

    const hasDelete = toApply.some((p) => p.action === "delete");
    const confirmed = hasDelete ? [...confirmedDeletes].some((id) => toApply.some((p) => p.id === id)) : false;

    startApply(async () => {
      const res = await applyProjectPatchPlanAction({
        projectId,
        patches:          toApply,
        confirmedDelete:  confirmed,
      });

      if (res.ok && res.data) {
        setApplyResult(res.data);

        // Build results to notify parent
        const appliedResults: AppliedPatchResult[] = res.data.applied.map((a) => {
          const srcPatch = plan.patches.find((p) => p.id === a.id);
          return {
            id:         a.id,
            path:       a.path,
            action:     a.action,
            newContent: srcPatch?.newContent ?? "",
            size:       a.size,
            modifiedAt: a.modifiedAt,
          };
        });

        if (appliedResults.length > 0) {
          onPatchApplied(appliedResults);
          setGitHint(true);
        }
      } else if (!res.ok) {
        setApplyError((res as { ok: false; error: string }).error);
      }
    });
  }, [plan, selectedIds, confirmedDeletes, projectId, tabs, onPatchApplied]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const safePatchCount  = plan?.patches.filter((p) => p.safeToApply).length ?? 0;
  const selectedCount   = plan
    ? plan.patches.filter((p) => selectedIds.has(p.id)).length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium flex-1">AI Patch Review</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted transition-colors">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Scope + instruction ── */}
        <div className="px-4 py-3 border-b space-y-3">
          {/* Scope selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Scope</label>
            <div className="flex gap-2">
              <button
                onClick={() => setScope("active")}
                disabled={!activeTab}
                className={`flex-1 text-xs rounded border px-2 py-1 transition-colors ${
                  scope === "active"
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
                }`}
              >
                Active file
              </button>
              <button
                onClick={() => setScope("tabs")}
                disabled={tabs.length === 0}
                className={`flex-1 text-xs rounded border px-2 py-1 transition-colors ${
                  scope === "tabs"
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
                }`}
              >
                All open tabs ({tabs.length})
              </button>
            </div>
            {scopedPaths.length === 0 && (
              <p className="text-[10px] text-amber-600">
                Open a file in the editor first.
              </p>
            )}
            {scopedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {scopedPaths.map((p) => (
                  <span key={p} className="text-[10px] bg-muted rounded px-1.5 py-0.5 font-mono max-w-[180px] truncate">
                    {p.split("/").pop()}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Dirty warning */}
          {hasDirtyTabs && (
            <div className="flex items-center gap-1.5 rounded border border-amber-300/40 bg-amber-50/10 px-2 py-1.5 text-[11px] text-amber-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Some files have unsaved changes. The AI will see your current editor
              content — apply will write to disk.
            </div>
          )}

          {/* Instruction */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Instruction</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={
                scopedPaths.length > 0
                  ? `e.g. Add a loading state, add error handling, create docs/notes.md…`
                  : "Open a file first…"
              }
              disabled={isGenerating || scopedPaths.length === 0}
              rows={3}
              className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !instruction.trim() || scopedPaths.length === 0}
            className="w-full flex items-center justify-center gap-2 rounded bg-primary text-primary-foreground py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating plan…</>
              : <><Sparkles className="h-3.5 w-3.5" /> Generate patch plan</>}
          </button>

          <p className="text-[10px] text-muted-foreground">
            AI suggests changes only. No files are modified until you click Apply.
            Secrets are never sent.
          </p>
        </div>

        {/* ── Error ── */}
        {genError && (
          <div className="mx-4 my-3 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {genError}
          </div>
        )}

        {/* ── Plan ── */}
        {plan && (
          <div className="px-4 py-3 space-y-4">
            {/* Summary card */}
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-2">
              <div className="flex items-start gap-2 flex-wrap">
                <RiskBadge level={plan.riskLevel} />
                {safePatchCount > 0 && (
                  <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                    {safePatchCount} safe patch{safePatchCount !== 1 ? "es" : ""}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{plan.summary}</p>

              {plan.rawFallback && (
                <div className="rounded border border-amber-200/40 bg-amber-50/10 px-2 py-2 space-y-1">
                  <p className="text-[11px] text-amber-600 flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-3 w-3" /> Unstructured AI response
                  </p>
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
                    {plan.rawFallback}
                  </pre>
                </div>
              )}

              {plan.warnings.length > 0 && (
                <div className="space-y-0.5">
                  {plan.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-600 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}
                    </p>
                  ))}
                </div>
              )}

              {plan.verificationSteps.length > 0 && (
                <div className="border-t border-border/50 pt-2 space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 uppercase tracking-wider">
                    <Terminal className="h-3 w-3" /> Run after applying
                  </p>
                  {plan.verificationSteps.map((s, i) => (
                    <code key={i} className="block text-[11px] font-mono bg-muted/60 rounded px-2 py-0.5">{s}</code>
                  ))}
                </div>
              )}
            </div>

            {/* Patches */}
            {plan.patches.length === 0 && !plan.rawFallback && (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Info className="h-4 w-4 mr-2" /> No patches suggested.
              </div>
            )}

            {plan.patches.map((patch) => (
              <PatchCard
                key={patch.id}
                patch={patch}
                selected={selectedIds.has(patch.id)}
                onToggle={togglePatch}
                deleteConfirmed={confirmedDeletes.has(patch.id)}
                onConfirmDelete={confirmDelete}
              />
            ))}

            {/* Apply bar */}
            {safePatchCount > 0 && (
              <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-background border-t border-border space-y-2">
                {applyError && (
                  <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{applyError}
                  </div>
                )}

                {/* Apply result */}
                {applyResult && (
                  <div className="space-y-1">
                    {applyResult.applied.map((a) => (
                      <p key={a.id} className="text-[11px] text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        {a.path} ({a.action}) applied
                      </p>
                    ))}
                    {applyResult.skipped.map((s) => (
                      <p key={s.id} className="text-[11px] text-amber-600 flex items-start gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        {s.path} skipped: {s.reason}
                      </p>
                    ))}
                  </div>
                )}

                {gitHint && (
                  <div className="flex items-center gap-2 rounded border border-green-300/30 bg-green-500/5 px-3 py-2 text-[11px] text-green-700">
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    Patch applied. Review changes in Git tab before committing.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const allSafe = plan.patches
                        .filter((p) => p.safeToApply && p.action !== "delete")
                        .map((p) => p.id);
                      setSelectedIds(new Set(allSafe));
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Select all safe
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Deselect all
                  </button>
                  <span className="flex-1" />
                  <button
                    onClick={() => { setPlan(null); setApplyResult(null); setGitHint(false); }}
                    title="Generate a new plan"
                    className="flex items-center gap-1 text-xs rounded border border-border px-2 py-1 hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <RefreshCcw className="h-3 w-3" /> New plan
                  </button>
                  <button
                    onClick={handleApply}
                    disabled={isApplying || selectedCount === 0}
                    className="flex items-center gap-1.5 rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isApplying
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</>
                      : <><CheckCircle2 className="h-3.5 w-3.5" /> Apply {selectedCount} patch{selectedCount !== 1 ? "es" : ""}</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Idle state */}
        {!plan && !isGenerating && !genError && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
            <Sparkles className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Select files, enter an instruction, and generate a patch plan.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
