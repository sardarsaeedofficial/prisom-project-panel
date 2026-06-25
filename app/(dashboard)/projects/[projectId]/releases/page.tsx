import type { Metadata }  from "next";
import { notFound }        from "next/navigation";
import Link                from "next/link";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Rocket,
  RotateCcw, ChevronLeft, GitBranch, Database, Flag, ShoppingCart, Trophy, Container, ShieldCheck, Activity, BookOpen,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }               from "@/components/projects/workspace-nav";
import { Badge }                       from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
}                                      from "@/components/ui/card";
import { db }                          from "@/lib/db";
import { listProjectPromotions }       from "@/lib/releases/release-promotion-service";
import { requireProjectPermission }    from "@/lib/auth/project-membership";
import { GoLiveReadinessPanel }            from "@/components/projects/go-live-readiness-panel";
import { ReleaseComparisonCard }           from "@/components/projects/release-comparison-card";
import { SardarMigrationRunbookPanel }        from "@/components/projects/sardar-migration-runbook-panel";
import { StagingImportPanel }                 from "@/components/projects/staging-import-panel";
import { DeploymentDryRunPanel }              from "@/components/projects/deployment-dry-run-panel";
import { ExternalServicesReadinessPanel }     from "@/components/projects/external-services-readiness-panel";
import { ProductionCutoverPanel }             from "@/components/projects/production-cutover-panel";
import { GoLiveRegressionChecklist }          from "@/components/projects/go-live-regression-checklist";
import { FinalGoLiveControlRoom }             from "@/components/projects/final-go-live-control-room";
import { DebugSummaryPanel }                  from "@/components/projects/debug-summary-panel";
import { ProductionExecutionPanel }           from "@/components/projects/production-execution-panel";
import { ContextualHelpCard }                 from "@/components/projects/contextual-help-card";
import { ReleaseCandidatePanel }              from "@/components/projects/release-candidate-panel";
import { QaVerificationPanel }               from "@/components/projects/qa-verification-panel";
import { ProjectProfileCard }                from "@/components/projects/project-profile-card";
import { LaunchSignoffPanel }                from "@/components/projects/launch-signoff-panel";
import { OperatorTrainingPanel }             from "@/components/projects/operator-training-panel";
import { CutoverRehearsalPanel }             from "@/components/projects/cutover-rehearsal-panel";
import { LaunchFreezePanel }                 from "@/components/projects/launch-freeze-panel";
import { isSardarProject }                    from "@/lib/migration/sardar-migration-types";

export const dynamic  = "force-dynamic";
export const metadata: Metadata = { title: "Releases" };

