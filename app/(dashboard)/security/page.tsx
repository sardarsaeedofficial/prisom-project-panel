import type { Metadata } from "next";
import { ShieldCheck, Key, Clock, Database, Info } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-workspace";
import { formatDate, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  let apiKeys: Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }> = [];
  let dbError = false;

  try {
    const user = await getCurrentUser();
    apiKeys = await db.apiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  } catch {
    dbError = true;
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Security"
        description="API keys and security settings for your account."
      />

      <div className="space-y-8 max-w-3xl">
        {/* Info banner — honest about what is and isn't implemented */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium mb-0.5">Security features status</p>
            <ul className="text-xs space-y-0.5 text-blue-600 dark:text-blue-400">
              <li>✓ Session cookie auth is active (HTTP-only, HMAC-SHA256, 7-day expiry)</li>
              <li>✗ Two-factor authentication — not yet implemented</li>
              <li>✗ API key creation UI — not yet implemented (keys can be added via code)</li>
              <li>✗ Automated security scan — not yet implemented</li>
            </ul>
          </div>
        </div>

        {/* API Keys */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  API Keys
                </CardTitle>
                <CardDescription className="mt-1">
                  Programmatic access keys for your account. Only the key prefix is shown — the full key
                  is never stored in plaintext.
                </CardDescription>
              </div>
              {/* Create UI not yet implemented — button is intentionally absent */}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {dbError && (
              <div className="flex items-center gap-2 px-6 py-4 text-sm text-destructive">
                <Database className="h-4 w-4 shrink-0" />
                Could not load API keys from the database.
              </div>
            )}

            {!dbError && apiKeys.length === 0 && (
              <div className="px-6 py-8 text-center">
                <Key className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">
                  No API keys yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  API key creation is not yet available in the UI.
                </p>
              </div>
            )}

            {apiKeys.length > 0 && (
              <div className="divide-y">
                {apiKeys.map((key) => {
                  const isExpired =
                    key.expiresAt && key.expiresAt < new Date();
                  return (
                    <div
                      key={key.id}
                      className="flex items-center gap-4 px-6 py-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium">{key.name}</p>
                          {isExpired && (
                            <Badge variant="error" className="text-xs">
                              Expired
                            </Badge>
                          )}
                          {key.expiresAt && !isExpired && (
                            <Badge variant="warning" className="text-xs">
                              Expires {formatDate(key.expiresAt)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                            {key.prefix}••••••••
                          </code>
                          <span className="text-xs text-muted-foreground">
                            Created {formatDate(key.createdAt)}
                          </span>
                          {key.lastUsedAt && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Last used {formatRelativeTime(key.lastUsedAt)}
                            </span>
                          )}
                        </div>
                        {key.scopes.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5">
                            {key.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="secondary"
                                className="text-xs px-1.5 py-0"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security settings — honest about what's implemented */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Session &amp; Auth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Session cookie</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                HTTP-only cookie (<code className="font-mono bg-muted px-1 rounded text-xs">prisom_session</code>),
                HMAC-SHA256 signed, 7-day expiry, Secure in production.
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Two-factor authentication
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Not yet implemented.
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Audit log
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deployment and GitHub events are logged to{" "}
                <code className="font-mono bg-muted px-1 rounded text-xs">ProjectLog</code>{" "}
                per project. A global audit view is not yet implemented.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
