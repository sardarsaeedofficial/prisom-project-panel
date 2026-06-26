import type { Metadata }    from "next";
import { notFound }          from "next/navigation";
import Link                  from "next/link";
import { BookOpen }          from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav }      from "@/components/projects/workspace-nav";
import { OperatorRunbookPanel }       from "@/components/projects/operator-runbook-panel";
import { OperatorTrainingPanel }      from "@/components/projects/operator-training-panel";
import { LaunchFreezePanel }          from "@/components/projects/launch-freeze-panel";
import { PostLaunchBugCapturePanel }  from "@/components/projects/post-launch-bug-capture-panel";
import { FinalReadinessAuditPanel }         from "@/components/projects/final-readiness-audit-panel";
import { StopBuildGatePanel }              from "@/components/projects/stop-build-gate-panel";
import { LaunchExecutionChecklistPanel }   from "@/components/projects/launch-execution-checklist-panel";
import { GoNoGoEvidencePanel }             from "@/components/projects/go-no-go-evidence-panel";
import { FinalLiveVerificationPanel }      from "@/components/projects/final-live-verification-panel";
import { Card, CardContent }      from "@/components/ui/card";
import { db }                     from "@/lib/db";

export const metadata: Metadata = { title: "Runbook" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectRunbookPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Operator Runbook"
          description={`Documentation guide for operating ${project.name} — no production mutation.`}
        />

        <div className="max-w-3xl space-y-6">
          {/* Key operations links */}
          <div className="rounded-xl border bg-card px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Monitoring",   href: `/projects/${projectId}/monitoring` },
              { label: "Releases",     href: `/projects/${projectId}/releases` },
              { label: "Backups",      href: `/projects/${projectId}/backups` },
              { label: "Logs",         href: `/projects/${projectId}/logs` },
              { label: "Team",         href: `/projects/${projectId}/team` },
              { label: "Operations",   href: `/projects/${projectId}/operations` },
            ].map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                {label}
              </Link>
            ))}
          </div>

          {/* Runbook panel */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <OperatorRunbookPanel projectId={projectId} />
            </CardContent>
          </Card>

          {/* Sprint 74: Operator Training Pack */}
          <OperatorTrainingPanel projectId={projectId} />

          {/* Sprint 75: Launch Freeze compact reference */}
          <LaunchFreezePanel projectId={projectId} compact />

          {/* Sprint 76: Post-Launch Bug Capture compact reference */}
          <PostLaunchBugCapturePanel projectId={projectId} compact />

          {/* Sprint 77: Final Readiness Audit + Stop-Build Gate compact cards */}
          <FinalReadinessAuditPanel projectId={projectId} compact />
          <StopBuildGatePanel projectId={projectId} compact />

          {/* Sprint 78: Launch Execution Checklist — full panel on Runbook */}
          <LaunchExecutionChecklistPanel projectId={projectId} />

          {/* Sprint 79: Final Live Verification compact reference */}
          <FinalLiveVerificationPanel projectId={projectId} compact />

          {/* Sprint 79: Go/No-Go Evidence Pack — full panel on Runbook */}
          <GoNoGoEvidencePanel projectId={projectId} />
        </div>
      </DashboardShell>
    </div>
  );
}
