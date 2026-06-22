"use client";

/**
 * components/projects/project-promotion-panel.tsx
 *
 * Sprint 39: Release promotion workflow UI.
 *
 * Flow:
 *  1. Shows latest successful deployment.
 *  2. "Run Preflight" → checks readiness.
 *  3. Preflight results displayed with pass/warning/fail badges.
 *  4. "Create Promotion" → starts approval record.
 *  5. User types PROMOTE → "Promote to Production" button activates.
 *  6. Shows recent promotions history.
 */

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  ChevronDown, ChevronRight, Rocket, RotateCcw, X, ShieldCheck,
  ExternalLink, GitBranch, Info,
} from "lucide-react";
import { cn }                     from "@/lib/utils";
import { Button }                 from "@/components/ui/button";
import { Input }                  from "@/components/ui/input";
import { Badge }                  from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type {
  ReleaseReadinessCheck,
  ReleaseReadinessReport,
  ReleasePromotionDTO,
} from "@/lib/releases/release-types";
import {
  getLatestPromotableDeploymentAction,
  getActivePromotionAction,
  runPreflightAction,
  createPromotionAction,
  runPromotionPreflightAction,
  approveAndPromoteAction,
  cancelPromotionAction,
  listPromotionsAction,
} from "@/app/actions/release-promotions";

// ── Status icons ──────────────────────────────────────────────────────────────

