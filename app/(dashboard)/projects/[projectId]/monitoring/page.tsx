import type { Metadata } from "next";
import { notFound }      from "next/navigation";

import {
  DashboardShell,
  PageHeader,
} from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { db }                          from "@/lib/db";
import { isSardarProject }            from "@/lib/migration/sardar-migration-types";
import { ProjectMonitoringPanel }      from "@/components/projects/project-monitoring-panel";
import { PostCutoverMonitoringPanel }  from "@/components/projects/post-cutover-monitoring-panel";
import { ContextualHelpCard }         from "@/components/projects/contextual-help-card";
import { LaunchDaySupportPanel }      from "@/components/projects/launch-day-support-panel";
import { PostLaunchBugCapturePanel }  from "@/components/projects/post-launch-bug-capture-panel";
import { FinalReadinessAuditPanel }   from "@/components/projects/final-readiness-audit-panel";
import { StopBuildGatePanel }        from "@/components/projects/stop-build-gate-panel";
import { DeployVerificationPanel }   from "@/components/projects/deploy-verification-panel";
import { LaunchExecutionChecklistPanel } from "@/components/projects/launch-execution-checklist-panel";
import { FinalLiveVerificationPanel }    from "@/components/projects/final-live-verification-panel";
import { GoNoGoEvidencePanel }           from "@/components/projects/go-no-go-evidence-panel";
import { HelpCenterPanel }               from "@/components/projects/help-center-panel";

export const metadata: Metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectMonitoringPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  const isSardar = isSardarProject(project.name) || isSardarProject(project.slug ?? "");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Monitoring"
          description="On-demand observability snapshot for this project. Read-only — no actions are performed."
        />

        <div className="max-w-3xl space-y-6">
          {/* Sprint 67: Contextual help card */}
          <ContextualHelpCard
            purpose="Check production health, classify incidents, review rollback recommendations after cutover."
            doHere="Generate monitoring report. Run RUN PRODUCTION HEALTH CHECKS. Complete ecommerce checklist. Export POST_CUTOVER_MONITORING_REPORT.md."
            dontDo="Do not execute rollback here automatically. Do not restart PM2. Do not change DNS. This page is observation and documentation only."
            nextPage={{ label: "Releases (cutover/rollback)", href: `/projects/${projectId}/releases` }}
          />

          {/* Sprint 66: Post-Cutover Monitoring Control Room */}
          {isSardar && (
            <Card>
              <CardContent className="pt-5 pb-5">
                <PostCutoverMonitoringPanel projectId={projectId} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-5 pb-5">
              <ProjectMonitoringPanel
                projectId={projectId}
                projectSlug={project.slug}
              />
            </CardContent>
          </Card>

          {/* Sprint 76: Launch-Day Execution Support */}
          <LaunchDaySupportPanel projectId={projectId} />

          {/* Sprint 76: Post-Launch Bug Capture (compact) */}
          <PostLaunchBugCapturePanel projectId={projectId} compact />

          {/* Sprint 77: Final Readiness Audit + Stop-Build Gate compact cards */}
          <FinalReadinessAuditPanel projectId={projectId} compact />
          <StopBuildGatePanel projectId={projectId} compact />

          {/* Sprint 78: Deploy Verification + Launch Execution compact cards */}
          <DeployVerificationPanel projectId={projectId} compact />
          <LaunchExecutionChecklistPanel projectId={projectId} compact />
          {/* Sprint 79: Final Live Verification + Go/No-Go Evidence compact cards */}
          <FinalLiveVerificationPanel projectId={projectId} compact />
          <GoNoGoEvidencePanel projectId={projectId} compact />
          {/* Sprint 81: Help Center compact card */}
          <HelpCenterPanel projectId={projectId} compact />
        </div>
      </DashboardShell>
    </div>
  );
}
