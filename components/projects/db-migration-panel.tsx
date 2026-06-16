"use client";

/**
 * components/projects/db-migration-panel.tsx
 *
 * UI for migrating a Replit PostgreSQL database to the project's target DB
 * using pg_dump and pg_restore.
 *
 * WARNING: DB URLs typed here are sent to the server action only —
 * they are never stored or returned in any response.
 */

import { useState } from "react";
import {
  Database,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Terminal,
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
import { runDbMigrationAction } from "@/app/actions/project-db-migration";

interface Props {
  projectId: string;
}

export function DbMigrationPanel({ projectId }: Props) {
  const [sourceUrl,    setSourceUrl]    = useState("");
  const [targetUrl,    setTargetUrl]    = useState("");
  const [wipeTarget,   setWipeTarget]   = useState(false);
  const [confirmed,    setConfirmed]    = useState(false);
  const [isPending,    setIsPending]    = useState(false);
  const [result,       setResult]       = useState<{
    ok: boolean; logs: string; error: string
  } | null>(null);
  const [showLogs,     setShowLogs]     = useState(false);

  async function handleMigrate() {
    if (!sourceUrl.trim() || !targetUrl.trim()) return;
    if (wipeTarget && !confirmed) return;
    setIsPending(true);
    setResult(null);
    try {
      const res = await runDbMigrationAction(
        projectId,
        sourceUrl.trim(),
        targetUrl.trim(),
        wipeTarget
      );
      setResult({ ok: res.ok, logs: res.logs, error: res.error });
      if (res.ok) setShowLogs(true);
    } catch (e) {
      setResult({
        ok: false,
        logs: "",
        error: e instanceof Error ? e.message : "Unexpected error.",
      });
    } finally {
      setIsPending(false);
      // Clear DB URLs from memory for safety
      setSourceUrl("");
      setTargetUrl("");
      setConfirmed(false);
      setWipeTarget(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Database Migration</CardTitle>
        </div>
        <CardDescription>
          Export from Replit&apos;s PostgreSQL database and restore into your project&apos;s
          database using pg_dump / pg_restore.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── DB URLs ── */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sourceUrl" className="text-sm">
              Replit Database URL{" "}
              <span className="text-muted-foreground font-normal">(source)</span>
            </Label>
            <Input
              id="sourceUrl"
              type="password"
              className="h-9 font-mono text-sm"
              placeholder="postgresql://user:pass@host/db"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              From Replit: Tools → Database → Connection string.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="targetUrl" className="text-sm">
              Target Database URL{" "}
              <span className="text-muted-foreground font-normal">(destination)</span>
            </Label>
            <Input
              id="targetUrl"
              type="password"
              className="h-9 font-mono text-sm"
              placeholder="postgresql://user:pass@host/db"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              The target database for this project. Add DATABASE_URL to env vars instead of here.
            </p>
          </div>
        </div>

        {/* ── Wipe option ── */}
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-3 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={wipeTarget}
              onChange={(e) => { setWipeTarget(e.target.checked); setConfirmed(false); }}
              disabled={isPending}
            />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Wipe target database before restore
              </p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                Runs DROP SCHEMA public CASCADE then recreates it.
                All existing data in the target DB will be permanently deleted.
              </p>
            </div>
          </label>

          {wipeTarget && (
            <label className="flex items-center gap-2 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={isPending}
              />
              <span className="text-xs font-medium text-red-700 dark:text-red-400">
                I understand this will permanently delete all data in the target database.
              </span>
            </label>
          )}
        </div>

        {/* ── Manual commands ── */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Terminal className="h-3.5 w-3.5" />
            Show manual migration commands
          </summary>
          <pre className="mt-2 p-3 bg-zinc-950 text-zinc-200 rounded-md overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed">
{`# Export from Replit
pg_dump "$REPLIT_DATABASE_URL" \\
  --format=custom --no-owner --no-acl \\
  --file dump.dump

# (Optional) wipe target
psql "$TARGET_DATABASE_URL" -c "
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO public;"

# Restore to target
pg_restore --no-owner --no-acl \\
  --dbname "$TARGET_DATABASE_URL" \\
  dump.dump`}
          </pre>
        </details>

        {/* ── Feedback ── */}
        {result && (
          <div className={`rounded-md border px-3 py-2.5 space-y-2 ${
            result.ok
              ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          }`}>
            <div className="flex items-center gap-2">
              {result.ok
                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                : <XCircle className="h-4 w-4 text-red-500" />}
              <p className={`text-sm font-medium ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-400"}`}>
                {result.ok ? "Migration completed successfully" : result.error}
              </p>
            </div>
            {result.logs && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowLogs((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Migration logs
                </button>
                {showLogs && (
                  <pre className="mt-2 text-xs font-mono bg-zinc-950 text-zinc-200 rounded p-3 overflow-auto max-h-60 whitespace-pre-wrap">
                    {result.logs}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Action ── */}
        <Button
          onClick={handleMigrate}
          disabled={
            isPending ||
            !sourceUrl.trim() ||
            !targetUrl.trim() ||
            (wipeTarget && !confirmed)
          }
          variant="default"
          className="gap-2"
        >
          {isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Running migration…</>
          ) : (
            <><Database className="h-4 w-4" /> Run Migration</>
          )}
        </Button>

        {isPending && (
          <p className="text-xs text-muted-foreground">
            Migration may take several minutes for large databases. Do not close this tab.
          </p>
        )}

        {/* ── Security note ── */}
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
          <p className="font-medium text-foreground/70 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Security note
          </p>
          <p>Database URLs are used server-side only and are never stored or returned to the browser.</p>
          <p>After migration, add DATABASE_URL to this project&apos;s env vars instead of using it here.</p>
        </div>
      </CardContent>
    </Card>
  );
}