function CheckIcon({ status }: { status: ReleaseReadinessCheck["status"] }) {
  if (status === "pass")    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (status === "fail")    return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function checkBadgeVariant(status: ReleaseReadinessCheck["status"]): "success" | "warning" | "error" | "secondary" {
  if (status === "pass")    return "success";
  if (status === "warning") return "warning";
  if (status === "fail")    return "error";
  return "secondary";
}

function overallBadge(s: ReleaseReadinessReport["overallStatus"]) {
  if (s === "ready")   return <Badge variant="success">Ready</Badge>;
  if (s === "warning") return <Badge variant="warning">Warning</Badge>;
  return <Badge variant="error">Blocked</Badge>;
}

function promoStatusBadge(status: ReleasePromotionDTO["status"]) {
  const map: Record<string, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    pending:   { variant: "secondary", label: "Pending" },
    approved:  { variant: "warning",   label: "Approved" },
    promoting: { variant: "warning",   label: "Promoting…" },
    promoted:  { variant: "success",   label: "Promoted" },
    failed:    { variant: "error",     label: "Failed" },
    cancelled: { variant: "secondary", label: "Cancelled" },
  };
  const m = map[status] ?? { variant: "secondary", label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function formatRelative(iso: string) {
  const diff    = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)  return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PreflightChecks({ checks }: { checks: ReleaseReadinessCheck[] }) {
  return (
    <div className="divide-y divide-border rounded-md border">
      {checks.map((c) => (
        <div key={c.id} className="flex items-start gap-3 px-3 py-2.5">
          <CheckIcon status={c.status} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">{c.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>
          </div>
          {c.href && (
            <Link href={c.href} className="shrink-0 text-xs text-primary hover:underline flex items-center gap-0.5">
              View <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function PromotionHistoryRow({ p }: { p: ReleasePromotionDTO }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-foreground">{p.deploymentRef.slice(0, 14)}</code>
          {promoStatusBadge(p.status)}
          {p.preflightStatus !== "not_run" && (
            <Badge variant={p.preflightStatus === "passed" ? "success" : p.preflightStatus === "warning" ? "warning" : "error"} className="text-[10px]">
              PF: {p.preflightStatus}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {p.approvedByEmail ? `by ${p.approvedByEmail} · ` : ""}
          {formatRelative(p.createdAt)}
          {p.rollbackDeploymentRef && p.status === "promoted" && (
            <span className="ml-2 flex items-center gap-1 inline-flex">
              <RotateCcw className="h-3 w-3" />
              rollback: <code className="font-mono">{p.rollbackDeploymentRef.slice(0, 10)}</code>
            </span>
          )}
        </p>
        {p.failureReason && (
          <p className="text-xs text-destructive mt-0.5">{p.failureReason.slice(0, 120)}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProjectPromotionPanelProps {
  projectId: string;
}

export function ProjectPromotionPanel({ projectId }: ProjectPromotionPanelProps) {
  type Deployment = { id: string; deploymentRef: string; sourceRef: string | null; createdAt: string; isActive: boolean };

  const [loading, setLoading]           = useState(true);
  const [deployment, setDeployment]     = useState<Deployment | null>(null);
  const [report, setReport]             = useState<ReleaseReadinessReport | null>(null);
  const [promotion, setPromotion]       = useState<ReleasePromotionDTO | null>(null);
  const [history, setHistory]           = useState<ReleasePromotionDTO[]>([]);
  const [error, setError]               = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [showHistory, setShowHistory]   = useState(false);

  const [isPending, startTransition] = useTransition();

  async function loadData() {
    setLoading(true);
    setError(null);
    const [depRes, promoRes, histRes] = await Promise.all([
      getLatestPromotableDeploymentAction(projectId),
      getActivePromotionAction(projectId),
      listPromotionsAction(projectId, 5),
    ]);
    if (depRes.ok)   setDeployment(depRes.deployment);
    if (promoRes.ok) setPromotion(promoRes.promotion);
    if (histRes.ok)  setHistory(histRes.promotions);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [projectId]);

  function handleError(msg: string) {
    setError(msg);
  }

  function onRunPreflight() {
    if (!deployment) return;
    setError(null);
    setReport(null);

    if (promotion?.id) {
      // run against existing promotion
      startTransition(async () => {
        const res = await runPromotionPreflightAction(projectId, promotion.id);
        if (!res.ok) { handleError(res.error); return; }
        setPromotion(res.promotion);
        setReport({
          projectId,
          deploymentId:  res.promotion.deploymentId ?? deployment.id,
          deploymentRef: res.promotion.deploymentRef,
          generatedAt:   new Date().toISOString(),
          overallStatus:
            res.promotion.preflightStatus === "passed"  ? "ready"   :
            res.promotion.preflightStatus === "warning" ? "warning" :
            "blocked",
          checks:        res.promotion.preflightChecks ?? [],
          rollbackTarget: res.promotion.rollbackDeploymentId
            ? { deploymentId: res.promotion.rollbackDeploymentId, deploymentRef: res.promotion.rollbackDeploymentRef ?? "", }
            : undefined,
        });
      });
    } else {
      // standalone preflight (before creating a promotion)
      startTransition(async () => {
        const res = await runPreflightAction(projectId, deployment.id);
        if (!res.ok) { handleError(res.error); return; }
        setReport(res.report);
      });
    }
  }

  function onCreatePromotion() {
    if (!deployment) return;
    setError(null);
    startTransition(async () => {
      const res = await createPromotionAction(projectId, deployment.id);
      if (!res.ok) { handleError(res.error); return; }
      setPromotion(res.promotion);
    });
  }

  function onPromote() {
    if (!promotion) return;
    setError(null);
    startTransition(async () => {
      const res = await approveAndPromoteAction(projectId, promotion.id, confirmation);
      if (!res.ok) { handleError(res.error); return; }
      setPromotion(res.promotion);
      setConfirmation("");
      // Refresh history after promotion
      const histRes = await listPromotionsAction(projectId, 5);
      if (histRes.ok) setHistory(histRes.promotions);
    });
  }

  function onCancel() {
    if (!promotion) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelPromotionAction(projectId, promotion.id);
      if (!res.ok) { handleError(res.error); return; }
      setPromotion(null);
      setReport(null);
      setConfirmation("");
      const histRes = await listPromotionsAction(projectId, 5);
      if (histRes.ok) setHistory(histRes.promotions);
    });
  }

  const canPromote      = !!promotion && ["pending", "approved"].includes(promotion.status);
  const preflightPassed = promotion?.preflightStatus === "passed" || promotion?.preflightStatus === "warning";
  const confirmReady    = confirmation.trim() === "PROMOTE";
  const promoted        = promotion?.status === "promoted";

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading release status…
        </CardContent>
      </Card>
    );
  }

  if (!deployment) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Release Promotion
          </CardTitle>
          <CardDescription>Formally promote a verified release to production.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No successful deployments yet. Deploy your project first to create a promotion candidate.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Release Promotion
          </CardTitle>
          {promotion && promoStatusBadge(promotion.status)}
        </div>
        <CardDescription>
          Verify and formally approve a deployment as the production release.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* ── Deployment summary ── */}
        <div className="rounded-md border bg-muted/30 px-3 py-2.5">
          <p className="text-xs text-muted-foreground mb-0.5">Latest successful deployment</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono font-medium">{deployment.deploymentRef.slice(0, 18)}</code>
            {deployment.isActive && <Badge variant="success" className="text-[10px]">Active</Badge>}
            {deployment.sourceRef && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                <code className="font-mono">{deployment.sourceRef.slice(0, 8)}</code>
              </span>
            )}
            <span className="text-xs text-muted-foreground">{formatRelative(deployment.createdAt)}</span>
          </div>
        </div>

        {/* ── Safety notices ── */}
        {!promoted && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1">
              <Info className="h-3.5 w-3.5" />
              Before promoting
            </p>
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside">
              <li>Production promotion will mark this deployment as the active release.</li>
              {promotion?.rollbackDeploymentRef
                ? <li>Rollback target: <code className="font-mono">{promotion.rollbackDeploymentRef.slice(0, 14)}</code></li>
                : <li>A recent backup is recommended before promoting.</li>}
            </ul>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-start gap-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* ── Preflight section ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Preflight checks</p>
            {report && overallBadge(report.overallStatus)}
          </div>

          {report?.checks && <PreflightChecks checks={report.checks} />}

          <Button
            variant="outline"
            size="sm"
            onClick={onRunPreflight}
            disabled={isPending}
            className="w-full"
          >
            {isPending && promotion?.preflightStatus === "running" ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Running…</>
            ) : (
              <><ShieldCheck className="h-3.5 w-3.5 mr-2" />{report ? "Re-run Preflight" : "Run Preflight"}</>
            )}
          </Button>
        </div>

        {/* ── Create promotion candidate ── */}
        {!promotion && report && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCreatePromotion}
            disabled={isPending || report.overallStatus === "blocked"}
            className="w-full"
          >
            <Rocket className="h-3.5 w-3.5 mr-2" />
            Create Promotion Candidate
          </Button>
        )}

        {/* ── Approve & promote ── */}
        {canPromote && preflightPassed && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Promote to production</p>
            <p className="text-xs text-muted-foreground">
              Type <code className="font-mono font-semibold">PROMOTE</code> to confirm this promotion.
            </p>
            <div className="flex gap-2">
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="PROMOTE"
                className="font-mono h-8 text-sm flex-1"
                disabled={isPending}
              />
              <Button
                size="sm"
                onClick={onPromote}
                disabled={!confirmReady || isPending}
                className="shrink-0"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Rocket className="h-3.5 w-3.5 mr-1.5" />Promote</>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Awaiting preflight ── */}
        {canPromote && !preflightPassed && (
          <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
            Run and pass preflight checks to unlock the Promote button.
          </div>
        )}

        {/* ── Success state ── */}
        {promoted && (
          <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2.5 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">Promotion successful</p>
              {promotion?.rollbackDeploymentRef && (
                <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                  Rollback target: <code className="font-mono">{promotion.rollbackDeploymentRef.slice(0, 14)}</code>
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Cancel ── */}
        {canPromote && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
            className="w-full text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Cancel promotion
          </Button>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Recent promotions ({history.length})
            </button>
            {showHistory && (
              <div>
                {history.map((p) => <PromotionHistoryRow key={p.id} p={p} />)}
                <Link
                  href={`/projects/${projectId}/releases`}
                  className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View all releases <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
