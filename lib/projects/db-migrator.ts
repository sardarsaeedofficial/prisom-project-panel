/**
 * lib/projects/db-migrator.ts
 *
 * Safe PostgreSQL database migration using pg_dump and pg_restore.
 *
 * Dump layout:  storage/migrations/{projectId}/{isoTimestamp}/dump.dump
 *
 * Safety rules:
 *   - DB connection URLs are masked in ALL returned log output
 *   - execFile only — no shell string, no shell injection possible
 *   - DROP SCHEMA requires an explicit wipTarget:true flag
 *   - pg_dump/pg_restore are checked before running (not silently failing)
 *   - Never return plaintext DB URLs to caller
 */

import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { sanitizeOutput } from "@/lib/server/command-runner";

const execFileAsync = promisify(execFile);

const MIGRATION_STORAGE = path.resolve(process.cwd(), "storage", "migrations");

// ── Types ──────────────────────────────────────────────────────────────────

export interface MigrationOptions {
  projectId:     string;
  sourceDatabaseUrl: string; // Replit DB URL (plaintext, never logged)
  targetDatabaseUrl: string; // Prisom project DB URL (plaintext, never logged)
  wipTarget:     boolean;    // DROP SCHEMA public CASCADE first
}

export interface MigrationResult {
  ok:        boolean;
  dumpPath?: string;
  logs:      string; // sanitised — no DB credentials
  durationMs: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Masks all postgres:// / postgresql:// URLs in a string. */
function maskDbUrls(text: string): string {
  return text.replace(
    /(?:postgresql|postgres):\/\/[^\s"'`]+/gi,
    "[DB_URL_REDACTED]"
  );
}

/** Returns true if a binary is on PATH. */
async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync("which", [name], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ── Main runner ─────────────────────────────────────────────────────────────

/**
 * Runs a full pg_dump → (optional wipe) → pg_restore pipeline.
 * All output is sanitised before returning.
 * Returns the dump file path on success.
 */
export async function runDbMigration(
  options: MigrationOptions
): Promise<MigrationResult> {
  const t0   = Date.now();
  const logs: string[] = [];

  const log = (line: string) => logs.push(maskDbUrls(sanitizeOutput(line)));
  const result = (): MigrationResult => ({
    ok: false,
    logs: logs.join("\n").slice(0, 50_000),
    durationMs: Date.now() - t0,
  });

  // ── Check pg_dump / pg_restore exist ─────────────────────────────────────
  const [hasDump, hasRestore] = await Promise.all([
    binaryExists("pg_dump"),
    binaryExists("pg_restore"),
  ]);

  if (!hasDump || !hasRestore) {
    const missing = [!hasDump && "pg_dump", !hasRestore && "pg_restore"]
      .filter(Boolean)
      .join(", ");
    log(`✗ ${missing} not found in PATH.`);
    log("  Install with: sudo apt-get install postgresql-client");
    log("  Or run migration manually:");
    log(`    pg_dump "$REPLIT_DATABASE_URL" --format=custom --no-owner --no-acl --file dump.dump`);
    log(`    pg_restore --no-owner --no-acl --dbname "$TARGET_DATABASE_URL" dump.dump`);
    return { ...result() };
  }

  // ── Create dump directory ─────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dumpDir   = path.join(MIGRATION_STORAGE, options.projectId, timestamp);
  const dumpFile  = path.join(dumpDir, "dump.dump");

  try {
    await fs.mkdir(dumpDir, { recursive: true });
  } catch (e) {
    log(`✗ Failed to create dump directory: ${(e as Error).message}`);
    return { ...result() };
  }

  log(`▶ pg_dump → ${dumpDir}/dump.dump`);

  // ── pg_dump ───────────────────────────────────────────────────────────────
  try {
    const { stdout, stderr } = await execFileAsync(
      "pg_dump",
      [
        options.sourceDatabaseUrl,
        "--format=custom",
        "--no-owner",
        "--no-acl",
        `--file=${dumpFile}`,
      ],
      {
        timeout: 300_000, // 5 min
        env: { ...process.env },
      }
    );
    if (stdout.trim()) log(stdout.trim());
    if (stderr.trim()) log(stderr.trim());
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    log(`✗ pg_dump failed: ${maskDbUrls(err.stderr ?? err.message ?? String(e))}`);
    return { ...result() };
  }

  log("✓ pg_dump complete");

  // ── Optional: wipe target schema ─────────────────────────────────────────
  if (options.wipTarget) {
    log("▶ Wiping target schema (DROP SCHEMA public CASCADE)…");
    const wipeSQL = [
      "DROP SCHEMA public CASCADE;",
      "CREATE SCHEMA public;",
      "GRANT ALL ON SCHEMA public TO public;",
    ].join(" ");

    try {
      const { stdout, stderr } = await execFileAsync(
        "psql",
        [options.targetDatabaseUrl, "-c", wipeSQL],
        { timeout: 60_000, env: { ...process.env } }
      );
      if (stdout.trim()) log(stdout.trim());
      if (stderr.trim()) log(stderr.trim());
      log("✓ Target schema wiped");
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      log(`✗ Schema wipe failed: ${maskDbUrls(err.stderr ?? err.message ?? String(e))}`);
      return { ...result() };
    }
  }

  // ── pg_restore ────────────────────────────────────────────────────────────
  log("▶ pg_restore → target database…");

  try {
    const { stdout, stderr } = await execFileAsync(
      "pg_restore",
      [
        "--no-owner",
        "--no-acl",
        `--dbname=${options.targetDatabaseUrl}`,
        dumpFile,
      ],
      {
        timeout: 300_000,
        env: { ...process.env },
      }
    );
    if (stdout.trim()) log(stdout.trim());
    if (stderr.trim()) log(stderr.trim());
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    // pg_restore exits non-zero for warnings (e.g. role not found) — check the message
    const msg = maskDbUrls(err.stderr ?? err.message ?? String(e));
    // Only treat as failure if it's a real error (not just warnings)
    if (msg.toLowerCase().includes("error:")) {
      log(`✗ pg_restore failed: ${msg}`);
      return { ...result() };
    }
    // Warnings are acceptable
    if (msg.trim()) log(`⚠ pg_restore warnings: ${msg}`);
  }

  log("✓ pg_restore complete — database migration finished");

  return {
    ok:         true,
    dumpPath:   dumpFile,
    logs:       logs.join("\n").slice(0, 50_000),
    durationMs: Date.now() - t0,
  };
}
