/**
 * lib/auto-import/auto-import-database-assistant.ts
 *
 * Sprint 86: Explains database setup requirements clearly.
 * Distinguishes source (old Replit) DB from target (Prisom runtime) DB.
 * No secrets returned. No automatic DB mutations.
 */

import { db } from "@/lib/db";

export type DatabaseImportGuidance = {
  required: boolean;
  targetDatabaseConfigured: boolean;
  sourceDatabaseNeeded: boolean;
  sourceDatabaseProvided: boolean;
  targetDatabaseEnvName: "DATABASE_URL";
  guidance: string[];
  warnings: string[];
};

export async function generateDatabaseImportGuidance(input: {
  projectId: string;
}): Promise<DatabaseImportGuidance> {
  const { projectId } = input;

  const envVars = await db.projectEnvVar.findMany({
    where:  { projectId, isEnabled: true },
    select: { name: true },
  }).then((rows) => new Set(rows.map((r) => r.name)));

  const targetDatabaseConfigured = envVars.has("DATABASE_URL");

  // Check if there is a database migration record (source migration available)
  const migrationRecord = await db.dbMigration?.findFirst?.({
    where: { projectId },
    select: { id: true, status: true },
  }).catch(() => null) ?? null;

  const sourceDatabaseProvided = !!migrationRecord;

  // Determine if a database is required based on env var expectations
  const project = await db.project.findUnique({
    where:  { id: projectId },
    select: { slug: true },
  });

  const required = await detectDatabaseRequired(project?.slug ?? "");

  const guidance: string[] = [];
  const warnings: string[] = [];

  // Core clarification — always shown
  guidance.push(
    "DATABASE_URL on Prisom = your TARGET (live/runtime) database. This is where your app stores data.",
  );
  guidance.push(
    "If you have an old Replit DATABASE_URL — that is the SOURCE database (read for migration only).",
  );
  guidance.push(
    "Cloudinary is media storage, not a database. CLOUDINARY_* variables are separate.",
  );
  guidance.push(
    "Stripe is payments, not a database. STRIPE_* variables are separate.",
  );

  if (!targetDatabaseConfigured) {
    guidance.push(
      "Add DATABASE_URL pointing to your Prisom/VPS PostgreSQL database before deploying.",
    );
    warnings.push(
      "DATABASE_URL is not configured. The app will fail to start without a database connection.",
    );
  } else {
    guidance.push("DATABASE_URL is configured. Target database is ready.");
  }

  if (!sourceDatabaseProvided) {
    guidance.push(
      "No source database migration uploaded yet. You can start with an empty target database — the app will create tables on first run (if auto-migration is enabled).",
    );
  } else {
    guidance.push("Source database migration is available. Run the migration after confirming the target DATABASE_URL.");
  }

  warnings.push(
    "Never run database wipe commands automatically. Always confirm before migrating or dropping tables.",
  );

  return {
    required,
    targetDatabaseConfigured,
    sourceDatabaseNeeded:  required && !sourceDatabaseProvided,
    sourceDatabaseProvided,
    targetDatabaseEnvName: "DATABASE_URL",
    guidance,
    warnings,
  };
}

async function detectDatabaseRequired(slug: string): Promise<boolean> {
  if (!slug) return false;
  try {
    const { existsSync } = await import("fs");
    const path = await import("path");
    const sourceDir = path.default.resolve(process.cwd(), "storage", "projects", slug);
    // Knex migrations directory is a strong signal
    const hasMigrations =
      existsSync(path.default.join(sourceDir, "migrations")) ||
      existsSync(path.default.join(sourceDir, "artifacts", "api-server", "migrations")) ||
      existsSync(path.default.join(sourceDir, "artifacts", "api-server", "db"));
    return hasMigrations;
  } catch {
    return false;
  }
}
