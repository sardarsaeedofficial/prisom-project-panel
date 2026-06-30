"use client";

/**
 * components/projects/ai-import-autopilot-panel.tsx
 *
 * Sprint 88: AI Import Autopilot — Replit-style "Make This Project Live" panel.
 * One button runs analyze → ask → apply safe fixes → deploy → verify automatically,
 * stopping only at preview_live, waiting_for_user_input, needs_manual_approval, or blocked.
 */

import { useState } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Loader2,
  ChevronDown, ChevronUp, Download, ArrowRight, ShieldCheck,
  Eye, EyeOff, Wrench,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  runAiImportAutopilotAction,
  saveAutopilotInputsAction,
  approveAutopilotFixAction,
  exportAiImportAutopilotRunbookAction,
} from "@/app/actions/ai-import-autopilot";
import {
  GROUP_LABELS,
} from "@/lib/ai-import-autopilot/ai-import-autopilot-question-service";
import type {
  AiImportAutopilotRun,
  AiImportAutopilotState,
  RequiredInput,
  RequiredInputGroup,
} from "@/lib/ai-import-autopilot/ai-import-autopilot-types";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATE_LABEL: Record<AiImportAutopilotState, string> = {
  idle:                    "Not started",
  analyzing_source:        "Analyzing…",
  waiting_for_user_input:  "Needs your input",
  applying_preset:         "Applying preset…",
  installing:              "Installing…",
  building:                "Building…",
  deploying:               "Deploying…",
  checking_api:            "Checking API…",
  checking_preview:        "Checking preview…",
  fixing_issue:            "Fixing issue…",
  retrying:                "Retrying…",
  preview_live:            "Preview live",
  needs_manual_approval:   "Needs your approval",
  blocked:                 "Blocked",
};

function StateBadge({ state }: { state: AiImportAutopilotState }) {
  const variant: "success" | "warning" | "destructive" | "secondary" =
    state === "preview_live"                                          ? "success" :
    state === "blocked"                                                ? "destructive" :
    state === "waiting_for_user_input" || state === "needs_manual_approval" ? "warning" :
    "secondary";
  return <Badge variant={variant}>{STATE_LABEL[state]}</Badge>;
}

/** Never returns true for raw 127.0.0.1/localhost URLs — those are VPS-internal only. */
function isBrowserSafe(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const { hostname } = new URL(url);
    return hostname !== "127.0.0.1" && hostname !== "localhost";
  } catch {
    return false;
  }
}

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Secret input field ────────────────────────────────────────────────────────

