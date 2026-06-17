"use client";

/**
 * components/projects/readiness-panel.tsx
 *
 * Deployment readiness checklist card shown on the publishing page.
 *
 * Runs the full login smoke-test suite and displays individual check results:
 *   App process · Frontend · API health · Database · Required secrets · Login route
 *
 * Never displays secret values.
 */

import { useState, useTransition } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  RefreshCw, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  runProjectLoginSmokeTestAction,
  type SmokeTestCheck,
} from "@/app/actions/project-deployments";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:  string;
  hasConfig:  boolean;
  defaultEnv: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReadinessPanel({ projectId, hasConfig, defaultEnv }: Props) {
  const [checks,      setChecks]      = useState<SmokeTestCheck[]>([]);
  const [allOk,       setAllOk]       = useState<boolean | null>(null);
  const [error,       setError]       = useState("");
  const [environment, setEnvironment] = useState(defaultEnv);
  const [isPending,   startTransition] = useTransition();

  async function runSmokeTest() {
    setError("");
    startTransition(async () => {
      const res = await runProjectLoginSmokeTestAction(projectId, environment);
      setChecks(res.checks);
      setAllOk(res.ok);
      if (!res.ok && res.error) setError(res.error);
    });
  }

  // ── Icons ──────────────────────────────────────────────────────────────────

  function CheckIcon({ ok }: { ok: boolean }) {
    return ok
      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      : <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  }

  function OverallBadge() {
    if (allOk === null) return <Badge variant="secondary">Not tested</Badge>;
    if (allOk)          return <Badge variant="success">Ready</Badge>;
    return <Badge variant="warning">Incomplete</Badge>;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Deployment Readiness</CardTitle>
          </div>
          <OverallBadge />
        </div>
        <CardDescription>
          Verifies the project is fully functional: process, frontend, API health,
          database, secrets, and login route.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {checks.length > 0 && (
          <div className="rounded-md border divide-y text-sm">
            {checks.map((c) => (
              <div key={c.name} className="flex items-start gap-3 px-3 py-2.5">
                <CheckIcon ok={c.ok} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.name}</span>
                    {c.status != null && (
                      <span className="text-xs text-muted-foreground font-mono">
                        HTTP {c.status}
                      </span>
                    )}
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline truncate max-w-[200px]"
                      >
                        {c.url}
                      </a>
                    )}
                  </div>
                  {c.error && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-words">
                      {c.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="text-xs text-amber-600 flex items-start gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="production">Production</option>
            <option value="preview">Preview</option>
            <option value="development">Development</option>
          </select>

          <Button
            size="sm"
            variant="outline"
            onClick={runSmokeTest}
            disabled={isPending || !hasConfig}
            className="gap-2"
          >
            {isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Run readiness check
          </Button>
        </div>

        {!hasConfig && (
          <p className="text-xs text-muted-foreground">
            Deploy the project first to run readiness checks.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Separate statuses: <strong>Runtime</strong> (PM2 online),{" "}
          <strong>Readiness</strong> (all checks pass),{" "}
          <strong>Database</strong> (SELECT 1 success).
          A passing process does not imply a connected database.
        </p>
      </CardContent>
    </Card>
  );
}
