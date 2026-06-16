"use client";

/**
 * components/projects/publish-domain-form.tsx
 *
 * Client component for publishing a domain through nginx.
 * Handles:
 *   - Quick "Publish generated domain" (<slug>.doorstepmanchester.uk)
 *   - Custom hostname input
 *   - Error display with nginx permission hint
 *   - Manual SSL next-step instructions after success
 */

import { useState } from "react";
import {
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Copy,
  Terminal,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { publishProjectDomainAction } from "@/app/actions/project-deployments";

interface Props {
  projectId:         string;
  /** Suggested subdomain: <slug>.doorstepmanchester.uk */
  generatedDomain:   string;
  /** Port the PM2 app is listening on (from ProjectDeploymentConfig) */
  port:              number;
  /** Whether a domain is already published for this project */
  activeDomain:      string | null;
}

export function PublishDomainForm({
  projectId,
  generatedDomain,
  port,
  activeDomain,
}: Props) {
  const [customHostname, setCustomHostname] = useState("");
  const [isPending,      setIsPending]      = useState(false);
  const [publishedHost,  setPublishedHost]  = useState<string | null>(activeDomain);
  const [error,          setError]          = useState("");
  const [copiedCmd,      setCopiedCmd]      = useState(false);

  const certbotCmd = `sudo certbot --nginx -d ${publishedHost ?? generatedDomain}`;

  async function handlePublish(hostname: string) {
    setError("");
    setIsPending(true);
    try {
      const res = await publishProjectDomainAction(projectId, hostname);
      if (res.ok) {
        setPublishedHost(hostname);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error publishing domain.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Publish via Nginx</CardTitle>
        </div>
        <CardDescription>
          Route a domain to your running app on port {port}. Nginx is
          configured automatically — no manual config editing needed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Success state ── */}
        {publishedHost && (
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Domain published
              </p>
              <Badge variant="success" className="text-xs">Nginx active</Badge>
            </div>
            <p className="text-sm text-green-700 dark:text-green-400">
              <strong>
                <a
                  href={`http://${publishedHost}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  http://{publishedHost}
                </a>
              </strong>{" "}
              → 127.0.0.1:{port}
            </p>

            {/* Internal target */}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Internal target:</span>{" "}
              <code className="font-mono">127.0.0.1:{port}</code>
            </p>

            {/* Manual SSL next step */}
            <div className="rounded-md border border-green-300 dark:border-green-700 bg-white/50 dark:bg-black/20 px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-green-800 dark:text-green-300 flex items-center gap-1">
                <Terminal className="h-3.5 w-3.5" />
                Next step: enable HTTPS
              </p>
              <p className="text-xs text-muted-foreground">
                Run this on the VPS to get a free SSL certificate:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono bg-zinc-950 text-zinc-200 rounded px-2 py-1 flex-1 break-all">
                  {certbotCmd}
                </code>
                <button
                  type="button"
                  title="Copy command"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    void navigator.clipboard.writeText(certbotCmd);
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 2000);
                  }}
                >
                  {copiedCmd
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Generated domain quick-publish ── */}
        {!publishedHost && (
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Generated subdomain</p>
            </div>
            <p className="text-sm font-mono text-foreground">{generatedDomain}</p>
            <p className="text-xs text-muted-foreground">
              The wildcard A record{" "}
              <code className="font-mono">*.doorstepmanchester.uk → 178.105.105.59</code>{" "}
              is already configured, so this domain works immediately.
            </p>
            <Button
              size="sm"
              className="mt-1 gap-2"
              disabled={isPending}
              onClick={() => handlePublish(generatedDomain)}
            >
              {isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…</>
              ) : (
                <><Zap className="h-3.5 w-3.5" /> Publish generated domain</>
              )}
            </Button>
          </div>
        )}

        {/* ── Custom hostname ── */}
        {!publishedHost && (
          <div className="space-y-2">
            <Label htmlFor="customHostname" className="text-sm">
              Or publish a custom domain
            </Label>
            <div className="flex gap-2">
              <Input
                id="customHostname"
                className="h-9 font-mono text-sm"
                placeholder="myapp.example.com"
                value={customHostname}
                onChange={(e) => setCustomHostname(e.target.value)}
                disabled={isPending}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || !customHostname.trim()}
                onClick={() => handlePublish(customHostname.trim())}
                className="shrink-0"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Publish"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Point an A record for this hostname to{" "}
              <code className="font-mono">178.105.105.59</code> before publishing.
            </p>
          </div>
        )}

        {/* ── Re-publish (change domain) ── */}
        {publishedHost && (
          <div className="space-y-2">
            <Label htmlFor="republishHostname" className="text-sm text-muted-foreground">
              Publish a different domain
            </Label>
            <div className="flex gap-2">
              <Input
                id="republishHostname"
                className="h-9 font-mono text-sm"
                placeholder="myapp.example.com"
                value={customHostname}
                onChange={(e) => setCustomHostname(e.target.value)}
                disabled={isPending}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || !customHostname.trim()}
                onClick={() => handlePublish(customHostname.trim())}
                className="shrink-0"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Publish"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Failed to publish domain
              </p>
              <pre className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
                {error}
              </pre>
            </div>
          </div>
        )}

        {/* ── DNS requirement note ── */}
        <div className="rounded-md bg-muted/40 px-3 py-2.5 text-xs space-y-1">
          <p className="font-medium text-foreground/70">DNS requirements</p>
          <p className="text-muted-foreground">
            For <code className="font-mono">*.doorstepmanchester.uk</code>: wildcard
            A record already points to{" "}
            <code className="font-mono">178.105.105.59</code> — no DNS change needed.
          </p>
          <p className="text-muted-foreground">
            For custom domains: add an A record pointing{" "}
            <code className="font-mono">your-domain.com → 178.105.105.59</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
