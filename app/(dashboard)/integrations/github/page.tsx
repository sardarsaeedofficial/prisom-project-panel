import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Github,
  Database,
  Download,
  Ban,
  RotateCcw,
  Webhook,
  Info,
  Trash2,
  Activity,
  GitBranch,
  Hash,
  Clock,
  Radio,
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
import { Separator } from "@/components/ui/separator";
import { GitHubRepositoryCard } from "@/components/github/github-repository-card";
import { CopyButton } from "@/components/github/copy-button";
import { ManualRefreshButton } from "@/components/github/manual-refresh-button";
import { LinkRepoForm } from "@/components/github/link-repo-form";
import { RepairInstallationIdButton } from "@/components/github/repair-installation-id-button";
import { RecordInstallationIdForm } from "@/components/github/record-installation-id-form";
import {
  getGitHubIntegrationStatus,
  getDetectedRepositories,
  getIgnoredRepositories,
  getImportedGitHubRepositories,
} from "@/lib/data/github";
import {
  getGitHubHealthData,
  getProjectsWithoutGitHubRepo,
  getRecentGitHubWebhookDeliveries,
  type WebhookDeliveryRow,
} from "@/lib/data/github-health";
import {
  getEnvVarStatuses,
  isGitHubAppConfigured,
  getGitHubWebhookUrl,
} from "@/lib/github/config";
import {
  ignoreDetectedRepositoryAction,
  restoreIgnoredRepositoryAction,
  importDetectedRepositoryAction,
  permanentlyDeleteIgnoredRepositoryAction,
} from "@/app/actions/github";

export const metadata: Metadata = { title: "GitHub Integration" };
export const dynamic = "force-dynamic";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Diagnostics card (env vars + webhook URL in one place) ────────────────────