type Props = { params: Promise<{ projectId: string }> };

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function promoStatusBadge(status: string) {
  const map: Record<string, { variant: "success" | "warning" | "error" | "secondary"; label: string }> = {
    pending:   { variant: "secondary", label: "Pending" },
    approved:  { variant: "warning",   label: "Approved" },
    promoting: { variant: "warning",   label: "Promoting" },
    promoted:  { variant: "success",   label: "Promoted" },
    failed:    { variant: "error",     label: "Failed" },
    cancelled: { variant: "secondary", label: "Cancelled" },
  };
  const m = map[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function preflightIcon(status: string) {
  if (status === "passed")  return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  if (status === "failed")  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

export default async function ReleasesPage({ params }: Props) {
  const { projectId } = await params;

  const ctx = await requireProjectPermission(projectId, "project.view");
  if (!ctx.ok) notFound();

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  // Sprint 50: Sardar runbook compact card
  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  // Sprint 49: Server-side go-live status for blocker banner (non-fatal)
  let goLiveBlocked = false;
  let goLiveBlockerCount = 0;
  try {
    const { generateGoLiveReadinessReport } = await import("@/lib/go-live/go-live-readiness-service");
    const glReport = await generateGoLiveReadinessReport(projectId);
    if (glReport.status === "blocked") {
      goLiveBlocked      = true;
      goLiveBlockerCount = glReport.blockers.length;
    }
  } catch { /* non-fatal */ }

  const [promotions, deployments] = await Promise.all([
    listProjectPromotions(projectId, 20),
    db.deployment.findMany({
      where:   { projectId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take:    20,
      select: {
        id:           true,
        metadata:     true,
        createdAt:    true,
        isActive:     true,
        activatedAt:  true,
        commitSha:    true,
        commitMessage: true,
        duration:     true,
        branch:       true,
      },
    }),
  ]);

  // Build a map from deploymentId → promotion for quick lookup
  const promoByDeploymentId = new Map(
    promotions.filter((p) => p.deploymentId).map((p) => [p.deploymentId!, p]),
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <div className="flex items-center gap-2 mb-2">
          <Link
            href={`/projects/${projectId}/publishing`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Publishing
          </Link>
        </div>

        <PageHeader
          title="Releases"
          description="Deployment history, release promotions, and rollback targets."
        />

        <div className="space-y-5 max-w-3xl">

          {/* Sprint 71: Project Migration Profile */}
          <ProjectProfileCard projectId={projectId} />

          {/* Help card */}
          <ContextualHelpCard
            purpose="Deployment history, release promotions, go-live control room, and production cutover guard."
            doHere="Generate the execution plan. Preview production routes. Run smoke checks. Export the production execution plan."
            dontDo="Do not type APPLY PRODUCTION CUTOVER until all 14 evidence items are reviewed and a backup is confirmed. The panel records the request — nginx must still be applied manually by an operator."
            nextPage={{ label: "Monitoring (post-cutover)", href: `/projects/${projectId}/monitoring` }}
          />

          {/* ── Final Verification ────────────────────────────────────── */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Final Verification</p>

          {isSardar && (
            <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
              <Activity className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Live QA Verification</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  QA report — routes, exports, confirmations, safety, smoke checks, 18-item manual checklist. <span className="text-primary">↓ Panel below</span>
                </p>
              </div>
            </div>
          )}

          {isSardar && (
            <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Release Candidate Hardening</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Final hardening score, blockers, manual checklist, confirmation phrase index, smoke commands. <span className="text-primary">↓ Panel below</span>
                </p>
              </div>
            </div>
          )}

          {/* ── Execution ─────────────────────────────────────────────── */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Execution</p>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Production Cutover Execution Guard</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Confirmation-gated workflow — APPLY PRODUCTION CUTOVER, RUN PRODUCTION SMOKE CHECKS, EXECUTE PRODUCTION ROLLBACK. <span className="text-primary">↓ Panel below</span>
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Trophy className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Final Go-Live Control Room</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aggregate readiness gate — all Sprint 50–68 checks. Generate FINAL_GO_LIVE_PACK.md before cutover. <span className="text-primary">↓ Panel below</span>
              </p>
            </div>
          </div>

          {/* ── Monitoring ───────────────────────────────────────────── */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">After Cutover</p>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Activity className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Post-Cutover Monitoring</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Monitor production health, triage incidents, run health checks, and support rollback decisions after cutover.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/monitoring`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Monitoring →
            </Link>
          </div>

          {/* ── Prerequisites ────────────────────────────────────────── */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Prerequisites</p>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Container className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Staging Deployment</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plan and verify an isolated staging deployment — service config, source prep, smoke checks, STAGING_DEPLOYMENT_PROOF.md.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ShoppingCart className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Ecommerce Test Harness</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Prove checkout, orders, and Stripe test-mode readiness on staging. No real charges — required before production go-live.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Flag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Staging Trial Migration</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complete the staging trial before production cutover — smoke checks, env, DB, routing, and backup drill must all pass.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Migration →
            </Link>
          </div>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <Database className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Backup / Restore Drill</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Run a full restore drill before production cutover to confirm your backups are recoverable.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/backups`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Backups →
            </Link>
          </div>

          {/* ── Documentation ────────────────────────────────────────── */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Documentation</p>

          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <BookOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Operator Runbook</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Daily operations, incident response, rollback procedures, and handoff exports.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/runbook`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Go to Runbook →
            </Link>
          </div>

          {/* Sprint 74: Launch Signoff + Training compact refs */}
          <LaunchSignoffPanel projectId={projectId} compact />
          <OperatorTrainingPanel projectId={projectId} compact />

          {/* Sprint 75: Cutover Rehearsal + Freeze compact refs */}
          <CutoverRehearsalPanel projectId={projectId} compact />
          <LaunchFreezePanel projectId={projectId} compact />

          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Panels</p>

          {/* ── Sprint 69: Live QA Verification ── */}
          {isSardar && (
            <div className="rounded-xl border bg-card p-4">
              <QaVerificationPanel projectId={projectId} />
            </div>
          )}

          {/* ── Sprint 68: Release Candidate Hardening ── */}
          {isSardar && (
            <div className="rounded-xl border bg-card p-4">
              <ReleaseCandidatePanel projectId={projectId} />
            </div>
          )}

          {/* ── Sprint 65: Production Cutover Execution Guard ── */}
          <div className="rounded-xl border bg-card p-4">
            <ProductionExecutionPanel projectId={projectId} />
          </div>

          {/* ── Sprint 63: Final Go-Live Control Room ── */}
          <div className="rounded-xl border bg-card p-4">
            <FinalGoLiveControlRoom projectId={projectId} />
          </div>

          {/* ── Sprint 74: Final Launch Signoff ── */}
          <LaunchSignoffPanel projectId={projectId} />

          {/* ── Sprint 75: Production Cutover Rehearsal ── */}
          <CutoverRehearsalPanel projectId={projectId} />

          {/* ── Sprint 75: Launch Freeze Checklist ── */}
          <LaunchFreezePanel projectId={projectId} />

          {/* ── Sprint 58: Debug failed dry-run/cutover ── */}
          <DebugSummaryPanel projectId={projectId} compact context="dry_run" />

          {/* ── Sprint 56: Go-Live Regression Checklist ── */}
          <GoLiveRegressionChecklist projectId={projectId} />

          {/* ── Sprint 55: Production Cutover Assistant — full panel ── */}
          <ProductionCutoverPanel projectId={projectId} />

          {/* ── Sprint 54: External Services compact card ── */}
          <ExternalServicesReadinessPanel projectId={projectId} compact />

          {/* ── Sprint 53: Deployment dry-run compact card ── */}
          <DeploymentDryRunPanel projectId={projectId} compact />

          {/* ── Sprint 51: Staging import compact card ── */}
          {isSardar && (
            <StagingImportPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 50: Sardar migration runbook compact card ── */}
          {isSardar && (
            <SardarMigrationRunbookPanel projectId={projectId} compact />
          )}

          {/* ── Sprint 49: Go-Live Readiness ── */}
          <GoLiveReadinessPanel projectId={projectId} />

          {/* ── Sprint 49: Blocker banner ── */}
          {goLiveBlocked && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex items-start gap-3">
              <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Go-live readiness: {goLiveBlockerCount} blocker{goLiveBlockerCount > 1 ? "s" : ""} detected
                </p>
                <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                  Fix all blockers in the Go-Live Readiness panel above before promoting to production.
                  Promoting with blockers may break production.
                </p>
              </div>
            </div>
          )}

          {/* ── Sprint 49: Release Comparison ── */}
          <ReleaseComparisonCard projectId={projectId} />

          {/* ── Promotions ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Rocket className="h-4 w-4" />
                Release Promotions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {promotions.length === 0 ? (
                <div className="py-8 text-center">
                  <Rocket className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No release promotions yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the <Link href={`/projects/${projectId}/publishing`} className="text-primary hover:underline">Publishing</Link> page to promote a release.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {promotions.map((p) => (
                    <div key={p.id} className="py-3 flex items-start gap-3">
                      <div className="pt-0.5">{preflightIcon(p.preflightStatus)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-sm font-mono font-medium">{p.deploymentRef.slice(0, 16)}</code>
                          {promoStatusBadge(p.status)}
                        </div>
                        <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          <span>{formatDate(p.createdAt)}</span>
                          {p.approvedByEmail && <span>by {p.approvedByEmail}</span>}
                          {p.rollbackDeploymentRef && p.status === "promoted" && (
                            <span className="flex items-center gap-1">
                              <RotateCcw className="h-3 w-3" />
                              rollback: <code className="font-mono">{p.rollbackDeploymentRef.slice(0, 12)}</code>
                            </span>
                          )}
                        </div>
                        {p.failureReason && (
                          <p className="mt-1 text-xs text-destructive">{p.failureReason.slice(0, 160)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Deployment history ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Successful Deployments</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {deployments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No successful deployments.</p>
              ) : (
                <div className="divide-y divide-border">
                  {deployments.map((dep) => {
                    const meta          = dep.metadata as Record<string, unknown> | null;
                    const deploymentRef = (meta?.deploymentRef as string) ?? dep.id;
                    const promo         = promoByDeploymentId.get(dep.id);

                    return (
                      <div key={dep.id} className="py-3 flex items-start gap-3">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-sm font-mono font-medium">{deploymentRef.slice(0, 16)}</code>
                            {dep.isActive && <Badge variant="success" className="text-[10px]">Active</Badge>}
                            {promo && promoStatusBadge(promo.status)}
                          </div>
                          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            <span>{formatDate(dep.createdAt.toISOString())}</span>
                            {dep.branch && (
                              <span className="flex items-center gap-1">
                                <GitBranch className="h-3 w-3" />
                                {dep.branch}
                              </span>
                            )}
                            {dep.commitSha && <code className="font-mono">{dep.commitSha.slice(0, 7)}</code>}
                            {dep.duration && (
                              <span>{Math.round(dep.duration / 1000)}s</span>
                            )}
                          </div>
                          {dep.commitMessage && (
                            <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-md">
                              {dep.commitMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </DashboardShell>
    </div>
  );
}
