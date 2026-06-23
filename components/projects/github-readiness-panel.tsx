"use client";

/**
 * components/projects/github-readiness-panel.tsx
 *
 * Sprint 48: GitHub Auto-Sync Readiness panel.
 *
 * Safety rules:
 *  - Webhook secret never shown in the panel except immediately after generation
 *  - Secret shown ONCE in a dedicated one-time-reveal section; user must copy it
 *  - All status shown as icon + text (no raw env values)
 *  - Auto-deploy warnings always visible when enabled
 */

import { useState } from "react";
import {
  Github,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Link2,
  Link2Off,
  GitBranch,
  Webhook,
  Lock,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Zap,
  ArrowUpCircle,
  Clock,
  Play,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button }                                   from "@/components/ui/button";
import { Badge }                                    from "@/components/ui/badge";
import {
  generateGitHubReadinessReportAction,
  testGitHubWebhookSetupAction,
  generateGitHubWebhookSecretAction,
} from "@/app/actions/github-readiness";
import type {
  GitHubSyncReadinessReport,
  GitHubWebhookTestResult,
  GitHubReadinessStatus,
} from "@/lib/github/github-readiness-types";

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GitHubReadinessStatus }) {
  if (status === "ready")
    return <Badge className="bg-green-100 text-green-800 border-green-200">Ready</Badge>;
  if (status === "warning")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Warning</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200">Blocked</Badge>;
}

function CheckIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok)
    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (warn)
    return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </button>
  );
}

// ── One-time secret reveal ────────────────────────────────────────────────────

function SecretReveal({ secret, warning }: { secret: string; warning: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied,   setCopied]   = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-amber-800 font-medium">{warning}</p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-white border border-amber-200 rounded px-2 py-1 font-mono text-xs tracking-tight break-all select-all">
          {revealed ? secret : "•".repeat(Math.min(secret.length, 40))}
        </code>
        <button
          onClick={() => setRevealed((v) => !v)}
          className="p-1 rounded hover:bg-amber-100 text-amber-700"
          title={revealed ? "Hide secret" : "Reveal secret"}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-amber-100 text-amber-700"
          title="Copy secret"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-amber-700">
        Add as <code className="font-mono bg-amber-100 px-1 rounded">GITHUB_WEBHOOK_SECRET</code> in your server{" "}
        <code className="font-mono bg-amber-100 px-1 rounded">.env</code> file, then configure the same value in GitHub webhook settings.
      </p>
    </div>
  );
}

// ── Webhook test result section ───────────────────────────────────────────────

