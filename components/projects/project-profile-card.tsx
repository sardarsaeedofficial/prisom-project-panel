/**
 * components/projects/project-profile-card.tsx
 *
 * Sprint 71: Server component — detects and renders the project migration profile.
 * Calls the detection service directly (no client-side fetch needed).
 * Uses CopyDownloadButton for the PROJECT_PROFILE_REPORT.md export.
 */

import { detectProjectMigrationProfile } from "@/lib/project-profiles/project-profile-service";
import { exportProjectProfileReport }    from "@/lib/project-profiles/project-profile-export";
import {
  getProjectProfileBadge,
  getDefaultStagingDomain,
  getDefaultProductionDomain,
} from "@/lib/project-profiles/profile-labels";
import type { ProjectMigrationProfile }  from "@/lib/project-profiles/project-profile-types";
import { CopyDownloadButton }            from "@/components/common/copy-download-button";
import { Badge }                         from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, Server, Globe, ShieldCheck } from "lucide-react";

// ── Kind badge color ──────────────────────────────────────────────────────────

function kindVariant(
  kind: ProjectMigrationProfile["kind"],
): "default" | "secondary" | "warning" | "success" {
  switch (kind) {
    case "sardar_ecommerce":  return "success";
    case "generic_ecommerce": return "warning";
    case "generic_web_app":   return "default";
    case "api_service":       return "secondary";
    case "static_site":       return "secondary";
    default:                  return "secondary";
  }
}

// ── Row display ───────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export async function ProjectProfileCard({ projectId }: { projectId: string }) {
  let profile: ProjectMigrationProfile | null = null;
  let exportMarkdown = "";

  try {
    profile        = await detectProjectMigrationProfile({ projectId });
    exportMarkdown = exportProjectProfileReport(profile);
  } catch {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Project Profile</CardTitle>
          <CardDescription>Could not detect project profile.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const badge         = getProjectProfileBadge(profile);
  const prodDomain    = getDefaultProductionDomain(profile);
  const stagingDomain = getDefaultStagingDomain(profile);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">Project Profile</CardTitle>
            <Badge variant={kindVariant(profile.kind)}>{badge}</Badge>
            {profile.isEcommerce && (
              <Badge variant="secondary">Ecommerce</Badge>
            )}
          </div>
          <CopyDownloadButton
            content={exportMarkdown}
            filename="PROJECT_PROFILE_REPORT.md"
            label="Export Report"
          />
        </div>
        <CardDescription className="mt-1">{profile.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Domain info */}
        {(prodDomain || stagingDomain || profile.slug) && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Domains
            </p>
            <div className="rounded-md border divide-y">
              {profile.slug && (
                <InfoRow label="Slug" value={<code className="font-mono">{profile.slug}</code>} />
              )}
              {prodDomain && (
                <InfoRow label="Production" value={<code className="font-mono text-xs">{prodDomain}</code>} />
              )}
              {stagingDomain && (
                <InfoRow label="Staging" value={<code className="font-mono text-xs">{stagingDomain}</code>} />
              )}
            </div>
          </div>
        )}

        {/* Expected services */}
        {profile.expectedServices.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Expected Services ({profile.expectedServices.length})
            </p>
            <div className="rounded-md border divide-y">
              {profile.expectedServices.map((svc, i) => (
                <div key={i} className="px-3 py-2 text-xs space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{svc.name}</span>
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">{svc.kind}</Badge>
                    {svc.route && (
                      <code className="ml-auto text-muted-foreground font-mono">{svc.route}</code>
                    )}
                  </div>
                  {svc.healthPath && (
                    <div className="text-muted-foreground">Health: <code className="font-mono">{svc.healthPath}</code></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expected routes */}
        {profile.expectedRoutes.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Expected Routes
            </p>
            <div className="rounded-md border divide-y">
              {profile.expectedRoutes.map((route, i) => (
                <div key={i} className="px-3 py-2 text-xs flex items-center gap-3">
                  <code className="font-mono text-foreground w-24 shrink-0">{route.path}</code>
                  <span className="text-muted-foreground flex-1 truncate">{route.target}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">{route.type}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Env categories */}
        {profile.expectedEnv.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Expected Env Categories
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(profile.expectedEnv.map((e) => e.category))].sort().map((cat) => {
                const count = profile.expectedEnv.filter((e) => e.category === cat).length;
                return (
                  <Badge key={cat} variant="outline" className="text-xs">
                    {cat} ({count})
                  </Badge>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {profile.expectedEnv.length} key name(s) registered — values are never shown.
            </p>
          </div>
        )}

        {/* Safety notes */}
        {profile.safetyNotes.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" /> Safety Notes
            </p>
            <ul className="space-y-1">
              {profile.safetyNotes.map((note, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-yellow-500 mt-0.5 shrink-0">⚠</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommended next steps */}
        {profile.recommendedNextSteps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Recommended Next Steps
            </p>
            <ol className="space-y-1 list-decimal list-inside">
              {profile.recommendedNextSteps.map((step, i) => (
                <li key={i} className="text-xs text-muted-foreground">{step}</li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
