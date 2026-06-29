"use client";

/**
 * components/projects/ai-import-operator-panel.tsx
 *
 * Sprint 87: AI Import Operator — one-button "Make Project Live" flow.
 * Shows a simple, plain-English interface. Technical details are collapsed.
 */

import { useState } from "react";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Clock,
  Loader2, ChevronDown, ChevronUp, Download,
  RefreshCw, ArrowRight, ShieldCheck, Eye, EyeOff,
  Wrench,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  generateAiImportOperatorRunAction,
  saveAiImportUserInputsAction,
  executeAiImportFixAction,
  retryAiImportDeployAction,
  exportAiImportOperatorRunbookAction,
} from "@/app/actions/ai-import-operator";
import type {
  AiImportOperatorRun,
  AiImportOperatorStatus,
  AiImportUserInputRequest,
} from "@/lib/ai-import-operator/ai-import-operator-types";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AiImportOperatorStatus, string> = {
  not_started:       "Not started",
  reading_project:   "Reading project…",
  needs_user_input:  "Needs your input",
  ready_to_fix:      "Ready to fix",
  applying_fix:      "Applying fix…",
  deploying:         "Deploying…",
  checking_preview:  "Checking preview…",
  preview_live:      "Preview live",
  ready_for_go_live: "Ready for go-live",
  blocked:           "Blocked",
};