function SecretField({
  req, value, onChange,
}: {
  req: RequiredInput;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <Label htmlFor={req.id} className="text-xs font-medium">
        {req.label}
        {req.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <p className="text-xs text-muted-foreground">{req.description}</p>
      {req.distinguishHint && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">{req.distinguishHint}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          id={req.id}
          type={req.secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={req.placeholder}
          className="h-8 text-xs font-mono"
          autoComplete="off"
        />
        {req.secret && (
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface AiImportAutopilotPanelProps {
  projectId: string;
  compact?: boolean;
}

export function AiImportAutopilotPanel({ projectId, compact }: AiImportAutopilotPanelProps) {
  if (compact) return <CompactCard projectId={projectId} />;

  const [run,           setRun]           = useState<AiImportAutopilotRun | null>(null);
  const [running,       setRunning]       = useState(false);
  const [savingInputs,  setSavingInputs]  = useState(false);
  const [approving,     setApproving]     = useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [inputValues,   setInputValues]   = useState<Record<string, string>>({});
  const [approveConfirm, setApproveConfirm] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);

  async function makeItLive() {
    setRunning(true);
    setError(null);
    const res = await runAiImportAutopilotAction({ projectId });
    setRunning(false);
    if (res.ok) {
      setRun(res.data);
    } else {
      setError(res.error);
    }
  }

  async function saveInputs() {
    const vals = Object.fromEntries(Object.entries(inputValues).filter(([, v]) => v.trim()));
    if (Object.keys(vals).length === 0) {
      setError("Enter at least one value before saving.");
      return;
    }
    setSavingInputs(true);
    setError(null);
    const res = await saveAutopilotInputsAction({ projectId, values: vals });
    setSavingInputs(false);
    if (res.ok) {
      setRun(res.data);
      setInputValues({});
    } else {
      setError(res.error);
    }
  }

  async function approveAndContinue() {
    if (approveConfirm !== "I APPROVE") {
      setError("Type I APPROVE to confirm.");
      return;
    }
    setApproving(true);
    setError(null);
    const res = await approveAutopilotFixAction({ projectId, confirmation: approveConfirm });
    setApproving(false);
    if (res.ok) {
      setRun(res.data);
      setApproveConfirm("");
    } else {
      setError(res.error);
    }
  }

  async function exportRunbook() {
    setExporting(true);
    const res = await exportAiImportAutopilotRunbookAction({ projectId });
    setExporting(false);
    if (res.ok) {
      downloadMarkdown(res.data.markdown, res.data.filename);
    } else {
      setError(res.error);
    }
  }

  const state = run?.state ?? "idle";
  const groupedInputs = (run?.requiredInputs ?? []).reduce<Record<RequiredInputGroup, RequiredInput[]>>(
    (acc, ri) => {
      (acc[ri.group] ??= []).push(ri);
      return acc;
    },
    { core: [], payments: [], media: [], advanced: [] },
  );
  const hasInputs = (run?.requiredInputs.length ?? 0) > 0;
  const hasInputValues = Object.values(inputValues).some((v) => v.trim());

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Import Autopilot</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                One button makes your project live — I read, fix, deploy, and verify automatically.
              </CardDescription>
            </div>
          </div>
          <StateBadge state={state} />
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        <Button size="default" className="w-full sm:w-auto" onClick={makeItLive} disabled={running}>
          {running
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Working…</>
            : <><Zap className="h-4 w-4 mr-2" /> Make This Project Live</>
          }
        </Button>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</div>
        )}

        {run && (
          <>
            {/* ── Plain English summary ───────────────────────────────────── */}
            <div className="rounded-md bg-muted/50 px-4 py-3">
              <p className="text-sm leading-relaxed">{run.summary}</p>
            </div>

            {/* ── Run log (sequential plain-English steps) ─────────────────── */}
            {run.log.length > 0 && (
              <div className="space-y-1 text-xs text-muted-foreground border-l-2 border-muted pl-3">
                {run.log.map((line, i) => <p key={i}>{line}</p>)}
              </div>
            )}

            {/* ── Grouped secret inputs ───────────────────────────────────── */}
            {hasInputs && (
              <div className="space-y-4 rounded-md border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Needs from you
                </p>
                {(Object.keys(groupedInputs) as RequiredInputGroup[])
                  .filter((g) => groupedInputs[g].length > 0)
                  .map((g) => (
                    <div key={g} className="space-y-3">
                      <p className="text-xs font-medium text-foreground">{GROUP_LABELS[g]}</p>
                      {groupedInputs[g].map((req) => (
                        <SecretField
                          key={req.id}
                          req={req}
                          value={inputValues[req.id] ?? ""}
                          onChange={(v) => setInputValues((prev) => ({ ...prev, [req.id]: v }))}
                        />
                      ))}
                    </div>
                  ))}
                <Button size="sm" onClick={saveInputs} disabled={savingInputs || !hasInputValues} className="mt-1">
                  {savingInputs
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
                    : "Save & Continue"
                  }
                </Button>
              </div>
            )}

            {/* ── Pending fix needing approval ─────────────────────────────── */}
            {run.pendingFix && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Wrench className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{run.pendingFix.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{run.pendingFix.plainEnglishSummary}</p>
                    {run.pendingFix.approvalReason && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">{run.pendingFix.approvalReason}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={approveConfirm}
                    onChange={(e) => setApproveConfirm(e.target.value)}
                    placeholder="Type: I APPROVE"
                    className="h-8 text-xs font-mono max-w-[180px]"
                  />
                  <Button
                    size="sm"
                    disabled={approveConfirm !== "I APPROVE" || approving}
                    onClick={approveAndContinue}
                    className="h-8"
                  >
                    {approving
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Resuming…</>
                      : <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Approve & Continue</>
                    }
                  </Button>
                </div>
              </div>
            )}

            {/* ── Export ────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="ghost" disabled={exporting} onClick={exportRunbook} className="h-8 text-xs">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Export Runbook
              </Button>
            </div>

            {/* ── Preview / domain URLs ────────────────────────────────────── */}
            {(run.browserPreviewUrl || run.publicUrl) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {run.browserPreviewUrl && isBrowserSafe(run.browserPreviewUrl) && (
                  <a
                    href={run.browserPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" /> Panel preview
                  </a>
                )}
                {run.publicUrl && isBrowserSafe(run.publicUrl) && (
                  <a
                    href={run.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:underline"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Live domain
                  </a>
                )}
              </div>
            )}
            {!run.publicUrl && (state === "preview_live" || state === "needs_manual_approval") && (
              <p className="text-xs text-muted-foreground">
                No public domain attached yet. Use panel preview until domain is connected.
              </p>
            )}

            {/* ── Verification checks ──────────────────────────────────────── */}
            {run.checks.filter((c) => c.scope === "browser").length > 0 && (
              <div className="space-y-1">
                {run.checks.filter((c) => c.scope === "browser").map((c) => {
                  const icon =
                    c.status === "pass"    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> :
                    c.status === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" /> :
                                              <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      {icon}
                      <span className="font-mono">{c.label}</span>
                      <span className="text-muted-foreground">{c.result}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Technical details (collapsed) ───────────────────────────── */}
            <div>
              <button
                type="button"
                onClick={() => setShowTechnical((s) => !s)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTechnical ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showTechnical ? "Hide" : "Show"} technical details
              </button>

              {showTechnical && (
                <div className="mt-3 rounded-md bg-muted/50 p-3 space-y-1.5 text-xs font-mono">
                  {run.hiddenTechnicalDetails.packageManager && (
                    <div><span className="text-muted-foreground">package manager:</span> {run.hiddenTechnicalDetails.packageManager}</div>
                  )}
                  {run.hiddenTechnicalDetails.installCommand && (
                    <div><span className="text-muted-foreground">install:</span> {run.hiddenTechnicalDetails.installCommand}</div>
                  )}
                  {run.hiddenTechnicalDetails.buildCommand && (
                    <div><span className="text-muted-foreground">build:</span> {run.hiddenTechnicalDetails.buildCommand}</div>
                  )}
                  {run.hiddenTechnicalDetails.startCommand && (
                    <div><span className="text-muted-foreground">start:</span> {run.hiddenTechnicalDetails.startCommand}</div>
                  )}
                  {run.hiddenTechnicalDetails.pm2Name && (
                    <div><span className="text-muted-foreground">PM2 process:</span> {run.hiddenTechnicalDetails.pm2Name}</div>
                  )}
                  {run.hiddenTechnicalDetails.port && (
                    <div><span className="text-muted-foreground">port:</span> {run.hiddenTechnicalDetails.port}</div>
                  )}
                  {run.hiddenTechnicalDetails.healthPath && (
                    <div><span className="text-muted-foreground">health path:</span> {run.hiddenTechnicalDetails.healthPath}</div>
                  )}
                  {run.hiddenTechnicalDetails.routeMode && (
                    <div><span className="text-muted-foreground">route mode:</span> {run.hiddenTechnicalDetails.routeMode}</div>
                  )}
                  {run.hiddenTechnicalDetails.staticOutputPath && (
                    <div><span className="text-muted-foreground">static output:</span> {run.hiddenTechnicalDetails.staticOutputPath}</div>
                  )}
                  {run.hiddenTechnicalDetails.projectId && (
                    <div className="pt-1 border-t border-border/50 mt-1">
                      <span className="text-muted-foreground">project id:</span> {run.hiddenTechnicalDetails.projectId}
                    </div>
                  )}
                  {run.hiddenTechnicalDetails.projectSlug && (
                    <div><span className="text-muted-foreground">project slug:</span> {run.hiddenTechnicalDetails.projectSlug}</div>
                  )}
                  {run.hiddenTechnicalDetails.deploymentConfigFound !== undefined && (
                    <div><span className="text-muted-foreground">deployment config found:</span> {run.hiddenTechnicalDetails.deploymentConfigFound ? "yes" : "no"}</div>
                  )}
                  {run.hiddenTechnicalDetails.envVarNamesFound && (
                    <div><span className="text-muted-foreground">env vars found:</span> {run.hiddenTechnicalDetails.envVarNamesFound.join(", ") || "none"}</div>
                  )}
                  {run.hiddenTechnicalDetails.latestDeploymentStatus !== undefined && (
                    <div><span className="text-muted-foreground">latest deployment status:</span> {run.hiddenTechnicalDetails.latestDeploymentStatus ?? "none"}</div>
                  )}
                  {run.hiddenTechnicalDetails.sourceDirectoryChecked !== undefined && (
                    <div><span className="text-muted-foreground">source directory checked:</span> {run.hiddenTechnicalDetails.sourceDirectoryChecked ? "found" : "not found"}</div>
                  )}
                  {Object.keys(run.hiddenTechnicalDetails.fixAttempts).length > 0 && (
                    <div>
                      <span className="text-muted-foreground">fix attempts:</span>{" "}
                      {Object.entries(run.hiddenTechnicalDetails.fixAttempts).map(([k, v]) => `${k}=${v}`).join(", ")}
                    </div>
                  )}
                  {run.hiddenTechnicalDetails.lastDeploymentLog && (
                    <div className="pt-1">
                      <span className="text-muted-foreground block mb-1">last deployment log:</span>
                      <pre className="whitespace-pre-wrap break-words text-[10px] max-h-48 overflow-y-auto">
                        {run.hiddenTechnicalDetails.lastDeploymentLog}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 shrink-0" />
              No secrets shown. Only safe config fixes auto-applied. DNS, DB wipe, and go-live always need approval.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Compact card (for Publishing / Preview / Logs / Domains) ─────────────────

function CompactCard({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4 flex items-start gap-3">
        <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">AI Import Autopilot</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            One click makes your project live. No technical setup needed.
          </p>
        </div>
        <a
          href={`/projects/${projectId}/import`}
          className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5 flex items-center gap-1"
        >
          Open <ArrowRight className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}
