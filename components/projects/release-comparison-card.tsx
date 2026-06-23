"use client";

/**
 * components/projects/release-comparison-card.tsx
 *
 * Sprint 49: Side-by-side release comparison card.
 * Shows: Current Live / Candidate / Rollback Target.
 *
 * Safety: no secrets. Renders DB-sourced metadata only.
 */

import { useState, useEffect } from "react";
import {
  Rocket, RotateCcw, GitBranch, GitCommit, Clock, CheckCircle2, Loader2, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }                                    from "@/components/ui/badge";
import { Button }                                   from "@/components/ui/button";
import { getReleaseSummaryAction }                  from "@/app/actions/project-go-live";
import { buildReleaseComparison }                   from "@/lib/releases/release-comparison";
import type { ReleaseComparison, ReleaseSlot }      from "@/lib/releases/release-comparison";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Slot card ─────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  accent,
}: {
  slot: ReleaseSlot;
  accent: "green" | "blue" | "amber";
}) {
  const border = {
    green: "border-green-200 bg-green-50 dark:bg-green-950/20",
    blue:  "border-blue-200 bg-blue-50 dark:bg-blue-950/20",
    amber: "border-amber-200 bg-amber-50 dark:bg-amber-950/20",
  }[accent];
  const titleColor = {
    green: "text-green-700 dark:text-green-300",
    blue:  "text-blue-700 dark:text-blue-300",
    amber: "text-amber-700 dark:text-amber-300",
  }[accent];

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${border}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-semibold uppercase tracking-wide ${titleColor}`}>
          {slot.label}
        </p>
        {slot.isActive && (
          <Badge variant="success" className="text-[10px]">Live</Badge>
        )}
      </div>
      <code className="block font-mono text-sm font-semibold truncate">
        {slot.ref.slice(0, 18)}
      </code>
      <div className="space-y-1 text-xs text-muted-foreground">
        {slot.branch && (
          <div className="flex items-center gap-1">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{slot.branch}</span>
          </div>
        )}
        {slot.commitSha && (
          <div className="flex items-center gap-1 font-mono">
            <GitCommit className="h-3 w-3 shrink-0" />
            <span>{slot.commitSha.slice(0, 7)}</span>
          </div>
        )}
        {slot.commitMessage && (
          <p className="truncate">{slot.commitMessage.slice(0, 60)}</p>
        )}
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{timeAgo(slot.activatedAt ?? slot.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Empty slot ────────────────────────────────────────────────────────────────

function EmptySlot({ label, note }: { label: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed p-3 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReleaseComparisonCard({ projectId }: { projectId: string }) {
  const [comparison, setComparison] = useState<ReleaseComparison | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getReleaseSummaryAction(projectId);
      if (res.ok) {
        setComparison(buildReleaseComparison({
          currentLive:    res.currentLive,
          candidate:      res.candidate,
          rollbackTarget: res.rollbackTarget,
        }));
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not load release comparison.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Rocket className="h-4 w-4 text-muted-foreground" />
            Release Comparison
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-3">{error}</p>
        )}

        {comparison?.isFirstRelease && (
          <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 mb-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5 shrink-0" />
              This will be the first promoted release — no rollback target yet.
            </p>
          </div>
        )}

        {comparison && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {comparison.currentLive
              ? <SlotCard slot={comparison.currentLive} accent="green" />
              : <EmptySlot label="Current Live" note="No active production release yet." />
            }
            {comparison.candidate
              ? <SlotCard slot={comparison.candidate} accent="blue" />
              : <EmptySlot label="Candidate" note="Deploy a build to create a candidate." />
            }
            {comparison.rollbackTarget
              ? (
                <div className="space-y-1">
                  <SlotCard slot={comparison.rollbackTarget} accent="amber" />
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 px-1">
                    <RotateCcw className="h-3 w-3 shrink-0" />
                    Rollback does not revert database changes.
                  </div>
                </div>
              )
              : <EmptySlot label="Rollback Target" note="No previous release to roll back to." />
            }
          </div>
        )}

        {!comparison && !error && loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading release data…
          </div>
        )}

        {comparison && comparison.rollbackTarget && (
          <p className="text-[10px] text-muted-foreground mt-3 border-t pt-2">
            Rollback confirmation requires typing <code className="font-mono font-semibold">ROLLBACK</code>.
            Rollback reverts the release but does not undo database migrations.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
