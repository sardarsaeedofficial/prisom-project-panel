import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { ProjectSecretsVault }             from "@/components/projects/project-secrets-vault";
import { EnvReadinessPanel }               from "@/components/projects/env-readiness-panel";
import { ExternalServicesReadinessPanel }  from "@/components/projects/external-services-readiness-panel";
import { ShoppingCart }                    from "lucide-react";
import Link                                from "next/link";
import { db }                              from "@/lib/db";

export const metadata: Metadata = { title: "Secrets Vault" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectSecretsPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Secrets Vault"
          description="Manage encrypted secrets and environment variables. Values are encrypted at rest and never exposed in logs, backups, or exports."
        />
        {/* Sprint 46: Environment Readiness + Sprint 54: External Services */}
        <div className="space-y-6 max-w-3xl mb-6">
          <EnvReadinessPanel projectId={projectId} />
          <ExternalServicesReadinessPanel projectId={projectId} />

          {/* Sprint 62: Ecommerce proof requires these env names */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-start gap-3">
            <ShoppingCart className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Ecommerce Test Harness — Required Env Names</p>
              <p className="text-xs text-muted-foreground mt-1">
                Before running the ecommerce test harness, add the following env var names to the Secrets Vault with staging/test values:
              </p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                <li>
                  <code className="font-mono bg-muted px-1 rounded">STRIPE_SECRET_KEY</code>,{" "}
                  <code className="font-mono bg-muted px-1 rounded">STRIPE_PUBLISHABLE_KEY</code>,{" "}
                  <code className="font-mono bg-muted px-1 rounded">STRIPE_WEBHOOK_SECRET</code>
                  <span className="ml-1 text-amber-700 dark:text-amber-400">— use test keys (sk_test_ / pk_test_) only in staging</span>
                </li>
                <li>
                  <code className="font-mono bg-muted px-1 rounded">CLOUDINARY_CLOUD_NAME</code>,{" "}
                  <code className="font-mono bg-muted px-1 rounded">CLOUDINARY_API_KEY</code>,{" "}
                  <code className="font-mono bg-muted px-1 rounded">CLOUDINARY_API_SECRET</code>
                </li>
                <li>
                  <code className="font-mono bg-muted px-1 rounded">RESEND_API_KEY</code>{" or "}
                  <code className="font-mono bg-muted px-1 rounded">SMTP_HOST</code>{" "}
                  (email provider)
                </li>
              </ul>
            </div>
            <Link
              href={`/projects/${projectId}/migration`}
              className="text-xs text-primary hover:underline whitespace-nowrap mt-0.5"
            >
              Open Harness →
            </Link>
          </div>
        </div>
        <ProjectSecretsVault projectId={projectId} />
      </DashboardShell>
    </div>
  );
}
