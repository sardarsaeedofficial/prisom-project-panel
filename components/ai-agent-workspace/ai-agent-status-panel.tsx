"use client";

/**
 * components/ai-agent-workspace/ai-agent-status-panel.tsx
 * Right-pane status cards: run status, phase, endpoint, model, Claude call.
 */

import {
  Activity, Cpu, Globe, CheckCircle2, XCircle, Loader2,
  Clock, AlertTriangle,
} from "lucide-react";
import type { AgentRun, AiPlanMeta } from "@/lib/ai-import-agent/agent-run-types";

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="h-2 w-2 rounded-full bg-slate-600 inline-block" />;
  return ok
    ? <span className="h-2 w-2 rounded-full bg-green-400 inline-block animate-pulse" />
    : <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />;
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 space-y-1">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{label}</p>
      <div>{children}</div>
    </div>
  );
}

interface AiAgentStatusPanelProps {
  run: AgentRun;
  isWorking: boolean;
  phaseText: string;
  modelLabel: string;
  exactModel?: string;
}

export function AiAgentStatusPanel({
  run, isWorking, phaseText, modelLabel, exactModel,
}: AiAgentStatusPanelProps) {
  const meta: AiPlanMeta | undefined = run.aiPlanMeta;
  const durationMs = meta?.respondedAt
    ? new Date(meta.respondedAt).getTime() - new Date(meta.requestedAt).getTime()
    : null;
  const durationSec = durationMs !== null ? (durationMs / 1000).toFixed(1) : null;

  const runStatusLabel =
    run.status === "preview_live"              ? "Live"     :
    run.status === "failed"                    ? "Failed"   :
    run.status === "stopped"                   ? "Stopped"  :
    run.status === "timed_out"                 ? "Timed out":
    run.status === "waiting_for_user_input"    ? "Waiting"  :
    run.status === "waiting_for_fix_approval"  ? "Waiting"  :
    run.status === "waiting_for_patch_approval"? "Waiting"  :
    run.status === "blocked"                   ? "Blocked"  :
    run.status === "not_started"               ? "Not started" :
    isWorking ? "Running" : run.status;

  const runStatusOk =
    run.status === "preview_live" ? true :
    run.status === "failed" || run.status === "timed_out" || run.status === "blocked" ? false :
    null;

  return (
    <div className="grid grid-cols-1 gap-2 p-3">
      {/* Run status */}
      <Card label="Run Status">
        <div className="flex items-center gap-2">
          <StatusDot ok={runStatusOk} />
          <span className="text-[13px] text-slate-200 capitalize">{runStatusLabel}</span>
          {isWorking && <Loader2 className="h-3 w-3 animate-spin text-purple-400 ml-auto" />}
        </div>
      </Card>

      {/* Current phase */}
      <Card label="Current Phase">
        <p className="text-[12px] text-slate-300 leading-snug">{phaseText}</p>
      </Card>

      {/* Endpoint */}
      {(run.previewUrl || run.publicUrl) && (
        <Card label="Endpoint">
          <div className="space-y-1">
            {run.previewUrl && (
              <a
                href={run.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[12px] text-purple-400 hover:underline truncate"
              >
                <Globe className="h-3 w-3 shrink-0" />
                Panel preview
              </a>
            )}
            {run.publicUrl && (
              <a
                href={run.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[12px] text-green-400 hover:underline truncate"
              >
                <Globe className="h-3 w-3 shrink-0" />
                {run.publicUrl}
              </a>
            )}
          </div>
        </Card>
      )}

      {/* Model */}
      <Card label="Model">
        <div className="space-y-0.5">
          <p className="text-[12px] text-slate-300">{modelLabel}</p>
          {exactModel && <p className="text-[10px] font-mono text-slate-500">{exactModel}</p>}
        </div>
      </Card>

      {/* Claude call proof */}
      {(meta || run.status === "planning" || run.nextPhase === "plan_with_ai") && (
        <Card label="AI Call">
          {meta ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                {meta.success
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <XCircle       className="h-3.5 w-3.5 text-red-400 shrink-0" />
                }
                <span className={`text-[12px] ${meta.success ? "text-green-300" : "text-red-300"}`}>
                  {meta.success ? `${meta.modelLabel} returned a plan` : `${meta.modelLabel} call failed`}
                </span>
              </div>
              {durationSec && (
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> responded in {durationSec}s
                </p>
              )}
              {!meta.respondedAt && (
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> waiting for response…
                </p>
              )}
              {meta.error && (
                <p className="text-[10px] text-red-400 break-words">{meta.error}</p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-slate-400 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Waiting to call {modelLabel}
            </p>
          )}
        </Card>
      )}

      {/* Last updated */}
      <Card label="Last Updated">
        <p className="text-[12px] text-slate-400">
          {run.updatedAt
            ? new Date(run.updatedAt).toLocaleTimeString()
            : "—"
          }
        </p>
      </Card>
    </div>
  );
}
