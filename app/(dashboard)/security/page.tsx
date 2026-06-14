import type { Metadata } from "next";
import { ShieldCheck, Key, Plus, Trash2, Clock, CheckCircle2 } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { MOCK_API_KEYS } from "@/lib/mock-data";
import { formatDate, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <DashboardShell>
      <PageHeader
        title="Security"
        description="Manage API keys, access tokens, and security settings."
      />

      <div className="space-y-8 max-w-3xl">
        {/* Security overview */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-green-500/5 border-green-500/20">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">No issues found</p>
                <p className="text-xs text-muted-foreground">Security scan passed</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Active API Keys</p>
              <p className="text-2xl font-bold mt-0.5">{MOCK_API_KEYS.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Last Activity</p>
              <p className="text-sm font-medium mt-0.5">12 min ago</p>
            </CardContent>
          </Card>
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
                  {/* TODO: Implement key creation with secure hashing using lib/crypto.ts */}
                  API keys grant programmatic access to your projects.
                </CardDescription>
              </div>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New Key
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {MOCK_API_KEYS.map((key) => (
                <div key={key.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium">{key.name}</p>
                      {key.expiresAt && (
                        <Badge variant="warning" className="text-xs">Expires {formatDate(key.expiresAt)}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                        {key.prefix}_••••••••
                      </code>
                      {key.lastUsed && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last used {formatRelativeTime(key.lastUsed)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5 mt-1.5">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs px-1.5 py-0">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Security settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Security Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                label: "Two-factor authentication",
                description: "Require 2FA for account access",
                enabled: false,
                // TODO: Implement TOTP / WebAuthn
              },
              {
                label: "Session timeout",
                description: "Automatically sign out after 7 days of inactivity",
                enabled: true,
              },
              {
                label: "Audit log",
                description: "Keep a log of all security-relevant events",
                enabled: true,
              },
            ].map((setting, i) => (
              <div key={i}>
                {i > 0 && <Separator className="mb-4" />}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <Switch defaultChecked={setting.enabled} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
