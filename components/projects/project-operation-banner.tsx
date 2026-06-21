"use client";

/**
 * components/projects/project-operation-banner.tsx
 *
 * Sprint 27: Shows an amber banner while a project operation is running.
 * Polls every 5 seconds via listActiveOperationsAction.
 * Embedded in WorkspaceNav so it appears on every project page.
 *
 * Safety: only shows title, type label, and elapsed time — never secrets.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, X, AlertTriangle } from "lucide-react";
import { listActiveOperationsAction, requestCancelOperationAction } from "@/app/actions/project-operations";
import type { ProjectOperationDTO } from "@/lib/operations/project-operation-types";
import { OPERATION_TYPE_LABELS }   from "@/lib/operations/project-operation-types";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedLabel(isoStart: string): string {
  const ms      = Date.now() - new Date(isoStart).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60)  return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ${seconds % 60}s`;
  const hours   = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ── Sub-component: single operation row ──────────────────────────────────────

function OperationRow({
  op,
  projectId,
  onCancelled,
}: {
  op:          ProjectOperationDTO;
  projectId:   string;
  onCancelled: (id: string) => void;
}) {
  const [cancelling, startCancelTransition] = useTransition();
  const [elapsed, setElapsed] = useState(() => elapsedLabel(op.startedAt));

  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedLabel(op.startedAt)), 1_000);
    return () => clearInterval(t);
  }, [op.startedAt]);

  function handleCancel() {
    startCancelTransition(async () => {
      const r = await requestCancelOperationAction(projectId, op.id);
      if (r.ok) onCancelled(op.id);
    });
  }

  const typeLabel = OPERATION_TYPE_LABELS[op.operationType] ?? op.operationType;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
      <span className="truncate text-sm font-medium text-amber-900">
        {op.title}
      </span>
      <span className="text-xs text-amber-700 shrink-0">
        {typeLabel} · {elapsed}
      </span>
      {op.initiatedByName && (
        <span className="hidden sm:inline text-xs text-amber-600 shrink-0">
          by {op.initiatedByName}
        </span>
      )}
      <button
        onClick={handleCancel}
        disabled={cancelling}
        title="Force-clear this lock (does not stop the underlying process)"
        className={cn(
          "ml-1 shrink-0 rounded p-0.5 transition-colors",
          "text-amber-700 hover:text-amber-900 hover:bg-amber-200",
          cancelling && "opacity-50 cursor-not-allowed",
        )}
        aria-label="Cancel operation lock"
      >
        {cancelling
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <X className="h-3 w-3" />
        }
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_MS = 5_000;

export function ProjectOperationBanner({ projectId }: { projectId: string }) {
  const [ops, setOps] = useState<ProjectOperationDTO[]>([]);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  async function poll() {
    try {
      const r = await listActiveOperationsAction(projectId);
      if (r.ok) setOps(r.data);
    } catch { /* silently ignore — banner is non-critical */ }
  }

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function handleCancelled(id: string) {
    setOps((prev) => prev.filter((o) => o.id !== id));
  }

  if (ops.length === 0) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 sm:px-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 sm:flex-wrap">
        {ops.map((op) => (
          <OperationRow
            key={op.id}
            op={op}
            projectId={projectId}
            onCancelled={handleCancelled}
          />
        ))}
        {ops.length > 1 && (
          <div className="flex items-center gap-1 text-xs text-amber-700 shrink-0">
            <AlertTriangle className="h-3 w-3" />
            <span>{ops.length} operations running</span>
          </div>
        )}
        <Link
          href={`/projects/${projectId}/operations`}
          className="ml-auto text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900 shrink-0"
        >
          View history →
        </Link>
      </div>
    </div>
  );
}
