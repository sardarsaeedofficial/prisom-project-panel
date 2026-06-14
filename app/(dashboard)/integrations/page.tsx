import type { Metadata } from "next";
import Link from "next/link";
import {
  Github,
  CheckCircle2,
  ExternalLink,
  Plug,
  Database,
  Activity,
  Cpu,
  Cloud,
} from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { isGitHubAppConfigured } from "@/lib/github/config";
import { IntegrationType, IntegrationStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

// ── Static catalogue — what this panel knows about ────────────────────────────

type IntegrationMeta = {
  type: IntegrationType | "COMING_SOON";
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  manageHref?: string; // internal page for integrations that have one
  docsHref?: string;
};

const CATALOGUE: IntegrationMeta[] = [
  {
    type: IntegrationType.GITHUB,
    name: "GitHub",
    description:
      "Receive push webhooks and sync repository metadata. Required for commit tracking and GitHub-based deployments.",
    category: "Version Control",
    icon: <Github className="h-5 w-5" />,
    manageHref: "/integrations/github",
  },
  {
    type: "COMING_SOON",
    name: "Vercel",
    description:
      "Deploy projects to Vercel with zero-configuration. (Not yet connected — coming soon.)",
    category: "Deployment",
    icon: <Cloud className="h-5 w-5 text-muted-foreground" />,
  },
  {
    type: "COMING_SOON",
    name: "Railway",
    description:
      "Deploy and scale applications on Railway infrastructure. (Not yet connected — coming soon.)",
    category: "Deployment",
    icon: <Cloud className="h-5 w-5 text-muted-foreground" />,
  },
  {
    type: "COMING_SOON",
    name: "Supabase",
    description:
      "Open-source Firebase alternative with Postgres, Auth, and Storage. (Not yet connected — coming soon.)",
    category: "Database",
    icon: <Database className="h-5 w-5 text-muted-foreground" />,
  },
  {
    type: "COMING_SOON",
    name: "PlanetScale",
    description:
      "MySQL-compatible serverless database. (Not yet connected — coming soon.)",
    category: "Database",
    icon: <Database className="h-5 w-5 text-muted-foreground" />,
  },
  {
    type: "COMING_SOON",
    name: "Datadog",
    description:
      "Monitoring and analytics for cloud-scale applications. (Not yet connected — coming soon.)",
    category: "Monitoring",
    icon: <Activity className="h-5 w-5 text-muted-foreground" />,
  },
  {
    type: "COMING_SOON",
    name: "AI Provider",
    description:
      "Connect an AI provider (Anthropic, OpenAI) for the AI assistant. (Not yet connected — coming soon.)",
    category: "AI & ML",
    icon: <Cpu className="h-5 w-5 text-muted-foreground" />,
  },
];

const CATEGORY_ORDER = [
  "Version Control",
  "Deployment",
  "Database",
  "Monitoring",
  "AI & ML",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function IntegrationsPage() {
  // Load real Integration rows; also check GitHub App env-var config
  let dbIntegrations: Array<{
    type: IntegrationType;
    status: IntegrationStatus;
    externalUsername: string | null;
    lastSyncedAt: Date | null;
  }> = [];
  let dbError = false;

  try {
    const workspaceId = await getCurrentWorkspaceId();
    dbIntegrations = await db.integration.findMany({
      where: { workspaceId },
      select: {
        type: true,
        status: true,
        externalUsername: true,
        lastSyncedAt: true,
      },
    });
  } catch {
    dbError = true;
  }

  const githubAppConfigured = isGitHubAppConfigured();

  // Build lookup map: IntegrationType → DB row
  const dbMap = new Map(dbIntegrations.map((r) => [r.type, r]));

  // Group catalogue by category
  const categories = CATEGORY_ORDER.filter((cat) =>
    CATALOGUE.some((i) => i.category === cat)
  );

  return (
    <DashboardShell>
      <PageHeader
        title="Integrations"
        description="Connect your favourite tools and services."
      />

      {dbError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 mb-6 text-sm text-destructive">
          <Database className="h-4 w-4 shrink-0" />
          Could not load integration status from the database.
        </div>
      )}

      <div className="space-y-10">
        {categories.map((category) => {
          const items = CATALOGUE.filter((i) => i.category === category);
          return (
            <div key={category}>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                {category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((integration) => {
                  const isComingSoon = integration.type === "COMING_SOON";

                  // For GitHub: connected when GitHub App env vars are set
                  // For others: check DB row
                  const dbRow =
                    !isComingSoon && integration.type !== "COMING_SOON"
                      ? dbMap.get(integration.type as IntegrationType)
                      : undefined;

                  const isGitHub = integration.type === IntegrationType.GITHUB;

                  // "Connected" means:
                  // • GitHub → GitHub App env vars all set
                  // • Others → DB row with CONNECTED status
                  const connected = isGitHub
                    ? githubAppConfigured
                    : dbRow?.status === IntegrationStatus.CONNECTED;

                  const hasError = dbRow?.status === IntegrationStatus.ERROR;

                  return (
                    <Card
                      key={integration.name}
                      className={isComingSoon ? "opacity-60" : undefined}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg border bg-muted flex items-center justify-center shrink-0">
                              {integration.icon}
                            </div>
                            <div>
                              <CardTitle className="text-sm">
                                {integration.name}
                              </CardTitle>
                              {connected && (
                                <Badge
                                  variant="success"
                                  className="mt-0.5 text-xs"
                                >
                                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                                  Connected
                                </Badge>
                              )}
                              {hasError && (
                                <Badge
                                  variant="error"
                                  className="mt-0.5 text-xs"
                                >
                                  Error
                                </Badge>
                              )}
                              {isComingSoon && (
                                <Badge
                                  variant="secondary"
                                  className="mt-0.5 text-xs"
                                >
                                  Coming soon
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-xs mb-4">
                          {integration.description}
                        </CardDescription>

                        {isComingSoon ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs"
                            disabled
                          >
                            <Plug className="h-3.5 w-3.5 mr-1.5" />
                            Not available yet
                          </Button>
                        ) : connected && integration.manageHref ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs"
                            asChild
                          >
                            <Link href={integration.manageHref}>
                              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                              Manage
                            </Link>
                          </Button>
                        ) : isGitHub && !connected ? (
                          <Button
                            size="sm"
                            className="w-full text-xs"
                            asChild
                          >
                            <Link href="/integrations/github">
                              <Github className="h-3.5 w-3.5 mr-1.5" />
                              Set up GitHub App
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs"
                            disabled
                          >
                            <Plug className="h-3.5 w-3.5 mr-1.5" />
                            Not connected
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
