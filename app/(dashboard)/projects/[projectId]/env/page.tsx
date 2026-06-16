import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { EnvVarsEditor } from "@/components/projects/env-vars-editor";
import { PaymentWebhookChecklist } from "@/components/projects/payment-webhook-checklist";
import { getProjectEnvVarsAction } from "@/app/actions/project-envvars";
import { db } from "@/lib/db";
import { DomainStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Env Vars" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectEnvPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  // Fetch env vars (masked) for display
  const envVarsResult = await getProjectEnvVarsAction(projectId);
  const initialVars = envVarsResult.ok ? envVarsResult.vars : [];
  const envVarNames = initialVars.map((v) => v.name);

  // Find active domain for Stripe webhook URL
  const activeDomain = await db.domain.findFirst({
    where: { projectId, status: DomainStatus.ACTIVE },
    select: { hostname: true },
    orderBy: { isPrimary: "desc" },
  });

  const hasStripeVars = envVarNames.some((n) => n.startsWith("STRIPE_") || n.startsWith("VITE_STRIPE_"));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Environment Variables"
          description="Manage secrets and config injected into every deployment. Encrypted at rest, never exposed in logs."
        />

        <div className="space-y-6 max-w-2xl">
          <EnvVarsEditor projectId={projectId} initialVars={initialVars} />

          <PaymentWebhookChecklist
            domain={activeDomain?.hostname ?? null}
            hasStripeVars={hasStripeVars}
            envVarNames={envVarNames}
          />
        </div>
      </DashboardShell>
    </div>
  );
}