function DiagnosticsCard() {
  const statuses = getEnvVarStatuses();
  const allGood = statuses.every((s) => s.configured);
  const webhookUrl = getGitHubWebhookUrl();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Diagnostics</CardTitle>
          {allGood ? (
            <Badge variant="success" className="text-xs">All set</Badge>
          ) : (
            <Badge variant="warning" className="text-xs">Incomplete</Badge>
          )}
        </div>
        <CardDescription className="mt-0.5">
          Required environment variables and computed webhook URL. Set these in
          your <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code> file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* NEXT_PUBLIC_APP_URL — not in the required list but critical */}
        <div className="flex items-start gap-2 text-sm">
          {appUrl ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <code className="font-mono text-xs">NEXT_PUBLIC_APP_URL</code>
            {appUrl ? (
              <span className="ml-2 text-xs text-muted-foreground truncate">
                {appUrl}
              </span>
            ) : (
              <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-500">
                — not set (defaults to http://localhost:3000)
              </span>
            )}
          </div>
        </div>

        {/* GitHub App required vars */}
        {statuses.map(({ key, configured }) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            {configured ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <code className="font-mono text-xs">{key}</code>
            {!configured && (
              <span className="text-xs text-muted-foreground">— not set</span>
            )}
          </div>
        ))}

        {/* Webhook URL — derived from NEXT_PUBLIC_APP_URL */}
        <div className="border-t pt-3 mt-1 space-y-1.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Webhook className="h-3.5 w-3.5" />
            Webhook URL — paste into GitHub App settings
          </p>
          <CopyButton value={webhookUrl} label="Copy webhook URL" block />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Webhook delivery table ────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, React.ReactNode> = {
  ok: (
    <Badge variant="success" className="text-xs font-mono">
      ok
    </Badge>
  ),
  warning: (
    <Badge variant="warning" className="text-xs font-mono">
      warning
    </Badge>
  ),
  error: (
    <Badge variant="destructive" className="text-xs font-mono">
      error
    </Badge>
  ),
  ignored: (
    <Badge variant="secondary" className="text-xs font-mono">
      ignored
    </Badge>
  ),
};

function WebhookDeliveryTable({
  deliveries,
}: {
  deliveries: WebhookDeliveryRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Radio className="h-4 w-4" />
          Recent Webhook Deliveries
          <span className="text-muted-foreground text-xs font-normal">
            (last {deliveries.length})
          </span>
        </CardTitle>
        <CardDescription>
          Every verified webhook delivery is logged here. Full payload is never
          stored — only a safe summary.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {deliveries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            No deliveries recorded yet. Send a ping from GitHub App settings →
            Advanced → Recent Deliveries.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">
                    Repository
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium hidden md:table-cell">
                    Message
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2 font-mono font-medium whitespace-nowrap">
                      {d.event}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {d.action ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell truncate max-w-[160px]">
                      {d.repositoryFullName ?? "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {STATUS_BADGE[d.status] ?? (
                        <Badge variant="secondary" className="text-xs font-mono">
                          {d.status}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground hidden md:table-cell max-w-xs truncate">
                      {d.message ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground whitespace-nowrap tabular-nums">
                      {timeAgo(d.receivedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Setup wizard ──────────────────────────────────────────────────────────────

function SetupWizard({ isConfigured }: { isConfigured: boolean }) {
  const url = getGitHubWebhookUrl();

  const steps = [
    {
      n: 1,
      title: "Create a GitHub App",
      body: (
        <>
          Go to GitHub → <strong>Settings</strong> → <strong>Developer settings</strong> →{" "}
          <strong>GitHub Apps</strong> → <strong>New GitHub App</strong>. Give it a name
          (e.g. &ldquo;Prisom Dev&rdquo;) and set the <strong>Homepage URL</strong> to your app
          URL.
        </>
      ),
    },
    {
      n: 2,
      title: "Configure the webhook URL",
      body: (
        <>
          In the app settings, enable <strong>Active</strong> under Webhook and set{" "}
          <strong>Webhook URL</strong> to:
          <span className="block mt-1">
            <CopyButton value={url} label="Copy webhook URL" block />
          </span>
        </>
      ),
    },
    {
      n: 3,
      title: "Add a webhook secret",
      body: (
        <>
          Generate a random secret (e.g.{" "}
          <code className="text-xs bg-muted px-1 rounded">openssl rand -hex 32</code>) and
          paste it into the <strong>Webhook Secret</strong> field. Then save the same value
          as{" "}
          <code className="text-xs bg-muted px-1 rounded">GITHUB_WEBHOOK_SECRET</code> in
          your <code className="text-xs bg-muted px-1 rounded">.env</code>.
        </>
      ),
    },
    {
      n: 4,
      title: "Set repository permissions",
      body: (
        <>
          Under <strong>Permissions &amp; events → Repository permissions</strong>, set:
          <ul className="mt-1 space-y-0.5 list-none pl-0">
            <li>
              <code className="text-xs bg-muted px-1 rounded">Contents</code> →{" "}
              <strong>Read-only</strong>
            </li>
            <li>
              <code className="text-xs bg-muted px-1 rounded">Metadata</code> →{" "}
              <strong>Read-only</strong> (auto-selected)
            </li>
          </ul>
        </>
      ),
    },
    {
      n: 5,
      title: "Subscribe to events",
      body: (
        <>
          Still under <strong>Permissions &amp; events</strong>, subscribe to:{" "}
          {[
            "push",
            "repository",
            "installation",
            "installation_repositories",
          ].map((e) => (
            <code key={e} className="text-xs bg-muted px-1 rounded mr-1">
              {e}
            </code>
          ))}
        </>
      ),
    },
    {
      n: 6,
      title: "Copy credentials to .env",
      body: (
        <>
          From the app&apos;s <strong>About</strong> page:
          <ul className="mt-1 space-y-0.5">
            <li>
              <strong>App ID</strong> →{" "}
              <code className="text-xs bg-muted px-1 rounded">GITHUB_APP_ID</code>
            </li>
            <li>
              <strong>Client ID</strong> →{" "}
              <code className="text-xs bg-muted px-1 rounded">GITHUB_CLIENT_ID</code>
            </li>
            <li>
              Generate and download a <strong>Private Key</strong> → set as{" "}
              <code className="text-xs bg-muted px-1 rounded">GITHUB_APP_PRIVATE_KEY</code>{" "}
              (paste PEM content with literal <code className="text-xs bg-muted px-1 rounded">\n</code> escapes)
            </li>
            <li>
              Generate a <strong>Client Secret</strong> →{" "}
              <code className="text-xs bg-muted px-1 rounded">GITHUB_CLIENT_SECRET</code>
            </li>
          </ul>
        </>
      ),
    },
    {
      n: 7,
      title: "Install the app &amp; trigger a ping",
      body: (
        <>
          Click <strong>Install App</strong> on the app settings page → choose your
          account / org → select repositories. Then go to{" "}
          <strong>App settings → Advanced</strong> and click <strong>Send ping</strong> to
          confirm the webhook reaches Prisom. Use the{" "}
          <strong>Refresh</strong> button on this page to pull the repo list via the API.
        </>
      ),
    },
  ];

  return (
    <details open={!isConfigured} className="group">
      <summary className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm font-medium select-none list-none [&::-webkit-details-marker]:hidden hover:text-foreground text-muted-foreground transition-colors">
        <Info className="h-4 w-4 shrink-0" />
        GitHub App Setup Guide
        <span className="text-xs font-normal ml-1 text-muted-foreground/70">
          (7 steps)
        </span>
      </summary>

      <Card className="border-dashed mt-2">
        <CardContent className="pt-5">
          <ol className="space-y-4 text-sm">
            {steps.map(({ n, title, body }) => (
              <li key={n} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold mt-0.5">
                  {n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium mb-0.5">{title}</p>
                  <div className="text-muted-foreground leading-relaxed text-xs">
                    {body}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </details>
  );
}

// ── Health panel ──────────────────────────────────────────────────────────────

type HealthData = Awaited<ReturnType<typeof getGitHubHealthData>>;

function HealthPanel({ health }: { health: HealthData }) {
  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    {
      icon: <Activity className="h-3.5 w-3.5" />,
      label: "GitHub App configured",
      value: health.appConfigured ? (
        <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Yes
        </span>
      ) : (
        <span className="text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
          <XCircle className="h-3 w-3" /> No
        </span>
      ),
    },
    {
      icon: <Webhook className="h-3.5 w-3.5" />,
      label: "Webhook secret set",
      value: health.webhookSecretSet ? (
        <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Yes
        </span>
      ) : (
        <span className="text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
          <XCircle className="h-3 w-3" /> No
        </span>
      ),
    },
    {
      icon: <Hash className="h-3.5 w-3.5" />,
      label: "Installation IDs",
      value:
        health.installationIds.length === 0 ? (
          <span className="text-muted-foreground">None yet</span>
        ) : (
          <span className="font-mono text-xs">
            {health.installationIds.join(", ")}
          </span>
        ),
    },
    {
      icon: <Github className="h-3.5 w-3.5" />,
      label: "Detected / Imported / Ignored",
      value: (
        <span>
          <span className="text-blue-600 dark:text-blue-400">{health.detectedCount}</span>
          {" / "}
          <span className="text-green-600 dark:text-green-400">{health.importedCount}</span>
          {" / "}
          <span className="text-muted-foreground">{health.ignoredCount}</span>
        </span>
      ),
    },
    {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: "Last repo detected",
      value: health.lastDetectedAt ? (
        timeAgo(health.lastDetectedAt)
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
    },
    {
      icon: <GitBranch className="h-3.5 w-3.5" />,
      label: "Last sync run",
      value: health.lastSyncRun ? (
        <span>
          <Badge
            variant={
              health.lastSyncRun.status === "SUCCESS"
                ? "success"
                : health.lastSyncRun.status === "FAILED"
                  ? "error"
                  : "secondary"
            }
            className="text-xs mr-1.5"
          >
            {health.lastSyncRun.status}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {timeAgo(health.lastSyncRun.startedAt)}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Connection Health
        </CardTitle>
        <CardDescription>
          Live status of your GitHub App configuration and sync activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          {rows.map(({ icon, label, value }) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground shrink-0">{icon}</span>
              <dt className="text-muted-foreground text-xs w-44 shrink-0">{label}</dt>
              <dd className="flex-1 text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Demo data detection ───────────────────────────────────────────────────────

const DEMO_OWNER = "alexrivera";
const DEMO_INSTALLATION_ID = 987654;

function hasDemoData(
  detected: Array<{ fullName: string; installationId: number | null }>,
  imported: Array<{ fullName: string; installationId: number | null }>,
  deliveries: WebhookDeliveryRow[]
): boolean {
  return (
    detected.some(
      (r) =>
        r.fullName.startsWith(`${DEMO_OWNER}/`) ||
        r.installationId === DEMO_INSTALLATION_ID
    ) ||
    imported.some(
      (r) =>
        r.fullName.startsWith(`${DEMO_OWNER}/`) ||
        r.installationId === DEMO_INSTALLATION_ID
    ) ||
    deliveries.some(
      (d) =>
        d.installationId === DEMO_INSTALLATION_ID ||
        (d.repositoryFullName?.startsWith(`${DEMO_OWNER}/`) ?? false)
    )
  );
}

// ── Record installation ID card ───────────────────────────────────────────────

function RecordInstallationIdCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Hash className="h-4 w-4" />
          Record Installation ID
        </CardTitle>
        <CardDescription>
          Enter your GitHub App installation ID so the{" "}
          <strong>Refresh Repositories</strong> button can call the GitHub API.
          Find it at:{" "}
          <em>
            GitHub → Settings → Applications → Installed GitHub Apps →
            Configure
          </em>{" "}
          — the number at the end of the URL.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RecordInstallationIdForm />
      </CardContent>
    </Card>
  );
}

// ── Local testing card ────────────────────────────────────────────────────────

function LocalTestingCard() {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          <Webhook className="h-4 w-4" />
          Testing webhooks locally
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-2.5">
        <p>
          <strong className="text-foreground">Step 1 — Start a tunnel.</strong> Use{" "}
          <code className="font-mono bg-muted px-1 rounded">ngrok http 3000</code> or{" "}
          <code className="font-mono bg-muted px-1 rounded">cloudflared tunnel --url http://localhost:3000</code>{" "}
          to expose your local server.
        </p>
        <p>
          <strong className="text-foreground">Step 2 — Set the app URL.</strong> Add{" "}
          <code className="font-mono bg-muted px-1 rounded">NEXT_PUBLIC_APP_URL=https://&lt;your-tunnel&gt;</code>{" "}
          to your <code className="font-mono bg-muted px-1 rounded">.env</code>. The webhook
          URL above will update automatically after a server restart.
        </p>
        <p>
          <strong className="text-foreground">Step 3 — Update GitHub App.</strong> Paste the
          new webhook URL into your GitHub App settings and save.
        </p>
        <p>
          <strong className="text-foreground">Step 4 — Test.</strong> Trigger a{" "}
          <strong>ping</strong> from <em>App settings → Advanced → Recent Deliveries</em> to
          verify the connection. Push a commit to see the full sync pipeline.
        </p>
        <p className="text-yellow-600 dark:text-yellow-500">
          ⚠ In development you may set{" "}
          <code className="font-mono bg-muted px-1 rounded">GITHUB_WEBHOOK_DEV_BYPASS=true</code>{" "}
          to skip signature verification — <strong>never</strong> use this in production.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GitHubIntegrationPage() {
  const isConfigured = isGitHubAppConfigured();

  type Status = Awaited<ReturnType<typeof getGitHubIntegrationStatus>>;
  type Detected = Awaited<ReturnType<typeof getDetectedRepositories>>;
  type Ignored = Awaited<ReturnType<typeof getIgnoredRepositories>>;
  type Imported = Awaited<ReturnType<typeof getImportedGitHubRepositories>>;
  type Health = Awaited<ReturnType<typeof getGitHubHealthData>>;
  type UnlinkedProjects = Awaited<ReturnType<typeof getProjectsWithoutGitHubRepo>>;

  let status: Status | null = null;
  let detected: Detected = [];
  let ignored: Ignored = [];
  let imported: Imported = [];
  let health: Health | null = null;
  let unlinkedProjects: UnlinkedProjects = [];
  let deliveries: WebhookDeliveryRow[] = [];
  let dbError: string | null = null;

  try {
    [status, detected, ignored, imported, health, unlinkedProjects, deliveries] =
      await Promise.all([
        getGitHubIntegrationStatus(),
        getDetectedRepositories(),
        getIgnoredRepositories(),
        getImportedGitHubRepositories(),
        getGitHubHealthData(),
        getProjectsWithoutGitHubRepo(),
        getRecentGitHubWebhookDeliveries(20),
      ]);
  } catch {
    dbError = "Could not connect to the database.";
  }

  return (
    <DashboardShell>
      <Button
        variant="ghost"
        size="sm"
        className="mb-6 -ml-2 text-muted-foreground"
        asChild
      >
        <Link href="/integrations">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to integrations
        </Link>
      </Button>

      <PageHeader
        title="GitHub"
        description="Connect Prisom to GitHub to receive push webhooks and sync repositories."
        action={<ManualRefreshButton />}
      />

      <div className="space-y-6 max-w-3xl">
        {/* Configuration status banner */}
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            isConfigured
              ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400"
              : "border-yellow-500/30 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400"
          }`}
        >
          {isConfigured ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div>
            {isConfigured ? (
              <>
                <span className="font-medium">GitHub App is configured.</span>{" "}
                Webhooks will be verified and repo sync is ready.
              </>
            ) : (
              <>
                <span className="font-medium">
                  GitHub App is not fully configured.
                </span>{" "}
                Set the required environment variables and follow the setup guide below.
              </>
            )}
          </div>
        </div>

        {/* DB error */}
        {dbError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <Database className="h-4 w-4 shrink-0" />
            <span>
              {dbError} Run{" "}
              <code className="font-mono text-xs bg-destructive/10 px-1 rounded">
                npm run db:push &amp;&amp; npm run db:seed
              </code>{" "}
              to initialize.
            </span>
          </div>
        )}

        {/* Demo data warning — shown when seed data is still in the DB */}
        {!dbError &&
          hasDemoData(detected, imported, deliveries) && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">Demo GitHub data detected.</span>{" "}
                Repositories from <code className="font-mono text-xs">alexrivera</code>{" "}
                or installation ID{" "}
                <code className="font-mono text-xs">{DEMO_INSTALLATION_ID}</code> are seed
                data and will interfere with real GitHub App testing. Run{" "}
                <code className="font-mono text-xs bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">
                  npm run db:clean-github-demo
                </code>{" "}
                to remove them. Real repositories should match your actual GitHub account.
              </div>
            </div>
          )}

        {/* Health panel */}
        {health && (
          <div className="space-y-3">
            <HealthPanel health={health} />
            {/* Repair missing installation IDs — only shown when some repos are imported */}
            {health.importedCount > 0 && (
              <div className="flex items-center gap-3 px-1">
                <RepairInstallationIdButton />
                <span className="text-xs text-muted-foreground">
                  Recovers installation IDs for repos that were imported before a push
                  webhook was received.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Record installation ID — manual entry for dev / first-time setup */}
        <RecordInstallationIdCard />

        {/* Diagnostics — env vars + NEXT_PUBLIC_APP_URL + webhook URL */}
        <DiagnosticsCard />

        {/* Setup wizard — collapsible, open by default when not configured */}
        <SetupWizard isConfigured={isConfigured} />

        {/* Recent webhook deliveries */}
        <WebhookDeliveryTable deliveries={deliveries} />

        <Separator />

        {/* Imported repositories */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Github className="h-4 w-4" />
                  Imported Repositories
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {status
                    ? `${status.importedCount} repositor${
                        status.importedCount !== 1 ? "ies" : "y"
                      } linked to projects.`
                    : "Repositories linked to Prisom projects."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {imported.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No imported repositories yet. Import a detected repo below to
                create a project automatically.
              </p>
            ) : (
              <div className="divide-y">
                {imported.map((repo) => (
                  <GitHubRepositoryCard
                    key={repo.id}
                    fullName={repo.fullName}
                    name={repo.name}
                    description={repo.description}
                    isPrivate={repo.private}
                    language={repo.language}
                    defaultBranch={repo.defaultBranch}
                    htmlUrl={repo.htmlUrl}
                    linkedProjectId={repo.project.id}
                    linkedProjectName={repo.project.name}
                    actions={
                      <Badge variant="success" className="text-xs">
                        Linked
                      </Badge>
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detected repositories */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Detected Repositories</CardTitle>
            <CardDescription className="mt-0.5">
              Repos that sent a webhook but haven&apos;t been imported yet.
              Import to create a linked project automatically, or link to an
              existing project.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {detected.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                {isConfigured
                  ? "No detected repositories. Push to a repo with the GitHub App installed to see it here."
                  : "Configure the GitHub App above and push to a repository to see it here."}
              </p>
            ) : (
              <div className="divide-y">
                {detected.map((repo) => (
                  <GitHubRepositoryCard
                    key={repo.id}
                    fullName={repo.fullName}
                    name={repo.name}
                    description={repo.description}
                    isPrivate={repo.private}
                    language={repo.language}
                    defaultBranch={repo.defaultBranch}
                    htmlUrl={repo.url}
                    actions={
                      <div className="flex items-center gap-2">
                        <form action={importDetectedRepositoryAction.bind(null, repo.id)}>
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1.5"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Import
                          </Button>
                        </form>
                        <form action={ignoreDetectedRepositoryAction.bind(null, repo.id)}>
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-xs gap-1.5 text-muted-foreground"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Ignore
                          </Button>
                        </form>
                      </div>
                    }
                    footer={
                      <LinkRepoForm
                        detectedRepositoryId={repo.id}
                        existingProjects={unlinkedProjects}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ignored repositories */}
        {ignored.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-muted-foreground">
                Ignored Repositories
              </CardTitle>
              <CardDescription>
                Repos you dismissed. Restore to add them back to detected, or
                delete permanently.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y opacity-70">
                {ignored.map((repo) => (
                  <GitHubRepositoryCard
                    key={repo.id}
                    fullName={repo.fullName}
                    actions={
                      <div className="flex items-center gap-1">
                        <form
                          action={restoreIgnoredRepositoryAction.bind(
                            null,
                            repo.id
                          )}
                        >
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-xs gap-1.5"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restore
                          </Button>
                        </form>
                        <form
                          action={permanentlyDeleteIgnoredRepositoryAction.bind(
                            null,
                            repo.id
                          )}
                        >
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-xs gap-1.5 text-muted-foreground hover:text-destructive"
                            title="Delete permanently"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      </div>
                    }
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Local testing guide */}
        <LocalTestingCard />
      </div>
    </DashboardShell>
  );
}
