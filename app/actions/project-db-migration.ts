"use server";

/**
 * app/actions/project-db-migration.ts
 *
 * Server actions for pg_dump → pg_restore database migration.
 *
 * Security:
 *   - DB URLs are never returned to the client
 *   - All output is masked via sanitizeOutput + URL masking in db-migrator
 *   - wipTarget requires a separate explicit confirmation flag
 *   - Ownership verified on every action
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { runDbMigration } from "@/lib/projects/db-migrator";

// ── Ownership guard ────────────────────────────────────────────────────────

async function verifyOwnership(projectId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) return null;
  return project;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type DbMigrationActionResult = {
  ok:           boolean;
  error:        string;
  migrationId?: string;
  logs:         string;
  durationMs:   number;
};

// ── Run migration ──────────────────────────────────────────────────────────

/**
 * Runs a full pg_dump → pg_restore migration.
 *
 * WARNING: if wipTarget is true, the target DB's public schema is dropped
 * and recreated first. This is irreversible.
 *
 * DB URLs are only used server-side and are never logged or returned.
 */
export async function runDbMigrationAction(
  projectId:         string,
  sourceDatabaseUrl: string,
  targetDatabaseUrl: string,
  wipTarget:         boolean
): Promise<DbMigrationActionResult> {
  const project = await verifyOwnership(projectId);
  if (!project) {
    return { ok: false, error: "Not found or access denied.", logs: "", durationMs: 0 };
  }

  if (!sourceDatabaseUrl.startsWith("postgres")) {
    return { ok: false, error: "Invalid source database URL.", logs: "", durationMs: 0 };
  }
  if (!targetDatabaseUrl.startsWith("postgres")) {
    return { ok: false, error: "Invalid target database URL.", logs: "", durationMs: 0 };
  }

  // Create a RUNNING record
  const migration = await db.dbMigration.create({
    data: { projectId, status: "RUNNING", wipedTarget: wipTarget },
  });

  const result = await runDbMigration({
    projectId,
    sourceDatabaseUrl,
    targetDatabaseUrl,
    wipTarget,
  });

  // Update record with outcome
  await db.dbMigration.update({
    where: { id: migration.id },
    data: {
      status:     result.ok ? "SUCCESS" : "FAILED",
      dumpPath:   result.dumpPath ?? null,
      logs:       result.logs.slice(0, 20_000),
      finishedAt: new Date(),
    },
  });

  revalidatePath(`/projects/${projectId}/import`);

  return {
    ok:          result.ok,
    error:       result.ok ? "" : "Migration failed — see logs.",
    migrationId: migration.id,
    logs:        result.logs,
    durationMs:  result.durationMs,
  };
}

// ── List migrations ────────────────────────────────────────────────────────

export async function getDbMigrationsAction(projectId: string): Promise<{
  ok:    boolean;
  error: string;
  migrations: {
    id: string; status: string; wipedTarget: boolean;
    createdAt: Date; finishedAt: Date | null; logsPreview: string;
  }[];
}> {
  const project = await verifyOwnership(projectId);
  if (!project) return { ok: false, error: "Not found.", migrations: [] };

  const rows = await db.dbMigration.findMany({
    where:   { projectId },
    orderBy: { createdAt: "desc" },
    take:    20,
  });

  return {
    ok: true, error: "",
    migrations: rows.map((r) => ({
      id:          r.id,
      status:      r.status,
      wipedTarget: r.wipedTarget,
      createdAt:   r.createdAt,
      finishedAt:  r.finishedAt,
      logsPreview: (r.logs ?? "").slice(0, 500),
    })),
  };
}
