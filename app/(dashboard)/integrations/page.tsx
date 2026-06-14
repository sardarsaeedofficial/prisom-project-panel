import type { Metadata } from "next";
import { Plug, CheckCircle2, ExternalLink } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MOCK_INTEGRATIONS } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Integrations" };

const CATEGORY_LABELS: Record<string, string> = {
  "version-control": "Version Control",
  "deployment": "Deployment",
  "database": "Database",
  "monitoring": "Monitoring",
  "ai": "AI & ML",
  "other": "Other",
};

export default function IntegrationsPage() {
  const categories = [...new Set(MOCK_INTEGRATIONS.map((i) => i.category))];

  return (
    <DashboardShell>
      <PageHeader
        title="Integrations"
        description="Connect your favorite tools and services."
      />

      <div className="space-y-8">
        {categories.map((category) => {
          const items = MOCK_INTEGRATIONS.filter((i) => i.category === category);
          return (
            <div key={category}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((integration) => (
                  <Card key={integration.id} className="relative">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg border bg-muted flex items-center justify-center shrink-0">
                            <Plug className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <CardTitle className="text-sm">{integration.name}</CardTitle>
                            {integration.connected && (
                              <Badge variant="success" className="mt-0.5 text-xs">
                                <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                                Connected
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
                      {integration.connected ? (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1 text-xs">
                            Manage
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-destructive hover:text-destructive"
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" className="w-full text-xs">
                          Connect
                          {/* TODO: Implement OAuth flow for each provider */}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Separator className="mt-8" />
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
