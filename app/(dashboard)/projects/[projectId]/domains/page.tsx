import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Globe,
  CheckCircle2,
  Clock,
  XCircle,
  Shield,
  ShieldCheck,
  Trash2,
  Star,
  Server,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { WorkspaceNav } from "@/components/projects/workspace-nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddDomainForm } from "@/components/workspace/add-domain-form";
import { getProjectDomains, getProjectEnvironments } from "@/lib/data/workspace-modules";
import { deleteDomainAction, updateDomainAction } from "@/app/actions/workspace-modules";
import { db } from "@/lib/db";
import { DomainStatus, SslStatus } from "@prisma/client";
import { PublishDomainForm } from "@/components/projects/publish-domain-form";

export const metadata: Metadata = { title: "Domains" };
export const dynamic = "force-dynamic";

const BASE_DOMAIN = "doorstepmanchester.uk";

type Props = { params: Promise<{ projectId: string }> };

function DomainStatusBadge({ status }: { status: DomainStatus }) {
  if (status === DomainStatus.ACTIVE)
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Active
      </span>
    );
  if (status === DomainStatus.FAILED)
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <XCircle className="h-3.5 w-3.5" />
        Failed
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
      <Clock className="h-3.5 w-3.5" />
      Pending DNS
    </span>
  );
}

function SslBadge({ status }: { status: SslStatus }) {
  if (status === SslStatus.ACTIVE)
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        SSL Active
      </span>
    );
  if (status === SslStatus.FAILED || status === SslStatus.EXPIRED)
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <Shield className="h-3.5 w-3.5" />
        SSL {status.toLowerCase()}
      </span>
    );
  if (status === SslStatus.NONE)
    return <span className="text-xs text-muted-foreground">No SSL</span>;
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-600">
      <Clock className="h-3.5 w-3.5" />
      SSL pending
    </span>
  );
}

export default async function ProjectDomainsPage({ params }: Props) {
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true },
  });
  if (!project) notFound();

  const [domains, environments, dbDeployConfig] = await Promise.all([
    getProjectDomains(projectId),
    getProjectEnvironments(projectId),
    db.projectDeploymentConfig.findUnique({ where: { projectId } }),
  ]);

  const generatedDomain = `${project.slug}.${BASE_DOMAIN}`;

  // The currently nginx-published domain for this project (if any)
  const activeDomainRow = domains.find(
    (d) => d.status === DomainStatus.ACTIVE && (d as { nginxConfigPath?: string | null }).nginxConfigPath
  );
  const activeDomain = activeDomainRow?.hostname ?? null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <WorkspaceNav projectId={projectId} />
      <DashboardShell>
        <PageHeader
          title="Domains"
          description="Publish your running app to a public URL through nginx."
        />

        <div className="space-y-6 max-w-2xl">
          {/* ── Nginx publish section (only if project has a deployment config) ── */}
          {dbDeployConfig ? (
            <PublishDomainForm
              projectId={projectId}
              generatedDomain={generatedDomain}
              port={dbDeployConfig.port}
              activeDomain={activeDomain}
            />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Publish via Nginx</CardTitle>
                </div>
                <CardDescription>
                  Deploy your project first (Publishing tab) before you can
                  connect a domain.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  <span>No deployment config — go to the Publishing tab to set up your project.</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Legacy AddDomainForm (DNS/CNAME management) ── */}
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground mb-3 font-medium">
              Manual domain management (DNS/CNAME verification)
            </p>
            <AddDomainForm projectId={projectId} environments={environments} />
          </div>

          {/* Domain list */}
          {domains.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center text-center py-10 gap-3">
                <Globe className="h-8 w-8 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium">No domains yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add a domain above to get started.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Connected Domains ({domains.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {domains.map((domain) => (
                    <div key={domain.id} className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <Globe className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">
                              {domain.hostname}
                            </p>
                            {domain.isPrimary && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Star className="h-2.5 w-2.5" />
                                Primary
                              </Badge>
                            )}
                            {domain.environment && (
                              <Badge variant="secondary" className="text-xs">
                                {domain.environment.name}
                              </Badge>
                            )}
                            {domain.provider && (
                              <span className="text-xs text-muted-foreground">
                                via {domain.provider}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                            <DomainStatusBadge status={domain.status} />
                            <SslBadge status={domain.sslStatus} />
                            {/* Nginx route status */}
                            {(domain as { nginxConfigPath?: string | null }).nginxConfigPath && (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Nginx active
                              </span>
                            )}
                          </div>

                          {/* Internal target for nginx-published domains */}
                          {(domain as { nginxConfigPath?: string | null; targetPort?: number | null }).nginxConfigPath &&
                            (domain as { targetPort?: number | null }).targetPort && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Server className="h-3 w-3" />
                              Internal: 127.0.0.1:{(domain as { targetPort?: number | null }).targetPort}
                            </p>
                          )}

                          {/* Nginx last error */}
                          {domain.status === DomainStatus.FAILED &&
                            (domain as { lastError?: string | null }).lastError && (
                            <div className="mt-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2.5 py-2 text-xs">
                              <p className="font-medium text-red-700 dark:text-red-400">Nginx error:</p>
                              <pre className="mt-1 text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
                                {(domain as { lastError?: string | null }).lastError}
                              </pre>
                            </div>
                          )}

                          {/* DNS instructions */}
                          {domain.status === DomainStatus.PENDING && (
                            <div className="mt-2 rounded-md bg-muted p-2.5 text-xs space-y-1">
                              <p className="font-medium text-muted-foreground">
                                DNS setup required
                              </p>
                              {domain.cnameTarget ? (
                                <p>
                                  Add a{" "}
                                  <strong className="font-mono">CNAME</strong>{" "}
                                  record pointing to{" "}
                                  <code className="font-mono bg-background px-1 rounded">
                                    {domain.cnameTarget}
                                  </code>
                                </p>
                              ) : (
                                <p className="text-muted-foreground">
                                  DNS instructions will appear once the domain
                                  is verified.
                                </p>
                              )}
                              {domain.verificationTxt && (
                                <p>
                                  Verification TXT:{" "}
                                  <code className="font-mono bg-background px-1 rounded break-all">
                                    {domain.verificationTxt}
                                  </code>
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {!domain.isPrimary && (
                            <form
                              action={updateDomainAction.bind(
                                null,
                                domain.id,
                                projectId
                              )}
                            >
                              <input type="hidden" name="isPrimary" value="true" />
                              <button
                                type="submit"
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                                title="Set as primary"
                              >
                                Set primary
                              </button>
                            </form>
                          )}
                          <form
                            action={deleteDomainAction.bind(
                              null,
                              domain.id,
                              projectId
                            )}
                          >
                            <button
                              type="submit"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded"
                              title="Remove domain"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardShell>
    </div>
  );
}
