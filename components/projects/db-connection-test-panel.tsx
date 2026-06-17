"use client";

/**
 * components/projects/db-connection-test-panel.tsx
 *
 * Displays the last DB connection test result and exposes a "Test connection"
 * button that calls testProjectDatabaseConnectionAction server-side.
 *
 * Never shows the DATABASE_URL or any decrypted value.
 */

import { useState, useTransition } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  RefreshCw, Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { testProjectDatabaseConnectionAction } from "@/app/actions/project-deployments";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CachedResult {
  status:       string | null; // "ok" | "failed" | "missing_url" | null
  errorMessage: string | null;
  checkedAt:    Date | null;
  environment:  string | null;
}

interface Props {
  projectId:    string;
  hasDbConfig:  boolean; // true if a deployment config exists
  cachedResult: CachedResult;
  defaultEnv:   string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DbConnectionTestPanel({
  projectId,
  hasDbConfig,
  cachedResult,
  defaultEnv,
}: Props) {
  const [result,      setResult]      = useState<CachedResult>(cachedResult);
  const [liveError,   setLiveError]   = useState<string>("");
  const [isPending,   startTransition] = useTransition();
  const [environment, setEnvironment]  = useState(defaultEnv);

  async function runTest() {
    setLiveError("");
    startTransition(async () => {
      const res = await testProjectDatabaseConnectionAction(projectId, environment);
      setResult({
        status:       res.ok ? "ok" : (res.code ?? "failed"),
        errorMessage: res.ok ? null : res.error,
        checkedAt:    new Date(),
        environment:  res.environment,
      });
      if (!res.ok) setLiveError(res.error);
    });
  }

  // ── Status icon + badge ────────────────────────────────────────────────────

  function StatusIcon({ status }: { status: string | null }) {
    if (!status)            return <Database className="h-4 w-4 text-muted-foreground" />;
    if (status === "ok")    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "missing_url") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  }

  function StatusBadge({ status }: { status: string | null }) {
    if (!status)            return <Badge variant="secondary">Not tested</Badge>;
    if (status === "ok")    return <Badge variant="success">Connected</Badge>;
    if (status === "missing_url") return <Badge variant="warning">No DATABASE_URL</Badge>;
    return <Badge variant="error">Failed</Badge>;
  }

  function formatTime(d: Date | null) {
    if (!d) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short", timeStyle: "medium",
    }).format(d);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={result.status} />
            <CardTitle className="text-base">Database Connection</CardTitle>
          </div>
          <StatusBadge status={result.status} />
        </div>
        <CardDescription>
          Tests the project's <code className="font-mono">DATABASE_URL</code> for
          the selected environment by running{" "}
          <code className="font-mono">SELECT 1</code>. The URL is never returned
          to the browser.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Detail rows */}
        <div className="rounded-md border divide-y text-sm">
          <Row label="Status">
            <StatusBadge status={result.status} />
          </Row>
          <Row label="Last checked">
            {formatTime(result.checkedAt)}
          </Row>
          <Row label="Environment">
            {result.environment ?? environment}
          </Row>
          {result.errorMessage && (
            <Row label="Error">
              <span className="text-red-600 dark:text-red-400 text-xs font-mono break-all">
                {result.errorMessage}
              </span>
            </Row>
          )}
        </div>

        {liveError && (
          <p className="text-xs text-red-600 flex items-start gap-1">
            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {liveError}
          </p>
        )}

        {/* Environment selector + test button */}
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
            onClick={runTest}
            disabled={isPending || !hasDbConfig}
            className="gap-2"
          >
            {isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Test connection
          </Button>
        </div>

        {!hasDbConfig && (
          <p className="text-xs text-muted-foreground">
            Deploy the project first to enable the connection test.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="text-xs flex-1 min-w-0">{children}</span>
    </div>
  );
}