function StatusBadge({ status }: { status: AiImportOperatorStatus }) {
  const variant: "success" | "warning" | "destructive" | "secondary" | "default" =
    status === "preview_live" || status === "ready_for_go_live" ? "success" :
    status === "blocked"                                         ? "destructive" :
    status === "needs_user_input" || status === "ready_to_fix"   ? "warning" :
    "secondary";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function StepDot({ status }: { status: "pending" | "running" | "passed" | "warning" | "blocked" }) {
  if (status === "passed")  return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (status === "blocked") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
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
  req,
  value,
  onChange,
}: {
  req: AiImportUserInputRequest;
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
      {req.safetyNote && (
        <p className="text-[10px] text-muted-foreground">{req.safetyNote}</p>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface AiImportOperatorPanelProps {
  projectId: string;
}

export function AiImportOperatorPanel({ projectId }: AiImportOperatorPanelProps) {
  const [run,            setRun]           = useState<AiImportOperatorRun | null>(null);
  const [loading,        setLoading]       = useState(false);
  const [savingInputs,   setSavingInputs]  = useState(false);
  const [applyingFix,    setApplyingFix]   = useState(false);
  const [retrying,       setRetrying]      = useState(false);
  const [exporting,      setExporting]     = useState(false);
  const [error,          setError]         = useState<string | null>(null);
  const [successMsg,     setSuccessMsg]    = useState<string | null>(null);
  const [inputValues,    setInputValues]   = useState<Record<string, string>>({});
  const [fixConfirm,     setFixConfirm]    = useState("");
  const [retryConfirm,   setRetryConfirm]  = useState("");
  const [showTechnical,  setShowTechnical] = useState(false);

  function clearMessages() {
    setError(null);
    setSuccessMsg(null);
  }

  async function analyze() {
    setLoading(true);
    clearMessages();
    const res = await generateAiImportOperatorRunAction({ projectId });
    setLoading(false);
    if (res.ok) {
      setRun(res.data);
    } else {
      setError(res.error);
    }
  }

  async function saveInputs() {
    const vals = Object.fromEntries(
      Object.entries(inputValues).filter(([, v]) => v.trim())
    );
    if (Object.keys(vals).length === 0) {
      setError("Enter at least one value before saving.");
      return;
    }
    setSavingInputs(true);
    clearMessages();
    const res = await saveAiImportUserInputsAction({ projectId, values: vals });
    setSavingInputs(false);
    if (res.ok) {
      setRun(res.data);
      setInputValues({});
      setSuccessMsg("Values saved securely.");
    } else {
      setError(res.error);
    }
  }

  async function applyFix() {
    if (fixConfirm !== "APPLY FIX") {
      setError("Type APPLY FIX to confirm.");
      return;
    }
    if (!run?.fixPlan) {
      setError("No fix plan available.");
      return;
    }
    setApplyingFix(true);
    clearMessages();
    const res = await executeAiImportFixAction({
      projectId,
      fixId:        run.fixPlan.id,
      confirmation: fixConfirm,
    });
    setApplyingFix(false);
    if (res.ok) {
      setRun(res.data);
      setFixConfirm("");
      setSuccessMsg("Fix applied. Check the status and retry deploy.");
    } else {
      setError(res.error);
    }
  }

  async function retryDeploy() {
    if (retryConfirm !== "RETRY DEPLOY") {
      setError("Type RETRY DEPLOY to confirm.");
      return;
    }
    setRetrying(true);
    clearMessages();
    const res = await retryAiImportDeployAction({ projectId, confirmation: retryConfirm });
    setRetrying(false);
    if (res.ok) {
      setRun(res.data.run);
      setRetryConfirm("");
      setSuccessMsg("Deploy started. Preview checks will update shortly.");
    } else {
      setError(res.error);
    }
  }

  async function exportRunbook() {
    setExporting(true);
    const res = await exportAiImportOperatorRunbookAction({ projectId });
    setExporting(false);
    if (res.ok) {
      downloadMarkdown(res.data.markdown, res.data.filename);
    } else {
      setError(res.error);
    }
  }

  const status    = run?.status ?? "not_started";
  const hasInputs = (run?.userInputsNeeded ?? []).filter((i) => i.kind !== "domain").length > 0;
  const hasFix    = !!run?.fixPlan;
  const hasNonSecretInputValues = Object.values(inputValues).some((v) => v.trim());

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Import Operator</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                One button. I read your project, detect what's needed, and make it live.
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* ── Main action button ──────────────────────────────────────────── */}
        <Button
          size="default"
          className="w-full sm:w-auto"
          onClick={analyze}
          disabled={loading}
        >
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Analyzing…</>
            : <><Zap className="h-4 w-4 mr-2" /> Make Project Live</>
          }
        </Button>

        {/* ── Messages ────────────────────────────────────────────────────── */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded px-3 py-2 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {successMsg}
          </div>
        )}

        {run && (
          <>
            {/* ── Plain English Summary ───────────────────────────────────── */}
            <div className="rounded-md bg-muted/50 px-4 py-3">
              <p className="text-sm leading-relaxed">{run.plainEnglishSummary}</p>
              {run.currentQuestion && (
                <p className="text-xs text-muted-foreground mt-1.5">{run.currentQuestion}</p>
              )}
            </div>

            {/* ── User Input Fields ────────────────────────────────────────── */}
            {hasInputs && (
              <div className="space-y-3 rounded-md border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Needs from you
                </p>
                {run.userInputsNeeded
                  .filter((i) => i.kind !== "domain")
                  .map((req) => (
                    <SecretField
                      key={req.id}
                      req={req}
                      value={inputValues[req.id] ?? ""}
                      onChange={(v) =>
                        setInputValues((prev) => ({ ...prev, [req.id]: v }))
                      }
                    />
                  ))}
                <Button
                  size="sm"
                  onClick={saveInputs}
                  disabled={savingInputs || !hasNonSecretInputValues}
                  className="mt-1"
                >
                  {savingInputs
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
                    : "Save Values Securely"
                  }
                </Button>
              </div>
            )}

            {/* ── Fix Plan ─────────────────────────────────────────────────── */}
            {hasFix && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Wrench className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{run.fixPlan!.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {run.fixPlan!.plainEnglishSummary}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={fixConfirm}
                    onChange={(e) => setFixConfirm(e.target.value)}
                    placeholder="Type: APPLY FIX"
                    className="h-8 text-xs font-mono max-w-[180px]"
                  />
                  <Button
                    size="sm"
                    disabled={fixConfirm !== "APPLY FIX" || applyingFix}
                    onClick={applyFix}
                    className="h-8"
                  >
                    {applyingFix
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Applying…</>
                      : <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Apply Fix</>
                    }
                  </Button>
                </div>
              </div>
            )}

            {/* ── Retry Deploy ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                value={retryConfirm}
                onChange={(e) => setRetryConfirm(e.target.value)}
                placeholder="Type: RETRY DEPLOY"
                className="h-8 text-xs font-mono w-[180px]"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={retryConfirm !== "RETRY DEPLOY" || retrying}
                onClick={retryDeploy}
                className="h-8"
              >
                {retrying
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Deploying…</>
                  : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry Deploy</>
                }
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={exporting}
                onClick={exportRunbook}
                className="h-8 text-xs"
              >
                {exporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Download className="h-3.5 w-3.5 mr-1.5" />
                }
                Export Runbook
              </Button>
            </div>

            {/* ── Steps overview ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {run.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-1.5 text-xs">
                  <StepDot status={step.status} />
                  <span className={step.status === "passed" ? "text-foreground" : "text-muted-foreground"}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Preview checks ───────────────────────────────────────────── */}
            {run.previewChecks.length > 0 && (
              <div className="space-y-1">
                {run.previewChecks.map((c, i) => {
                  const icon =
                    c.status === "pass"    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> :
                    c.status === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" /> :
                                             <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {icon}
                      <span className="font-mono">{c.urlOrPath}</span>
                      <span className="text-muted-foreground">{c.result}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Preview / domain URLs ────────────────────────────────────── */}
            {(run.previewUrl || run.publicDomain) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {run.previewUrl && (
                  <a
                    href={run.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </a>
                )}
                {run.publicDomain && (
                  <a
                    href={run.publicDomain}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:underline"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Live domain
                  </a>
                )}
              </div>
            )}

            {/* ── Technical details (collapsed) ───────────────────────────── */}
            <div>
              <button
                type="button"
                onClick={() => setShowTechnical((s) => !s)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTechnical
                  ? <ChevronUp className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />
                }
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
                  {run.hiddenTechnicalDetails.routeMode && (
                    <div><span className="text-muted-foreground">route mode:</span> {run.hiddenTechnicalDetails.routeMode}</div>
                  )}
                  {run.hiddenTechnicalDetails.staticOutputPath && (
                    <div><span className="text-muted-foreground">static output:</span> {run.hiddenTechnicalDetails.staticOutputPath}</div>
                  )}
                  {run.hiddenTechnicalDetails.healthPath && (
                    <div><span className="text-muted-foreground">health path:</span> {run.hiddenTechnicalDetails.healthPath}</div>
                  )}
                  {run.hiddenTechnicalDetails.knownErrors.length > 0 && (
                    <div className="text-yellow-600 dark:text-yellow-400">
                      <span className="text-muted-foreground">issues:</span>{" "}
                      {run.hiddenTechnicalDetails.knownErrors.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Safety note ──────────────────────────────────────────────── */}
            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 shrink-0" />
              No secrets shown. All fixes require confirmation. No automatic go-live.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