function WebhookTestResultPanel({ result }: { result: GitHubWebhookTestResult }) {
  return (
    <div className="space-y-1.5 mt-2">
      {result.checks.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
          <CheckIcon
            ok={c.status === "pass"}
            warn={c.status === "warning"}
          />
          <div className="flex-1 min-w-0">
            <span className="font-medium">{c.label}</span>
            <span className="text-muted-foreground ml-1">— {c.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type ActiveAction = "generate" | "test" | "secret" | null;

export function GitHubReadinessPanel({ projectId }: { projectId: string }) {
  const [report,       setReport]       = useState<GitHubSyncReadinessReport | null>(null);
  const [testResult,   setTestResult]   = useState<GitHubWebhookTestResult | null>(null);
  const [generatedSecret, setGeneratedSecret] = useState<{ secret: string; warning: string } | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [expanded,     setExpanded]     = useState(false);
  const [webhookExpanded, setWebhookExpanded] = useState(false);

  // ── Action: generate report ──────────────────────────────────────────────

  async function handleGenerate() {
    setActiveAction("generate");
    setError(null);
    try {
      const res = await generateGitHubReadinessReportAction(projectId);
      if (res.ok) {
        setReport(res.report);
        setExpanded(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Readiness check failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Action: test webhook setup ───────────────────────────────────────────

  async function handleTest() {
    setActiveAction("test");
    setError(null);
    try {
      const res = await testGitHubWebhookSetupAction(projectId);
      if (res.ok) {
        setTestResult(res.result);
        setWebhookExpanded(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Webhook test failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  // ── Action: generate webhook secret ──────────────────────────────────────

  async function handleGenerateSecret() {
    setActiveAction("secret");
    setError(null);
    try {
      const res = await generateGitHubWebhookSecretAction(projectId);
      if (res.ok) {
        setGeneratedSecret({ secret: res.secret, warning: res.warning });
      } else {
        setError(res.error);
      }
    } catch {
      setError("Secret generation failed. Try again.");
    } finally {
      setActiveAction(null);
    }
  }

  const overallStatus = report?.status ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">GitHub Auto-Sync Readiness</CardTitle>
            {overallStatus && <StatusBadge status={overallStatus} />}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              disabled={activeAction !== null}
            >
              {activeAction === "generate" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              {report ? "Re-check" : "Check Readiness"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!report && !error && (
          <p className="text-xs text-muted-foreground">
            Check whether GitHub auto-sync, webhook, and auto-deploy are correctly configured for this project.
          </p>
        )}

        {/* ── Report summary ── */}
        {report && (
          <div className="space-y-3">
            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <CheckIcon ok={report.repositoryConfigured} />
                <span>Repository {report.repositoryConfigured ? "connected" : "not connected"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckIcon ok={report.branchConfigured} />
                <span>Branch {report.branchConfigured ? `(${report.branch})` : "not set"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckIcon ok={report.webhook.secretConfigured} />
                <span>Webhook secret {report.webhook.secretConfigured ? "configured" : "missing"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckIcon ok={!!report.webhook.lastEventAt} warn={!report.webhook.lastEventAt} />
                <span>
                  {report.webhook.lastEventAt
                    ? `Last event ${timeAgo(report.webhook.lastEventAt)}`
                    : "No events yet"}
                </span>
              </div>
            </div>

            {/* Blockers */}
            {report.blockers.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                <p className="text-xs font-semibold text-red-700">
                  {report.blockers.length} blocker{report.blockers.length > 1 ? "s" : ""}
                </p>
                {report.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {b}
                  </p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            {/* Collapsible details */}
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {expanded ? "Hide details" : "Show details"}
            </button>

            {expanded && (
              <div className="space-y-3 border-t pt-3">
                {/* Repo info */}
                <div className="text-xs space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Repository</p>
                  <div className="flex items-center gap-1.5">
                    {report.repositoryConfigured
                      ? <Link2 className="h-3.5 w-3.5 text-green-500" />
                      : <Link2Off className="h-3.5 w-3.5 text-destructive" />}
                    <span>
                      {report.repositoryFullName ?? "No repository connected"}
                    </span>
                  </div>
                  {report.branchConfigured && (
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Branch: <code className="font-mono">{report.branch}</code></span>
                    </div>
                  )}
                </div>

                {/* Sync settings */}
                <div className="text-xs space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Auto-sync</p>
                  <div className="flex items-center gap-1.5">
                    <CheckIcon ok={report.autoPullEnabled} warn={!report.autoPullEnabled} />
                    <span>Auto-pull {report.autoPullEnabled ? "enabled" : "disabled"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckIcon ok={report.autoDeployEnabled} warn={!report.autoDeployEnabled} />
                    <span>Auto-deploy {report.autoDeployEnabled ? "enabled" : "disabled"}</span>
                    {report.autoDeployEnabled && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                        Review carefully
                      </Badge>
                    )}
                  </div>
                  {report.dirtyWorktree && (
                    <div className="flex items-center gap-1.5 text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Worktree has uncommitted changes</span>
                    </div>
                  )}
                  {report.behindRemote && (
                    <div className="flex items-center gap-1.5 text-amber-600">
                      <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>Repository is behind remote</span>
                    </div>
                  )}
                </div>

                {/* Webhook info */}
                <div className="text-xs space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Webhook</p>
                  <div className="flex items-start gap-1.5">
                    <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <code className="font-mono text-[11px] break-all">
                        {report.webhook.webhookUrl}
                      </code>
                      <div className="mt-0.5">
                        <CopyButton value={report.webhook.webhookUrl} label="Copy URL" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Secret: {report.webhook.secretConfigured ? "Configured" : "Not configured"}</span>
                  </div>
                  {report.webhook.lastEventAt && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        Last event: {report.webhook.lastEventType ?? "unknown"} — {timeAgo(report.webhook.lastEventAt)}
                      </span>
                    </div>
                  )}
                  {report.webhook.lastDeliveryId && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      Delivery ID: {report.webhook.lastDeliveryId}
                    </div>
                  )}
                </div>

                {/* Next steps */}
                {report.nextSteps.length > 0 && (
                  <div className="text-xs space-y-1">
                    <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Next steps</p>
                    {report.nextSteps.map((s, i) => (
                      <p key={i} className="flex items-start gap-1.5 text-muted-foreground">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        {s}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Webhook test section ── */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Webhook Setup Test</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={activeAction !== null}
            >
              {activeAction === "test" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5" />
              )}
              {testResult ? "Re-test" : "Test Setup"}
            </Button>
          </div>

          {testResult && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs">
                <CheckIcon ok={testResult.overallPass} />
                <span className={testResult.overallPass ? "text-green-700" : "text-destructive"}>
                  {testResult.overallPass
                    ? "All checks passed"
                    : "Some checks failed — review below"}
                </span>
              </div>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setWebhookExpanded((v) => !v)}
              >
                {webhookExpanded
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />}
                {webhookExpanded ? "Hide checks" : "Show checks"}
              </button>
              {webhookExpanded && <WebhookTestResultPanel result={testResult} />}
            </div>
          )}
        </div>

        {/* ── Secret generation section ── */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Webhook Secret</span>
            </div>
            {!generatedSecret && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateSecret}
                disabled={activeAction !== null}
              >
                {activeAction === "secret" ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                )}
                Generate Secret
              </Button>
            )}
          </div>

          {!generatedSecret && (
            <p className="text-xs text-muted-foreground">
              Generate a strong random secret for your GitHub webhook.
              The value will be shown once — copy it and add it to your server{" "}
              <code className="font-mono bg-muted px-1 rounded">.env</code> as{" "}
              <code className="font-mono bg-muted px-1 rounded">GITHUB_WEBHOOK_SECRET</code>, and enter the same value in GitHub webhook settings.
            </p>
          )}

          {generatedSecret && (
            <SecretReveal
              secret={generatedSecret.secret}
              warning={generatedSecret.warning}
            />
          )}
        </div>

        {report && (
          <p className="text-[10px] text-muted-foreground text-right">
            Generated {timeAgo(report.generatedAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
